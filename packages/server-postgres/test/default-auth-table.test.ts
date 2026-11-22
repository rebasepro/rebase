/**
 * A declared users table is `rebase.users` exactly as auth creates it.
 *
 * A project shows Users in the admin by declaring an auth table — the
 * scaffold's `users.ts`, or the one `schema introspect --users` writes. That
 * is only safe if the declaration IS the table `ensureAuthTablesExist`
 * creates: one column off and boot or `db push` would alter the table every
 * auth foreign key points at. The old scaffold's `uuid` key against the real
 * `text` one planned exactly that. `defaultAuthTable` is that table stated
 * once; the scaffold and introspection are held to it here.
 *
 * Asked of a real Postgres (PGlite): `rebase.users` is created the way auth
 * creates it, then
 *  - the boot planner (the same plan `db push` renders `schema.sql` from)
 *    finds nothing to do to its columns, and
 *  - the DDL the planner renders for the definition, applied to an empty
 *    database, produces the same columns — types, nullability, defaults —
 *    which is what Atlas compares on a push.
 * The scaffold's `users.ts` and what `schema introspect` writes for the table
 * are held to the same two checks.
 */
import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import path from "path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { compileSchema } from "@rebasepro/common";
import { col, defineTable, isAuthTableDef, type AnyTableDef, type CompiledTable } from "@rebasepro/types";
import { compileSchemaDefs, loadBackendSchema } from "@rebasepro/server";
import { ensureAuthTablesExist } from "../src/auth/ensure-tables";
import { defaultAuthTable } from "../src/schema/default-auth-table";
import { AUTH_USERS_COLUMNS } from "../src/schema/auth-users-columns";
import { planTableSchemaEnsure, readSchemaFactsFor } from "../src/schema/ensure-tables";
import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { generateAuthTableModule } from "../src/schema/introspect-db-logic";
import { readSchemaMetadata } from "../src/schema/introspect-db-queries";
import { evaluateSchemaModules } from "./helpers/introspect-generation";

const here = __dirname;

interface ColumnShape {
    column_name: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
}

/** A default reduced to what decides equality: `(gen_random_uuid())::text` and `gen_random_uuid()::text` are one default. */
const normalizeDefault = (value: string | null): string | null =>
    value === null ? null : value.toLowerCase().replace(/[\s()]/g, "").replace(/::textarray$|::text\[\]$/, "");

async function usersColumns(db: PGlite): Promise<ColumnShape[]> {
    const { rows } = await db.query<ColumnShape>(
        "SELECT column_name, udt_name, is_nullable, column_default FROM information_schema.columns " +
        "WHERE table_schema = 'rebase' AND table_name = 'users' ORDER BY column_name"
    );
    return rows.map(row => ({ ...row, column_default: normalizeDefault(row.column_default) }));
}

let ensured: PGlite;
let ensuredColumns: ColumnShape[];

beforeAll(async () => {
    ensured = new PGlite();
    await ensured.waitReady;
    // PGlite's drizzle database stands in for node-postgres's: no typed bridge between the two exists.
    await ensureAuthTablesExist(drizzle(ensured));
    ensuredColumns = await usersColumns(ensured);
}, 60_000);

afterAll(async () => {
    await ensured.close();
});

/** The `rebase.users` of these tables. */
const usersOf = (tables: readonly CompiledTable[]): CompiledTable[] => {
    const users = tables.filter(table => table.descriptor.schema === "rebase" && table.descriptor.table === "users");
    expect(users).toHaveLength(1);
    return users;
};

/** What the boot planner would do to `rebase.users`, planned against a database auth provisioned. */
async function plannedActions(db: PGlite, tables: readonly CompiledTable[]): Promise<{ kind: string; sql: string }[]> {
    const users = usersOf(tables);
    const plan = planTableSchemaEnsure(users, await readSchemaFactsFor(db, users));
    return plan.actions.filter(action => action.kind !== "enable-rls");
}

/**
 * The boot planner, against a fresh `rebase.users` made by auth: nothing to do
 * to the table itself. The one thing planned is `.onUpdateNow()`'s touch
 * trigger on `updated_at` (and the function it calls), added once: planned
 * again after it is applied, there is nothing at all.
 */
async function expectNoTableChanges(tables: readonly CompiledTable[]): Promise<void> {
    const db = new PGlite();
    try {
        await db.waitReady;
        await ensureAuthTablesExist(drizzle(db));
        const first = await plannedActions(db, tables);
        expect(first.filter(action => action.kind !== "create-trigger" && action.kind !== "create-function")).toEqual([]);
        for (const action of first) await db.exec(action.sql);
        expect(await plannedActions(db, tables)).toEqual([]);
    } finally {
        await db.close();
    }
}

/** The columns the planner's DDL for these tables gives `rebase.users` in an empty database. */
async function plannedColumns(tables: readonly CompiledTable[]): Promise<ColumnShape[]> {
    const users = usersOf(tables);
    const db = new PGlite();
    try {
        await db.waitReady;
        await db.exec("CREATE SCHEMA IF NOT EXISTS rebase;");
        await db.exec(renderPostgresDdl(planSchema(users), { includePolicies: false }));
        return await usersColumns(db);
    } finally {
        await db.close();
    }
}

describe("the default users table", () => {
    const [builtin] = compileSchema([defaultAuthTable]);

    it("declares every column auth owns, and its text key", () => {
        const declared = builtin.descriptor.columns.map(column => column.column).sort();
        expect(declared).toEqual(["id", ...AUTH_USERS_COLUMNS.map(spec => spec.column)].sort());
        const id = builtin.descriptor.columns.find(column => column.key === "id");
        expect(id?.type.kind).toBe("text");
    });

    it("keeps the secrets private", () => {
        const privateKeys = builtin.descriptor.columns.filter(column => column.private).map(column => column.key).sort();
        expect(privateKeys).toEqual(["emailChangeToken", "emailVerificationToken", "passwordHash"]);
    });

    it("is the auth table", () => {
        expect(builtin.descriptor.auth).toBeDefined();
        expect(builtin.descriptor.slug).toBe("users");
        expect(builtin.descriptor.schema).toBe("rebase");
    });

    it("plans no change to the rebase.users auth created", async () => {
        await expectNoTableChanges([builtin]);
    });

    it("renders the same columns auth creates", async () => {
        expect(await plannedColumns([builtin])).toEqual(ensuredColumns);
    });
});

describe("a project that declares no auth table", () => {
    const posts = defineTable("posts", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });

    it("serves no users table: Users stays out of the admin until the project declares one", () => {
        expect(compileSchemaDefs([posts]).descriptors.map(descriptor => descriptor.slug)).toEqual(["posts"]);
    });
});

describe("the scaffold's users.ts", () => {
    let template: AnyTableDef | undefined;

    beforeAll(async () => {
        const loaded = await loadBackendSchema(path.resolve(here, "../../cli/templates/template/backend/schema"));
        template = loaded.defs.find((def): def is AnyTableDef => isAuthTableDef(def));
    }, 60_000);

    it("is an auth table", () => {
        expect(template).toBeDefined();
    });

    it("plans no change to the rebase.users auth created", async () => {
        await expectNoTableChanges(compileSchema([template!]));
    });

    it("renders the same columns auth creates", async () => {
        expect(await plannedColumns(compileSchema([template!]))).toEqual(ensuredColumns);
    });

    it("keys the table on text, as auth does", () => {
        const source = fs.readFileSync(path.resolve(here, "../../cli/templates/template/backend/schema/users.ts"), "utf8");
        expect(source).toContain("col.text().primaryKey()");
        expect(source).not.toContain("col.uuid()");
    });
});

describe("schema introspect's users.ts", () => {
    it("is the default table, for a fresh rebase.users", async () => {
        const generated = generateAuthTableModule(await readSchemaMetadata(ensured, "rebase", { forGeneration: true }));
        expect(generated?.table).toBe("users");
        expect(generated?.schemaModule).toContain("defineAuthTable(\"users\"");
        const [users] = evaluateSchemaModules([generated!.schemaModule]);
        expect(isAuthTableDef(users)).toBe(true);
        const [compiled] = compileSchema([users]);
        const [builtin] = compileSchema([defaultAuthTable]);
        expect(compiled.descriptor.columns).toEqual(builtin.descriptor.columns);
        expect(compiled.descriptor.rls).toEqual(builtin.descriptor.rls);
        await expectNoTableChanges([compiled]);
        expect(await plannedColumns([compiled])).toEqual(ensuredColumns);
    });

    it("keeps a column the project added to rebase.users", async () => {
        const db = new PGlite();
        try {
            await db.waitReady;
            await ensureAuthTablesExist(drizzle(db));
            await db.exec("ALTER TABLE rebase.users ADD COLUMN agency_name text");
            const generated = generateAuthTableModule(await readSchemaMetadata(db, "rebase", { forGeneration: true }));
            expect(generated?.remarks.join(" ")).toContain("\"agency_name\"");
            const [compiled] = compileSchema(evaluateSchemaModules([generated!.schemaModule]) as AnyTableDef[]);
            expect(compiled.descriptor.columns.map(column => column.column)).toContain("agency_name");
            const users = usersOf([compiled]);
            const plan = planTableSchemaEnsure(users, await readSchemaFactsFor(db, users));
            expect(plan.actions.filter(action => !["enable-rls", "create-trigger", "create-function"].includes(action.kind))).toEqual([]);
        } finally {
            await db.close();
        }
    });

    it("writes nothing for a database with no rebase.users", async () => {
        const db = new PGlite();
        try {
            await db.waitReady;
            await db.exec("CREATE SCHEMA rebase; CREATE TABLE rebase.app_config (key text PRIMARY KEY);");
            expect(generateAuthTableModule(await readSchemaMetadata(db, "rebase", { forGeneration: true }))).toBeUndefined();
        } finally {
            await db.close();
        }
    });
});
