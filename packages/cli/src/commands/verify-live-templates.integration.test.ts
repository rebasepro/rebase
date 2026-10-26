/**
 * Every preset `rebase init` writes passes its own `rebase verify --live`.
 *
 * The blog scaffold's `defaultSecurityRules` read `access: "public"`, which
 * Rebase compiles to `USING (true)` select policies. rls-check reads those as
 * critical — for the role signed-in requests run as, every row — and the live
 * step mapped critical onto errors, so a fresh scaffold failed `verify --live`
 * with three errors that step 2 of the same command deliberately passes. The
 * API refuses a request with no token unless `AUTH_REQUIRE=false`, so the
 * policy grants every row to every signed-in user: a warning, as in step 2.
 *
 * Each preset is scaffolded, its collections provisioned into PGlite the way
 * the runtime's boot provisions them (auth tables, collection tables, the
 * `rebase_user` role, the compiled policies), and `runVerify` run live against
 * it — so a scaffold change that the audit would fail is caught here.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CollectionConfig } from "@rebasepro/types";

import { ensureAppRole } from "@rebasepro/server-postgres";
import { RLS_BOOTSTRAP_SQL } from "../../../server-postgres/src/schema/rls-bootstrap-sql";
import { ensureCollectionTables } from "../../../server-postgres/src/schema/ensure-collection-tables";
import { ensureCollectionPolicies } from "../../../server-postgres/src/schema/ensure-collection-policies";

import { MANAGED_SERVER_MAX_CONNECTIONS } from "../dev-db/constraints";
import { findFreePort } from "../dev-db/state";
import { createRebaseApp, type TemplatePreset } from "./init";
import { runVerify } from "./verify";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

/** The scaffold's collection files import `defineCollection`; a stand-in with the same identity builder. */
function stubCmsTypes(projectDir: string): void {
    const pkg = path.join(projectDir, "node_modules", "@rebasepro", "cms-types");
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "@rebasepro/cms-types", type: "module", main: "index.js" }));
    fs.writeFileSync(path.join(pkg, "index.js"), "export const defineCollection = (collection) => collection;\n");
}

describe.each<TemplatePreset>(["blog", "ecommerce", "blank"])("a fresh %s scaffold, provisioned as boot provisions it", (preset) => {
    let root: string;
    let project: string;
    let db: { close(): Promise<void> };
    let server: { stop(): Promise<void> };
    let url: string;

    beforeAll(async () => {
        root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-verify-live-templates-"));
        project = path.join(root, `${preset}-app`);
        vi.stubEnv("REBASE_E2E", "1");
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            await createRebaseApp(["node", "rebase", "init", project, "--yes", "--template", preset]);
        } finally {
            vi.unstubAllEnvs();
            log.mockRestore();
            warn.mockRestore();
        }
        stubCmsTypes(project);

        const { PGlite } = (await import("@electric-sql/pglite")) as {
            PGlite: { create(options?: unknown): Promise<{ close(): Promise<void> }> };
        };
        const { PGLiteSocketServer } = (await import("@electric-sql/pglite-socket")) as {
            PGLiteSocketServer: new (options: unknown) => { start(): Promise<void>; stop(): Promise<void> };
        };
        db = await PGlite.create();
        const port = await findFreePort();
        const socketServer = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: MANAGED_SERVER_MAX_CONNECTIONS });
        await socketServer.start();
        server = socketServer;
        url = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;

        // The collections as the backend gets them: the directory's `index.ts`
        // applies `defaultSecurityRules` to the array it exports.
        const { createJiti } = await import("jiti");
        const collectionsDir = path.join(project, "config", "collections");
        const jiti = createJiti(path.join(collectionsDir, "index.ts"), { interopDefault: true, moduleCache: false, fsCache: false });
        const mod = await jiti.import<{ collections: CollectionConfig[] }>(path.join(collectionsDir, "index.ts"));
        const collections = mod.collections;
        expect(collections.length).toBeGreaterThan(0);

        // The boot order of server-postgres's managed-boot acceptance test:
        // the helper functions the policies call (what `db push` bootstraps
        // first), the tables, the `rebase_user` role, then the policies.
        const client = new pg.Client({ connectionString: url });
        await client.connect();
        try {
            const queryable = { query: <T>(text: string) => client.query(text).then(result => ({ rows: result.rows as T[] })) };
            await client.query(RLS_BOOTSTRAP_SQL);
            await ensureCollectionTables(queryable, collections);
            await ensureAppRole(async (text) => (await client.query<Record<string, unknown>>(text)).rows, ["public", "rebase", "auth"]);
            const applied = await ensureCollectionPolicies(queryable, collections);
            expect(applied.failures).toEqual([]);
        } finally {
            await client.end();
        }
    });

    afterAll(async () => {
        await server?.stop();
        await db?.close();
        if (root) fs.rmSync(root, { recursive: true, force: true });
    });

    it("passes rebase verify --live", async () => {
        const report = await runVerify({
            projectRoot: project,
            collectionsDir: path.join(project, "config", "collections"),
            backendDir: path.join(project, "backend"),
            live: true,
            databaseUrl: url
        });
        expect(report.findings.filter(f => f.severity === "error")).toEqual([]);
        expect(report.steps.find(s => s.id === "live")?.status).not.toBe("skipped");
        expect(report.ok).toBe(true);
    });

    it("still fails a compiled public read when AUTH_REQUIRE=false makes the rows anonymous", async () => {
        const report = await runVerify({
            projectRoot: project,
            collectionsDir: path.join(project, "config", "collections"),
            backendDir: path.join(project, "backend"),
            live: true,
            databaseUrl: url,
            authRequired: false
        });
        const publicReads = report.findings.filter(f => f.check === "policy-always-true" && f.severity === "error");
        // Only the blog preset reads `access: "public"`; the others are admin-only.
        if (preset === "blog") expect(publicReads.length).toBeGreaterThan(0);
        else expect(publicReads).toEqual([]);
    });
});
