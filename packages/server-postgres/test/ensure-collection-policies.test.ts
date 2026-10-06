import { PGlite } from "@electric-sql/pglite";
import { CollectionConfig } from "@rebasepro/types";
import { planCollectionPolicies } from "../src/schema/generate-postgres-ddl-logic";
import { ensureCollectionPolicies, lockCollectionTables } from "../src/schema/ensure-collection-policies";
import type { Queryable } from "../src/schema/ensure-collection-tables";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";

/**
 * The boot-time RLS applier and the plan behind it.
 *
 * `planCollectionPolicies` is what makes a managed tenant's tables servable at
 * boot; `ensureCollectionPolicies` runs it against the database. Both are unit
 * tested here without Postgres — the end-to-end behaviour is pinned against a
 * real container in `test/e2e/managed-boot-acceptance.test.ts`.
 */

const tiers: CollectionConfig = {
    name: "Tiers", slug: "tiers", table: "tiers", schema: "public",
    properties: { id: { name: "ID", type: "string", isId: true }, label: { name: "L", type: "string" } },
    securityRules: [{ operation: "select", access: "public" }]
} as unknown as CollectionConfig;

const customers: CollectionConfig = {
    name: "Customers", slug: "customers", table: "customers", schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        owner_id: { name: "O", type: "string" }
    },
    securityRules: [{ operation: "all", ownerField: "owner_id" }]
} as unknown as CollectionConfig;

describe("planCollectionPolicies", () => {
    it("emits an ENABLE RLS statement and CREATE POLICY statements per declared table", () => {
        const plans = planCollectionPolicies([tiers, customers]);
        const byTable = Object.fromEntries(plans.map(p => [p.table, p]));

        expect(byTable.tiers.enableRls).toBe(`ALTER TABLE "public"."tiers" ENABLE ROW LEVEL SECURITY;`);
        expect(byTable.tiers.qualified).toBe("public.tiers");
        // Every statement is a complete, single command (ends in ';', no newline).
        for (const s of byTable.tiers.policyStatements) expect(s.trimEnd().endsWith(";")).toBe(true);
        expect(byTable.tiers.policyStatements.some(s => /^CREATE POLICY/.test(s))).toBe(true);
        expect(byTable.customers.policyStatements.some(s => /CREATE POLICY/.test(s))).toBe(true);
    });

    it("includes junction tables — boot creates them, so it must police them too", () => {
        const tags: CollectionConfig = {
            slug: "tags", table: "tags", name: "Tags", properties: { name: { type: "string" } }
        } as unknown as CollectionConfig;
        const posts: CollectionConfig = {
            slug: "posts", table: "posts", name: "Posts",
            properties: { title: { type: "string" } },
            relations: [{
                kind: "manyToMany", relationName: "tags", target: () => tags,
                through: { table: "posts_to_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
            }]
        } as unknown as CollectionConfig;

        const plans = planCollectionPolicies([posts, tags]);
        const tables = plans.map(p => p.table);
        expect(tables).toContain("posts");
        expect(tables).toContain("tags");
        // A junction left un-policed is readable and writable by every signed-in
        // user, so it may never be created without its derived RLS.
        expect(tables).toContain("posts_to_tags");
        const junction = plans.find(p => p.table === "posts_to_tags")!;
        expect(junction.enableRls).toMatch(/ENABLE ROW LEVEL SECURITY/);
        expect(junction.policyStatements.some(s => /^CREATE POLICY/.test(s))).toBe(true);
    });
});

/** A fake DB: reports the named tables as present, records DDL, fails on cue. */
function fakeDb(present: string[], failOn?: RegExp): { queryable: Queryable; ran: string[] } {
    const ran: string[] = [];
    const queryable: Queryable = {
        async query<T>(text: string): Promise<{ rows: T[] }> {
            if (/information_schema\.columns/i.test(text)) {
                const rows = present.map(t => {
                    const [table_schema, table_name] = t.split(".");
                    return { table_schema, table_name, column_name: "id" };
                });
                return { rows: rows as unknown as T[] };
            }
            if (/pg_type/i.test(text)) return { rows: [] };
            if (/pg_constraint/i.test(text)) return { rows: [] };
            // Column comments — where a generated search column's fingerprint
            // lives. A catalogue read, like the three above, not DDL.
            if (/pg_description/i.test(text)) return { rows: [] };
            // Enum values, the table list, and the row-existence probe behind
            // the NOT NULL decision. Catalogue reads too: `ran` is the record of
            // what this path *changed*, and the assertions below read it as
            // such.
            if (/pg_enum/i.test(text)) return { rows: [] };
            if (/pg_class/i.test(text)) return { rows: [] };
            // The helper functions and extensions the table ensure looks up so
            // an unchanged one is not re-created.
            if (/pg_proc|pg_extension/i.test(text)) return { rows: [] };
            if (/EXISTS\(SELECT 1 FROM/i.test(text)) return { rows: [] };
            ran.push(text);
            if (failOn && failOn.test(text)) throw new Error("boom");
            return { rows: [] };
        }
    };
    return { queryable, ran };
}

describe("ensureCollectionPolicies", () => {
    it("applies policies to tables that exist and counts the CREATE POLICY statements", async () => {
        const { queryable, ran } = fakeDb(["public.tiers", "public.customers"]);
        const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

        expect(result.tablesSecured).toBe(2);
        expect(result.failures).toEqual([]);
        expect(result.skipped).toEqual([]);
        const lines = ran.flatMap(s => s.split("\n"));
        expect(result.policiesApplied).toBe(lines.filter(s => /^CREATE POLICY/.test(s)).length);
        expect(result.policiesApplied).toBeGreaterThan(0);
        // RLS was enabled before any policy statement ran.
        expect(lines.find(s => /ENABLE ROW LEVEL SECURITY|CREATE POLICY/.test(s))).toMatch(/ENABLE ROW LEVEL SECURITY/);
    });

    it("skips a declared table the database does not have, without failing", async () => {
        const { queryable } = fakeDb(["public.tiers"]); // customers absent
        const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

        expect(result.tablesSecured).toBe(1);
        expect(result.skipped.map(s => s.table)).toEqual(["public.customers"]);
        expect(result.failures).toEqual([]);
    });

    it("records a per-table policy failure and keeps going (denies, never crash-loop)", async () => {
        // Only customers' CREATE POLICY fails; its RLS is on, so it denies —
        // and tiers must still be secured.
        // Multiline: the table's statements arrive as one transaction, and the
        // one-statement-at-a-time fallback that follows its failure is what
        // leaves the table in today's partial, denying state.
        const { queryable } = fakeDb(["public.tiers", "public.customers"], /^CREATE POLICY[\s\S]*"customers"/m);
        const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

        expect(result.failures.map(f => f.table)).toEqual(["public.customers"]);
        expect(result.unsecured).toEqual([]);
        expect(result.tablesSecured).toBe(2); // RLS is on for both
    });

    /**
     * `ENABLE ROW LEVEL SECURITY` failing is the opposite of a policy failing,
     * and the two used to share a `try` and a message.
     *
     * By the time this runs, `ensureRlsEnforcement` has already granted the user
     * role DML across the schema. A policy statement failing therefore leaves
     * the table denying — RLS on, no matching policy — but `enableRls` failing
     * leaves RLS *off* over that grant: readable and writable by every
     * authenticated request, with no row filtering. It was reported as a
     * `failure`, in the failure case's words: "it stays locked (denies)".
     */
    describe("when RLS cannot be enabled at all", () => {
        const enableFails = /ENABLE ROW LEVEL SECURITY[\s\S]*"customers"|"customers"[\s\S]*ENABLE ROW LEVEL SECURITY/;

        it("revokes the grant instead of serving an unprotected table", async () => {
            const { queryable, ran } = fakeDb(["public.tiers", "public.customers"], enableFails);
            const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

            // Not a `failure`: that word now means "on and denying".
            expect(result.failures).toEqual([]);
            expect(result.unsecured.map(u => u.table)).toEqual(["public.customers"]);
            expect(result.unsecured[0].grantWithdrawn).toBe(true);

            // The privilege is actually taken back, naming that table.
            expect(ran.some(t => /^REVOKE ALL PRIVILEGES ON "public"\."customers" FROM /.test(t))).toBe(true);
            // And no policy was attempted on a table with RLS off.
            expect(ran.some(t => /^CREATE POLICY[\s\S]*"customers"/.test(t))).toBe(false);
            // The healthy table is untouched by its neighbour's failure.
            expect(result.tablesSecured).toBe(1);
        });

        it("reports grantWithdrawn: false when the revoke also fails", async () => {
            // Neither securable nor closable — the caller escalates this to a
            // refusal to boot, because the alternative is serving it open.
            const { queryable } = fakeDb(
                ["public.tiers", "public.customers"],
                /customers/  // matches the ENABLE, and the REVOKE too
            );
            const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

            expect(result.unsecured.map(u => u.table)).toEqual(["public.customers"]);
            expect(result.unsecured[0].grantWithdrawn).toBe(false);
        });

        /**
         * The revoke named the table unquoted, so Postgres folded it to lower
         * case: a mixed-case adopted table — Prisma's `"User"` — was revoked as
         * `public.user`, which does not exist. `grantWithdrawn` came back false
         * and boot refused to start, over a table it could have closed.
         */
        it("closes a mixed-case table by its exact name", async () => {
            const users: CollectionConfig = {
                name: "Users", slug: "users", table: "User", schema: "public",
                properties: { id: { name: "ID", type: "string", isId: true } },
                securityRules: [{ operation: "select", access: "public" }]
            };
            const db = new PGlite();
            try {
                await db.exec(
                    "CREATE ROLE rebase_user;" +
                    'CREATE TABLE "public"."User" ("id" TEXT PRIMARY KEY);' +
                    'GRANT ALL PRIVILEGES ON "public"."User" TO rebase_user;'
                );
                // RLS cannot be enabled on a table the runtime does not own;
                // PGlite runs as its owner, so the refusal is staged here.
                const queryable: Queryable = {
                    async query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
                        if (/ENABLE ROW LEVEL SECURITY/.test(text)) throw new Error("must be owner of table User");
                        return db.query<T>(text, values);
                    }
                };
                const result = await ensureCollectionPolicies(queryable, [users]);

                expect(result.unsecured).toEqual([
                    { table: "public.User", error: "must be owner of table User", grantWithdrawn: true }
                ]);
                const { rows } = await db.query<{ can: boolean }>(
                    "SELECT has_table_privilege('rebase_user', '\"public\".\"User\"', 'SELECT') AS can");
                expect(rows).toEqual([{ can: false }]);
            } finally {
                await db.close();
            }
        }, 30_000);
    });
});

/**
 * A boot that changes nothing takes no lock to find that out, and never closes
 * a table that was protected all along.
 *
 * `ENABLE ROW LEVEL SECURITY` on a table that already has it is a no-op that
 * still queues for an ACCESS EXCLUSIVE lock. Measured on Postgres 18 with a
 * reader holding every table (a `pg_dump`): each ENABLE waited out the
 * statement timeout, and the catch below it REVOKEd the user role's privileges
 * — 12 of 12 tables unreadable afterwards, on every replica, until the next
 * clean boot.
 */
describe("a table whose RLS is already on", () => {
    /** Tables with their RLS state; the second read (after a failed ENABLE) answers `recheck`. */
    function catalogueDb(tables: Record<string, boolean>, options: { enableError?: Error; recheck?: boolean } = {}) {
        const ran: string[] = [];
        const queryable: Queryable = {
            async query<T>(text: string): Promise<{ rows: T[] }> {
                if (/information_schema\.columns/i.test(text)) {
                    const rows = Object.entries(tables).map(([qualified, rls]) => {
                        const [table_schema, table_name] = qualified.split(".");
                        return { table_schema, table_name, rls };
                    });
                    return { rows: rows as unknown as T[] };
                }
                if (/relrowsecurity/i.test(text)) return { rows: [{ rls: options.recheck === true }] as unknown as T[] };
                if (/^\s*SELECT\b[\s\S]*\bFROM pg_polic(?:y|ies)\b/i.test(text)) return { rows: [] };
                ran.push(text);
                if (options.enableError && /ENABLE ROW LEVEL SECURITY/.test(text)) throw options.enableError;
                return { rows: [] };
            }
        };
        return { queryable, ran };
    }

    const lockTimeout = (): Error => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });

    it("is not re-enabled and not revoked on a boot that changes nothing", async () => {
        const { queryable, ran } = catalogueDb({ "public.tiers": true, "public.customers": true });
        const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

        expect(ran.filter(t => /ENABLE ROW LEVEL SECURITY/.test(t))).toEqual([]);
        expect(ran.filter(t => /^REVOKE/.test(t))).toEqual([]);
        expect(result.tablesSecured).toBe(2);
        expect(result.unsecured).toEqual([]);
    });

    it("is not revoked when its ENABLE times out but the catalogue says RLS is on", async () => {
        // The first read says off (a peer is enabling it right now); the ENABLE
        // then loses a lock wait; the catalogue, asked again, says on.
        const { queryable, ran } = catalogueDb({ "public.customers": false }, { enableError: lockTimeout(), recheck: true });
        const result = await ensureCollectionPolicies(queryable, [customers]);

        expect(ran.filter(t => /^REVOKE/.test(t))).toEqual([]);
        expect(result.unsecured).toEqual([]);
        expect(result.tablesSecured).toBe(1);
    });

    it("is still revoked when its ENABLE times out and RLS really is off", async () => {
        // The safety the skip must not weaken: RLS off over the schema-wide
        // grant is an open table, whatever the reason the ENABLE failed.
        const { queryable, ran } = catalogueDb({ "public.customers": false }, { enableError: lockTimeout(), recheck: false });
        const result = await ensureCollectionPolicies(queryable, [customers]);

        expect(ran.some(t => /^REVOKE ALL PRIVILEGES ON "public"\."customers" FROM /.test(t))).toBe(true);
        expect(result.unsecured.map(u => [u.table, u.grantWithdrawn])).toEqual([["public.customers", true]]);
    });

    it("is not re-enabled by `db push`'s lock step either", async () => {
        const { queryable, ran } = catalogueDb({ "public.tiers": true, "public.customers": false });
        const result = await lockCollectionTables(queryable, [tiers, customers]);

        expect(ran).toEqual(['ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;']);
        expect(result).toEqual({ locked: 2, unsecured: [] });
    });

    it("is left alone by a second boot against a real database", async () => {
        const db = new PGlite();
        try {
            await db.exec(
                'CREATE TABLE "public"."tiers" ("id" TEXT PRIMARY KEY, "label" TEXT);' +
                'CREATE TABLE "public"."customers" ("id" TEXT PRIMARY KEY, "owner_id" TEXT);'
            );
            for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
            const ran: string[] = [];
            // `exec` speaks the simple protocol, as node-postgres does.
            const queryable: Queryable = {
                async query<T>(text: string): Promise<{ rows: T[] }> {
                    ran.push(text);
                    const results = await db.exec(text);
                    return { rows: (results[results.length - 1]?.rows ?? []) as T[] };
                }
            };
            await ensureCollectionPolicies(queryable, [tiers, customers]);
            expect(ran.filter(t => /ENABLE ROW LEVEL SECURITY/.test(t))).toHaveLength(2);

            ran.length = 0;
            const second = await ensureCollectionPolicies(queryable, [tiers, customers]);
            expect(ran.filter(t => /ENABLE ROW LEVEL SECURITY|^REVOKE/m.test(t))).toEqual([]);
            expect(second.tablesSecured).toBe(2);
            expect(second.failures).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);
});

/**
 * Each table's policies are applied in one transaction, under a lock budget.
 *
 * Every DROP POLICY and CREATE POLICY used to be its own autocommit: at 240
 * tables, 4,332 statements and 4,080 commits per boot (6–22 s on a disk that
 * really flushes), each waiting on the table's ACCESS EXCLUSIVE lock for up to
 * the statement timeout — and between a policy's DROP and its CREATE, other
 * replicas served the table without it (a user's own row read back empty once
 * per boot, measured).
 */
describe("one transaction per table", () => {
    const lockTimeout = (): Error => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
    const fast = { backoffMs: () => 0 };

    /** Tables (all RLS on unless listed in `rlsOff`); `fail` decides what a statement does. */
    function db(tables: string[], fail: (text: string) => Error | undefined = () => undefined, rlsOff: string[] = []) {
        const ran: string[] = [];
        const queryable: Queryable = {
            async query<T>(text: string): Promise<{ rows: T[] }> {
                if (/information_schema\.columns/i.test(text)) {
                    const rows = tables.map(t => {
                        const [table_schema, table_name] = t.split(".");
                        return { table_schema, table_name, rls: !rlsOff.includes(t) };
                    });
                    return { rows: rows as unknown as T[] };
                }
                if (/relrowsecurity/i.test(text)) return { rows: [{ rls: false }] as unknown as T[] };
                if (/^\s*SELECT\b[\s\S]*\bFROM pg_polic(?:y|ies)\b/i.test(text)) return { rows: [] };
                ran.push(text);
                const error = fail(text);
                if (error) throw error;
                return { rows: [] };
            }
        };
        return { queryable, ran };
    }

    it("sends each table's statements as one string, under a lock_timeout", async () => {
        const { queryable, ran } = db(["public.tiers", "public.customers"]);
        const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

        expect(ran).toHaveLength(2);
        for (const [i, table] of ["tiers", "customers"].entries()) {
            expect(ran[i]).toMatch(/^SET LOCAL lock_timeout = '1000ms';\n/);
            const lines = ran[i].split("\n").slice(1);
            expect(lines.length).toBeGreaterThan(1);
            expect(lines.every(l => new RegExp(`ON "public"\\."${table}"`).test(l))).toBe(true);
        }
        expect(result.policiesApplied).toBe(ran.join("\n").split("\n").filter(l => /^CREATE POLICY/.test(l)).length);
        expect(result.tablesSecured).toBe(2);
    });

    it("retries a table whose lock is held and, still held, leaves it as it was — not revoked", async () => {
        const { queryable, ran } = db(
            ["public.tiers", "public.customers"],
            text => (/"customers"/.test(text) ? lockTimeout() : undefined)
        );
        const result = await ensureCollectionPolicies(queryable, [tiers, customers], undefined, fast);

        expect(ran.filter(t => /"customers"/.test(t))).toHaveLength(3);
        expect(ran.filter(t => /^REVOKE/m.test(t))).toEqual([]);
        expect(result.deferred.map(d => [d.table, d.rulesChanged])).toEqual([["public.customers", true]]);
        expect(result.deferred[0].error).toMatch(/held the table's lock/);
        expect(result.failures).toEqual([]);
        expect(result.unsecured).toEqual([]);
        // The neighbour is applied on the first pass, not held up by it.
        expect(ran[0]).toMatch(/"tiers"/);
        expect(result.tablesSecured).toBe(2);
    });

    it("succeeds on a retry once the holder lets go", async () => {
        let held = 1;
        const { queryable } = db(["public.customers"], text => (/"customers"/.test(text) && held-- > 0 ? lockTimeout() : undefined));
        const result = await ensureCollectionPolicies(queryable, [customers], undefined, fast);

        expect(result.deferred).toEqual([]);
        expect(result.policiesApplied).toBeGreaterThan(0);
    });

    it("closes a table whose RLS is off when its lock is held throughout", async () => {
        // RLS off over the schema-wide grant is an open table: whatever kept
        // the ENABLE from running, the table is closed, as before.
        const { queryable, ran } = db(["public.customers"], text => (/ENABLE ROW/.test(text) ? lockTimeout() : undefined), ["public.customers"]);
        const result = await ensureCollectionPolicies(queryable, [customers], undefined, fast);

        expect(ran.some(t => /^REVOKE ALL PRIVILEGES ON "public"\."customers" FROM /.test(t))).toBe(true);
        expect(result.unsecured.map(u => [u.table, u.grantWithdrawn])).toEqual([["public.customers", true]]);
        expect(result.deferred).toEqual([]);
    });

    it("stops retrying when the step's retry budget is spent", async () => {
        // A holder on every table — a dump. Retrying cannot help, and the
        // budget keeps it from costing tables × attempts × timeout.
        const { queryable, ran } = db(["public.tiers", "public.customers"], () => lockTimeout());
        const result = await ensureCollectionPolicies(queryable, [tiers, customers], undefined,
            { ...fast, lockTimeoutMs: 100, retryBudgetMs: 100 });

        // Two first attempts, then one retry before the budget is gone.
        expect(ran).toHaveLength(3);
        expect(result.deferred.map(d => d.table)).toEqual(["public.tiers", "public.customers"]);
    });

    it("falls back to one statement at a time on a handle that takes one statement per query", async () => {
        // PGlite's `query` is extended-protocol only, like some drivers.
        const pg = new PGlite();
        try {
            await pg.exec(
                'CREATE TABLE "public"."tiers" ("id" TEXT PRIMARY KEY, "label" TEXT);' +
                'CREATE TABLE "public"."customers" ("id" TEXT PRIMARY KEY, "owner_id" TEXT);'
            );
            for (const statement of RLS_BOOTSTRAP_STATEMENTS) await pg.exec(statement);
            const ran: string[] = [];
            const queryable: Queryable = {
                async query<T>(text: string): Promise<{ rows: T[] }> {
                    ran.push(text);
                    return pg.query<T>(text);
                }
            };
            const result = await ensureCollectionPolicies(queryable, [tiers, customers]);

            expect(result.failures).toEqual([]);
            expect(result.tablesSecured).toBe(2);
            // Refused once, then never offered again.
            expect(ran.filter(t => /^SET LOCAL/.test(t))).toHaveLength(1);
            const { rows } = await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'");
            expect(rows[0].n).toBe(result.policiesApplied);
        } finally {
            await pg.close();
        }
    }, 30_000);
});
