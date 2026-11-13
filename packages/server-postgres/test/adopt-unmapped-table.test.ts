/**
 * "Import an existing table" adopts it: the definition it writes states the
 * table exactly as the database has it, so applying the adoption changes
 * nothing in the database, and neither does the next boot.
 *
 * The import used to read raw catalogue columns and guess properties in the
 * browser (`buildCollectionFromTableMetadata`), then save a `createTable` —
 * a `numeric(10,2)` came back a plain number, an enum lost its type name, a
 * foreign key its `ON DELETE`. Now the table is described by introspection
 * (`describeUnmappedTables`), written by the printer (`adoptTable`), and this
 * runs that whole path on PGlite: a table made by hand in SQL, imported, and
 * planned against the database that holds it.
 */
import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

import { TableSourceEditor } from "../../server/src/api/table-source-editor";
import { describeUnmappedTables } from "../src/schema/introspect-tables";
import { planTableSchemaEnsure, readSchemaFactsFor, type Queryable } from "../src/schema/ensure-tables";
import { generateSchemaCommit } from "../src/schema/generate-schema-commit";
import { ensureTablePolicies } from "../src/schema/ensure-policies";

const DATABASE = `
    CREATE TYPE ticket_state AS ENUM ('open', 'closed');
    CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
    CREATE TABLE tickets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title text NOT NULL,
        amount numeric(10, 2),
        opened_at timestamptz NOT NULL DEFAULT now(),
        state ticket_state NOT NULL DEFAULT 'open',
        customer_id uuid REFERENCES customers (id) ON DELETE CASCADE,
        details jsonb
    );
    CREATE INDEX tickets_customer_id_idx ON tickets (customer_id);
    ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tickets_read ON tickets FOR SELECT USING (true);
`;

/** `backend/schema` before the import: `customers` declared, `tickets` not. */
const SCHEMA_FILES: Record<string, string> = {
    "index.ts": "export { customers } from \"./customers\";\n",
    "customers.ts": [
        "import { defineTable, col } from \"@rebasepro/server/schema\";",
        "",
        "export const customers = defineTable(\"customers\", {",
        "    columns: {",
        "        id: col.uuid().primaryKey().defaultRandom(),",
        "        name: col.text().notNull()",
        "    },",
        "    rls: \"admin-only\"",
        "});",
        ""
    ].join("\n")
};

const open: { db: PGlite; root: string }[] = [];

afterEach(async () => {
    for (const { db, root } of open.splice(0)) {
        await db.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

async function setUp(): Promise<{ db: PGlite; dir: string }> {
    const db = new PGlite();
    await db.waitReady;
    await db.exec(DATABASE);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-unmapped-"));
    const dir = path.join(root, "backend", "schema");
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(SCHEMA_FILES)) fs.writeFileSync(path.join(dir, name), text);
    open.push({ db, root });
    return { db, dir };
}

const facts = (db: PGlite): Queryable => ({ query: async <T>(sql: string) => ({ rows: (await db.query<T>(sql)).rows }) });

describe("importing a table the database already has", () => {
    it("describes it exactly, adopts it, and plans nothing for it — now or at the next boot", async () => {
        const { db, dir } = await setUp();

        const unmapped = await describeUnmappedTables(
            { query: async <R>(text: string, values?: unknown[]) => ({ rows: (await db.query<R>(text, values)).rows }) },
            "public",
            { mapped: new Set(["customers"]) }
        );
        expect(unmapped.map(table => table.table)).toEqual(["tickets"]);
        const [tickets] = unmapped;
        expect(tickets).toMatchObject({ rlsEnabled: true, policies: 1 });
        expect(tickets.rlsRaised).toBeUndefined();
        const descriptor = tickets.descriptor;
        if (!descriptor) throw new Error("tickets was not described");
        expect(descriptor.relations.map(relation => `${relation.name}:${relation.kind}:${relation.target}`)).toEqual(["customer:belongsTo:customers"]);

        const editor = new TableSourceEditor(dir);
        const before = (await editor.compileCurrent()).tables;
        const edit = await editor.apply([{ op: "adoptTable", table: descriptor }]);
        const source = fs.readFileSync(path.join(dir, "tickets.ts"), "utf8");
        expect(source).toMatch(/pgEnum\("ticket_state", \["open", "closed"\]\)/);
        expect(source).toMatch(/col\.numeric\(\{ precision: 10, scale: 2 \}\)/);
        expect(source).toMatch(/rel\.belongsTo\(\(\) => customers/);
        expect(source).toContain("onDelete: \"cascade\"");

        // The live apply's plan: the adoption alone, against this database.
        const after = edit.schema.tables;
        const existing = await readSchemaFactsFor(facts(db), after);
        const commit = await generateSchemaCommit({ before, after, existing });
        expect(commit.classified.applicable).toBe(true);
        expect(commit.statements).toEqual([]);

        // A boot after it: the declared schema, ensured against the database.
        expect(planTableSchemaEnsure(after, existing, { constraints: "converge" }).statements).toEqual([]);

        // Not vacuous: against a database without it, the same definition is a whole table.
        const empty = new PGlite();
        await empty.waitReady;
        try {
            const created = planTableSchemaEnsure(after, await readSchemaFactsFor(facts(empty), after), { constraints: "converge" }).statements;
            expect(created.some(statement => /CREATE TABLE[^;]*"tickets"/.test(statement))).toBe(true);
        } finally {
            await empty.close();
        }

        // Its policies: the boot's policy step finds the rule it was read
        // from. The first run writes the same policy back once, under the
        // stamp boot keys on (no change to what it allows); from then on it
        // is left alone.
        const policiesOf = async () => (await db.query("SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE tablename = 'tickets' ORDER BY policyname")).rows;
        const policiesBefore = await policiesOf();
        await ensureTablePolicies(facts(db), after, undefined, { adminRoleAvailable: false });
        expect(await policiesOf()).toEqual(policiesBefore);
        const again = await ensureTablePolicies(facts(db), after, undefined, { adminRoleAvailable: false });
        expect(again.policiesApplied).toBe(0);
        expect(await policiesOf()).toEqual(policiesBefore);
    });

    it("never imports a weaker posture than the database has: no policy is \"admin-only\", said out loud", async () => {
        const { db } = await setUp();
        await db.exec("CREATE TABLE notes (id serial PRIMARY KEY, body text); CREATE TABLE locked (id serial PRIMARY KEY); ALTER TABLE locked ENABLE ROW LEVEL SECURITY;");
        const unmapped = await describeUnmappedTables(
            { query: async <R>(text: string, values?: unknown[]) => ({ rows: (await db.query<R>(text, values)).rows }) },
            "public",
            { mapped: new Set(["customers"]) }
        );
        const notes = unmapped.find(table => table.table === "notes");
        const locked = unmapped.find(table => table.table === "locked");
        expect(notes?.descriptor?.rls).toEqual({ posture: "admin-only", rules: [], defaultPolicies: true });
        expect(notes?.rlsRaised).toMatch(/Row-level security is off/);
        expect(locked?.descriptor?.rls).toEqual({ posture: "admin-only", rules: [], defaultPolicies: true });
        expect(locked?.rlsRaised).toMatch(/no policy/);
    });
});
