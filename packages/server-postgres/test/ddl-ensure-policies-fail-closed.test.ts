import { PGlite } from "@electric-sql/pglite";
import { CollectionConfig, policy, type SecurityRule } from "@rebasepro/types";
import { ensureTablePolicies } from "../src/schema/ensure-policies";
import type { Queryable } from "../src/schema/ensure-tables";
import { generatePostgresPoliciesDdl } from "../src/schema/generate-postgres-ddl-logic";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";
import { compileSet } from "./helpers/plan-tables";

/**
 * A restrictive policy is a gate ANDed over every grant on its table, so a gate
 * that is missing is not a denial: the grants beside it answer alone. These pin
 * the two ways the boot applier used to leave a gate out from under the grants.
 */

/** PGlite, whose `query` takes one statement — the applier's one-statement-at-a-time path. */
async function withDb(tables: string, run: (pg: PGlite, queryable: Queryable) => Promise<void>): Promise<void> {
    const pg = new PGlite();
    try {
        await pg.exec(tables);
        for (const statement of RLS_BOOTSTRAP_STATEMENTS) await pg.exec(statement);
        await run(pg, { query: <T>(text: string) => pg.query<T>(text) });
    } finally {
        await pg.close();
    }
}

interface StoredPolicy { policyname: string; permissive: string; cmd: string; qual: string | null }

const policiesOf = async (pg: PGlite, table: string): Promise<StoredPolicy[]> =>
    (await pg.query<StoredPolicy>(
        `SELECT policyname, permissive, cmd, qual FROM pg_policies WHERE tablename = '${table}' ORDER BY policyname`
    )).rows;

describe("a restrictive rule whose policy cannot be created", () => {
    const docs = (gate: string): CollectionConfig => ({
        name: "Docs", slug: "docs", table: "docs",
        properties: { id: { type: "string", isId: true }, org_id: { type: "string" } },
        securityRules: [
            { name: "docs_public_read", operation: "select", access: "public" },
            { name: "docs_org_gate", operation: "select", mode: "restrictive", using: gate }
        ]
    });
    const table = 'CREATE TABLE "public"."docs" ("id" TEXT PRIMARY KEY, "org_id" TEXT);';

    it("stands in a gate that passes nothing, beside the grants it was meant to restrict", async () => {
        await withDb(table, async (pg, queryable) => {
            const result = await ensureTablePolicies(queryable, compileSet([docs("rebase_missing_gate({org_id})")]));

            expect(result.failures.map(f => f.table)).toEqual(["public.docs"]);
            expect(result.failures[0].error).toMatch(/docs_org_gate/);
            const policies = await policiesOf(pg, "docs");
            expect(policies.find(p => p.policyname === "docs_public_read")).toBeDefined();
            expect(policies.find(p => p.policyname === "docs_org_gate"))
                .toMatchObject({ permissive: "RESTRICTIVE", cmd: "SELECT", qual: "false" });
        });
    }, 30_000);

    it("does not drop a working gate it fails to replace", async () => {
        await withDb(table, async (pg, queryable) => {
            await ensureTablePolicies(queryable, compileSet([docs("{org_id} = 'acme'")]));
            expect((await policiesOf(pg, "docs")).find(p => p.policyname === "docs_org_gate")?.qual)
                .toMatch(/acme/);

            await ensureTablePolicies(queryable, compileSet([docs("rebase_missing_gate({org_id})")]));
            expect((await policiesOf(pg, "docs")).find(p => p.policyname === "docs_org_gate"))
                .toMatchObject({ permissive: "RESTRICTIVE", qual: "false" });
        });
    }, 30_000);

    it("is replaced by the real gate on the boot after it becomes creatable", async () => {
        await withDb(table, async (pg, queryable) => {
            await ensureTablePolicies(queryable, compileSet([docs("rebase_missing_gate({org_id})")]));
            await pg.exec("CREATE FUNCTION rebase_missing_gate(org text) RETURNS boolean LANGUAGE sql AS $$ SELECT org = 'acme' $$;");

            const result = await ensureTablePolicies(queryable, compileSet([docs("rebase_missing_gate({org_id})")]));
            expect(result.failures).toEqual([]);
            expect((await policiesOf(pg, "docs")).find(p => p.policyname === "docs_org_gate")?.qual)
                .toMatch(/rebase_missing_gate/);
        });
    }, 30_000);
});

describe("a policy whose name Postgres stores cut to 63 bytes", () => {
    // 48 bytes: the unnamed multi-operation rule's `<table>_select_<hash>_0`
    // is 65 bytes, stored as `<table>_select_<hash>` — the generated shape.
    const name = "a".repeat(48);
    const longs: CollectionConfig = {
        name: "Longs", slug: "longs", table: name,
        properties: { id: { type: "string", isId: true }, org_id: { type: "string" } },
        securityRules: [
            { operation: "select", access: "public" },
            { operations: ["select", "update"], mode: "restrictive", using: "{org_id} = 'acme'" }
        ]
    };

    it("is not dropped as an orphan by the next boot", async () => {
        await withDb(`CREATE TABLE "public"."${name}" ("id" TEXT PRIMARY KEY, "org_id" TEXT);`, async (pg, queryable) => {
            await ensureTablePolicies(queryable, compileSet([longs]));
            const created = await policiesOf(pg, name);
            expect(created.filter(p => p.permissive === "RESTRICTIVE")).toHaveLength(2);

            const second = await ensureTablePolicies(queryable, compileSet([longs]));
            expect(second.orphansDropped).toBe(0);
            expect(second.unchanged).toBe(1);
            expect(await policiesOf(pg, name)).toEqual(created);
        });
    }, 30_000);
});

describe("two rules whose policies Postgres would store under one name", () => {
    it("are refused rather than one silently replacing the other", () => {
        // At 56 bytes `<table>_select_<hash>` is stored as `<table>_select`,
        // whatever the rule: the grant's DROP IF EXISTS would drop the gate.
        const table = "b".repeat(56);
        expect(() => generatePostgresPoliciesDdl(compileSet([{
            name: "Wide", slug: "wide", table,
            properties: { org_id: { type: "string" } },
            securityRules: [
                { operation: "select", mode: "restrictive", using: "{org_id} = 'acme'" },
                { operation: "select", access: "public" }
            ]
        }]))).toThrow(/stores under one name[\s\S]*63 bytes/);
    });

    it("leaves a rule repeated verbatim alone", () => {
        const rule: SecurityRule = { operation: "select", access: "public" };
        expect(() => generatePostgresPoliciesDdl(compileSet([{
            name: "Twice", slug: "twice", table: "twice",
            properties: { org_id: { type: "string" } },
            securityRules: [rule, rule]
        }]))).not.toThrow();
    });
});

describe("rules whose compiled SQL Postgres used to refuse", () => {
    it("creates a raw clause ending in a line comment, and an empty role list", async () => {
        const notes: CollectionConfig = {
            name: "Notes", slug: "notes", table: "notes",
            properties: { id: { type: "string", isId: true }, owner_id: { type: "string" } },
            securityRules: [
                { name: "notes_own", operation: "all", using: "owner_id = rebase.uid() -- the owner only" },
                {
                    name: "notes_staff",
                    operation: "select",
                    condition: policy.or(
                        policy.compare(policy.field("owner_id"), "eq", policy.authUid()),
                        policy.rolesOverlap([])
                    )
                }
            ]
        };
        await withDb('CREATE TABLE "public"."notes" ("id" TEXT PRIMARY KEY, "owner_id" TEXT);', async (pg, queryable) => {
            const result = await ensureTablePolicies(queryable, compileSet([notes]));
            expect(result.failures).toEqual([]);
            const names = (await policiesOf(pg, "notes")).map(p => p.policyname);
            expect(names).toEqual(expect.arrayContaining(["notes_own", "notes_staff"]));
        });
    }, 30_000);
});
