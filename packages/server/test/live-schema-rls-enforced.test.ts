import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { BackendBootstrapper, CompiledTable, SchemaChangePlan, TableDescriptor } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import type { HonoEnv } from "../src/api/types";
import { fakeBootstrapper, fakeDataDriver, idleServer } from "./helpers/server-b-fakes";
import { generateAccessToken } from "../src/auth/jwt";
import { writeSchemaFixture } from "./helpers/schema-source-fixture";

/**
 * Security review S-4: a live apply that changes a table's `rls` never
 * reports a posture the database does not enforce.
 *
 * The planner's DDL carries no policies, so an apply that removed a public
 * read rule used to swap the served rules at once — `/api/schema/tables`, the
 * Studio's RLS editor and MCP showed the tightened rules — while Postgres kept
 * serving the rows under the old policies until the next boot. Now the
 * changed tables' policies are written in the same apply, through the boot
 * policy applier (`ensureCollectionPolicies`); where this backend cannot write
 * them, the served `rls` stays what the database enforces and the result
 * says so (`policies.status: "deferred"`), with the message the Studio shows.
 */

const JWT_SECRET = "live-schema-rls-enforced-secret-1234567890";
const BOOTS_A_BACKEND = 30_000;

let fixture: ReturnType<typeof writeSchemaFixture>;
const originalNodeEnv = process.env.NODE_ENV;
/** The collections each policy write was handed, in order. */
const policyWrites: TableDescriptor[][] = [];

beforeEach(() => {
    process.env.NODE_ENV = "development";
    policyWrites.length = 0;
    fixture = writeSchemaFixture();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture.root, stdio: "pipe" });
    fs.writeFileSync(path.join(fixture.root, "rebase.json"), "{}\n");
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "init");
});

afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    fixture.cleanup();
});

function bootstrapper(options: { policies: "write" | "none" | "fail" }): BackendBootstrapper {
    // An RLS-only change: the planner has no DDL for it.
    const plan: SchemaChangePlan = {
        files: [],
        statements: [],
        classified: { changes: [], verdict: "safe", applicable: true },
        message: "feat(schema): posts rls\n"
    };
    const overrides: Partial<BackendBootstrapper> = {
        async initializeAuth() {
            const authRepository = {
                getUserRoleIds: async (uid: string) => (uid === "admin-1" ? ["admin"] : []),
                getTokensValidAfter: async () => undefined
            };
            return { userService: authRepository, authRepository };
        }
    };
    if (options.policies !== "none") {
        overrides.ensureCollectionPolicies = async (tables: readonly CompiledTable[]) => {
            if (policyWrites.length > 0 && options.policies === "fail") throw new Error("permission denied for table posts");
            policyWrites.push(tables.map(table => table.descriptor));
            return { applied: 3 };
        };
    }
    return fakeBootstrapper({
        driver: fakeDataDriver({ admin: { planSchemaChange: async () => plan, executeSql: async () => [] } }),
        collections: undefined
    }, overrides);
}

async function boot(policies: "write" | "none" | "fail"): Promise<Hono<HonoEnv>> {
    const app = new Hono<HonoEnv>();
    await initializeRebaseBackend({
        app,
        server: idleServer(),
        schemaDir: fixture.dir,
        cronPersistence: false,
        auth: { jwtSecret: JWT_SECRET },
        bootstrappers: [bootstrapper({ policies })]
    });
    return app;
}

const admin = async () => ({ authorization: `Bearer ${await generateAccessToken("admin-1", ["admin"])}` });

async function servedPosts(app: Hono<HonoEnv>): Promise<TableDescriptor> {
    const res = await app.request("/api/schema/tables/posts", { headers: await admin() });
    expect(res.status).toBe(200);
    return await res.json() as TableDescriptor;
}

/** Remove the public read rule (`rls[0]`) of `posts` through the live apply route. */
async function removePublicRead(app: Hono<HonoEnv>): Promise<Record<string, unknown>> {
    const res = await app.request("/api/admin/schema/apply", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await admin()) },
        body: JSON.stringify({ patches: [{ op: "removeRule", table: "posts", index: 0 }] })
    });
    expect(res.status).toBe(200);
    return await res.json() as Record<string, unknown>;
}

const PUBLIC_READ = { operation: "select", access: "public", condition: { status: "published" } };

describe("a live apply that removes a public read rule", () => {
    it("writes the policies in the same apply, then serves the rules the database now enforces", async () => {
        const app = await boot("write");
        const bootWrites = policyWrites.length;
        expect((await servedPosts(app)).rls.rules).toContainEqual(PUBLIC_READ);

        const result = await removePublicRead(app);
        expect(result).toMatchObject({ applied: true, policies: { status: "applied", tables: ["posts"], statements: 3 } });

        // The applier was handed the edited table, without the public rule.
        expect(policyWrites.length).toBe(bootWrites + 1);
        const written = policyWrites.at(-1)?.find(table => table.slug === "posts");
        expect(written?.rls.rules).not.toContainEqual(PUBLIC_READ);
        expect(written?.rls.rules).toHaveLength(2);
        // And what is served agrees with what was written.
        const served = await servedPosts(app);
        expect(served.rls.rules).not.toContainEqual(PUBLIC_READ);
        expect(served.rls.rules).toEqual(written?.rls.rules);
    }, BOOTS_A_BACKEND);

    it("where policies cannot be written, keeps serving the rules the database enforces, and says so", async () => {
        const app = await boot("none");
        const result = await removePublicRead(app);
        expect(result).toMatchObject({
            applied: true,
            policies: { status: "deferred", tables: ["posts"], message: expect.stringContaining("Rules saved to source; they take effect on the next deploy") }
        });
        expect(result.followUp).toEqual(expect.arrayContaining([expect.stringContaining("take effect on the next deploy")]));
        expect(String(result.summary)).toContain("take effect on the next deploy");
        // Postgres still enforces the public read, so that is what is served.
        expect((await servedPosts(app)).rls.rules).toContainEqual(PUBLIC_READ);
        // The source has the change.
        expect(fs.readFileSync(path.join(fixture.dir, "posts.ts"), "utf8")).not.toContain('access: "public"');
    }, BOOTS_A_BACKEND);

    it("when writing them fails, reports it and keeps serving the enforced rules", async () => {
        const app = await boot("fail");
        const result = await removePublicRead(app);
        expect(result).toMatchObject({ applied: true, policies: { status: "failed", error: "permission denied for table posts" } });
        expect((await servedPosts(app)).rls.rules).toContainEqual(PUBLIC_READ);
    }, BOOTS_A_BACKEND);
});
