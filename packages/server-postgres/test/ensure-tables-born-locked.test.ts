/**
 * A table the boot ensure creates is born with row-level security on.
 *
 * Boot creates the collection tables first and applies the policies — which is
 * where RLS used to be switched on — only after the driver and auth have
 * initialised. In between, `ensureAppRole` grants the user role DML on every
 * table in the schema, so any failure on the way left a brand-new table
 * readable and writable by every authenticated request with no row filtering,
 * served by whichever process in the deployment does not provision. The live
 * schema editor plans its statements with the same planner and never applied
 * policies at all.
 *
 * Proved here on PGlite: the ensure is made to fail on the first statement
 * after the tables exist, and every table it created is RLS-on anyway.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { ensureCollectionTables, planCollectionSchemaEnsure, type Queryable } from "../src/schema/ensure-collection-tables";
import type { ExistingSchema } from "../src/schema/plan/diff-plan";

const tags = {
    slug: "tags",
    table: "tags",
    name: "Tags",
    properties: {
        id: { type: "string", isId: "uuid" },
        label: { type: "string" }
    }
} as unknown as CollectionConfig;

const secrets = {
    slug: "secrets",
    table: "secrets",
    name: "Secrets",
    securityRules: [{ operation: "select", roles: ["admin"] }],
    properties: {
        id: { type: "string", isId: "uuid" },
        value: { type: "string" },
        tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
} as unknown as CollectionConfig;

const collections = [secrets, tags];
const emptyDb = (): ExistingSchema => ({ tables: new Map(), enums: new Set(), constraints: new Set() });

describe("the boot ensure creates every table locked", () => {
    it("plans ENABLE ROW LEVEL SECURITY immediately after each CREATE TABLE, junctions included", () => {
        const { actions } = planCollectionSchemaEnsure(collections, emptyDb());
        const created = actions.filter(a => a.kind === "create-table").map(a => a.target);
        expect(created).toEqual(expect.arrayContaining(["public.secrets", "public.tags"]));
        expect(created.length).toBe(3); // and the junction

        for (const target of created) {
            const at = actions.findIndex(a => a.kind === "create-table" && a.target === target);
            const [schema, table] = target.split(".");
            expect(actions[at + 1]).toEqual({
                kind: "enable-rls",
                target,
                sql: `ALTER TABLE "${schema}"."${table}" ENABLE ROW LEVEL SECURITY;`
            });
        }
    });

    it("plans nothing for a table that already exists", () => {
        const existing = emptyDb();
        for (const table of ["public.secrets", "public.tags"]) existing.tables.set(table, new Set(["id"]));
        const { actions } = planCollectionSchemaEnsure(collections, existing);
        expect(actions.filter(a => a.kind === "enable-rls").map(a => a.target))
            .toEqual(actions.filter(a => a.kind === "create-table").map(a => a.target));
        expect(actions.some(a => a.target === "public.secrets" && a.kind === "enable-rls")).toBe(false);
    });

    describe("against a database", () => {
        let db: PGlite;

        beforeEach(async () => {
            db = new PGlite();
            await db.waitReady;
        });

        afterEach(async () => {
            await db.close();
        });

        it("leaves the tables it created RLS-on when a later statement fails", async () => {
            // Every table is created before any column is added, so failing the
            // first ADD COLUMN fails the ensure with all of them already there —
            // the state a boot that dies before its policies step leaves.
            const failing: Queryable = {
                query: async <T,>(text: string) => {
                    if (/ADD COLUMN/.test(text)) throw new Error("injected: the next step failed");
                    return { rows: (await db.query<T>(text)).rows };
                }
            };
            await expect(ensureCollectionTables(failing, collections)).rejects.toThrow(/injected/);

            const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
                `SELECT c.relname, c.relrowsecurity FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`
            );
            expect(rows.length).toBe(3);
            expect(rows.every(r => r.relrowsecurity)).toBe(true);
        });
    });
});
