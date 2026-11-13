/**
 * The catalogue check behind "a declared table the database does not protect
 * is not served" (SEC-FIX-2 F-2), on a real Postgres (PGlite), and what the
 * registry does with a table it withholds. The boot and refresh wiring is
 * driven end to end in `e2e/declared-table-protection-e2e`.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { RebaseApiError, col, defineTable } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { findUnprotectedServedTables, withheldTableMessage } from "../src/security/served-table-protection";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";

const locked = defineTable("locked", { columns: { id: col.serial().primaryKey() }, rls: [{ operation: "select", access: "public" }] });
const open = defineTable("open_notes", { columns: { id: col.serial().primaryKey() }, rls: "admin-only" });
const bare = defineTable("bare", { columns: { id: col.serial().primaryKey() }, rls: [{ operation: "select", access: "public" }] });
const absent = defineTable("absent", { columns: { id: col.serial().primaryKey() }, rls: "admin-only" });
const COMPILED = compileSchema([locked, open, bare, absent]);

let db: PGlite;
const run = async (text: string) => (await db.query<Record<string, unknown>>(text)).rows;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE TABLE locked (id serial PRIMARY KEY);
        ALTER TABLE locked ENABLE ROW LEVEL SECURITY;
        CREATE POLICY anything ON locked FOR SELECT USING (true);
        CREATE TABLE open_notes (id serial PRIMARY KEY);
        CREATE TABLE bare (id serial PRIMARY KEY);
        ALTER TABLE bare ENABLE ROW LEVEL SECURITY;
    `);
});

afterAll(async () => {
    await db.close();
});

describe("findUnprotectedServedTables", () => {
    it("names a table with RLS off and one with RLS on but none of its declared policies — and only those", async () => {
        const found = await findUnprotectedServedTables(run, COMPILED);
        expect(found.map(({ slug, problem }) => [slug, problem]).sort()).toEqual([
            ["bare", "no-policies"],
            ["open_notes", "rls-off"]
        ]);
    });

    it("gives the statements a provisioning boot would have run", async () => {
        const found = await findUnprotectedServedTables(run, COMPILED);
        const open = found.find(table => table.slug === "open_notes");
        expect(open?.remediationSql).toMatch(/^ALTER TABLE .*open_notes.* ENABLE ROW LEVEL SECURITY;/);
        expect(open?.remediationSql).toContain("CREATE POLICY");
        const bare = found.find(table => table.slug === "bare");
        expect(bare?.remediationSql).not.toContain("ENABLE ROW LEVEL SECURITY");
        expect(bare?.remediationSql).toContain("CREATE POLICY");
    });

    it("issues one read and no schema change", async () => {
        const statements: string[] = [];
        await findUnprotectedServedTables(async (text) => {
            statements.push(text);
            return run(text);
        }, COMPILED);
        expect(statements).toHaveLength(1);
        expect(statements[0].trim()).toMatch(/^SELECT /);
    });
});

describe("a withheld table in the registry", () => {
    const registry = (): PostgresTableRegistry => {
        const r = new PostgresTableRegistry();
        r.registerTables(COMPILED);
        r.withhold("open_notes", withheldTableMessage({ slug: "open_notes", problem: "rls-off" }));
        return r;
    };

    it("is not served, and a request naming it is refused with the reason (503 TABLE_WITHHELD)", () => {
        const r = registry();
        expect(r.getTable("open_notes")).toBeUndefined();
        expect(r.tables().map(table => table.slug)).not.toContain("open_notes");
        for (const name of ["open_notes", "open-notes"]) {
            try {
                r.tableAt(name);
                throw new Error("expected a refusal");
            } catch (error) {
                expect(error).toBeInstanceOf(RebaseApiError);
                expect(error).toMatchObject({ status: 503, code: "TABLE_WITHHELD", message: expect.not.stringContaining("ALTER TABLE") });
            }
        }
        expect(() => r.requireTable("open_notes")).toThrow(/row-level security is disabled/);
        expect(r.tableAt("nothing_here")).toBeUndefined();
    });

    it("stays withheld across a swap that carries it", () => {
        const r = registry();
        const next = new PostgresTableRegistry();
        next.registerTables(COMPILED);
        for (const [slug, message] of r.withheld()) next.withhold(slug, message);
        r.replaceWith(next);
        expect(r.getTable("open_notes")).toBeUndefined();
        expect([...r.withheld().keys()]).toEqual(["open_notes"]);
    });
});
