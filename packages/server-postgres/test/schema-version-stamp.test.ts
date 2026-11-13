/**
 * `rebase db push` and server boot stamp the same schema version.
 *
 * Both record which tables provisioned a database (`rebase.schema_meta`,
 * `collections_schema_version`), and every process compares itself against
 * that row. The server computes it from the compiled descriptors of the
 * tables it provisions in the default database; a push that computed it any
 * other way — from collections, as before 0.31, or over a different set of
 * tables — would make every boot after it report a mismatch, and the
 * server's own advice for a `v1:` stamp ("run `rebase db push`") would never
 * clear it.
 *
 * One schema, written to disk as a project writes it: the boot is handed the
 * very definitions its index exports, and the push's version is computed from
 * the same directory by the loader the push uses.
 */
import { afterAll, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { REBASE_USER_ROLE } from "@rebasepro/common";
import { isTableDef, isViewDef, type BackendBootstrapper, type DefaultRls, type DataDriver, type InitializedDriver } from "@rebasepro/types";
import { createRebaseBackend } from "@rebasepro/server";

import { defaultDatabaseSchemaVersion, loadTableSchema } from "../src/schema/load-tables";
import { readTablesSchemaVersion, SCHEMA_META_SCHEMA, stampTablesSchemaVersion } from "../src/schema/tables-schema-version";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-schema-stamp-"));
const schemaDir = path.join(root, "backend", "schema");
fs.mkdirSync(schemaDir, { recursive: true });
fs.writeFileSync(path.join(schemaDir, "authors.ts"), `import { col, defineTable } from "@rebasepro/types";

export const authors = defineTable("authors", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text().notNull() },
    rls: [{ operation: "select", access: "public" }]
});
`);
fs.writeFileSync(path.join(schemaDir, "posts.ts"), `import { col, defineTable, rel } from "@rebasepro/types";
import { authors } from "./authors";

export const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text(), authorId: col.uuid() },
    relations: { author: rel.belongsTo(() => authors) },
    rls: "inherit"
});
`);
// A table in another database: the server provisions (and stamps) only the
// default database's tables, so the push's version must leave it out too.
fs.writeFileSync(path.join(schemaDir, "events.ts"), `import { col, defineTable } from "@rebasepro/types";

export const events = defineTable("events", {
    database: "analytics",
    columns: { id: col.uuid().primaryKey().defaultRandom(), kind: col.text() },
    rls: "admin-only"
});
`);
fs.writeFileSync(path.join(schemaDir, "index.ts"),
    "export { posts } from \"./posts\";\nexport { authors } from \"./authors\";\nexport { events } from \"./events\";\n" +
    "export const defaultRls = [{ operation: \"select\", access: \"authenticated\" }] as const;\n");

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

/** A bootstrapper that provisions nothing and records the version the boot stamps. */
function recordingBootstrapper(id: string, isDefault: boolean, stamped: string[]): BackendBootstrapper {
    const driver: DataDriver = {
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        checkUniqueField: async () => true
    };
    const repo = {
        getUserRoleIds: async () => [],
        getUserById: async () => null,
        getAccountAccessState: async () => null,
        getUserByEmail: async () => null
    };
    return {
        type: "postgres",
        id,
        isDefault,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, tables: undefined, internals: {} };
        },
        ...(isDefault ? { async initializeAuth() { return { userService: repo, authRepository: repo }; } } : {}),
        async ensureTableSchema() { return { applied: 0 }; },
        async ensureTablePolicies() { return { applied: 0 }; },
        async readTablesSchemaVersion() { return null; },
        async stampTablesSchemaVersion(version: string) { stamped.push(version); }
    };
}

describe("the schema version stamp", () => {
    it("is the same from `rebase db push` as from a provisioning boot, for one schema", async () => {
        const index: Record<string, unknown> = await import(pathToFileURL(path.join(schemaDir, "index.ts")).href);
        const tables = Object.values(index).filter(value => isTableDef(value) || isViewDef(value));
        const defaultRls: DefaultRls = [{ operation: "select", access: "authenticated" }];

        const stamped: string[] = [];
        const backend = await createRebaseBackend({
            tables,
            defaultRls,
            bootstrappers: [recordingBootstrapper("(default)", true, stamped), recordingBootstrapper("analytics", false, [])],
            auth: { jwtSecret: "schema-version-stamp-secret-0123456789abcdef" },
            cronPersistence: false,
            provision: true
        });
        try {
            const pushed = defaultDatabaseSchemaVersion(await loadTableSchema(schemaDir));
            expect(stamped).toEqual([pushed]);
            expect(pushed.startsWith("v2:")).toBe(true);
        } finally {
            await backend.shutdown(0);
        }
    });

    it("is written where the boot reads it, replacing a stamp from before 0.31", async () => {
        const db = new PGlite();
        try {
            await db.exec(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN`);
            const orm = drizzle(db);
            await stampTablesSchemaVersion(orm, SCHEMA_META_SCHEMA, "v1:0123456789abcdef");
            const version = defaultDatabaseSchemaVersion(await loadTableSchema(schemaDir));
            await stampTablesSchemaVersion(orm, SCHEMA_META_SCHEMA, version);
            expect(await readTablesSchemaVersion(orm, SCHEMA_META_SCHEMA)).toBe(version);
        } finally {
            await db.close();
        }
    });
});
