import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { BackendBootstrapper, CompiledTable, SchemaChangePlan, TableDescriptor, TableHooks, TableRefreshOutcome } from "@rebasepro/types";
import { createCallContext } from "@rebasepro/common";

import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";
import { generateAccessToken } from "../src/auth/jwt";
import { writeSchemaFixture } from "./helpers/schema-source-fixture";

/**
 * After a live apply, the hooks that run are the hooks the source declares,
 * and the drivers serve the tables the apply left.
 *
 * What an apply handed the registries was descriptors alone, so a table's
 * hooks were known after it only as flags: the drivers — which run hooks
 * natively — were never given the compiled ones, and the table model kept
 * none (storage's "this table has read hooks" check, the masking refusals).
 * The edited definitions are compiled anyway; the compiled tables now travel
 * with the edit to every driver's `refreshTables`, which serves them — a
 * table the apply added included — and the result says whether every driver
 * did (`serving`). The Postgres driver's own refresh, over a real database,
 * is `server-postgres/test/e2e/live-schema-refresh-e2e.test.ts`.
 */

const JWT_SECRET = "live-schema-hooks-applied-secret-1234567890";
const BOOTS_A_BACKEND = 30_000;

let fixture: ReturnType<typeof writeSchemaFixture>;
const originalNodeEnv = process.env.NODE_ENV;
const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture.root, stdio: "pipe" });
const commitAll = (message: string) => {
    git("add", "-A");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", message);
};

beforeEach(() => {
    process.env.NODE_ENV = "development";
    fixture = writeSchemaFixture();
    fs.writeFileSync(path.join(fixture.root, "rebase.json"), "{}\n");
    git("init", "-q");
    commitAll("init");
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    fixture.cleanup();
});

/**
 * The tables a driver serves, by slug, as the Postgres driver holds them: the
 * compiled tables `refreshTables` hands it (hooks included), and the hooks
 * attached after boot through its registry's `setTableHooks`.
 */
class DriverTables {
    readonly served = new Map<string, CompiledTable>();
    readonly refreshes: CompiledTable[][] = [];
    setTableHooks(slug: string, hooks: TableHooks): boolean {
        const table = this.served.get(slug);
        if (!table) return false;
        this.served.set(slug, { ...table, hooks });
        return true;
    }
    async refreshTables(tables: readonly CompiledTable[]): Promise<TableRefreshOutcome> {
        this.refreshes.push([...tables]);
        this.served.clear();
        for (const table of tables) this.served.set(table.descriptor.slug, table);
        return { status: "served" };
    }
}

const notesDescriptor: TableDescriptor = {
    name: "notes", slug: "notes", table: "notes", schema: "public", kind: "table",
    columns: [{ key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true }],
    primaryKey: ["id"],
    relations: [],
    rls: { posture: "admin-only", rules: [], defaultPolicies: true }
};

function bootstrapper(registry: DriverTables, options: { refreshes: boolean }): BackendBootstrapper {
    const plan: SchemaChangePlan = {
        files: [],
        statements: ['CREATE TABLE IF NOT EXISTS "public"."notes" ("id" uuid PRIMARY KEY, "body" text);'],
        classified: { changes: [], verdict: "safe", applicable: true },
        message: "feat(schema): add notes\n"
    };
    // A driver that, as the Postgres one does, reads only the tables it
    // serves and runs the `afterRead` their compiled table carries.
    const driver = Object.assign(fakeDataDriver({
        async fetchOne(props) {
            const table = registry.served.get(props.path);
            if (!table) return undefined;
            const row = { id: props.id, body: "the secret" };
            const afterRead = table.hooks?.afterRead;
            if (!afterRead) return row;
            return afterRead({ table: notesDescriptor, path: props.path, values: row, context: createCallContext() });
        },
        admin: {
            planSchemaChange: async () => plan,
            executeSql: async () => []
        }
    }), { registry });
    return fakeBootstrapper({
        driver,
        tables: undefined,
        ...(options.refreshes ? { refreshTables: (tables: readonly CompiledTable[]) => registry.refreshTables(tables) } : {})
    }, {
        async initializeAuth() {
            const authRepository = {
                getUserRoleIds: async (uid: string) => (uid === "admin-1" ? ["admin"] : []),
                getTokensValidAfter: async () => undefined
            };
            return { userService: authRepository, authRepository };
        }
    });
}

async function boot(registry: DriverTables, options: { refreshes: boolean }) {
    const app = new Hono<HonoEnv>();
    const backend = await initializeRebaseBackend({
        app,
        server: idleServer(),
        schemaDir: fixture.dir,
        cronPersistence: false,
        auth: { jwtSecret: JWT_SECRET },
        bootstrappers: [bootstrapper(registry, options)]
    });
    return { app, backend };
}

/** The table written in the editor of the person's choice, hook and all — hooks are code, which no schema edit carries. */
function writeNotesByHand(): void {
    fs.writeFileSync(path.join(fixture.dir, "notes.ts"), [
        "import { defineTable, col } from \"@rebasepro/server/schema\";",
        "",
        "export const notes = defineTable(\"notes\", {",
        "    columns: {",
        "        id: col.uuid().primaryKey().defaultRandom(),",
        "        body: col.text()",
        "    },",
        "    rls: \"admin-only\",",
        "    hooks: {",
        "        afterRead: ({ values }) => ({ ...values, body: \"[masked]\" })",
        "    }",
        "});",
        ""
    ].join("\n"));
    fs.appendFileSync(path.join(fixture.dir, "index.ts"), "export { notes } from \"./notes\";\n");
    commitAll("notes, written by hand");
}

const admin = async () => ({ authorization: `Bearer ${await generateAccessToken("admin-1", ["admin"])}` });

async function applyNotes(app: Hono<HonoEnv>, description = "Notes, masked on the way out.") {
    const applied = await app.request("/api/admin/schema/apply", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await admin()) },
        body: JSON.stringify({ patches: [{ op: "setOption", table: "notes", option: "description", value: description }] })
    });
    expect(applied.status).toBe(200);
    return applied.json();
}

describe("a live apply that adds a table with an afterRead hook", () => {
    it("is served by the driver, hook running, on the next REST read — without a restart", async () => {
        const registry = new DriverTables();
        const { app } = await boot(registry, { refreshes: true });
        const read = async () => app.request("/api/data/notes/n1", { headers: await admin() });
        expect((await read()).status).toBe(404);

        writeNotesByHand();
        expect(await applyNotes(app)).toMatchObject({ applied: true, serving: { status: "now" } });

        // The driver was handed the compiled table, hook and all, and serves it.
        expect(typeof registry.served.get("notes")?.hooks?.afterRead).toBe("function");
        const res = await read();
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ id: "n1", body: "[masked]" });
    }, BOOTS_A_BACKEND);

    it("hands the driver the hooks attached at runtime, not the source's, for a table that has them", async () => {
        const registry = new DriverTables();
        const { app, backend } = await boot(registry, { refreshes: true });
        writeNotesByHand();
        await applyNotes(app);

        backend.setTableHooks("notes", { afterRead: ({ values }) => ({ ...values, body: "[attached]" }) });
        await applyNotes(app, "Notes, described again.");

        const handed = registry.refreshes[registry.refreshes.length - 1].find(table => table.descriptor.slug === "notes");
        const masked = await handed?.hooks?.afterRead?.({ table: notesDescriptor, path: "notes", values: { body: "x" }, context: createCallContext() });
        expect(masked).toMatchObject({ body: "[attached]" });
        const res = await app.request("/api/data/notes/n1", { headers: await admin() });
        expect(await res.json()).toMatchObject({ body: "[attached]" });
    }, BOOTS_A_BACKEND);

    it("says the change is served after a restart when the driver cannot refresh its tables", async () => {
        const registry = new DriverTables();
        const { app } = await boot(registry, { refreshes: false });
        writeNotesByHand();

        const result = await applyNotes(app);
        expect(result).toMatchObject({ applied: true, serving: { status: "after-restart" } });
        expect(result.summary).toContain("serves it after the server restarts");
        // Not a claim the driver can back: it was never handed the table.
        expect(registry.served.has("notes")).toBe(false);
    }, BOOTS_A_BACKEND);
});
