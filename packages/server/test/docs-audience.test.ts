import { describe, expect, it } from "@jest/globals";
import { Hono, type MiddlewareHandler } from "hono";
import { col, defineTable } from "@rebasepro/types";
import { compileSchemaDefs } from "../src/schema/load-schema";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { loadOpenApiGenerator, mountOpenApiDocs, type OpenApiDocsAudience } from "../src/init/docs";
import { createRequireAuth, requireAdmin } from "../src/auth/middleware";

/**
 * `GET /api/docs` by default (`enableSwagger` unset) is served to the callers
 * `GET /schema/tables` describes the tables to, each the document of exactly
 * the tables, columns and relations that endpoint describes to them
 * (SEC-FIX-2, "worth a second look"). It used to list every served table —
 * admin-only ones included, every non-private column — to anyone, which
 * undid the schema endpoint's redaction. Publishing it is `enableSwagger: true`.
 */

const openNotes = defineTable("open_notes", {
    columns: { id: col.serial().primaryKey(), body: col.text() },
    rls: [{ operation: "select", access: "public" }]
});
const members = defineTable("members", {
    columns: { id: col.serial().primaryKey(), name: col.text(), salary: col.integer().access({ read: ["hr"] }) },
    rls: [{ operation: "select", access: "authenticated" }]
});
const staffOnly = defineTable("staff_only", {
    columns: { id: col.serial().primaryKey(), memo: col.text() },
    rls: [{ operation: "select", roles: ["staff"] }]
});
const secrets = defineTable("admin_secrets", {
    columns: { id: col.serial().primaryKey(), value: col.text() },
    rls: "admin-only"
});
const TABLES = compileSchemaDefs([openNotes, members, staffOnly, secrets]).descriptors;

/** The caller a test names in `x-test-roles` (absent: nobody signed in). */
const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    const roles = c.req.header("x-test-roles");
    if (roles !== undefined) c.set("user", { uid: "u-1", roles: roles ? roles.split(",") : [] });
    return next();
};

async function docsApp(enableSwagger: boolean | undefined, audience?: Partial<OpenApiDocsAudience>) {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    mountOpenApiDocs(app, "/api", {
        enableSwagger,
        serverTables: TABLES,
        requireAuth: true,
        adminGate: [createRequireAuth({}), requireAdmin],
        generate: await loadOpenApiGenerator(),
        ...(audience ? { audience: { authenticate: [fakeAuth], available: true, ...audience } } : {})
    });
    return app;
}

async function documentFor(app: Hono<HonoEnv>, roles?: string): Promise<{ status: number; text: string }> {
    const response = await app.request("/api/docs", roles === undefined ? {} : { headers: { "x-test-roles": roles } });
    return { status: response.status, text: await response.text() };
}

describe("/api/docs by default: the schema endpoint's audience", () => {
    it("refuses an anonymous caller", async () => {
        const app = await docsApp(undefined, {});
        const answer = await documentFor(app);
        expect(answer.status).toBe(401);
        expect(answer.text).not.toContain("admin_secrets");
    });

    it("describes to a signed-in person only the tables their roles reach, without the columns they may not read", async () => {
        const app = await docsApp(undefined, {});
        const answer = await documentFor(app, "editor");
        expect(answer.status).toBe(200);
        expect(answer.text).toContain("/open_notes");
        expect(answer.text).toContain("/members");
        expect(answer.text).not.toContain("staff_only");
        expect(answer.text).not.toContain("admin_secrets");
        expect(answer.text).not.toContain("salary");

        const staff = await documentFor(app, "staff,hr");
        expect(staff.text).toContain("/staff_only");
        expect(staff.text).toContain("salary");
        expect(staff.text).not.toContain("admin_secrets");
    });

    it("describes every table to an administrator (the console's API Explorer)", async () => {
        const app = await docsApp(undefined, {});
        const answer = await documentFor(app, "admin");
        expect(answer.status).toBe(200);
        for (const table of ["open_notes", "members", "staff_only", "admin_secrets"]) expect(answer.text).toContain(`/${table}`);
    });

    it("with schemaTables.public, describes to an anonymous caller the tables with a public select rule alone", async () => {
        const app = await docsApp(undefined, { publicTables: true });
        const answer = await documentFor(app);
        expect(answer.status).toBe(200);
        expect(answer.text).toContain("/open_notes");
        expect(answer.text).not.toContain("/members");
        expect(answer.text).not.toContain("admin_secrets");
    });

    it("answers 404 DOCS_UNAVAILABLE without authentication, naming the opt-in", async () => {
        const app = await docsApp(undefined, { available: false });
        const answer = await documentFor(app);
        expect(answer.status).toBe(404);
        expect(answer.text).toContain("DOCS_UNAVAILABLE");
        expect(answer.text).toContain("enableSwagger: true");
    });

    it("is private to the caller: never shared by a cache", async () => {
        const app = await docsApp(undefined, {});
        const response = await app.request("/api/docs", { headers: { "x-test-roles": "editor" } });
        expect(response.headers.get("cache-control")).toBe("private, no-cache");
        expect(response.headers.get("vary")).toBe("Authorization");
    });

    it("falls back to the admin gate when no audience is wired (fail closed)", async () => {
        const app = await docsApp(undefined);
        expect([401, 403]).toContain((await documentFor(app)).status);
    });

    it("publishes the whole document to everyone only on the explicit opt-in, and no Swagger UI otherwise", async () => {
        const published = await docsApp(true, {});
        const answer = await documentFor(published);
        expect(answer.status).toBe(200);
        expect(answer.text).toContain("/admin_secrets");

        const unset = await docsApp(undefined, {});
        expect((await unset.request("/api/swagger")).status).toBe(404);
    });
});
