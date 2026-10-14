/**
 * What `rebase db push` will do to row-level security, read before it does it.
 *
 * Atlas has no model for a policy: its free tier neither plans nor reads one.
 * So its plan, which was everything `db push --dry-run` showed, never named
 * one. After `schema introspect` on a database whose tables had policies of
 * their own and no admin baseline, the dry run said "No changes: the database
 * already matches these collections", and the push then created eight
 * `<table>_default_admin_*` policies that let an admin read and write every
 * row.
 *
 * The plan is the push's own steps, read instead of run:
 *
 * - **RLS switched on:** the tables `lockCollectionTables` switches on
 *   ({@link tablesRlsWouldEnable}).
 * - **Policies created and replaced:** `policies.sql`, which DROPs and CREATEs
 *   every declared policy, against the database as `checkPolicyDrift` reads
 *   it: by name, `TO` list, command, mode and which clauses there are. Text
 *   is compared through the stamp the push and every boot write
 *   ({@link readPolicyStamps}), which is what catches a rule whose SQL changed
 *   under the same name. Where the stamp does not match, or there is none (a
 *   policy `db migrate` or a hand made), the policy is made again under a probe
 *   name and rolled back ({@link probeRenderedPolicies}): one Postgres would
 *   store exactly as it is now is no change. Only one that could not be probed
 *   is listed as unstamped.
 * - **Policies dropped and kept:** {@link partitionOrphans}, which is how the
 *   push's reconcile step decides.
 */
import type { CollectionConfig } from "@rebasepro/types";
import {
    checkPolicyDrift,
    parseExpectedPolicies,
    partitionOrphans,
    type PolicyRef,
    type Queryable
} from "../security/policy-drift";
import { generatePostgresPoliciesDdl } from "./generate-postgres-ddl-logic";
import { probeRenderedPolicies, readPolicyStamps, tablesRlsWouldEnable } from "./ensure-collection-policies";

export interface PolicyPushPlan {
    /** Declared tables in the database with row-level security off, as `schema.table`: the push switches it on. */
    enableRls: string[];
    /** Declared policies the database does not have: the push creates them. */
    create: PolicyRef[];
    /** Declared policies the database has under the same name, defined otherwise: the push replaces them. */
    replace: { policy: PolicyRef; why: string[] }[];
    /** Policies an earlier push generated from a rule edited since: the push drops them. */
    drop: PolicyRef[];
    /** Policies no collection describes, which the push leaves in force. */
    keep: PolicyRef[];
    /** Declared policies the database has with no stamp of Rebase's: re-created from their rules, changed or not. */
    unstamped: PolicyRef[];
}

const keyOf = (p: PolicyRef): string => `${p.schema}.${p.table}.${p.name}`;

/** What a stamp that no longer matches says. */
const STALE = "its rule, or the policy itself, has changed since Rebase wrote it";

/** What a policy with no stamp, whose rule stores something else, says. */
const UNSTAMPED_DIFFERS = "it carries no stamp of Rebase's, and its rule defines it otherwise";

/**
 * Read the plan.
 *
 * @param options.searchPath the `search_path` the stamps were written under
 *        when the connection's own differs — the one `db push` stamps under.
 *        See {@link readPolicyStamps}.
 */
export async function planPolicyPush(
    client: Queryable,
    collections: CollectionConfig[],
    options: { searchPath?: string } = {}
): Promise<PolicyPushPlan> {
    const drift = await checkPolicyDrift(client, collections);
    const { dropped, kept } = partitionOrphans(drift, collections);
    const enableRls = await tablesRlsWouldEnable(client, collections);
    const stamps = await underSearchPath(client, options.searchPath, () => readPolicyStamps(client, collections));

    const replace = drift.diverged.map(d => ({ policy: d.expected, why: d.differences }));
    const settled = new Set([...drift.missing, ...drift.diverged.map(d => d.expected)].map(keyOf));
    const unsure: { policy: PolicyRef; state: "stale" | "unstamped" }[] = [];
    for (const policy of parseExpectedPolicies(generatePostgresPoliciesDdl(collections))) {
        if (settled.has(keyOf(policy))) continue;
        const state = stamps.get(`${policy.schema}.${policy.table}`)?.get(policy.name);
        if (state === "stale" || state === "unstamped") unsure.push({ policy, state });
    }
    // What the stamp cannot say, asked of Postgres: would the push store the
    // definition that is there? A policy it would re-create exactly is no change.
    const rendersAsStored = unsure.length === 0
        ? new Map<string, boolean>()
        : await probeRenderedPolicies(client, collections, unsure.map(entry => entry.policy), { searchPath: options.searchPath });
    const unstamped: PolicyRef[] = [];
    for (const { policy, state } of unsure) {
        const same = rendersAsStored.get(keyOf(policy));
        if (same === true) continue;
        if (state === "stale") replace.push({ policy, why: [STALE] });
        else if (same === false) replace.push({ policy, why: [UNSTAMPED_DIFFERS] });
        else unstamped.push(policy);
    }

    return { enableRls, create: drift.missing, replace, drop: dropped, keep: kept, unstamped };
}

/** Whether the push would change any row-level security. Kept and unstamped policies are not changes. */
export function policyPlanChanges(plan: PolicyPushPlan): boolean {
    return plan.enableRls.length + plan.create.length + plan.replace.length + plan.drop.length > 0;
}

const describe = (p: PolicyRef): string => `${p.schema}.${p.table} → "${p.name}" (${p.command} TO ${p.roles.join(", ")})`;

/**
 * The plan as `db push --dry-run` prints it: `changes`, what the push does,
 * and `notes`, what it leaves or cannot tell. Both empty when there is
 * nothing to say.
 */
export function formatPolicyPushPlan(plan: PolicyPushPlan): { changes: string[]; notes: string[] } {
    const changes: string[] = [];
    if (policyPlanChanges(plan)) {
        changes.push("  Planned row-level security changes:");
        for (const table of plan.enableRls) changes.push(`       switch RLS on   ${table}`);
        for (const p of plan.create) changes.push(`       create policy   ${describe(p)}`);
        for (const { policy, why } of plan.replace) changes.push(`       replace policy  ${describe(policy)}: ${why.join("; ")}`);
        for (const p of plan.drop) changes.push(`       drop policy     ${describe(p)}, left by a rule edited since`);
    }

    const notes: string[] = [];
    if (plan.unstamped.length > 0) {
        notes.push(`  ${plan.unstamped.length} declared ${plan.unstamped.length === 1 ? "policy carries" : "policies carry"} ` +
            "no stamp of Rebase's, so the push re-creates each from its rule");
        notes.push("  and cannot tell beforehand whether that changes it:");
        for (const p of plan.unstamped) notes.push(`       ${describe(p)}`);
    }
    if (plan.keep.length > 0) {
        notes.push("  Policies in the database that no collection describes, which the push leaves in force:");
        for (const p of plan.keep) notes.push(`       ${describe(p)}`);
    }
    return { changes, notes };
}

/** One line for the push itself: the counts, or `null` when it changes no row-level security. */
export function summarizePolicyPushPlan(plan: PolicyPushPlan): string | null {
    if (!policyPlanChanges(plan)) return null;
    const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
    const parts = [
        plan.create.length > 0 ? count(plan.create.length, "policy to create", "policies to create") : "",
        plan.replace.length > 0 ? `${plan.replace.length} to replace` : "",
        plan.drop.length > 0 ? `${plan.drop.length} to drop` : "",
        plan.enableRls.length > 0 ? `RLS to switch on for ${count(plan.enableRls.length, "table", "tables")}` : ""
    ].filter(Boolean);
    return `  Row-level security: ${parts.join(", ")}. \`rebase db push --dry-run\` lists them.`;
}

/**
 * Run `read` under `searchPath`, set for one transaction and gone after it, or
 * as the connection is when there is none to set.
 */
async function underSearchPath<T>(client: Queryable, searchPath: string | undefined, read: () => Promise<T>): Promise<T> {
    if (!searchPath) return read();
    await client.query("BEGIN");
    try {
        await client.query(`SET LOCAL search_path TO ${searchPath}`);
        const result = await read();
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
}
