/**
 * Zero-code BaaS foundation tests over real PostgreSQL (PGlite):
 *  - `createZeroCodeBundle()` produces a valid bundle with no manifest/code
 *  - `ensureBaasCatalogTables()` provisions `rebase.{table_meta,storage_policies,webhooks,cron_jobs,roles}`
 *  - `/api/admin/db/*` creates, alters, adds columns/indexes/policies, previews SQL via `dryRun`,
 *    persists `rebase.table_meta`, and triggers `reloadSchema()`
 *  - `readTableMetaOverlays()` + `applyTableMetaOverlays()` overlay zero-code metadata onto
 *    introspected `TableDescriptor`s (`description`, `softDelete`, `history`, `exposed: false`, `columnAccess`)
 *  - `createStoragePoliciesStore()` evaluates declarative owner/roles/public/claim rules deny-by-default
 *  - `createWebhooksStore()`, `createRolesStore()`, and `createCronJobsStore()` persist and validate cleanly
 */
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { createServer } from "node:http";
import { Hono } from "hono";
import { PGlite } from "@electric-sql/pglite";
import { isSQLAdmin, type SQLAdmin, type TableDescriptor } from "@rebasepro/types";
import type { HonoEnv } from "../../server/src/api/types";
import {
    createZeroCodeBundle,
    initializeRebaseBackend,
    WebhookDispatcher,
    _resetRebaseMock
} from "@rebasepro/server";
import {
    ensureBaasCatalogTables,
    createDbAdminRoutes,
    createDbCatalogRoutes,
    createDbInsightsRoutes,
    createStoragePoliciesStore,
    createWebhooksStore,
    createRolesStore,
    createCronJobsStore
} from "../../server/src/baas";
import { createPostgresAdapter } from "../src/PostgresAdapter";
import { openPostgresDriver } from "../src/PostgresBootstrapper";
import { introspectTables } from "../src/schema/introspect-tables";
import { applyTableMetaOverlays, readTableMetaOverlays } from "../src/schema/table-meta-overlay";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";
import { RLS_BOOTSTRAP_STATEMENTS } from "../src/schema/rls-bootstrap-sql";

function makePgliteSqlAdmin(db: PGlite, txBatches?: string[][]): SQLAdmin {
    return {
        executeSql: async (sqlText: string, options?: { params?: unknown[] }) => {
            const res = await db.query<Record<string, unknown>>(sqlText, options?.params);
            return res.rows;
        },
        executeSqlTransaction: async (statements: readonly string[]) => {
            txBatches?.push([...statements]);
            await db.exec("BEGIN");
            try {
                for (const stmt of statements) {
                    await db.query(stmt);
                }
                await db.exec("COMMIT");
            } catch (err) {
                await db.exec("ROLLBACK").catch(() => undefined);
                throw err;
            }
        }
    };
}

describe("Zero-code BaaS foundation (PGlite)", () => {
    let db: PGlite;
    let admin: SQLAdmin;

    beforeAll(async () => {
        db = new PGlite();
        await db.waitReady;
        // The real `rebase.uid()` / `rebase.roles()` the admin baseline policy
        // calls. A stand-in `roles()` returning text[] once let this suite pass
        // while every table create on a real database failed: the real one
        // returns comma-separated text.
        for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
        admin = makePgliteSqlAdmin(db);
        await ensureBaasCatalogTables(admin);
    });

    afterAll(async () => {
        await db.close();
    });

    it("createZeroCodeBundle builds a valid in-memory bundle with no files on disk", () => {
        const bundle = createZeroCodeBundle("/tmp/does-not-exist-zero-code");
        expect(bundle.isZeroCode).toBe(true);
        expect(bundle.isSource).toBe(false);
        expect(bundle.tablesDir).toBeUndefined();
        expect(bundle.manifest.kind).toBe("backend");
        expect(bundle.manifest.entry).toEqual({});
        expect(bundle.staticApps).toEqual([]);
    });

    it("creates tables, columns, indexes, policies, and table_meta via /api/admin/db and overlays introspection", async () => {
        let reloadCount = 0;
        let currentDescriptors: TableDescriptor[] = [];

        const reloadSchema = async () => {
            reloadCount++;
            const introspected = await introspectTables(db, "public");
            const overlays = await readTableMetaOverlays(db, "public");
            currentDescriptors = applyTableMetaOverlays(introspected.tables, overlays);
            return { tables: currentDescriptors.length, revision: reloadCount, unprotectedTables: [] };
        };

        const app = createDbAdminRoutes({
            admin,
            getServedTables: () => currentDescriptors,
            reloadSchema
        });

        // 1. Dry-run previews SQL without executing
        const dryRes = await app.request("/tables", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "notes",
                dryRun: true,
                columns: [
                    { name: "id", type: "uuid", primaryKey: true, default: "gen_random_uuid()" },
                    { name: "title", type: "text", nullable: false }
                ]
            })
        });
        expect(dryRes.status).toBe(200);
        const dryBody = await dryRes.json() as { dryRun: boolean; statements: string[] };
        expect(dryBody.dryRun).toBe(true);
        expect(dryBody.statements[0]).toContain('CREATE TABLE "public"."notes"');
        expect(reloadCount).toBe(0);

        // 2. Real create with RLS enabled, policy, and table_meta
        const createRes = await app.request("/tables", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "notes",
                columns: [
                    { name: "id", type: "uuid", primaryKey: true, default: "gen_random_uuid()" },
                    { name: "title", type: "text", nullable: false },
                    { name: "deleted_at", type: "timestamptz", nullable: true }
                ],
                policies: [
                    { name: "notes_public_read", operation: "SELECT", using: "true" }
                ],
                meta: {
                    description: "User notes",
                    softDeleteColumn: "deleted_at",
                    historyEnabled: true,
                    columnAccess: { title: { read: ["admin", "member"] } }
                }
            })
        });
        expect(createRes.status).toBe(201);
        expect(currentDescriptors.map(t => t.slug)).toContain("notes");
        const notes = currentDescriptors.find(t => t.slug === "notes")!;
        expect(notes.description).toBe("User notes");
        expect(notes.softDelete).toEqual({ field: "deletedAt" });
        expect(notes.history).toBe(true);
        expect(notes.columns.find(c => c.key === "title")?.access).toEqual({ read: ["admin", "member"] });

        // 3. Add a column via POST /tables/notes/columns
        const addColRes = await app.request("/tables/notes/columns", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "priority",
                type: "integer",
                nullable: false,
                default: "0"
            })
        });
        expect(addColRes.status).toBe(201);
        const updatedNotes = currentDescriptors.find(t => t.slug === "notes")!;
        expect(updatedNotes.columns.some(c => c.column === "priority")).toBe(true);

        // 4. GET /tables lists the table as served with enriched columns (key, primaryKey, unique, default), normalized camelCase meta, and policies
        const listRes = await app.request("/tables");
        expect(listRes.status).toBe(200);
        const listBody = await listRes.json() as {
            tables: Array<{
                name: string;
                served: boolean;
                exposed: boolean;
                rlsEnabled: boolean;
                columns: Array<{ name: string; key: string; primaryKey: boolean; unique: boolean; default: string | null }>;
                policies: Array<{ name: string; operation: string }>;
                meta: Record<string, unknown> | null;
            }>;
        };
        const listed = listBody.tables.find(t => t.name === "notes");
        expect(listed).toBeDefined();
        expect(listed?.served).toBe(true);
        expect(listed?.exposed).toBe(true);
        expect(listed?.rlsEnabled).toBe(true);
        const idCol = listed?.columns.find(c => c.name === "id");
        expect(idCol?.primaryKey).toBe(true);
        const delCol = listed?.columns.find(c => c.name === "deleted_at");
        expect(delCol?.key).toBe("deletedAt");
        expect(listed?.meta?.softDeleteColumn).toBe("deleted_at");
        expect(listed?.meta?.historyEnabled).toBe(true);
        expect((listed?.policies ?? []).length).toBeGreaterThanOrEqual(2);

        // 4b. Policy creation without explicit `operation` (e.g. legacy `command` typo) is refused rather than silently widening to ALL
        const badPolicyRes = await app.request("/tables/notes/policies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "bad_command_typo",
                command: "SELECT",
                using: "true"
            })
        });
        expect(badPolicyRes.status).toBe(400);

        // 4b'. A statement Postgres refuses comes back with Postgres's own
        // sentence, not the generic 500 "An unexpected error occurred".
        const duplicateRes = await app.request("/tables", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: "notes",
                columns: [{ name: "id", type: "uuid", primaryKey: true }]
            })
        });
        expect(duplicateRes.status).toBe(409);
        const duplicateBody = await duplicateRes.json() as { error: { code: string; message: string } };
        expect(duplicateBody.error.code).toBe("DDL_REJECTED");
        expect(duplicateBody.error.message).toContain('relation "notes" already exists');

        // 4c. Renaming a table AND toggling RLS in one PATCH uses the renamed identifier and migrates table_meta
        const renameRes = await app.request("/tables/notes", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ renameTo: "user_notes", rlsEnabled: true })
        });
        expect(renameRes.status).toBe(200);
        expect(currentDescriptors.find(t => t.table === "user_notes")?.description).toBe("User notes");
        await app.request("/tables/user_notes", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ renameTo: "notes", rlsEnabled: true })
        });

        // 5. Hiding a table via table_meta `exposed: false` removes it from served descriptors
        const hideRes = await app.request("/tables/notes", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ meta: { exposed: false } })
        });
        expect(hideRes.status).toBe(200);
        expect(currentDescriptors.find(t => t.table === "notes")).toBeUndefined();

        // 6. Drop requires explicit confirmation
        const dropNoConfirm = await app.request("/tables/notes", { method: "DELETE" });
        expect(dropNoConfirm.status).toBe(400);

        const dropOk = await app.request("/tables/notes", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: "notes" })
        });
        expect(dropOk.status).toBe(200);
    });

    it("enforces declarative zero-code storage policies deny-by-default", async () => {
        const store = createStoragePoliciesStore(admin);
        await store.reload();

        // Deny by default for non-admins when no policies exist
        expect(await store.authorize({
            bucket: "default",
            key: "users/u1/avatar.png",
            operation: "read",
            user: { uid: "u1", roles: ["member"] }
        })).toBe(false);

        // Admins always allowed
        expect(await store.authorize({
            bucket: "default",
            key: "users/u1/avatar.png",
            operation: "read",
            user: { uid: "admin-1", roles: ["admin"] }
        })).toBe(true);

        // Add declarative owner policy: users/:uid/**
        const policy = await store.create({
            name: "Owner files",
            pathPattern: "users/:uid/**",
            operations: ["read", "write", "delete"],
            rule: { kind: "owner", param: "uid" }
        });
        expect(policy.id).toBeTruthy();

        expect(await store.authorize({
            bucket: "default",
            key: "users/u1/avatar.png",
            operation: "write",
            user: { uid: "u1", roles: ["member"] }
        })).toBe(true);

        expect(await store.authorize({
            bucket: "default",
            key: "users/u1/avatar.png",
            operation: "write",
            user: { uid: "u2", roles: ["member"] }
        })).toBe(false);

        await store.remove(policy.id);

        // Claim-based policy matches JWT custom claims on `user.claims`
        const claimPolicy = await store.create({
            name: "Org documents",
            pathPattern: "orgs/:org/**",
            operations: ["read"],
            rule: { kind: "claim", claim: "org_id", param: "org" }
        });
        expect(await store.authorize({
            bucket: "default",
            key: "orgs/acme/report.pdf",
            operation: "read",
            user: { uid: "u1", roles: ["member"], claims: { org_id: "acme" } }
        })).toBe(true);
        expect(await store.authorize({
            bucket: "default",
            key: "orgs/other/report.pdf",
            operation: "read",
            user: { uid: "u1", roles: ["member"], claims: { org_id: "acme" } }
        })).toBe(false);
        await store.remove(claimPolicy.id);
    });

    it("persists zero-code webhooks, roles, and scheduled SQL/HTTP cron jobs", async () => {
        const dispatcher = new WebhookDispatcher();
        const webhooks = createWebhooksStore(admin, dispatcher);
        const wh = await webhooks.create({
            name: "Order created",
            table: "orders",
            events: ["create", "UPDATE"],
            url: "https://example.com/hook",
            secret: "whsec_test"
        });
        expect(wh.events).toEqual(["INSERT", "UPDATE"]);
        expect((await webhooks.list()).length).toBe(1);
        await webhooks.remove(wh.id);

        const roles = createRolesStore(admin);
        const editor = await roles.upsert({
            name: "editor",
            description: "Content editors",
            scopes: ["data:read", "data:write"],
            isDefault: true
        });
        expect(editor.scopes).toEqual(["data:read", "data:write"]);
        expect(editor.isDefault).toBe(true);
        expect((await roles.list()).map(r => r.name)).toContain("editor");

        // Refuse marking a role with admin-plane scopes as the default signup role
        await expect(roles.upsert({
            name: "super_ops",
            scopes: ["users:write"],
            isDefault: true
        })).rejects.toThrow(/admin-plane scopes/);

        await roles.remove("editor");

        const crons = createCronJobsStore(admin);
        const job = await crons.create({
            name: "cleanup_sessions",
            schedule: "0 3 * * *",
            kind: "sql",
            config: { sql: "SELECT 1" }
        });
        expect(job.kind).toBe("sql");
        expect((await crons.list()).map(j => j.name)).toContain("cleanup_sessions");
        await crons.remove(job.id);
    });

    it("boots full initializeRebaseBackend with 0 code tables and hot-reloads DDL, REST, schema, roles, storage policies, webhooks, and cron jobs over HTTP", async () => {
        const e2eDb = new PGlite();
        await e2eDb.waitReady;
        const app = new Hono<HonoEnv>();
        const server = createServer();
        const prevJwtSecret = process.env.JWT_SECRET;
        process.env.JWT_SECRET = "zero-code-e2e-test-jwt-secret-32chars!!";

        const backend = await initializeRebaseBackend({
            app,
            server,
            database: createPostgresAdapter({
                connection: pgliteNodePg(e2eDb),
                rls: { grants: "managed" }
            }),
            auth: {
                allowRegistration: true,
                jwtSecret: "zero-code-e2e-test-jwt-secret-32chars!!"
            }
        });

        try {
            // 1. Fresh zero-code server has 0 user tables -> /api/data/* answers 404 NO_TABLES
            const emptyRes = await app.request("/api/data/tasks");
            expect(emptyRes.status).toBe(404);
            const emptyBody = await emptyRes.json() as { error?: { code?: string } };
            expect(emptyBody.error?.code).toBe("NO_TABLES");

            // 2. Register first user -> promoted to admin during bootstrap window
            const regAdminRes = await app.request("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: "founder@rebase.pro",
                    password: "StrongPassword123!",
                    displayName: "Founder"
                })
            });
            expect(regAdminRes.status).toBe(201);
            const adminAuth = await regAdminRes.json() as { tokens: { accessToken: string }; user: { roles: string[] } };
            expect(adminAuth.user.roles).toContain("admin");
            const authHeaders = {
                "Content-Type": "application/json",
                Authorization: `Bearer ${adminAuth.tokens.accessToken}`
            };

            // 3. Create `tasks` table with RLS + policy + table_meta via POST /api/admin/db/tables
            const createTableRes = await app.request("/api/admin/db/tables", {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    name: "tasks",
                    columns: [
                        { name: "id", type: "uuid", primaryKey: true, default: "gen_random_uuid()" },
                        { name: "title", type: "text", nullable: false },
                        { name: "deleted_at", type: "timestamptz", nullable: true }
                    ],
                    enableRls: true,
                    policies: [
                        {
                            name: "tasks_authenticated_all",
                            operation: "ALL",
                            using: "true",
                            withCheck: "true"
                        }
                    ],
                    meta: {
                        description: "Zero-code tasks",
                        softDeleteColumn: "deleted_at",
                        historyEnabled: true
                    }
                })
            });
            expect(createTableRes.status).toBe(201);

            // 4. Immediately (zero restart!), GET /api/schema/tables includes `tasks` with overlaid metadata
            const schemaRes = await app.request("/api/schema/tables", { headers: authHeaders });
            expect(schemaRes.status).toBe(200);
            const schemaBody = await schemaRes.json() as TableDescriptor[];
            const tasksDesc = schemaBody.find(t => t.slug === "tasks");
            expect(tasksDesc).toBeDefined();
            expect(tasksDesc?.description).toBe("Zero-code tasks");
            expect(tasksDesc?.softDelete).toEqual({ field: "deletedAt" });

            // 5. Immediately insert & query rows over the hot-swapped `/api/data/tasks` REST endpoint!
            const insertRowRes = await app.request("/api/data/tasks", {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ title: "Live hot-reloaded row" })
            });
            expect(insertRowRes.status).toBe(201);
            const inserted = await insertRowRes.json() as { id: string; title: string };
            const rowId = inserted.id;
            expect(rowId).toBeTruthy();
            expect(inserted.title).toBe("Live hot-reloaded row");

            // 6. Add a column live via POST /api/admin/db/tables/tasks/columns and immediately PATCH it via /api/data/tasks/:id
            const addColRes = await app.request("/api/admin/db/tables/tasks/columns", {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    name: "priority",
                    type: "integer",
                    nullable: false,
                    default: "1"
                })
            });
            expect(addColRes.status).toBe(201);

            const patchRowRes = await app.request(`/api/data/tasks/${rowId}`, {
                method: "PATCH",
                headers: authHeaders,
                body: JSON.stringify({ priority: 9 })
            });
            expect(patchRowRes.status).toBe(200);
            const patchedRow = await patchRowRes.json() as { priority: number };
            expect(patchedRow.priority).toBe(9);

            // 6b. Per-table history enabled via `rebase.table_meta` records create + update automatically
            const historyRes = await app.request(`/api/data/tasks/${rowId}/history`, {
                headers: authHeaders
            });
            expect(historyRes.status).toBe(200);
            const historyBody = await historyRes.json() as { data: Array<{ action: string }> };
            expect(historyBody.data.map(h => h.action)).toEqual(expect.arrayContaining(["create", "update"]));

            // 7. Create a default signup role in `rebase.roles` via POST /api/admin/roles and verify GET /api/admin/roles is not shadowed
            const createRoleRes = await app.request("/api/admin/roles", {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    name: "member",
                    description: "Standard workspace member",
                    scopes: ["data:read", "data:write"],
                    isDefault: true,
                    assignable: true
                })
            });
            expect(createRoleRes.status).toBe(201);

            const listRolesRes = await app.request("/api/admin/roles", { headers: authHeaders });
            expect(listRolesRes.status).toBe(200);
            const listRolesBody = await listRolesRes.json() as {
                roles: Array<{ id: string; name: string; isDefault: boolean; source: string; scopes: string[] }>;
            };
            expect(listRolesBody.roles.some(r => r.name === "admin" && r.source === "built-in")).toBe(true);
            const memberRole = listRolesBody.roles.find(r => r.name === "member");
            expect(memberRole).toBeDefined();
            expect(memberRole?.isDefault).toBe(true);
            expect(memberRole?.source).toBe("database");

            // 8. Register a second user -> automatically receives the DB `isDefault` role ("member")!
            const regUserRes = await app.request("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: "user2@rebase.pro",
                    password: "StrongPassword123!",
                    displayName: "User Two"
                })
            });
            expect(regUserRes.status).toBe(201);
            const user2Auth = await regUserRes.json() as { user: { roles: string[] } };
            expect(user2Auth.user.roles).toEqual(["member"]);

            // 9. Manage declarative storage policies over /api/admin/storage/policies
            const createSpRes = await app.request("/api/admin/storage/policies", {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    name: "User uploads",
                    bucket: "default",
                    pathPattern: "users/:uid/**",
                    operations: ["read", "write", "delete"],
                    rule: { kind: "owner", param: "uid" },
                    priority: 50,
                    enabled: true
                })
            });
            expect(createSpRes.status).toBe(201);

            const listSpRes = await app.request("/api/admin/storage/policies", { headers: authHeaders });
            expect(listSpRes.status).toBe(200);
            const listSpBody = await listSpRes.json() as { policies: Array<{ name: string; pathPattern: string }> };
            expect(listSpBody.policies.map(p => p.pathPattern)).toContain("users/:uid/**");

            // 10. Manage zero-code webhooks over /api/admin/webhooks (secret redacted in response)
            const createWhRes = await app.request("/api/admin/webhooks", {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    name: "Task events",
                    table: "tasks",
                    events: ["INSERT", "UPDATE"],
                    url: "https://example.com/webhooks/tasks",
                    secret: "whsec_live_secret"
                })
            });
            expect(createWhRes.status).toBe(201);
            const whBody = await createWhRes.json() as { webhook: { id: string; hasSecret: boolean; secret?: string } };
            expect(whBody.webhook.hasSecret).toBe(true);
            expect(whBody.webhook.secret).toBeUndefined();

            // 11. Manage zero-code scheduled jobs over /api/admin/cron/jobs and verify active CronScheduler registration
            const createCronRes = await app.request("/api/admin/cron/jobs", {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({
                    name: "touch_tasks",
                    schedule: "*/15 * * * *",
                    kind: "sql",
                    config: { sql: "SELECT 1" },
                    enabled: true
                })
            });
            expect(createCronRes.status).toBe(201);
            const cronJobBody = await createCronRes.json() as { job: { id: string; name: string } };

            // Listed at its own path — the scheduler's `GET /:id` once took
            // `/jobs` for a job named "jobs".
            const listCronRes = await app.request("/api/admin/cron/jobs", { headers: authHeaders });
            expect(listCronRes.status).toBe(200);
            const listCronBody = await listCronRes.json() as { jobs: Array<{ name: string }> };
            expect(listCronBody.jobs.map(j => j.name)).toContain("touch_tasks");

            const schedulerListRes = await app.request("/api/admin/cron", { headers: authHeaders });
            expect(schedulerListRes.status).toBe(200);
            const schedulerList = await schedulerListRes.json() as { jobs: Array<{ id: string }> };
            expect(schedulerList.jobs.some(j => j.id === "db:touch_tasks")).toBe(true);

            const delCronRes = await app.request(`/api/admin/cron/jobs/${cronJobBody.job.id}`, {
                method: "DELETE",
                headers: authHeaders
            });
            expect(delCronRes.status).toBe(200);

            // 12. POST /api/admin/schema/reload works at its dedicated mount
            const reloadRes = await app.request("/api/admin/schema/reload", {
                method: "POST",
                headers: authHeaders
            });
            expect(reloadRes.status).toBe(200);
            const reloadBody = await reloadRes.json() as { status: string; tables: number };
            expect(reloadBody.status).toBe("reloaded");
            expect(reloadBody.tables).toBeGreaterThanOrEqual(1);
        } finally {
            await backend.shutdown(1_000);
            _resetRebaseMock();
            await e2eDb.close();
            if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
            else process.env.JWT_SECRET = prevJwtSecret;
        }
    });

    it("executes multi-statement DDL atomically via PostgresBackendDriver.admin.executeSqlTransaction and rolls back on failure", async () => {
        const txDb = new PGlite();
        await txDb.waitReady;
        try {
            const opened = await openPostgresDriver(
                { connection: pgliteNodePg(txDb), rls: { grants: "managed" } },
                { introspectCollections: true, provision: true, realtime: false }
            );
            const sqlAdmin = opened.driver.admin;
            expect(isSQLAdmin(sqlAdmin)).toBe(true);
            if (!isSQLAdmin(sqlAdmin) || !sqlAdmin.executeSqlTransaction) {
                throw new Error("Expected SQLAdmin with executeSqlTransaction");
            }

            // Failing second statement must roll back the first CREATE TABLE
            await expect(sqlAdmin.executeSqlTransaction([
                `CREATE TABLE "public"."atomic_rollback_test" ("id" integer PRIMARY KEY)`,
                `ALTER TABLE "public"."does_not_exist" ADD COLUMN "x" text`
            ])).rejects.toThrow();

            const afterRollback = await txDb.query<{ table_name: string }>(
                `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'atomic_rollback_test'`
            );
            expect(afterRollback.rows).toHaveLength(0);

            // Succeeding batch commits all statements together
            await sqlAdmin.executeSqlTransaction([
                `CREATE TABLE "public"."atomic_commit_test" ("id" integer PRIMARY KEY, "name" text NOT NULL)`,
                `ALTER TABLE "public"."atomic_commit_test" ENABLE ROW LEVEL SECURITY`
            ]);
            const afterCommit = await txDb.query<{ relrowsecurity: boolean }>(
                `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'atomic_commit_test'`
            );
            expect(afterCommit.rows[0]?.relrowsecurity).toBe(true);
        } finally {
            await txDb.close();
        }
    });

    it("fires passive TableMutationListener on insert, update, and hard delete for watched tables and skips unwatched tables", async () => {
        const hookDb = new PGlite();
        await hookDb.waitReady;
        try {
            for (const statement of RLS_BOOTSTRAP_STATEMENTS) await hookDb.exec(statement);
            await hookDb.exec(`
                CREATE TABLE "public"."watched_items" (
                    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    "label" text NOT NULL
                );
                ALTER TABLE "public"."watched_items" ENABLE ROW LEVEL SECURITY;
                CREATE POLICY "watched_all" ON "public"."watched_items" FOR ALL USING (true) WITH CHECK (true);

                CREATE TABLE "public"."unwatched_items" (
                    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    "label" text NOT NULL
                );
                ALTER TABLE "public"."unwatched_items" ENABLE ROW LEVEL SECURITY;
                CREATE POLICY "unwatched_all" ON "public"."unwatched_items" FOR ALL USING (true) WITH CHECK (true);
            `);

            const opened = await openPostgresDriver(
                { connection: pgliteNodePg(hookDb), rls: { grants: "managed" } },
                { introspectCollections: true, provision: true, realtime: false }
            );

            const events: Array<{ op: string; slug: string; id: string; label?: unknown }> = [];
            opened.tableRegistry?.addMutationListener?.({
                watches: (slug) => slug === "watched_items",
                afterSave: async ({ table, status, id, values }) => {
                    events.push({ op: status === "existing" ? "UPDATE" : "INSERT", slug: table.slug, id: String(id), label: values.label });
                },
                afterDelete: async ({ table, id, values }) => {
                    events.push({ op: "DELETE", slug: table.slug, id: String(id), label: values.label });
                }
            });

            // Insert, update, and hard delete on watched_items
            const created = await opened.driver.save({
                path: "watched_items",
                values: { label: "v1" },
                status: "new"
            });
            const watchedId = String(created.id);
            const updated = await opened.driver.save({
                path: "watched_items",
                id: watchedId,
                values: { label: "v2" },
                status: "existing"
            });
            await opened.driver.delete({
                row: { id: watchedId, path: "watched_items" }
            });

            // Insert and hard delete on unwatched_items -> listener must NOT fire
            const unwatched = await opened.driver.save({
                path: "unwatched_items",
                values: { label: "ignored" },
                status: "new"
            });
            await opened.driver.delete({
                row: { id: String(unwatched.id), path: "unwatched_items" }
            });

            expect(events).toEqual([
                { op: "INSERT", slug: "watched_items", id: watchedId, label: "v1" },
                { op: "UPDATE", slug: "watched_items", id: watchedId, label: "v2" },
                { op: "DELETE", slug: "watched_items", id: watchedId, label: "v2" }
            ]);
        } finally {
            await hookDb.close();
        }
    });
});

describe("Database view routes: /api/admin/db/catalog and /api/admin/db/insights (PGlite)", () => {
    let db: PGlite;
    let admin: SQLAdmin;
    let reloads = 0;
    let served: TableDescriptor[] = [];
    let catalog: ReturnType<typeof createDbCatalogRoutes>;
    let insights: ReturnType<typeof createDbInsightsRoutes>;

    const json = (body: unknown, method = "POST") => ({
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    beforeAll(async () => {
        db = new PGlite();
        await db.waitReady;
        for (const statement of RLS_BOOTSTRAP_STATEMENTS) await db.exec(statement);
        admin = makePgliteSqlAdmin(db);
        await ensureBaasCatalogTables(admin);
        await db.exec(`
            CREATE ROLE rebase_user NOLOGIN;
            CREATE TYPE public.mood AS ENUM ('sad', 'happy');
            CREATE DOMAIN public.positive_int AS integer CHECK (VALUE > 0);
            CREATE FUNCTION public.add_one(n integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT n + 1 $$;
            CREATE FUNCTION public.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

            CREATE TABLE public.authors (id serial PRIMARY KEY, name text NOT NULL);
            ALTER TABLE public.authors ENABLE ROW LEVEL SECURITY;
            CREATE TABLE public.books (
                id serial PRIMARY KEY,
                author_id integer NOT NULL REFERENCES public.authors (id),
                title text NOT NULL,
                mood public.mood
            );
            ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
            CREATE INDEX books_title_a ON public.books (title);
            CREATE INDEX books_title_b ON public.books (title);
            CREATE TRIGGER books_touch BEFORE INSERT OR UPDATE ON public.books FOR EACH ROW EXECUTE FUNCTION public.touch();

            CREATE TABLE public.event_log (happened_at timestamptz NOT NULL DEFAULT now(), message text);
            GRANT SELECT, INSERT ON public.event_log TO rebase_user;

            CREATE TABLE public.articles (id serial PRIMARY KEY, body text NOT NULL);
            ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
            INSERT INTO public.articles (body) SELECT 'article ' || g FROM generate_series(1, 10050) g;
            ANALYZE public.articles;
        `);
        served = (await introspectTables(db, "public")).tables;
        catalog = createDbCatalogRoutes({ admin, reloadSchema: async () => { reloads++; } });
        insights = createDbInsightsRoutes({
            admin,
            getServedTables: () => served,
            // The checker's modules, from source. Its package entry also loads
            // the CLI, which reads `import.meta` — not something jest's
            // CommonJS transform can compile. The default loader is exercised
            // by the Docker e2e, which runs as ESM.
            loadRlsCheck: async () => {
                const [{ introspectWith }, { runChecks }, { remediationFor }] = await Promise.all([
                    import("../../rls-check/src/introspect"),
                    import("../../rls-check/src/checks"),
                    import("../../rls-check/src/remediation")
                ]);
                return { introspectWith, runChecks, remediationFor };
            }
        });
    });

    afterAll(async () => {
        await db.close();
    });

    it("lists functions, marks the framework's own as protected, and drops one by its exact signature", async () => {
        const listed = await (await catalog.request("/functions")).json() as {
            functions: { schema: string; name: string; args: string; kind: string; protected: boolean; definition: string }[];
        };
        const addOne = listed.functions.find(f => f.schema === "public" && f.name === "add_one");
        expect(addOne).toMatchObject({ args: "n integer", kind: "function", protected: false });
        expect(addOne?.definition).toContain("CREATE OR REPLACE FUNCTION public.add_one");
        expect(listed.functions.some(f => f.schema === "rebase" && f.protected)).toBe(true);

        const wrong = await catalog.request("/functions/public/add_one", json({ args: "text" }, "DELETE"));
        expect(wrong.status).toBe(404);

        const protectedDrop = await catalog.request("/functions/rebase/uid", json({ args: "" }, "DELETE"));
        expect(protectedDrop.status).toBe(400);

        const preview = await catalog.request("/functions/public/add_one", json({ args: "n integer", dryRun: true }, "DELETE"));
        expect(await preview.json()).toEqual({ dryRun: true, statements: ['DROP FUNCTION "public"."add_one"(n integer);'] });
        expect((await db.query("SELECT 1 FROM pg_proc WHERE proname = 'add_one'")).rows).toHaveLength(1);

        const dropped = await catalog.request("/functions/public/add_one", json({ args: "n integer" }, "DELETE"));
        expect(dropped.status).toBe(200);
        expect((await db.query("SELECT 1 FROM pg_proc WHERE proname = 'add_one'")).rows).toHaveLength(0);
    });

    it("lists triggers with their timing, events and level", async () => {
        const listed = await (await catalog.request("/triggers")).json() as {
            triggers: { schema: string; table: string; name: string; timing: string; events: string[]; level: string; function: string; enabled: boolean }[];
        };
        expect(listed.triggers.find(t => t.name === "books_touch")).toMatchObject({
            schema: "public",
            table: "books",
            timing: "BEFORE",
            events: ["INSERT", "UPDATE"],
            level: "ROW",
            function: "public.touch",
            enabled: true
        });
    });

    it("lists enums and domains, and adds an enum value after previewing it", async () => {
        const listed = await (await catalog.request("/types")).json() as {
            types: { schema: string; name: string; kind: string; values: string[]; baseType: string | null }[];
        };
        expect(listed.types.find(t => t.name === "mood")).toMatchObject({ schema: "public", kind: "enum", values: ["sad", "happy"] });
        expect(listed.types.find(t => t.name === "positive_int")).toMatchObject({ kind: "domain", baseType: "integer" });

        const preview = await catalog.request("/types/public/mood/values", json({ value: "content", after: "sad", dryRun: true }));
        expect(await preview.json()).toEqual({ dryRun: true, statements: [`ALTER TYPE "public"."mood" ADD VALUE 'content' AFTER 'sad';`] });
        expect(reloads).toBe(0);

        const badAnchor = await catalog.request("/types/public/mood/values", json({ value: "content", after: "angry" }));
        expect(badAnchor.status).toBe(400);

        const added = await catalog.request("/types/public/mood/values", json({ value: "content", after: "sad" }));
        expect(added.status).toBe(200);
        expect(reloads).toBe(1);
        const values = await db.query<{ label: string }>(
            "SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = 'public.mood'::regtype ORDER BY enumsortorder"
        );
        expect(values.rows.map(r => r.label)).toEqual(["sad", "content", "happy"]);

        const duplicate = await catalog.request("/types/public/mood/values", json({ value: "happy" }));
        expect(duplicate.status).toBe(409);

        const protectedSchema = await catalog.request("/types/rebase/mood/values", json({ value: "x" }));
        expect(protectedSchema.status).toBe(400);
    });

    it("previews CREATE EXTENSION, explains a library the server lacks, and keeps plpgsql", async () => {
        const listed = await (await catalog.request("/extensions")).json() as { extensions: { name: string; installed: boolean }[] };
        expect(listed.extensions.find(e => e.name === "plpgsql")).toMatchObject({ installed: true });

        const preview = await catalog.request("/extensions/pg_trgm", json({ dryRun: true }));
        expect(await preview.json()).toEqual({ dryRun: true, statements: ['CREATE EXTENSION IF NOT EXISTS "pg_trgm";'] });

        // This PGlite was created without the pg_trgm bundle: the server has no
        // library, which is the refusal the hint is for.
        const refused = await catalog.request("/extensions/pg_trgm", json({}));
        expect(refused.status).toBe(400);
        const body = await refused.json() as { error: { message: string } };
        expect(body.error.message).toContain("is a server extension");

        expect((await catalog.request("/extensions/plpgsql", json({}, "DELETE"))).status).toBe(400);
        expect((await catalog.request("/extensions/hstore", json({}, "DELETE"))).status).toBe(404);
        expect((await catalog.request("/extensions/bad%20name", json({ dryRun: true }))).status).toBe(400);
    });

    it("describes the in-process database: engine, size and no query statistics or other sessions", async () => {
        const overview = await (await insights.request("/overview")).json() as {
            engine: string; version: string; sizeBytes: number | null; connections: { max: number | null };
        };
        expect(overview.engine).toBe("pglite");
        expect(overview.version).toMatch(/PostgreSQL/);
        expect(typeof overview.sizeBytes).toBe("number");

        const queries = await (await insights.request("/queries")).json() as { status: string };
        expect(queries.status).toBe("unavailable");
        expect((await insights.request("/queries?sort=nope")).status).toBe(400);

        const activity = await (await insights.request("/activity")).json() as { sessions: unknown[] };
        expect(activity.sessions).toEqual([]);
        expect((await insights.request("/activity/999999/cancel", json({ dryRun: true }))).status).toBe(404);
        expect((await insights.request("/activity/abc/terminate", json({}))).status).toBe(400);
    });

    it("answers for a declared database with ?source= and refuses one it does not serve", async () => {
        const other = new PGlite();
        await other.waitReady;
        try {
            await other.exec("CREATE TYPE public.only_in_analytics AS ENUM ('a');");
            const multi = createDbCatalogRoutes({
                admin,
                sources: () => [{ key: "analytics", admin: makePgliteSqlAdmin(other) }],
                reloadSchema: async () => undefined
            });
            const typeNames = async (query: string) =>
                ((await (await multi.request(`/types${query}`)).json()) as { types: { name: string }[] }).types.map(t => t.name);
            expect(await typeNames("?source=analytics")).toContain("only_in_analytics");
            expect(await typeNames("")).not.toContain("only_in_analytics");
            expect(await typeNames("?source=(default)")).toContain("mood");
            expect((await multi.request("/types?source=nope")).status).toBe(404);

            const multiInsights = createDbInsightsRoutes({
                admin,
                sources: () => [{ key: "analytics", admin: makePgliteSqlAdmin(other) }],
                getServedTables: () => served
            });
            expect(await (await multiInsights.request("/sources")).json()).toEqual({
                sources: [{ key: "(default)", isDefault: true }, { key: "analytics", isDefault: false }]
            });
            const overview = await (await multiInsights.request("/overview?source=analytics")).json() as { source: string };
            expect(overview.source).toBe("analytics");
        } finally {
            await other.close();
        }
    });

    it("reports security findings from rls-check and the performance advisors", async () => {
        const res = await insights.request("/advisors");
        expect(res.status).toBe(200);
        const body = await res.json() as {
            findings: { id: string; check: string; category: string; severity: string; table?: string; remediationSql?: string }[];
            errors: unknown[];
        };
        expect(body.errors).toEqual([]);
        const byCheck = (check: string, table: string) => body.findings.find(f => f.check === check && f.table === table);

        // event_log is granted to the request role and has RLS off.
        const rlsOff = byCheck("rls-disabled", "public.event_log");
        expect(rlsOff).toMatchObject({ category: "security" });
        expect(rlsOff?.remediationSql).toContain("ENABLE ROW LEVEL SECURITY");

        expect(byCheck("no-primary-key", "public.event_log")).toMatchObject({ category: "performance", severity: "medium" });
        expect(byCheck("fk-without-index", "public.books")?.remediationSql).toBe('CREATE INDEX ON "public"."books" ("author_id");');
        expect(byCheck("duplicate-index", "public.books")?.remediationSql).toBe('DROP INDEX "public"."books_title_b";');
        expect(byCheck("unindexed-search", "public.articles")).toMatchObject({ category: "performance" });
        // A table the framework owns is not the project's to tune.
        expect(body.findings.some(f => f.table?.startsWith("rebase."))).toBe(false);
        // Ids are unique, so a list can key on them.
        expect(new Set(body.findings.map(f => f.id)).size).toBe(body.findings.length);
    });
});
