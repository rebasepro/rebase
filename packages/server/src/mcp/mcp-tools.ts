/**
 * The tools an authorized MCP client may call, and the identity they run as.
 *
 * The whole design is one sentence: **every database call in this file goes
 * through `scopeDataDriver(driver, { uid, roles })` first**, so the connection
 * runs as `rebase_user` with `app.uid` set to the person who consented, and the
 * rows that come back are the rows that person's policies allow. The tools do
 * not filter. The database does. That is the difference between this and every
 * admin-key integration: there is no path here that can read a row its caller
 * could not read through the application itself.
 *
 * Two consequences worth stating, because they look like bugs otherwise:
 *
 *  - A tool call can return an empty list for a collection that plainly has
 *    rows. That is RLS working.
 *  - A write can fail with a permission error the tool cannot explain in
 *    detail, because the policy that refused it is not visible from here.
 *
 * `mcp:write` gates whether the mutating tools are *offered* at all. It is a
 * second lock, not the main one — a `mcp:write` token still cannot write a row
 * the user could not write themselves.
 */
import type { CollectionConfig, DataDriver, FilterValues } from "@rebasepro/types";
import { getCollectionDataPath } from "@rebasepro/types";
import { scopeDataDriver } from "../auth/rls-scope.js";
import { logger } from "../utils/logger.js";
import { scopeAllows } from "./oauth-metadata.js";

/** The identity a tool call runs as. Comes from the verified access token. */
export interface McpCaller {
    uid: string;
    roles: string[];
    scope: string;
    clientId: string;
}

export interface McpToolContext {
    driver: DataDriver;
    collections: CollectionConfig[];
    caller: McpCaller;
}

export interface McpToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    /** The scope a caller must hold for this tool to be listed or callable. */
    requiredScope: "mcp:read" | "mcp:write";
    run(args: Record<string, unknown>, ctx: McpToolContext): Promise<unknown>;
}

/** How many rows a single call may return, whatever it asks for. */
const MAX_ROWS = 200;
const DEFAULT_ROWS = 25;

/**
 * Resolve a collection the caller named.
 *
 * Refuses anything not in the registry rather than passing the string to the
 * driver. A collection path is interpolated into a table name downstream, and
 * "the caller may name any table" is how an integration becomes a way to read
 * `rebase.oauth_clients`.
 */
function resolveCollection(ctx: McpToolContext, raw: unknown): CollectionConfig {
    const path = String(raw ?? "");
    const found = ctx.collections.find(c => c.slug === path || getCollectionDataPath(c) === path);
    if (!found) {
        throw new McpToolError(`Unknown collection "${path}". Call list_collections to see what exists.`);
    }
    return found;
}

/** An error whose message is safe to hand back to the model. */
export class McpToolError extends Error {}

/** The caller's own driver: RLS-scoped, every time, with no way to skip it. */
async function scopedDriver(ctx: McpToolContext): Promise<DataDriver> {
    // `isAnonymous` is deliberately false rather than absent. An MCP grant
    // always comes from a real sign-in and a consent screen — there is no
    // anonymous path to one — so a policy asking `rebase.is_anonymous()` should
    // see an account.
    return scopeDataDriver(ctx.driver, {
        uid: ctx.caller.uid,
        roles: ctx.caller.roles,
        isAnonymous: false
    });
}

function collectionPath(collection: CollectionConfig): string {
    return getCollectionDataPath(collection);
}

function clampLimit(raw: unknown): number {
    const asked = Number(raw ?? DEFAULT_ROWS);
    if (!Number.isFinite(asked) || asked <= 0) return DEFAULT_ROWS;
    return Math.min(Math.floor(asked), MAX_ROWS);
}

/** A non-negative row offset. `NaN`, `-1` and `"soon"` all mean "from the start". */
function clampOffset(raw: unknown): number {
    const asked = Number(raw ?? 0);
    if (!Number.isFinite(asked) || asked <= 0) return 0;
    return Math.floor(asked);
}

/**
 * A field name the collection actually declares.
 *
 * Every caller-supplied identifier that reaches the driver goes through here.
 * `filter` had this check from the start and `orderBy` did not, which is the
 * same class of gap twice over: an identifier is not a value, so it cannot be
 * bound as a parameter, and whether it is safe depends entirely on what the
 * driver does with it. The registry is the only thing that knows which names
 * are real, so the check belongs here rather than in each driver's hope that
 * it quoted everything.
 *
 * `id` is admitted alongside the declared properties because every collection
 * has one and none of them declare it.
 */
function assertKnownField(collection: CollectionConfig, field: string, what: string): string {
    const properties = collection.properties ?? {};
    if (field !== "id" && !(field in properties)) {
        throw new McpToolError(
            `"${field}" is not a field of ${collectionPath(collection)}, so it cannot be used to ${what}. `
            + `Known fields: ${["id", ...Object.keys(properties)].join(", ")}.`
        );
    }
    return field;
}

/**
 * Translate the model's filter object into the driver's filter shape.
 *
 * The wire form is `{ field: [op, value] }` — `FilterValues` — and it is
 * accepted only for fields the collection actually declares. An unknown field
 * is refused rather than dropped: silently ignoring a filter turns "show me the
 * unpaid invoices" into "show me every invoice", which is a worse answer than
 * an error and looks like a correct one.
 */
function buildFilter(collection: CollectionConfig, raw: unknown): FilterValues<string> | undefined {
    if (raw == null) return undefined;
    if (typeof raw !== "object" || Array.isArray(raw)) {
        throw new McpToolError("filter must be an object of { field: [operator, value] }.");
    }

    const filter: Record<string, [string, unknown]> = {};

    for (const [field, condition] of Object.entries(raw as Record<string, unknown>)) {
        assertKnownField(collection, field, "filter");
        if (!Array.isArray(condition) || condition.length !== 2 || typeof condition[0] !== "string") {
            throw new McpToolError(`filter.${field} must be [operator, value], e.g. ["==", "paid"].`);
        }
        filter[field] = [condition[0], condition[1]];
    }

    return filter as FilterValues<string>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
    {
        name: "list_collections",
        description:
            "List the collections in this project, with their fields. Call this first — every " +
            "other tool takes a collection name from here.",
        requiredScope: "mcp:read",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        async run(_args, ctx) {
            return {
                collections: ctx.collections.map(c => ({
                    name: collectionPath(c),
                    title: c.name,
                    description: c.description ?? null,
                    fields: Object.entries(c.properties ?? {}).map(([key, property]) => ({
                        name: key,
                        type: (property as { dataType?: string }).dataType ?? "unknown",
                        title: (property as { name?: string }).name ?? key
                    }))
                }))
            };
        }
    },

    {
        name: "query_collection",
        description:
            "Read rows from a collection. Returns only rows the signed-in user is allowed to see, " +
            "so an empty result can mean 'none match' or 'none visible to you'.",
        requiredScope: "mcp:read",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string", description: "Collection name from list_collections." },
                filter: {
                    type: "object",
                    description: 'Field conditions, e.g. {"status": ["==", "paid"], "total": [">", 100]}.',
                    additionalProperties: { type: "array" }
                },
                orderBy: { type: "string", description: "Field to sort by." },
                order: { type: "string", enum: ["asc", "desc"], description: "Sort direction." },
                limit: { type: "number", description: `Rows to return (max ${MAX_ROWS}).` },
                offset: { type: "number", description: "Rows to skip." }
            },
            required: ["collection"],
            additionalProperties: false
        },
        async run(args, ctx) {
            const collection = resolveCollection(ctx, args.collection);
            const driver = await scopedDriver(ctx);
            const limit = clampLimit(args.limit);

            const rows = await driver.fetchCollection({
                path: collectionPath(collection),
                collection,
                filter: buildFilter(collection, args.filter),
                limit,
                offset: clampOffset(args.offset),
                orderBy: args.orderBy
                    ? [[
                        assertKnownField(collection, String(args.orderBy), "sort"),
                        args.order === "desc" ? "desc" : "asc"
                    ]]
                    : undefined
            } as Parameters<DataDriver["fetchCollection"]>[0]);

            return {
                collection: collectionPath(collection),
                count: rows.length,
                // Say so explicitly. A model that gets exactly `limit` rows back
                // and is not told there may be more will report the truncated
                // set as the complete answer.
                truncated: rows.length === limit,
                rows
            };
        }
    },

    {
        name: "get_document",
        description: "Read one row by id. Fails if the signed-in user cannot see it.",
        requiredScope: "mcp:read",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string" },
                id: { type: "string" }
            },
            required: ["collection", "id"],
            additionalProperties: false
        },
        async run(args, ctx) {
            const collection = resolveCollection(ctx, args.collection);
            const driver = await scopedDriver(ctx);
            const row = await driver.fetchOne({
                path: collectionPath(collection),
                collection,
                id: String(args.id)
            });

            if (!row) {
                // Deliberately one message for "absent" and "not visible to
                // you". Distinguishing them turns this tool into an existence
                // oracle for rows the caller cannot read.
                throw new McpToolError(`No row with id "${args.id}" in ${collectionPath(collection)}.`);
            }
            return row;
        }
    },

    {
        name: "create_document",
        description: "Create a row. Subject to the same permissions as creating it in the app.",
        requiredScope: "mcp:write",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string" },
                values: { type: "object", description: "Field values for the new row." },
                id: { type: "string", description: "Optional explicit id." }
            },
            required: ["collection", "values"],
            additionalProperties: false
        },
        async run(args, ctx) {
            const collection = resolveCollection(ctx, args.collection);
            const driver = await scopedDriver(ctx);
            const saved = await driver.save({
                path: collectionPath(collection),
                collection,
                values: args.values as Record<string, unknown>,
                id: args.id ? String(args.id) : undefined,
                status: "new"
            });
            logger.info("[mcp] Row created", {
                collection: collectionPath(collection), uid: ctx.caller.uid, clientId: ctx.caller.clientId
            });
            return saved;
        }
    },

    {
        name: "update_document",
        description: "Change fields on an existing row. Only the fields given are touched.",
        requiredScope: "mcp:write",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string" },
                id: { type: "string" },
                values: { type: "object", description: "Fields to change." }
            },
            required: ["collection", "id", "values"],
            additionalProperties: false
        },
        async run(args, ctx) {
            const collection = resolveCollection(ctx, args.collection);
            const driver = await scopedDriver(ctx);
            const saved = await driver.save({
                path: collectionPath(collection),
                collection,
                values: args.values as Record<string, unknown>,
                id: String(args.id),
                status: "existing"
            });
            logger.info("[mcp] Row updated", {
                collection: collectionPath(collection), id: String(args.id),
                uid: ctx.caller.uid, clientId: ctx.caller.clientId
            });
            return saved;
        }
    },

    {
        name: "delete_document",
        description: "Delete a row by id. This cannot be undone.",
        requiredScope: "mcp:write",
        inputSchema: {
            type: "object",
            properties: {
                collection: { type: "string" },
                id: { type: "string" }
            },
            required: ["collection", "id"],
            additionalProperties: false
        },
        async run(args, ctx) {
            const collection = resolveCollection(ctx, args.collection);
            const driver = await scopedDriver(ctx);
            await driver.delete({
                row: { id: String(args.id), path: collectionPath(collection) },
                collection
            });
            logger.info("[mcp] Row deleted", {
                collection: collectionPath(collection), id: String(args.id),
                uid: ctx.caller.uid, clientId: ctx.caller.clientId
            });
            return { deleted: true, id: String(args.id) };
        }
    }
];

/** The tools a caller holding `scope` may see and call. */
export function toolsForScope(scope: string): McpToolDefinition[] {
    return MCP_TOOLS.filter(tool => scopeAllows(scope, tool.requiredScope));
}

/** Look up a tool by name, honouring scope — an unlisted tool is not callable. */
export function findTool(name: string, scope: string): McpToolDefinition | undefined {
    return toolsForScope(scope).find(tool => tool.name === name);
}
