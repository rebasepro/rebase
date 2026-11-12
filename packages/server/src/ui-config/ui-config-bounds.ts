/**
 * The bounds of `/api/admin/ui-config` writes (security review S-5).
 *
 * `PUT /user/:slug` is open to every signed-in person, guests included, and
 * used to accept any slug and any body up to the server's global limit: a
 * per-user sink of unbounded rows in `rebase.ui_preferences`. Mounted in
 * front of the routes, this refuses:
 *
 * - a slug that is `__proto__`, `constructor` or `prototype` (`400`), on
 *   every route — and any such key anywhere in a body;
 * - a write for a table this server does not serve, or for a user write a
 *   table the caller is not described by `GET /api/schema/tables` (`404
 *   TABLE_NOT_FOUND`) — which bounds a user's rows by the number of tables
 *   they can see. A `DELETE` is let through: it only removes;
 * - a body over {@link UI_PREFERENCES_MAX_BYTES} (`413`). The store refuses a
 *   merge that would grow a row past the same cap.
 *
 * @module
 */
import type { Context, MiddlewareHandler } from "hono";
import type { TableDescriptor } from "@rebasepro/types";

import { ApiError } from "../api/errors";
import type { HonoEnv } from "../api/types";
import { schemaCallerOf } from "../api/schema-tables-routes";
import { schemaViewFor, servedTableSlugs, type SchemaTablesPersons } from "../api/schema-tables";

/** The most one table's preferences may take, serialized, for one owner. */
export const UI_PREFERENCES_MAX_BYTES = 64 * 1024;

/** Keys that would reach an object's prototype when assigned. */
export const FORBIDDEN_PREFERENCE_KEYS: readonly string[] = ["__proto__", "constructor", "prototype"];

/** What the bounds read. */
export interface UiConfigBoundsOptions {
    /** The tables this server serves now (the table registry). */
    tables: () => readonly TableDescriptor[];
    /** `schemaTables.persons`: which tables a person is described, for their own writes. */
    persons?: SchemaTablesPersons;
}

/** Where under `under` a forbidden key sits, or `undefined`. */
export function forbiddenKeyPath(value: unknown, under = ""): string | undefined {
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            const found = forbiddenKeyPath(item, `${under}[${index}]`);
            if (found) return found;
        }
        return undefined;
    }
    if (typeof value !== "object" || value === null) return undefined;
    for (const key of Object.keys(value)) {
        const path = under ? `${under}.${key}` : key;
        if (FORBIDDEN_PREFERENCE_KEYS.includes(key)) return path;
        const found = forbiddenKeyPath(Reflect.get(value, key), path);
        if (found) return found;
    }
    return undefined;
}

/** The slugs a caller may write preferences for, in a scope. */
function writableSlugs(c: Context<HonoEnv>, scope: string, options: UiConfigBoundsOptions): ReadonlySet<string> {
    const tables = options.tables();
    if (scope === "workspace") return new Set(tables.map(table => table.slug));
    const view = schemaViewFor(schemaCallerOf(c), { persons: options.persons ?? "granted" });
    return "refused" in view ? new Set() : servedTableSlugs(tables, view);
}

/**
 * The middleware. Mount it on the ui-config router before its routes (a
 * `use()` after the routes never runs): `router.use("/:scope/:slug", …)`.
 */
export function uiConfigBounds(options: UiConfigBoundsOptions): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        const scope = c.req.param("scope") ?? "";
        const slug = c.req.param("slug") ?? "";
        if (scope !== "workspace" && scope !== "user") return next();
        if (FORBIDDEN_PREFERENCE_KEYS.includes(slug)) {
            throw ApiError.badRequest(`"${slug}" is not a table slug.`, "INVALID_INPUT");
        }
        if (c.req.method !== "PUT") return next();

        const declared = Number(c.req.header("content-length") ?? "0");
        if (Number.isFinite(declared) && declared > UI_PREFERENCES_MAX_BYTES) throw tooLarge();
        const text = await c.req.text();
        if (Buffer.byteLength(text, "utf8") > UI_PREFERENCES_MAX_BYTES) throw tooLarge();
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            body = undefined;
        }
        const forbidden = forbiddenKeyPath(body);
        if (forbidden) {
            throw ApiError.badRequest(`The body names \`${forbidden}\`, a key that is never a preference.`, "INVALID_INPUT");
        }
        if (!writableSlugs(c, scope, options).has(slug)) {
            throw ApiError.notFound(
                scope === "user"
                    ? `No table "${slug}" is served to this caller, so it has no preferences to store.`
                    : `This server serves no table "${slug}".`,
                "TABLE_NOT_FOUND"
            );
        }
        return next();
    };
}

function tooLarge(): ApiError {
    return new ApiError(413, "UI_PREFERENCES_TOO_LARGE",
        `One table's preferences may take at most ${UI_PREFERENCES_MAX_BYTES / 1024} KB.`);
}
