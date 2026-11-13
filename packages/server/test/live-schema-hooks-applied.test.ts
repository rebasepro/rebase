import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { BackendBootstrapper, SchemaChangePlan, TableDescriptor, TableHooks } from "@rebasepro/types";
import { createCallContext } from "@rebasepro/common";

import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";
import { generateAccessToken } from "../src/auth/jwt";
import { writeSchemaFixture } from "./helpers/schema-source-fixture";

/**
 * After a live apply, the hooks that run are the hooks the source declares.
 *
 * What an apply handed the registries was descriptors alone, so a table's
 * hooks were known after it only as flags: the drivers — which run hooks
 * natively — were never given the compiled ones, and the table model kept
 * none (storage's "this table has read hooks" check, the masking refusals).
 * The edited definitions are compiled anyway; the compiled tables now travel
 * with the edit to every registry.
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

/** The hooks the driver's own registry was handed, by slug — what it runs. */
class DriverTableHooks {
    readonly attached = new Map<string, TableHooks>();
    setTableHooks(slug: string, hooks: TableHooks): boolean {
        this.attached.set(slug, hooks);
        return true;
    }
}

const notesDescriptor: TableDescriptor = {
    name: "notes", slug: "notes", table: "notes", schema: "public", kind: "table",
    columns: [{ key: "id", column: "id", type: { kind: "uuid" }, nullable: false, primaryKey: true }],
    primaryKey: ["id"],
    relations: [],
    rls: { posture: "admin-only", rules: [], defaultPolicies: true }
};

function bootstrapper(registry: DriverTableHooks): BackendBootstrapper {
    const plan: SchemaChangePlan = {
        files: [],
        statements: ['CREATE TABLE IF NOT EXISTS "public"."notes" ("id" uuid PRIMARY KEY, "body" text);'],
        classified: { changes: [], verdict: "safe", applicable: true },
        message: "feat(schema): add notes\n"
    };
    // A driver that runs, as the Postgres one does, the `afterRead` its own
    // registry holds for the table it reads.
    const driver = Object.assign(fakeDataDriver({
        async fetchOne(props) {
            const row = { id: props.id, body: "the secret" };
            const afterRead = registry.attached.get(props.path)?.afterRead;
            if (!afterRead) return row;
            return afterRead({ table: notesDescriptor, path: props.path, values: row, context: createCallContext() });
        },
        admin: {
            planSchemaChange: async () => plan,
            executeSql: async () => []
        }
    }), { registry });
    return fakeBootstrapper({ driver, collections: undefined }, {
        async initializeAuth() {
            const authRepository = {
                getUserRoleIds: async (uid: string) => (uid === "admin-1" ? ["admin"] : []),
                getTokensValidAfter: async () => undefined
            };
            return { userService: authRepository, authRepository };
        }
    });
}

async function boot(registry: DriverTableHooks): Promise<Hono<HonoEnv>> {
    const app = new Hono<HonoEnv>();
    await initializeRebaseBackend({
        app,
        server: idleServer(),
        schemaDir: fixture.dir,
        cronPersistence: false,
        auth: { jwtSecret: JWT_SECRET },
        bootstrappers: [bootstrapper(registry)]
    });
    return app;
}

const admin = async () => ({ authorization: `Bearer ${await generateAccessToken("admin-1", ["admin"])}` });

describe("a live apply that adds a table with an afterRead hook", () => {
    it("runs that hook on the next REST read, without a restart", async () => {
        const registry = new DriverTableHooks();
        const app = await boot(registry);
        const read = async () => app.request("/api/data/notes/n1", { headers: await admin() });
        expect((await read()).status).toBe(404);

        // The table is written in the editor of the person's choice, hook and
        // all — hooks are code, which no schema edit carries — and the live
        // apply compiles it with the rest of the schema.
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

        const applied = await app.request("/api/admin/schema/apply", {
            method: "POST",
            headers: { "content-type": "application/json", ...(await admin()) },
            body: JSON.stringify({ patches: [{ op: "setOption", table: "notes", option: "description", value: "Notes, masked on the way out." }] })
        });
        expect(applied.status).toBe(200);
        expect(await applied.json()).toMatchObject({ applied: true });

        // The driver was handed the compiled hook, and runs it.
        expect(typeof registry.attached.get("notes")?.afterRead).toBe("function");
        const res = await read();
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ id: "n1", body: "[masked]" });
    }, BOOTS_A_BACKEND);
});
