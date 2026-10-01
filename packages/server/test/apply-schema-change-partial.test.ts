/**
 * A change's DDL runs one statement at a time, with no transaction around it —
 * `CREATE INDEX CONCURRENTLY` may not run inside one. So when statement k fails,
 * statements 1…k-1 have already changed the database, and the receipt has to
 * say so. It used to say "the database was not changed" whatever k was: a new
 * belongsTo on a large table whose ADD COLUMN succeeded and whose FOREIGN KEY
 * validation hit `statement_timeout` was reported as untouched.
 */
import { Hono } from "hono";
import type { CollectionConfig, DatabaseAdmin, SchemaChangePlan } from "@rebasepro/types";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createLiveSchemaRoutes } from "../src/api/live-schema-routes";
import {
    applySchemaChange,
    StatementFailedError,
    type SchemaEditRepository
} from "../src/schema-edit/apply-schema-change";

const STATEMENTS = [
    'ALTER TABLE "public"."posts" ADD COLUMN IF NOT EXISTS "author_id" UUID;',
    'ALTER TABLE "public"."posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."authors" ("id") ON DELETE SET NULL'
];

const plan = (): SchemaChangePlan => ({
    files: [{ path: "backend/src/schema.generated.ts", contents: "export const x = 1;" }],
    statements: STATEMENTS,
    classified: { changes: [], verdict: "safe", applicable: true },
    message: "feat(schema): add author to posts"
});

const repository = (): SchemaEditRepository => ({
    root: "/tmp/project",
    currentBranch: async () => "main",
    dirtyPaths: async () => [],
    writeFiles: async () => undefined,
    commit: async () => "abc123def456"
});

describe("a DDL failure after the first statement", () => {
    it("reports how many statements ran, and never that nothing changed", async () => {
        const result = await applySchemaChange({
            plan: plan(),
            repository: repository(),
            apply: async () => {
                throw new StatementFailedError(1, STATEMENTS[1], new Error("canceling statement due to statement timeout"));
            }
        });

        expect(result.applied).toBe(false);
        expect(result.appliedStatements).toBe(1);
        expect(result.summary).not.toMatch(/not changed/);
        expect(result.summary).toMatch(/applied 1 of 2 statement/);
        expect(result.summary).toContain("statement timeout");
    });

    it("still says the database was not changed when the first statement failed", async () => {
        const result = await applySchemaChange({
            plan: plan(),
            repository: repository(),
            apply: async () => {
                throw new StatementFailedError(0, STATEMENTS[0], new Error("permission denied"));
            }
        });

        expect(result.appliedStatements).toBe(0);
        expect(result.summary).toMatch(/database was not changed/);
    });

    it("does not claim to know when the applier could not say how far it got", async () => {
        const result = await applySchemaChange({
            plan: plan(),
            repository: repository(),
            apply: async () => { throw new Error("connection reset"); }
        });

        expect(result.appliedStatements).toBeUndefined();
        expect(result.summary).not.toMatch(/not changed/);
        expect(result.summary).toMatch(/may have/);
    });

    it("is what /apply reports when the second statement is rejected", async () => {
        const executed: string[] = [];
        const admin = {
            planSchemaChange: async () => plan(),
            executeSql: async (sql: string) => {
                if (executed.length === 1) throw new Error("canceling statement due to statement timeout");
                executed.push(sql);
                return { rows: [] };
            }
        } as unknown as DatabaseAdmin;

        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("user", { uid: "u_1", roles: ["admin"], email: "ada@example.com" } as never);
            await next();
        });
        app.route("/api/schema", createLiveSchemaRoutes({
            getCollections: () => [{ slug: "posts", name: "posts", properties: {} } as unknown as CollectionConfig],
            getAdmin: () => admin,
            getRepository: () => repository(),
            writeSource: async () => []
        }));

        const response = await app.fetch(new Request("http://localhost/api/schema/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ collectionId: "posts", collection: { name: "Posts", properties: {} } })
        }));
        const body = await response.json() as { applied: boolean; appliedStatements?: number; summary: string };

        expect(response.status).toBe(200);
        expect(body.applied).toBe(false);
        expect(body.appliedStatements).toBe(1);
        expect(body.summary).not.toMatch(/not changed/);
    });
});
