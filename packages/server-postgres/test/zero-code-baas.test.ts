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
import type { SQLAdmin, TableDescriptor } from "@rebasepro/types";
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
    createStoragePoliciesStore,
    createWebhooksStore,
    createRolesStore,
    createCronJobsStore
} from "../../server/src/baas";
import { createPostgresAdapter } from "../src/PostgresAdapter";
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
});
