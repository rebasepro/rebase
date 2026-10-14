/**
 * A change to the cloud app's compiled RLS policies ships with a migration.
 *
 * The framework's boot compiles `securityRules` from saas/config/collections and
 * applies them to every table, so an edit does reach the database. What the boot
 * cannot do is create anything a new rule needs — a helper function, a column, a
 * table. When a rule calls one that is not there, `CREATE POLICY` is refused, the
 * table is left RLS-enabled in a deny-leaning partial state, the boot logs a
 * warning and the deploy reports green. The migration is where the function, the
 * column and the rewritten policy arrive first; the cloud app keeps every policy
 * change in one (0017 onwards, DROP-then-CREATE), which is also what makes its
 * history of who-can-read-what reviewable as SQL.
 *
 * So this refuses a deploy whose compiled policies differ from the merge-base's
 * with no migration SQL beside them. "Compiled" is the point: it compares what
 * `planCollectionPolicies` produces at both revisions (lib/cloud-policies.mjs),
 * not which lines changed, because a comment or a respelling the compiler undoes
 * changes no policy, and an edited constant far from its rule changes one on a
 * line that names none.
 *
 * It used to read the monorepo's `git diff`, in which `saas/` — gitignored, its
 * own repository — does not exist, so it passed on every run without looking.
 * `ctx.changed` now includes the nested repository's own changes.
 */
import path from "node:path";
import { context, baseRevision } from "../lib/ctx.mjs";
import { compareCloudPolicies } from "../lib/cloud-policies.mjs";
import { finding, pass, FAIL } from "../lib/report.mjs";

export const id = "rls-drift";
export const title = "Cloud RLS config/migration drift";

const CONFIG_PREFIX = "saas/config/collections/";
const MIGRATION_PREFIX = "saas/backend/drizzle/";

export function run(ctx = context()) {
    if (!ctx.hasSaas) return [pass(id, "No cloud workspace present — RLS drift check not applicable.")];

    const touched = ctx.changed.filter((file) => file.startsWith(CONFIG_PREFIX));
    if (!touched.length) return [pass(id, "No cloud collection config changed.")];

    const migrations = ctx.changed.filter((file) => file.startsWith(MIGRATION_PREFIX) && file.endsWith(".sql"));
    if (migrations.length) {
        return [pass(id, `Cloud collections changed (${touched.length} file(s)), with migration(s): ${migrations.join(", ")}.`)];
    }

    const saasRoot = path.join(ctx.root, "saas");
    const comparison = compareCloudPolicies(saasRoot, baseRevision(saasRoot) || "HEAD");
    const fix = `Add a migration under ${MIGRATION_PREFIX} that DROPs and re-CREATEs the affected policies (and creates anything they call), then verify against a prod replica.`;

    if (comparison.error !== undefined) {
        return [
            finding(
                id,
                FAIL,
                `${touched.join(", ")} changed with no accompanying migration SQL, and the policies could not be ` +
                    `compiled to tell whether that matters, so it is treated as a policy change: ${comparison.error}`,
                fix,
            ),
        ];
    }

    if (!comparison.changed.length) {
        return [
            pass(
                id,
                `Cloud collections changed (${touched.length} file(s)), but they compile to exactly the policies the ` +
                    "merge-base does — no migration needed.",
            ),
        ];
    }

    return [
        finding(
            id,
            FAIL,
            `The compiled RLS policies of ${comparison.changed.join(", ")} change (from ${touched.join(", ")}) with no ` +
                "accompanying migration SQL. If a new rule calls anything only a migration creates, the boot cannot " +
                "apply it and the table is left denying.",
            fix,
        ),
    ];
}
