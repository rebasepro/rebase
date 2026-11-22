import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { SQLAdmin } from "@rebasepro/types";
import { ApiError, errorHandler } from "../api/errors";
import type { HonoEnv } from "../api/types";
import type { WebhookConfig, WebhookDispatcher } from "../services/webhook-service";
import { notifySchemaChanged } from "./catalog-ddl";

const EVENT_ALIASES: Record<string, string> = {
    create: "INSERT",
    insert: "INSERT",
    INSERT: "INSERT",
    update: "UPDATE",
    UPDATE: "UPDATE",
    delete: "DELETE",
    DELETE: "DELETE",
    "*": "*"
};

export interface StoredWebhook extends WebhookConfig {
    name: string;
    createdAt: string;
    updatedAt: string;
}

export interface WebhookInput {
    name: string;
    table: string;
    events: string[];
    url: string;
    secret?: string;
    headers?: Record<string, string>;
    enabled?: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function parseHeaders(raw: unknown): Record<string, string> {
    if (!isRecord(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string") out[k] = v;
    }
    return out;
}

function rowToWebhook(row: Record<string, unknown>): StoredWebhook | null {
    if (
        typeof row.id !== "string" ||
        typeof row.name !== "string" ||
        typeof row.table_slug !== "string" ||
        typeof row.url !== "string"
    ) {
        return null;
    }
    const events = Array.isArray(row.events)
        ? row.events
            .map((e) => (typeof e === "string" ? EVENT_ALIASES[e] : undefined))
            .filter((e): e is string => Boolean(e))
        : [];
    return {
        id: row.id,
        name: row.name,
        table: row.table_slug,
        events,
        url: row.url,
        ...(typeof row.secret === "string" && row.secret.length > 0 ? { secret: row.secret } : {}),
        headers: parseHeaders(row.headers),
        enabled: row.enabled !== false,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? "")
    };
}

function validateWebhookInput(input: WebhookInput): {
    name: string;
    table: string;
    events: string[];
    url: string;
    secret: string | null;
    headers: Record<string, string>;
    enabled: boolean;
} {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) throw ApiError.badRequest("`name` is required.", "INVALID_INPUT");

    const table = typeof input.table === "string" ? input.table.trim() : "";
    if (!table || !/^(?:\*|[A-Za-z_][A-Za-z0-9_$-]*)$/.test(table)) {
        throw ApiError.badRequest("`table` must be a valid table slug or \"*\".", "INVALID_INPUT");
    }

    if (!Array.isArray(input.events) || input.events.length === 0) {
        throw ApiError.badRequest("`events` must be a non-empty list of: INSERT, UPDATE, DELETE, or *.", "INVALID_INPUT");
    }
    const events: string[] = [];
    for (const ev of input.events) {
        const normalized = typeof ev === "string" ? EVENT_ALIASES[ev] : undefined;
        if (!normalized) {
            throw ApiError.badRequest(`Invalid webhook event "${String(ev)}". Use INSERT, UPDATE, DELETE, or *.`, "INVALID_INPUT");
        }
        if (!events.includes(normalized)) events.push(normalized);
    }

    const url = typeof input.url === "string" ? input.url.trim() : "";
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        throw ApiError.badRequest("`url` must be a valid http:// or https:// URL.", "INVALID_INPUT");
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw ApiError.badRequest("`url` must use http:// or https://.", "INVALID_INPUT");
    }

    return {
        name,
        table,
        events,
        url,
        secret: typeof input.secret === "string" && input.secret.trim() !== "" ? input.secret.trim() : null,
        headers: parseHeaders(input.headers),
        enabled: input.enabled !== false
    };
}

/** Redact webhook secret in API responses while indicating whether one is set. */
function redactWebhook(wh: StoredWebhook): Omit<StoredWebhook, "secret"> & { hasSecret: boolean } {
    const { secret, ...rest } = wh;
    return { ...rest, hasSecret: Boolean(secret) };
}

export interface WebhooksStore {
    list(): Promise<StoredWebhook[]>;
    create(input: WebhookInput): Promise<StoredWebhook>;
    update(id: string, patch: Partial<WebhookInput>): Promise<StoredWebhook>;
    remove(id: string): Promise<boolean>;
    reload(): Promise<void>;
}

/**
 * Persistent zero-code webhook store over `rebase.webhooks`, automatically
 * synchronized into {@link WebhookDispatcher}.
 */
export function createWebhooksStore(
    admin: SQLAdmin,
    dispatcher: WebhookDispatcher
): WebhooksStore {
    const list = async (): Promise<StoredWebhook[]> => {
        try {
            const rows = await admin.executeSql(
                `SELECT id, name, table_slug, events, url, secret, headers, enabled, created_at, updated_at
                   FROM "rebase"."webhooks"
                  ORDER BY created_at ASC`
            );
            const items: StoredWebhook[] = [];
            for (const row of rows) {
                const parsed = rowToWebhook(row);
                if (parsed) items.push(parsed);
            }
            return items;
        } catch (err) {
            const code = isRecord(err) ? err.code : undefined;
            if (code === "42P01" || code === "3F000") return [];
            throw err;
        }
    };

    const reload = async (): Promise<void> => {
        const items = await list();
        dispatcher.setWebhooks(items);
    };

    const create = async (input: WebhookInput): Promise<StoredWebhook> => {
        const valid = validateWebhookInput(input);
        const id = randomUUID();
        const rows = await admin.executeSql(
            `INSERT INTO "rebase"."webhooks"
                (id, name, table_slug, events, url, secret, headers, enabled)
             VALUES ($1, $2, $3, $4::text[], $5, $6, $7::jsonb, $8)
             RETURNING id, name, table_slug, events, url, secret, headers, enabled, created_at, updated_at`,
            { params: [id, valid.name, valid.table, valid.events, valid.url, valid.secret, JSON.stringify(valid.headers), valid.enabled] }
        );
        const created = rows[0] ? rowToWebhook(rows[0]) : null;
        if (!created) throw new ApiError(500, "INTERNAL_ERROR", "Failed to create webhook.");
        await reload();
        await notifySchemaChanged(admin, "webhook_created");
        return created;
    };

    const update = async (id: string, patch: Partial<WebhookInput>): Promise<StoredWebhook> => {
        const existing = (await list()).find(w => w.id === id);
        if (!existing) throw ApiError.notFound(`Webhook "${id}" not found.`);
        const valid = validateWebhookInput({
            name: patch.name ?? existing.name,
            table: patch.table ?? existing.table,
            events: patch.events ?? existing.events,
            url: patch.url ?? existing.url,
            secret: patch.secret !== undefined ? patch.secret : existing.secret,
            headers: patch.headers ?? existing.headers,
            enabled: patch.enabled ?? existing.enabled
        });
        const rows = await admin.executeSql(
            `UPDATE "rebase"."webhooks"
                SET name = $2,
                    table_slug = $3,
                    events = $4::text[],
                    url = $5,
                    secret = $6,
                    headers = $7::jsonb,
                    enabled = $8,
                    updated_at = NOW()
              WHERE id = $1
             RETURNING id, name, table_slug, events, url, secret, headers, enabled, created_at, updated_at`,
            { params: [id, valid.name, valid.table, valid.events, valid.url, valid.secret, JSON.stringify(valid.headers), valid.enabled] }
        );
        const updated = rows[0] ? rowToWebhook(rows[0]) : null;
        if (!updated) throw ApiError.notFound(`Webhook "${id}" not found.`);
        await reload();
        await notifySchemaChanged(admin, "webhook_updated");
        return updated;
    };

    const remove = async (id: string): Promise<boolean> => {
        const rows = await admin.executeSql(
            `DELETE FROM "rebase"."webhooks" WHERE id = $1 RETURNING id`,
            { params: [id] }
        );
        const deleted = rows.length > 0;
        if (deleted) {
            await reload();
            await notifySchemaChanged(admin, "webhook_deleted");
        }
        return deleted;
    };

    return { list, create, update, remove, reload };
}

/**
 * Admin HTTP routes for database webhooks (`/api/admin/webhooks`).
 */
export function createWebhookAdminRoutes(
    store: WebhooksStore,
    dispatcher: WebhookDispatcher
): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);

    router.get("/", async (c) => {
        const webhooks = await store.list();
        return c.json({ webhooks: webhooks.map(redactWebhook) });
    });

    router.post("/", async (c) => {
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) {
            throw ApiError.badRequest("Expected a JSON webhook definition.", "INVALID_INPUT");
        }
        const created = await store.create({
            name: typeof body.name === "string" ? body.name : "",
            table: typeof body.table === "string" ? body.table : "",
            events: Array.isArray(body.events) ? body.events.filter((e): e is string => typeof e === "string") : [],
            url: typeof body.url === "string" ? body.url : "",
            secret: typeof body.secret === "string" ? body.secret : undefined,
            headers: parseHeaders(body.headers),
            enabled: typeof body.enabled === "boolean" ? body.enabled : undefined
        });
        return c.json({ webhook: redactWebhook(created) }, 201);
    });

    router.patch("/:id", async (c) => {
        const id = c.req.param("id");
        const body: unknown = await c.req.json().catch(() => undefined);
        if (!isRecord(body)) {
            throw ApiError.badRequest("Expected a JSON patch object.", "INVALID_INPUT");
        }
        const updated = await store.update(id, {
            ...(typeof body.name === "string" ? { name: body.name } : {}),
            ...(typeof body.table === "string" ? { table: body.table } : {}),
            ...(Array.isArray(body.events) ? { events: body.events.filter((e): e is string => typeof e === "string") } : {}),
            ...(typeof body.url === "string" ? { url: body.url } : {}),
            ...(typeof body.secret === "string" ? { secret: body.secret } : {}),
            ...(isRecord(body.headers) ? { headers: parseHeaders(body.headers) } : {}),
            ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {})
        });
        return c.json({ webhook: redactWebhook(updated) });
    });

    router.delete("/:id", async (c) => {
        const id = c.req.param("id");
        const deleted = await store.remove(id);
        if (!deleted) throw ApiError.notFound(`Webhook "${id}" not found.`);
        return c.json({ deleted: true, id });
    });

    router.post("/:id/test", async (c) => {
        const id = c.req.param("id");
        const webhook = (await store.list()).find(w => w.id === id);
        if (!webhook) throw ApiError.notFound(`Webhook "${id}" not found.`);
        const result = await dispatcher.sendTest(webhook, {
            test: true,
            webhookId: webhook.id,
            table: webhook.table,
            timestamp: new Date().toISOString()
        });
        return c.json({ delivery: result });
    });

    return router;
}
