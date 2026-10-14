/**
 * The stamps `rebase db migrate` leaves on the policies it applied.
 *
 * A boot leaves a table's policies alone only when each carries the stamp a
 * boot or a push writes (`COMMENT ON POLICY … IS 'rebase:<hash>'`, see
 * `policyStampSql`). `db push` stamps what `policies.sql` just created. A
 * migration runs the same statements — `db generate` appends `policies.sql` to
 * it — and stamped nothing, so the first boot after every migrate dropped and
 * re-created every policy once, an ACCESS EXCLUSIVE lock per table: 44 on the
 * blog scaffold.
 *
 * Migrate cannot stamp what the files hold, the way push stamps what it just
 * ran: a migration was written from the collections of its day, and the
 * database may hold something a later one, or a hand, made since. A stamp
 * there would tell the boot a policy is what the rule makes when it is not, and
 * the boot would never put it right. So each declared policy without a current
 * stamp is asked of Postgres instead, as `db push --dry-run` asks it
 * (`probeRenderedPolicies`): made again from its rule under a probe name, in a
 * transaction that is rolled back, and compared. Only a policy whose stored
 * definition is exactly what its rule makes is stamped. Any other keeps no
 * stamp, and the boot re-applies its table, as before.
 */
import path from "path";
import chalk from "chalk";
import type { CollectionConfig } from "@rebasepro/types";
import type { Queryable } from "../security/policy-drift";
import { withAppClient } from "../cli-helpers";
import { out, outWarn } from "../cli-output";
import { pinSearchPath } from "../connection";
import { planCollectionPolicies } from "./generate-postgres-ddl-logic";
import { policyStampSql, probeRenderedPolicies, readPolicyStamps } from "./ensure-collection-policies";
import { underSearchPath } from "./push-policy-plan";
import { loadCollections } from "./doctor";

/**
 * `rebase db migrate`'s last step: stamp what the migration left as its rules
 * make it, on this process's connection. Never fatal — a policy left
 * unstamped costs the next boot a re-apply of its table, which is what every
 * boot after a migrate did before this.
 */
export async function stampMigratedPolicies(databaseUrl: string, collectionsPath: string): Promise<void> {
    try {
        const collections = await loadCollections(path.resolve(process.cwd(), collectionsPath));
        // The rule the boot's connections follow: `search_path=public` unless
        // the URL pins one of its own, in which case this connection has it too.
        const searchPath = pinSearchPath(databaseUrl) === databaseUrl ? undefined : "public";
        const { stamped } = await withAppClient(databaseUrl, client => stampPoliciesStoredAsRendered(
            { query: async (text, values) => ({ rows: (await client.query(text, values)).rows }) },
            collections,
            { searchPath }
        ));
        if (stamped > 0) {
            out(chalk.gray(`  ✓ Stamped ${stamped} RLS ${stamped === 1 ? "policy" : "policies"} as their rules make them, so the next boot leaves ${stamped === 1 ? "it" : "them"} alone.`));
        }
    } catch (err) {
        outWarn(chalk.yellow(`  ⚠️  The policies could not be stamped (${err instanceof Error ? err.message : String(err)}); the next boot applies them again.`));
    }
}

/**
 * Stamp every declared policy whose stored definition its rule would store
 * as it is, and none other.
 *
 * @param options.searchPath the `search_path` a boot reads policies under,
 *        when the connection's own differs — the stamp hashes `pg_get_expr`,
 *        whose spelling depends on it. See `PolicyStamping.searchPath`.
 * @returns how many policies were stamped.
 */
export async function stampPoliciesStoredAsRendered(
    client: Queryable,
    collections: CollectionConfig[],
    options: { searchPath?: string } = {}
): Promise<{ stamped: number }> {
    const plans = planCollectionPolicies(collections);
    if (plans.length === 0) return { stamped: 0 };

    const states = await underSearchPath(client, options.searchPath, () => readPolicyStamps(client, collections));
    const unsure: { schema: string; table: string; name: string }[] = [];
    for (const plan of plans) {
        for (const [name, state] of states.get(plan.qualified) ?? []) {
            if (state !== "current") unsure.push({ schema: plan.schema, table: plan.table, name });
        }
    }
    if (unsure.length === 0) return { stamped: 0 };

    const confirmed = await probeRenderedPolicies(client, collections, unsure, { searchPath: options.searchPath });
    const statements: string[] = [];
    let stamped = 0;
    for (const plan of plans) {
        const names = new Set(unsure
            .filter(p => p.schema === plan.schema && p.table === plan.table
                && confirmed.get(`${p.schema}.${p.table}.${p.name}`) === true)
            .map(p => p.name));
        const statement = names.size > 0 ? policyStampSql(plan, names) : undefined;
        if (!statement) continue;
        statements.push(statement);
        stamped += names.size;
    }
    if (statements.length === 0) return { stamped: 0 };

    await underSearchPath(client, options.searchPath, async () => {
        for (const statement of statements) await client.query(statement);
    });
    return { stamped };
}
