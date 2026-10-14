import {
    DROP_LEGACY_AUTH_SCHEMA_SQL,
    dropLegacyAuthSchema,
    LEGACY_AUTH_SCHEMA_CONTENTS_SQL,
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
 * This was not hypothetical. The Rebase control plane defined
 * `auth.is_org_member(uuid)` and `auth.is_org_admin(uuid)` in that schema, both
 * calling `auth.uid()` from a string body, with eleven RLS policies going
 * through them. Verified against production: all 143 catalogue dependencies on
 * `auth.uid()` were `pg_policy` and none was `pg_proc`, so nothing was
 * protecting them. They survived only because policies still referenced
 * `auth.uid()` *directly* — which is exactly the condition the drop waits to
 * stop being true. (Its migration 0065 has since moved both to `public`.)
 *
 * The second half of this file is what that migration ran into next: with the
 * borrowers gone, the control plane's own `auth.uid()` — reading `app.user_id`
 * alone, as every Rebase release before v0.10.0 wrote it — did not match the
 * drop, and the schema stayed with nothing said.
 */

type Row = Record<string, unknown>;

/** The `auth` schema as a pre-1.0 Rebase left it. */
const REBASE_HELPERS: Row[] = [
    { object: "function auth.jwt()", helper: "ours" },
    { object: "function auth.roles()", helper: "ours" },
    { object: "function auth.uid()", helper: "ours" }
];

/**
 * A `run` that answers each query it knows, and records what it was asked.
 *
 * The schema holds Rebase's helpers until the drop runs and `after` once it
 * has — nothing, by default, meaning the schema went.
 */
function fakeRunner(answers: {
    policies?: Row[];
    functions?: Row[];
    before?: Row[];
    after?: Row[];
    onDrop?: () => void;
}) {
    const asked: string[] = [];
    let dropRan = false;
    const run = async (sql: string): Promise<Row[]> => {
        asked.push(sql);
        if (sql === LEGACY_AUTH_SCHEMA_CONTENTS_SQL) {
            return dropRan ? answers.after ?? [] : answers.before ?? REBASE_HELPERS;
        }
        if (sql === LEGACY_RLS_DEPENDENTS_SQL) return answers.policies ?? [];
        if (sql === LEGACY_RLS_FUNCTION_DEPENDENTS_SQL) return answers.functions ?? [];
        if (sql === DROP_LEGACY_AUTH_SCHEMA_SQL) {
            dropRan = true;
            answers.onDrop?.();
            return [];
        }
        throw new Error(`unexpected query: ${sql}`);
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

/** The one `IF EXISTS … DROP FUNCTION auth.<name>()` block of the drop for a helper. */
function dropBlockFor(name: string): string {
    const block = DROP_LEGACY_AUTH_SCHEMA_SQL.split("END IF;").find(b => b.includes(`DROP FUNCTION auth.${name}();`));
    if (!block) throw new Error(`no drop block for auth.${name}()`);
    return block;
}

describe("which `auth` helpers count as Rebase's", () => {

    it("drops an `auth.uid()` that reads only `app.user_id`, as every release before v0.10.0 wrote it", () => {
        const uid = dropBlockFor("uid");
        expect(uid).toContain("strpos(p.prosrc, 'app.user_id') > 0");
        // Still the later spelling too.
        expect(uid).toContain("strpos(p.prosrc, 'app.uid') > 0");
    });

    it("keeps the Supabase guard: a `text` result, and never a body reading `request.jwt`", () => {
        // Supabase's auth.uid() returns uuid and reads request.jwt.claims.
        const uid = dropBlockFor("uid");
        expect(uid).toContain("pg_get_function_result(p.oid) = 'text'");
        expect(uid).toContain("strpos(p.prosrc, 'request.jwt') = 0");
        // And the schema itself still only ever goes by RESTRICT.
        expect(DROP_LEGACY_AUTH_SCHEMA_SQL).toContain("DROP SCHEMA auth RESTRICT");
        expect(DROP_LEGACY_AUTH_SCHEMA_SQL).not.toMatch(/CASCADE/i);
    });

    it("never drops a function an extension installed", () => {
        // pg_session_jwt puts an `auth.jwt() RETURNS jsonb` in the same schema.
        for (const name of ["uid", "jwt", "roles"]) {
            expect(dropBlockFor(name)).toContain("e.deptype = 'e'");
        }
    });

    it("reports with the same matcher it drops with", () => {
        // The bug was the two disagreeing: a helper the drop did not recognise
        // was left, and nothing else knew to look for it.
        for (const guc of ["app.uid", "app.user_id", "app.jwt", "app.user_roles"]) {
            const test = `strpos(p.prosrc, '${guc}') > 0`;
            expect(DROP_LEGACY_AUTH_SCHEMA_SQL).toContain(test);
            expect(LEGACY_AUTH_SCHEMA_CONTENTS_SQL).toContain(test);
        }
    });
});

describe("dropLegacyAuthSchema reports a schema the drop left standing", () => {

    it("names what is still in it when `DROP SCHEMA … RESTRICT` was refused", async () => {
        const { run } = fakeRunner({ after: [{ object: "table auth.sessions", helper: null }] });
        const { report, warn } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(warn).toHaveLength(1);
        expect(warn[0]).toContain("  • table auth.sessions");
        expect(warn[0]).toContain("RESTRICT");
        expect(warn[0]).toContain("DROP SCHEMA auth;");
    });

    it("names a lookalike helper it would not drop, and why", async () => {
        const lookalike = { object: "function auth.uid()", helper: "lookalike" };
        const { run, asked } = fakeRunner({
            before: [lookalike],
            after: [lookalike],
            // Calls the lookalike, which nothing will drop: not a blocker.
            policies: [{ schema: "public", table: "notes", policy: "notes_owner" }]
        });
        const { report, warn } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(warn).toHaveLength(1);
        expect(warn[0]).toContain("function auth.uid()");
        expect(warn[0]).toMatch(/no release wrote this body/);
        expect(warn[0]).not.toContain("notes_owner");
        expect(asked).toEqual([LEGACY_AUTH_SCHEMA_CONTENTS_SQL]);
    });

    it("reports a drop that failed, with the object Postgres names in DETAIL", async () => {
        const { run } = fakeRunner({
            after: REBASE_HELPERS,
            onDrop: () => {
                throw Object.assign(
                    new Error("cannot drop function auth.uid() because other objects depend on it"),
                    { detail: "view public.me depends on function auth.uid()" }
                );
            }
        });
        const { report, warn, info } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(info).toHaveLength(0);
        expect(warn).toHaveLength(1);
        expect(warn[0]).toContain("cannot drop function auth.uid() because other objects depend on it");
        expect(warn[0]).toContain("view public.me depends on function auth.uid()");
        expect(warn[0]).toContain("function auth.uid() — Rebase's old helper, which could not be dropped");
    });

    it("says how to finish an empty schema the connection could not drop", async () => {
        const { run } = fakeRunner({ after: [{ object: null, helper: null }] });
        const { report, warn } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(warn).toHaveLength(1);
        expect(warn[0]).toMatch(/empty/);
        expect(warn[0]).toContain("DROP SCHEMA auth;");
        expect(warn[0]).not.toContain("•");
    });

    it("names at most twenty objects", async () => {
        const after = Array.from({ length: 25 }, (_, i) => ({ object: `table auth.t${i}`, helper: null }));
        const { run } = fakeRunner({ after });
        const { report, warn } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(warn[0]).toContain("table auth.t19");
        expect(warn[0]).not.toContain("table auth.t20");
        expect(warn[0]).toContain("…and 5 more");
    });

    it("says nothing when the drop takes the schema with it", async () => {
        const { run, asked } = fakeRunner({ after: [] });
        const { report, warn, info } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(asked[asked.length - 1]).toBe(LEGACY_AUTH_SCHEMA_CONTENTS_SQL);
        expect(warn).toHaveLength(0);
        expect(info).toHaveLength(0);
    });
});

describe("dropLegacyAuthSchema leaves an `auth` schema with no Rebase helper alone", () => {

    it("reads the catalogue once and stops when the schema is gone", async () => {
        const { run, asked } = fakeRunner({ before: [] });
        const { report, warn } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(asked).toEqual([LEGACY_AUTH_SCHEMA_CONTENTS_SQL]);
        expect(warn).toHaveLength(0);
    });

    it("does not touch, or report on, Supabase's `auth`", async () => {
        // Its policies call its own auth.uid(); counting them as blockers would
        // tell somebody to rewrite every policy they have.
        let dropped = false;
        const { run, asked } = fakeRunner({
            before: [
                { object: "function auth.uid()", helper: null },
                { object: "function auth.jwt()", helper: null },
                { object: "table auth.users", helper: null }
            ],
            policies: [{ schema: "public", table: "notes", policy: "notes_owner" }],
            onDrop: () => { dropped = true; }
        });
        const { report, warn } = fakeReport();

        await dropLegacyAuthSchema(run, report);

        expect(asked).toEqual([LEGACY_AUTH_SCHEMA_CONTENTS_SQL]);
        expect(dropped).toBe(false);
        expect(warn).toHaveLength(0);
    });
});
