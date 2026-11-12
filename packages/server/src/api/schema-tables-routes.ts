import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
    SCHEMA_VERSION_HEADER,
    computeSchemaVersion,
    type CollectionConfig,
    type TableDescriptor
} from "@rebasepro/types";
import type { HonoEnv } from "./types";
import { ApiError } from "./errors";
import { callerScopes } from "../auth/access";
import type { TableRegistry } from "../schema/table-registry";
import {
    compileServedPolicies,
    schemaViewFor,
    schemaViewKey,
    serializeTables,
    type SchemaCaller,
    type SchemaTablesPersons,
    type SchemaView,
    type TablePolicies
} from "./schema-tables";

/**
 * `GET {basePath}/schema/tables` — the tables this backend serves, as the
 * caller may see them — and `GET {basePath}/schema/tables/:slug`.
 *
 * The zero-config CMS renders every table from it, the Studio draws its schema
 * visualizer and RLS editor from it; the body is {@link serializeTables} for
 * the caller's view. Status codes:
 *
 * - `200` — a JSON array of `TableDescriptor` (one descriptor for `/:slug`),
 *   with `ETag: W/"<schemaVersion>-<view key>"`, `Cache-Control: private,
 *   no-cache` and the schema-version header. A signed-in person without
 *   `schema:read` is described only the tables their roles can reach, with
 *   only the rules that can apply to them, unless the backend says
 *   `schemaTables: { persons: "all" }`; the view key carries their roles.
 * - `304` — `If-None-Match` named the current tag.
 * - `401` — nobody is signed in (and the backend did not opt into
 *   `schemaTables: { public: true }`), or the credential sent is invalid.
 * - `403 SCOPE_MISSING` — a credential holding neither `schema:read` nor a
 *   `data:*` scope.
 * - `404 SCHEMA_UNAVAILABLE` — no authentication is configured, so there is
 *   no caller to redact for; `auth.requireAuth: false` does not change that.
 * - `404 TABLE_NOT_FOUND` — `/:slug` names a table this caller is not served.
 *
 * @module
 */

/**
 * What the endpoint and `/api/meta/contract` both serve from: the registry's
 * descriptors and compiled policies, cached per registry revision.
 *
 * @group Schema
 */
export interface SchemaTablesService {
    /** The schema version the bodies describe. */
    version(): string;
    /** The tables a view is served. */
    tablesFor(view: SchemaView): TableDescriptor[];
    /** The `ETag` of what a view is served. */
    etagFor(view: SchemaView): string;
}

/**
 * Options of {@link createSchemaTablesService}.
 *
 * @group Schema
 */
export interface SchemaTablesServiceConfig {
    /** The descriptors served. Its revision invalidates every cache. */
    tableRegistry: Pick<TableRegistry, "list" | "revision">;
    /**
     * The collections the declared tables were lowered into: what the policy
     * compiler reads. Introspected tables are not among them — Rebase did not
     * generate their policies, so it serves none for them.
     */
    policySource: () => readonly CollectionConfig[];
    /**
     * The schema version the bundle recorded at build time, quoted while the
     * registry is as it was when the service was created. Recomputed from the
     * descriptors when absent, and after the registry changes: the recorded
     * stamp no longer describes it then.
     */
    schemaVersion?: string;
}

/** Distinct views cached per revision; more than this and the cache starts over. */
const MAX_CACHED_VIEWS = 256;

/**
 * Build the cache both routes read.
 *
 * @group Schema
 */
export function createSchemaTablesService(config: SchemaTablesServiceConfig): SchemaTablesService {
    const registry = config.tableRegistry;
    const bootRevision = registry.revision;
    let cache: {
        revision: number;
        version: string;
        policies?: Map<string, TablePolicies>;
        bodies: Map<string, TableDescriptor[]>;
    } | undefined;

    const current = () => {
        if (cache && cache.revision === registry.revision) return cache;
        const version = registry.revision === bootRevision && config.schemaVersion
            ? config.schemaVersion
            : computeSchemaVersion(registry.list());
        cache = { revision: registry.revision, version, bodies: new Map() };
        return cache;
    };

    return {
        version: () => current().version,
        etagFor: (view) => `W/"${current().version}-${schemaViewKey(view)}"`,
        tablesFor: (view) => {
            const state = current();
            const key = schemaViewKey(view);
            const cached = state.bodies.get(key);
            if (cached) return cached;
            const tables = registry.list();
            if (view.privileged && !state.policies) {
                // A view has no policies of its own (`posture: "view"`).
                const policied = tables.filter(table => table.kind === "table").map(table => table.slug);
                state.policies = compileServedPolicies(config.policySource(), new Set(policied));
            }
            const body = serializeTables(tables, view, state.policies);
            if (state.bodies.size >= MAX_CACHED_VIEWS) state.bodies.clear();
            state.bodies.set(key, body);
            return body;
        }
    };
}

/**
 * Options of {@link createSchemaTablesRoutes}.
 *
 * @group Schema
 */
export interface SchemaTablesRoutesConfig {
    service: SchemaTablesService;
    /**
     * `false` when the backend has no authentication configured: every request
     * is answered `404 SCHEMA_UNAVAILABLE`.
     */
    available: boolean;
    /**
     * Identify the caller: verify whatever credential the request carries and
     * set `user` (and `scopes`, for a credential that narrows them). A request
     * with no credential must pass through with no `user`.
     */
    authenticate: MiddlewareHandler<HonoEnv>[];
    /** `schemaTables.public`: serve anonymous callers the tables with a public `select` rule. */
    publicTables?: boolean;
    /**
     * `schemaTables.persons`: what a signed-in person without `schema:read` is
     * described — the tables their roles can reach (`"granted"`, the default)
     * or every table (`"all"`). See {@link SchemaTablesPersons}.
     */
    persons?: SchemaTablesPersons;
}

/** The roles on the request's caller. */
function rolesOf(c: Context<HonoEnv>): string[] {
    const user = c.get("user");
    if (typeof user !== "object" || user === null || !("roles" in user) || !Array.isArray(user.roles)) return [];
    return user.roles.filter((role): role is string => typeof role === "string");
}

/**
 * Who a request comes from, as the serializer judges it: nobody, a person
 * (their roles' scopes), or a credential (exactly the scopes it carries).
 *
 * @group Schema
 */
export function schemaCallerOf(c: Context<HonoEnv>): SchemaCaller {
    if (!c.get("user")) return { kind: "anonymous", roles: [], scopes: [] };
    const narrowed = c.get("scopes");
    return narrowed
        ? { kind: "credential", roles: rolesOf(c), scopes: narrowed }
        : { kind: "person", roles: rolesOf(c), scopes: callerScopes(c) };
}

/** Whether an `If-None-Match` header names this tag (or `*`). */
function matches(header: string | undefined, etag: string): boolean {
    if (!header) return false;
    return header.split(",").map(tag => tag.trim()).some(tag => tag === etag || tag === "*");
}

/**
 * Mount `GET /tables` and `GET /tables/:slug` (the caller mounts the router at
 * `{basePath}/schema`).
 *
 * @group Schema
 */
export function createSchemaTablesRoutes(config: SchemaTablesRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    if (!config.available) {
        router.all("/*", (c) => c.json({
            error: {
                code: "SCHEMA_UNAVAILABLE",
                message: "This backend serves its tables only to authenticated callers, and no authentication is " +
                    "configured (no auth adapter and no auth.jwtSecret). Configure auth to enable GET /schema/tables."
            }
        }, 404));
        return router;
    }

    router.use("/*", ...config.authenticate);

    const viewOf = (c: Context<HonoEnv>): SchemaView => {
        const caller = schemaCallerOf(c);
        if (caller.kind === "anonymous" && !config.publicTables) {
            throw ApiError.unauthenticated("Authentication required: the tables are described to signed-in callers and credentials only.");
        }
        const view = schemaViewFor(caller, { persons: config.persons ?? "granted" });
        if ("refused" in view) throw new ApiError(403, "SCOPE_MISSING", view.message, { requiredScope: "schema:read" });
        return view;
    };

    const answer = <T>(c: Context<HonoEnv>, view: SchemaView, body: () => T): Response => {
        const etag = config.service.etagFor(view);
        c.header("ETag", etag);
        c.header("Cache-Control", "private, no-cache");
        c.header("Vary", "Authorization");
        c.header(SCHEMA_VERSION_HEADER, config.service.version());
        if (matches(c.req.header("if-none-match"), etag)) return c.body(null, 304);
        return c.json(body());
    };

    router.get("/tables", (c) => {
        const view = viewOf(c);
        return answer(c, view, () => config.service.tablesFor(view));
    });

    router.get("/tables/:slug", (c) => {
        const view = viewOf(c);
        const slug = c.req.param("slug");
        const table = config.service.tablesFor(view).find(candidate => candidate.slug === slug);
        if (!table) throw ApiError.notFound(`No table "${slug}" is served to this caller.`, "TABLE_NOT_FOUND");
        return answer(c, view, () => table);
    });

    return router;
}
