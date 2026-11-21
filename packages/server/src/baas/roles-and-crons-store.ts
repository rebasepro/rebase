import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
    ADMIN_ROLE,
    isAdminScope,
    parseScope,
    summarizeRoles,
    type AccessModel,
    type SQLAdmin
} from "@rebasepro/types";
import { ApiError, errorHandler } from "../api/errors";
import type { HonoEnv } from "../api/types";
import { hasScope, scopeMissing } from "../auth/access";
import type { CronScheduler } from "../cron/cron-scheduler";
import { validateCronExpression } from "../cron/cron-scheduler";
import { createOutboundPost } from "../services/outbound-post";
import { notifySchemaChanged } from "./catalog-ddl";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

// ─── Zero-code Roles (`rebase.roles`) ───────────────────────────────────────

export interface StoredRole {
    name: string;
    description: string | null;
    scopes: string[];
    isDefault: boolean;
    assignable: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface RoleInput {
    name: string;
    description?: string | null;
    scopes?: string[];
    isDefault?: boolean;
    assignable?: boolean;
}

const ROLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/;

function rowToRole(row: Record<string, unknown>): StoredRole | null {
    if (typeof row.name !== "string") return null;
    return {
        name: row.name,
        description: typeof row.description === "string" ? row.description : null,
        scopes: Array.isArray(row.scopes) ? row.scopes.filter((s): s is string => typeof s === "string") : [],
        isDefault: row.is_default === true,
        assignable: row.assignable !== false,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? "")
    };
}

export interface RolesStore {
    list(): Promise<StoredRole[]>;
    upsert(input: RoleInput): Promise<StoredRole>;
    remove(name: string): Promise<boolean>;
}

export function createRolesStore(admin: SQLAdmin): RolesStore {
    const list = async (): Promise<StoredRole[]> => {
        try {
            const rows = await admin.executeSql(
                `SELECT name, description, scopes, is_default, assignable, created_at, updated_at
                   FROM "rebase"."roles"
                  ORDER BY name ASC`
            );
            const roles: StoredRole[] = [];
            for (const row of rows) {
                const parsed = rowToRole(row);
                if (parsed) roles.push(parsed);
            }
            return roles;
        } catch (err) {
            const code = isRecord(err) ? err.code : undefined;
            if (code === "42P01" || code === "3F000") return [];
            throw err;
        }
    };

    const upsert = async (input: RoleInput): Promise<StoredRole> => {
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!ROLE_NAME_RE.test(name)) {
            throw ApiError.badRequest(`Role name "${name}" must match ${ROLE_NAME_RE.source}.`, "INVALID_INPUT");
        }
        const scopes = Array.isArray(input.scopes)
            ? [...new Set(input.scopes.filter((s): s is string => typeof s === "string" && s.trim() !== "").map(s => s.trim()))]
            : [];
        const description = typeof input.description === "string" ? input.description : null;
        const isDefault = input.isDefault === true;
        const assignable = input.assignable !== false;

        if (isDefault) {
            const adminScopes = name === ADMIN_ROLE
                ? ["every scope"]
                : scopes.filter(scope => isAdminScope(parseScope(scope)?.scope ?? ""));
            if (adminScopes.length > 0) {
                throw ApiError.badRequest(
                    `Role "${name}" cannot be the default signup role because it grants admin-plane scopes (${adminScopes.join(", ")}).`,
                    "INVALID_INPUT"
                );
            }
            await admin.executeSql(`UPDATE "rebase"."roles" SET is_default = false WHERE is_default = true AND name <> $1`, { params: [name] });
        }

        const rows = await admin.executeSql(
            `INSERT INTO "rebase"."roles" (name, description, scopes, is_default, assignable)
             VALUES ($1, $2, $3::text[], $4, $5)
             ON CONFLICT (name) DO UPDATE SET
                 description = EXCLUDED.description,
                 scopes = EXCLUDED.scopes,
                 is_default = EXCLUDED.is_default,
                 assignable = EXCLUDED.assignable,
                 updated_at = NOW()
             RETURNING name, description, scopes, is_default, assignable, created_at, updated_at`,
            { params: [name, description, scopes, isDefault, assignable] }
        );
        const role = rows[0] ? rowToRole(rows[0]) : null;
        if (!role) throw new ApiError(500, "INTERNAL_ERROR", "Failed to save role.");
        await notifySchemaChanged(admin, "role_updated");
        return role;
    };

    const remove = async (name: string): Promise<boolean> => {
        if (name === "admin") {
            throw ApiError.badRequest("The built-in \"admin\" role cannot be deleted.", "INVALID_INPUT");
        }
        const rows = await admin.executeSql(`DELETE FROM "rebase"."roles" WHERE name = $1 RETURNING name`, { params: [name] });
        const deleted = rows.length > 0;
        if (deleted) await notifySchemaChanged(admin, "role_deleted");
        return deleted;
    };

    return { list, upsert, remove };
}

export function createRolesAdminRoutes(
    store: RolesStore,
    options?: {
        onChanged?: () => Promise<void> | void;
        getAccessModel?: () => AccessModel;
        codeDefaultRole?: string;
    }
): Hono<HonoEnv> {
    const rolesRouter = new Hono<HonoEnv>();
    rolesRouter.onError(errorHandler);

    rolesRouter.get("/", async (c) => {
        const stored = await store.list();
        const storedByName = new Map(stored.map(r => [r.name, r]));
        const model = options?.getAccessModel?.();
        if (!model) {
            return c.json({
                roles: stored.map(r => ({
                    id: r.name,
                    ...r,
                    source: "database" as const
                }))
            });
        }
        const summaries = summarizeRoles(model);
        const roles = summaries.map(summary => {
            const dbRole = storedByName.get(summary.id);
            const source = summary.id === ADMIN_ROLE
                ? ("built-in" as const)
                : dbRole
                    ? ("database" as const)
                    : ("code" as const);
            return {
                ...summary,
                name: summary.id,
                label: summary.name,
                description: dbRole?.description ?? summary.description ?? null,
                scopes: dbRole ? dbRole.scopes : summary.scopes,
                isDefault: dbRole ? dbRole.isDefault : (options?.codeDefaultRole === summary.id),
                assignable: dbRole ? dbRole.assignable : true,
                source,
                ...(dbRole ? { createdAt: dbRole.createdAt, updatedAt: dbRole.updatedAt } : {})
            };
        });
        return c.json({ roles });
    });

    rolesRouter.post("/", async (c) => {
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON role object.", "INVALID_INPUT");
        const role = await store.upsert({
            name: typeof body.name === "string" ? body.name : "",
            description: typeof body.description === "string" ? body.description : null,
            scopes: Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === "string") : [],
            isDefault: body.isDefault === true,
            assignable: body.assignable !== false
        });
        await options?.onChanged?.();
        return c.json({ role }, 201);
    });

    rolesRouter.put("/:name", async (c) => {
        const name = c.req.param("name");
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON role object.", "INVALID_INPUT");
        const role = await store.upsert({
            name,
            description: typeof body.description === "string" ? body.description : null,
            scopes: Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === "string") : [],
            isDefault: body.isDefault === true,
            assignable: body.assignable !== false
        });
        await options?.onChanged?.();
        return c.json({ role });
    });

    rolesRouter.delete("/:name", async (c) => {
        const name = c.req.param("name");
        const deleted = await store.remove(name);
        if (!deleted) throw ApiError.notFound(`Role "${name}" not found.`);
        await options?.onChanged?.();
        return c.json({ deleted: true, name });
    });

    return rolesRouter;
}

// ─── Zero-code Scheduled Cron Jobs (`rebase.cron_jobs`) ─────────────────────

export type CronJobConfig =
    | { kind: "http"; url: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
    | { kind: "sql"; sql: string };

export interface StoredCronJob {
    id: string;
    name: string;
    schedule: string;
    timezone: string;
    kind: "http" | "sql";
    config: CronJobConfig;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface StoredCronJobInput {
    name: string;
    schedule: string;
    timezone?: string;
    kind: "http" | "sql";
    config: Record<string, unknown>;
    enabled?: boolean;
}

const CRON_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const DB_CRON_ID_PREFIX = "db:";

function parseCronConfig(kind: "http" | "sql", raw: unknown): CronJobConfig {
    if (!isRecord(raw)) {
        throw ApiError.badRequest("`config` must be a JSON object.", "INVALID_INPUT");
    }
    if (kind === "sql") {
        const query = typeof raw.sql === "string" ? raw.sql.trim() : "";
        if (!query) throw ApiError.badRequest("SQL cron job requires a non-empty `config.sql`.", "INVALID_INPUT");
        return { kind: "sql", sql: query };
    }
    const url = typeof raw.url === "string" ? raw.url.trim() : "";
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw ApiError.badRequest("HTTP cron job requires a valid http:// or https:// `config.url`.", "INVALID_INPUT");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw ApiError.badRequest("HTTP cron job `config.url` must use http:// or https://.", "INVALID_INPUT");
    }
    const headers: Record<string, string> = {};
    if (isRecord(raw.headers)) {
        for (const [k, v] of Object.entries(raw.headers)) {
            if (typeof v === "string") headers[k] = v;
        }
    }
    const timeoutMs = typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0
        ? Math.min(Math.trunc(raw.timeoutMs), 60_000)
        : undefined;
    return {
        kind: "http",
        url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(typeof raw.body === "string" ? { body: raw.body } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {})
    };
}

function rowToCronJob(row: Record<string, unknown>): StoredCronJob | null {
    if (
        typeof row.id !== "string" ||
        typeof row.name !== "string" ||
        typeof row.schedule !== "string" ||
        (row.kind !== "http" && row.kind !== "sql")
    ) {
        return null;
    }
    let config: CronJobConfig;
    try {
        config = parseCronConfig(row.kind, row.config);
    } catch {
        return null;
    }
    return {
        id: row.id,
        name: row.name,
        schedule: row.schedule,
        timezone: typeof row.timezone === "string" && row.timezone.trim() !== "" ? row.timezone.trim() : "UTC",
        kind: row.kind,
        config,
        enabled: row.enabled !== false,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? "")
    };
}

export interface CronJobsStore {
    list(): Promise<StoredCronJob[]>;
    create(input: StoredCronJobInput): Promise<StoredCronJob>;
    update(id: string, patch: Partial<StoredCronJobInput>): Promise<StoredCronJob>;
    remove(id: string): Promise<boolean>;
    syncToScheduler(scheduler: CronScheduler): Promise<void>;
}

export function createCronJobsStore(admin: SQLAdmin): CronJobsStore {
    const outboundPost = createOutboundPost();
    const syncedIds = new Set<string>();
    let boundScheduler: CronScheduler | undefined;

    const list = async (): Promise<StoredCronJob[]> => {
        try {
            const rows = await admin.executeSql(
                `SELECT id, name, schedule, timezone, kind, config, enabled, created_at, updated_at
                   FROM "rebase"."cron_jobs"
                  ORDER BY name ASC`
            );
            const jobs: StoredCronJob[] = [];
            for (const row of rows) {
                const parsed = rowToCronJob(row);
                if (parsed) jobs.push(parsed);
            }
            return jobs;
        } catch (err) {
            const code = isRecord(err) ? err.code : undefined;
            if (code === "42P01" || code === "3F000") return [];
            throw err;
        }
    };

    const syncToScheduler = async (scheduler: CronScheduler): Promise<void> => {
        boundScheduler = scheduler;
        const jobs = await list();
        const nextIds = new Set<string>();
        const loaded = jobs.map((job) => {
            const schedulerId = `${DB_CRON_ID_PREFIX}${job.name}`;
            nextIds.add(schedulerId);
            return {
                id: schedulerId,
                definition: {
                    name: job.name,
                    schedule: job.schedule,
                    timezone: job.timezone,
                    enabled: job.enabled,
                    description: job.kind === "sql" ? "Scheduled SQL job" : `Scheduled HTTP POST → ${job.config.kind === "http" ? job.config.url : ""}`,
                    handler: async () => {
                        if (job.config.kind === "sql") {
                            await admin.executeSql(job.config.sql);
                            return;
                        }
                        const controller = new AbortController();
                        const timeout = setTimeout(() => controller.abort(), job.config.timeoutMs ?? 15_000);
                        try {
                            const response = await outboundPost(job.config.url, {
                                headers: {
                                    "Content-Type": "application/json",
                                    ...(job.config.headers ?? {})
                                },
                                body: job.config.body ?? JSON.stringify({ job: job.name, timestamp: new Date().toISOString() }),
                                signal: controller.signal
                            });
                            if (response.status >= 400) {
                                throw new Error(`HTTP cron "${job.name}" failed with status ${response.status}`);
                            }
                        } finally {
                            clearTimeout(timeout);
                        }
                    }
                }
            };
        });

        for (const oldId of syncedIds) {
            if (!nextIds.has(oldId)) {
                scheduler.unregisterJob(oldId);
            }
        }
        syncedIds.clear();
        for (const id of nextIds) syncedIds.add(id);

        if (loaded.length > 0) {
            scheduler.registerJobs(loaded);
        }
    };

    const validateInput = (input: StoredCronJobInput) => {
        const name = typeof input.name === "string" ? input.name.trim() : "";
        if (!CRON_NAME_RE.test(name)) {
            throw ApiError.badRequest(`Cron job name "${name}" must match ${CRON_NAME_RE.source}.`, "INVALID_INPUT");
        }
        const schedule = typeof input.schedule === "string" ? input.schedule.trim() : "";
        const scheduleCheck = validateCronExpression(schedule);
        if (!scheduleCheck.valid) {
            throw ApiError.badRequest(`Invalid cron schedule "${schedule}": ${scheduleCheck.reason}`, "INVALID_INPUT");
        }
        if (input.kind !== "http" && input.kind !== "sql") {
            throw ApiError.badRequest("`kind` must be \"http\" or \"sql\".", "INVALID_INPUT");
        }
        const config = parseCronConfig(input.kind, input.config);
        const timezone = typeof input.timezone === "string" && input.timezone.trim() !== "" ? input.timezone.trim() : "UTC";
        const enabled = input.enabled !== false;
        return { name, schedule, timezone, kind: input.kind, config, enabled };
    };

    const create = async (input: StoredCronJobInput): Promise<StoredCronJob> => {
        const valid = validateInput(input);
        const id = randomUUID();
        const rows = await admin.executeSql(
            `INSERT INTO "rebase"."cron_jobs" (id, name, schedule, timezone, kind, config, enabled)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
             RETURNING id, name, schedule, timezone, kind, config, enabled, created_at, updated_at`,
            { params: [id, valid.name, valid.schedule, valid.timezone, valid.kind, JSON.stringify(valid.config), valid.enabled] }
        );
        const created = rows[0] ? rowToCronJob(rows[0]) : null;
        if (!created) throw new ApiError(500, "INTERNAL_ERROR", "Failed to create cron job.");
        if (boundScheduler) await syncToScheduler(boundScheduler);
        await notifySchemaChanged(admin, "cron_job_created");
        return created;
    };

    const update = async (id: string, patch: Partial<StoredCronJobInput>): Promise<StoredCronJob> => {
        const existing = (await list()).find(j => j.id === id);
        if (!existing) throw ApiError.notFound(`Cron job "${id}" not found.`);
        const valid = validateInput({
            name: patch.name ?? existing.name,
            schedule: patch.schedule ?? existing.schedule,
            timezone: patch.timezone ?? existing.timezone,
            kind: patch.kind ?? existing.kind,
            config: patch.config ?? existing.config,
            enabled: patch.enabled ?? existing.enabled
        });
        const rows = await admin.executeSql(
            `UPDATE "rebase"."cron_jobs"
                SET name = $2,
                    schedule = $3,
                    timezone = $4,
                    kind = $5,
                    config = $6::jsonb,
                    enabled = $7,
                    updated_at = NOW()
              WHERE id = $1
             RETURNING id, name, schedule, timezone, kind, config, enabled, created_at, updated_at`,
            { params: [id, valid.name, valid.schedule, valid.timezone, valid.kind, JSON.stringify(valid.config), valid.enabled] }
        );
        const updated = rows[0] ? rowToCronJob(rows[0]) : null;
        if (!updated) throw ApiError.notFound(`Cron job "${id}" not found.`);
        if (boundScheduler) await syncToScheduler(boundScheduler);
        await notifySchemaChanged(admin, "cron_job_updated");
        return updated;
    };

    const remove = async (id: string): Promise<boolean> => {
        const rows = await admin.executeSql(`DELETE FROM "rebase"."cron_jobs" WHERE id = $1 RETURNING id`, { params: [id] });
        const deleted = rows.length > 0;
        if (deleted) {
            if (boundScheduler) await syncToScheduler(boundScheduler);
            await notifySchemaChanged(admin, "cron_job_deleted");
        }
        return deleted;
    };

    return { list, create, update, remove, syncToScheduler };
}

/**
 * A SQL job runs its statement as the server's own database connection, past
 * every policy — the SQL console's power, on a schedule. So writing one takes
 * the SQL console's scope, `database:write`, not just `cron:write`: a key
 * minted to pause and trigger jobs must not be able to schedule a `DROP`.
 */
const SQL_JOB_SCOPE = "database:write";

function requireSqlJobScope(c: Context<HonoEnv>): void {
    if (!hasScope(c, SQL_JOB_SCOPE)) throw scopeMissing(c, SQL_JOB_SCOPE);
}

export function createCronJobsAdminRoutes(store: CronJobsStore): Hono<HonoEnv> {
    const cronJobsRouter = new Hono<HonoEnv>();
    cronJobsRouter.onError(errorHandler);

    cronJobsRouter.get("/", async (c) => {
        const jobs = await store.list();
        return c.json({ jobs });
    });

    cronJobsRouter.post("/", async (c) => {
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON cron job definition.", "INVALID_INPUT");
        if (body.kind !== "sql" && body.kind !== "http") {
            throw ApiError.badRequest(`Cron job kind must be "http" or "sql".`, "INVALID_INPUT");
        }
        if (body.kind === "sql") requireSqlJobScope(c);
        const job = await store.create({
            name: typeof body.name === "string" ? body.name : "",
            schedule: typeof body.schedule === "string" ? body.schedule : "",
            timezone: typeof body.timezone === "string" ? body.timezone : undefined,
            kind: body.kind,
            config: isRecord(body.config) ? body.config : {},
            enabled: typeof body.enabled === "boolean" ? body.enabled : undefined
        });
        return c.json({ job }, 201);
    });

    cronJobsRouter.patch("/:id", async (c) => {
        const id = c.req.param("id");
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) throw ApiError.badRequest("Expected a JSON patch object.", "INVALID_INPUT");
        // Any change to a SQL job — or turning a job into one — is a change to
        // what SQL runs, and when.
        const existing = (await store.list()).find(job => job.id === id);
        if (body.kind === "sql" || existing?.kind === "sql") requireSqlJobScope(c);
        const job = await store.update(id, {
            ...(typeof body.name === "string" ? { name: body.name } : {}),
            ...(typeof body.schedule === "string" ? { schedule: body.schedule } : {}),
            ...(typeof body.timezone === "string" ? { timezone: body.timezone } : {}),
            ...(body.kind === "sql" || body.kind === "http" ? { kind: body.kind } : {}),
            ...(isRecord(body.config) ? { config: body.config } : {}),
            ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {})
        });
        return c.json({ job });
    });

    cronJobsRouter.delete("/:id", async (c) => {
        const id = c.req.param("id");
        const deleted = await store.remove(id);
        if (!deleted) throw ApiError.notFound(`Cron job "${id}" not found.`);
        return c.json({ deleted: true, id });
    });

    return cronJobsRouter;
}
