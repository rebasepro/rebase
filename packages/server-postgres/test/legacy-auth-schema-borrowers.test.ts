import {
    dropLegacyAuthSchema,
    LEGACY_RLS_DEPENDENTS_SQL,
    LEGACY_RLS_FUNCTION_DEPENDENTS_SQL
} from "../src/schema/rls-bootstrap-sql";

/**
 * Retiring the pre-1.0 `auth` schema must not drop a helper somebody else is
 * calling.
 *
 * The policy half of this is safe by construction: Postgres records a
 * dependency for a policy that calls a function, so `DROP FUNCTION` refuses.
 * The *function* half is not. A `LANGUAGE sql` function whose body is a string
 * literal is never parsed at creation, so no dependency exists, `RESTRICT` has
 * nothing to refuse on, and the drop succeeds — leaving the caller pointing at
 * a function that is gone. It then fails when a query reaches it, not at boot.
 *
 * This is not hypothetical. The Rebase control plane defines
 * `auth.is_org_member(uuid)` and `auth.is_org_admin(uuid)` in that schema, both
 * calling `auth.uid()` from a string body, with eleven RLS policies going
 * through them. Verified against production: all 143 catalogue dependencies on
 * `auth.uid()` are `pg_policy` and none is `pg_proc`, so nothing was protecting
 * them. They survived only because policies still referenced `auth.uid()`
 * *directly* — which is exactly the condition the drop waits to stop being true.
 */

type Row = Record<string, unknown>;

/** A `run` that answers each query by prefix, and records what it was asked. */
function fakeRunner(answers: { policies?: Row[]; functions?: Row[]; onDrop?: () => void }) {
    const asked: string[] = [];
    const run = async (sql: string): Promise<Row[]> => {
        asked.push(sql);
        if (sql === LEGACY_RLS_DEPENDENTS_SQL) return answers.policies ?? [];
        if (sql === LEGACY_RLS_FUNCTION_DEPENDENTS_SQL) return answers.functions ?? [];
        answers.onDrop?.();
        return [];
    };
    return { run, asked };
}

function fakeReport() {
    const info: string[] = [];
    const warn: string[] = [];
    return { report: { info: (m: string) => info.push(m), warn: (m: string) => warn.push(m) }, info, warn };
}

describe("dropLegacyAuthSchema", () => {

    it("refuses to drop while another function borrows the helpers", async () => {
        let dropped = false;
        const { run } = fakeRunner({
            policies: [],
            functions: [
                { schema: "auth", function: "is_org_member" },
                { schema: "auth", function: "is_org_admin" }
            ],
            onDrop: () => { dropped = true; }
        });
        const { report, warn } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(dropped).toBe(false);
        expect(warn).toHaveLength(1);
        // The operator has to be able to act on this: name them.
        expect(warn[0]).toContain("auth.is_org_member()");
        expect(warn[0]).toContain("auth.is_org_admin()");
        // And say why Postgres did not stop it on its own.
        expect(warn[0]).toMatch(/records no dependency/i);
    });

    it("still refuses on a policy, and never reaches the function query", async () => {
        let dropped = false;
        const { run, asked } = fakeRunner({
            policies: [{ schema: "public", table: "notes", policy: "notes_owner" }],
            onDrop: () => { dropped = true; }
        });
        const { report, warn } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(dropped).toBe(false);
        expect(warn[0]).toContain("notes_owner");
        expect(asked).not.toContain(LEGACY_RLS_FUNCTION_DEPENDENTS_SQL);
    });

    it("drops when nothing references the helpers at all", async () => {
        let dropped = false;
        const { run } = fakeRunner({ policies: [], functions: [], onDrop: () => { dropped = true; } });
        const { report, warn } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(dropped).toBe(true);
        expect(warn).toHaveLength(0);
    });

    it("does not count the legacy helpers themselves as borrowers", () => {
        // `auth.uid()` reads `app.uid`, not `auth.uid`, so it would not match
        // anyway — but the query excludes them by name so that a future body
        // change cannot deadlock the drop against itself.
        expect(LEGACY_RLS_FUNCTION_DEPENDENTS_SQL)
            .toContain("NOT (n.nspname = 'auth' AND p.proname IN ('uid', 'jwt', 'roles'))");
    });

    it("looks in every schema, not just `auth`", () => {
        // A helper calling `auth.uid()` is far more likely to live in `public`.
        expect(LEGACY_RLS_FUNCTION_DEPENDENTS_SQL).toContain("pg_proc");
        expect(LEGACY_RLS_FUNCTION_DEPENDENTS_SQL).toContain("NOT IN ('pg_catalog', 'information_schema')");
        expect(LEGACY_RLS_FUNCTION_DEPENDENTS_SQL).not.toMatch(/WHERE\s+n\.nspname\s*=\s*'auth'/);
    });

    it("survives a database that will not answer the catalogue", async () => {
        const run = async () => { throw new Error("permission denied for schema pg_catalog"); };
        const { report, warn } = fakeReport();
        await expect(dropLegacyAuthSchema(run, report)).resolves.toBeUndefined();
        expect(warn).toHaveLength(0);
    });
});
