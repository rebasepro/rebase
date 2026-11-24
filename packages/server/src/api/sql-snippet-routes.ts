import { Hono, type Context } from "hono";
import type { DataDriver } from "@rebasepro/types";
import { ApiError } from "./errors";
import type { HonoEnv } from "./types";
import {
    SQL_SNIPPET_VISIBILITIES,
    SqlSnippetError,
    sqlSnippetStore,
    type CreateSqlSnippetInput,
    type SqlSnippetStore,
    type SqlSnippetViewer,
    type SqlSnippetVisibility,
    type UpdateSqlSnippetInput
} from "./sql-snippet-store";

/**
 * The SQL console's saved snippets: `GET /` lists the ones the caller sees,
 * `POST /` saves one, `PATCH /:id` changes one, `DELETE /:id` deletes one.
 *
 * Mounted at `/api/admin/sql/snippets` behind the admin gate: `database:read`
 * to list, `database:write` to save, change or delete — the scope the
 * console's runs ask for. A snippet belongs to a person, so a credential that
 * names nobody (the service key) is refused.
 */
export interface SqlSnippetRoutesOptions {
    /** The default data source, read per request. */
    getDriver: () => DataDriver | undefined;
}

export function createSqlSnippetRoutes(options: SqlSnippetRoutesOptions): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    const storeFor = (): SqlSnippetStore => {
        const driver = options.getDriver();
        const store = driver ? sqlSnippetStore(driver) : undefined;
        if (!store) {
            throw new ApiError(501, "SQL_SNIPPETS_UNSUPPORTED", "This data source has no SQL to keep snippets in.");
        }
        return store;
    };

    router.get("/", async (c) => {
        const viewer = viewerOf(c);
        return c.json({ snippets: await answer(() => storeFor().list(viewer)) });
    });

    router.post("/", async (c) => {
        const viewer = viewerOf(c);
        const input = readCreate(await c.req.json().catch(() => null));
        return c.json({ snippet: await answer(() => storeFor().create(input, viewer)) }, 201);
    });

    router.patch("/:id", async (c) => {
        const viewer = viewerOf(c);
        const input = readUpdate(await c.req.json().catch(() => null));
        return c.json({ snippet: await answer(() => storeFor().update(c.req.param("id"), input, viewer)) });
    });

    router.delete("/:id", async (c) => {
        const viewer = viewerOf(c);
        const removed = await answer(() => storeFor().remove(c.req.param("id"), viewer));
        if (!removed) throw ApiError.notFound(`No saved snippet with id "${c.req.param("id")}" that you may delete.`);
        return c.json({ deleted: true });
    });

    return router;
}

/** The store's refusals as the HTTP answers they are. */
async function answer<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error: unknown) {
        if (error instanceof SqlSnippetError) {
            throw error.status === 404 ? ApiError.notFound(error.message) : ApiError.badRequest(error.message, "INVALID_INPUT");
        }
        throw error;
    }
}

function viewerOf(c: Context<HonoEnv>): SqlSnippetViewer {
    const caller = c.get("user");
    const uid = typeof caller === "object" && caller !== null && typeof caller.uid === "string" ? caller.uid : "";
    if (!uid) {
        throw ApiError.forbidden("Saved snippets belong to a person, and this credential names nobody.", "SQL_SNIPPETS_NEED_A_USER");
    }
    const roles = typeof caller === "object" && caller !== null && Array.isArray(caller.roles)
        ? caller.roles.filter((role): role is string => typeof role === "string")
        : [];
    return { uid, roles };
}

function asObject(body: unknown): Record<string, unknown> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw ApiError.badRequest("Send the snippet as a JSON object.", "INVALID_INPUT");
    }
    return Object.fromEntries(Object.entries(body));
}

function optionalString(body: Record<string, unknown>, key: "name" | "sql"): string | undefined {
    const value = body[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw ApiError.badRequest(`\`${key}\` must be a string.`, "INVALID_INPUT");
    return value;
}

function optionalVisibility(body: Record<string, unknown>): SqlSnippetVisibility | undefined {
    const value = body.visibility;
    if (value === undefined) return undefined;
    const visibility = SQL_SNIPPET_VISIBILITIES.find(candidate => candidate === value);
    if (!visibility) throw ApiError.badRequest("`visibility` is `personal` or `team`.", "INVALID_INPUT");
    return visibility;
}

function optionalFavorite(body: Record<string, unknown>): boolean | undefined {
    const value = body.favorite;
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw ApiError.badRequest("`favorite` must be a boolean.", "INVALID_INPUT");
    return value;
}

function readCreate(raw: unknown): CreateSqlSnippetInput {
    const body = asObject(raw);
    const name = optionalString(body, "name");
    const sql = optionalString(body, "sql");
    if (name === undefined || sql === undefined) {
        throw ApiError.badRequest("A snippet is sent with its `name` and its `sql`.", "INVALID_INPUT");
    }
    return { name, sql, visibility: optionalVisibility(body), favorite: optionalFavorite(body) };
}

function readUpdate(raw: unknown): UpdateSqlSnippetInput {
    const body = asObject(raw);
    return {
        name: optionalString(body, "name"),
        sql: optionalString(body, "sql"),
        visibility: optionalVisibility(body),
        favorite: optionalFavorite(body)
    };
}
