/**
 * The RLS half of `rebase doctor`, and the exit code `--policies` gates CI on.
 *
 * Lives beside `doctor-cli.ts` rather than inside it because that file runs
 * `main()` on import: a gate whose failure modes cannot be unit-tested is how
 * this one shipped reporting success for work it never did.
 */
import path from "path";
import chalk from "chalk";
import { CollectionConfig } from "@rebasepro/types";
import { loadCollections } from "./doctor";
import { checkPolicyDrift, formatPolicyDrift, hasDrift } from "../security/policy-drift";
import { validatePolicyPgRoles, warnOnAnonymousGrants } from "../security/rls-enforcement";

/**
 * What the RLS checks concluded.
 *
 * `unchecked` exists because "we could not look" and "we looked and it is fine"
 * used to be reported identically: a collections path that did not resolve made
 * the loader return `[]` (it warns, it does not throw), `checkPolicyDrift`
 * early-returned an empty diff, and the gate printed
 * `✓ RLS policies match your collections` having compared zero policies against
 * zero collections. Any exception at all — a collection file that throws on
 * import, a `pg_policies` read the CI role is not granted, a connection reset —
 * did the same thing through a `warn`, and exited 0.
 */
export type PolicyCheckStatus = "ok" | "problems" | "unchecked";

/**
 * The exit code for `rebase doctor --policies`.
 *
 * A gate that could not run has not passed. Only a completed, clean check
 * exits 0 — anything else, including "we never opened a connection", is a
 * failure, or the flag certifies a database nobody looked at.
 */
export function exitCodeForPolicyGate(status: PolicyCheckStatus): 0 | 1 {
    return status === "ok" ? 0 : 1;
}

/**
 * Policies actually deployed vs the ones the collections describe, plus policy
 * roles this server could never satisfy.
 *
 * Never reports `ok` for work it did not do — see {@link PolicyCheckStatus}.
 */
export async function runPolicyChecks(collectionsPath: string, databaseUrl?: string): Promise<PolicyCheckStatus> {
    if (!databaseUrl) {
        console.error(chalk.yellow("  ⚠ No DATABASE_URL — RLS policies were NOT checked"));
        return "unchecked";
    }

    const resolvedPath = path.resolve(process.cwd(), collectionsPath);
    let problems = false;
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
        const collections: CollectionConfig[] = await loadCollections(resolvedPath);

        // Zero collections is not "no drift", it is nothing to compare. The
        // loader returns `[]` for a path that does not exist, so the commonest
        // way to get here is a `--collections` path resolved against the wrong
        // directory — which used to render as a green tick.
        if (collections.length === 0) {
            console.error(chalk.red(`  ✗ No collections found in ${resolvedPath}`));
            console.error(chalk.gray("    RLS policies were NOT checked. Pass --collections=<dir> if your collections live elsewhere."));
            return "unchecked";
        }

        const runSql = async (text: string) => (await pool.query(text)).rows as Record<string, unknown>[];

        // A policy naming a role the server never runs as filters every row, so
        // the collection reads as empty. Report it without booting a server.
        try {
            await validatePolicyPgRoles(runSql, collections as never);
            console.log(chalk.green("  ✓ Policy roles are usable by this server"));
        } catch (err) {
            problems = true;
            console.log("");
            console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        }

        // A rule that reads as a lockdown but is true for every caller compiles
        // to a grant. Report it without booting a server.
        warnOnAnonymousGrants(collections as never);

        const drift = await checkPolicyDrift(pool as never, collections);
        console.log("");
        if (hasDrift(drift)) {
            problems = true;
            console.log(chalk.yellow("  RLS policies: database does not match your collections"));
            console.log(formatPolicyDrift(drift));
        } else {
            console.log(chalk.green(`  ✓ RLS policies match your collections (${collections.length} collection(s) checked)`));
        }
    } catch (err) {
        // Fail closed. This catch covers every query and every collection import
        // above, so returning the pre-catch verdict made the documented CI gate
        // green on exactly the runs it exists to catch.
        console.error(chalk.red("  ✗ Could not check RLS policies:"), err instanceof Error ? err.message : String(err));
        return "unchecked";
    } finally {
        await pool.end();
    }
    return problems ? "problems" : "ok";
}
