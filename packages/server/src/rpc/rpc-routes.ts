/**
 * `POST /api/rpc/<name>`: the SQL functions a project declared with
 * `defineRpc`, called with a JSON body of named arguments.
 *
 * Only declared names are served; anything else answers `404 RPC_NOT_FOUND`.
 * Each call runs as the caller, through `getSql(c)`: the auth middleware in
 * front of this router scopes the request's driver to the signed-in user, or
 * to the anonymous identity when there is none, so the tables' row-level
 * security applies inside the function and a `SECURITY DEFINER` function runs
 * as its owner, as in Supabase. In order, a call is:
 *
 * 1. refused `401` when the RPC is `authenticated` and the caller anonymous;
 * 2. refused `403 SCOPE_MISSING` for a narrowed credential (an API key) that
 *    does not hold `data:read` (`data:write` for a `write: true` RPC) —
 *    unqualified, since a function reads whatever tables it reads;
 * 3. counted against the RPC's own limit — every `public` RPC has one;
 * 4. validated against its declared `args`;
 * 5. run, read-only unless the RPC says `write: true`.
 *
 * Portable: nothing here imports Node.
 *
 * @module
 */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { DEFAULT_PUBLIC_RPC_RATE_LIMIT, scopeGrants, type AnyRpcDef, type RpcRateLimit } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { ApiError, errorHandler } from "../api/errors";
import { recordMountPath } from "../api/mount-path";
import { getSql, getUser } from "../functions/context";
import { checkRateLimit, clientAddress } from "../functions/rate-limit";
import { refuseSimulatedWrite } from "../auth/simulation-read-only";
import { validateRpcArgs } from "./rpc-args";
import {
    RpcResolutionError,
    RpcSignatureCache,
    buildRpcStatement,
    resolveCandidate,
    shapeRpcResult,
    type RpcCandidate,
    type RpcSqlRunner
} from "./rpc-call";

/** What {@link createRpcRouter} mounts in front of the calls. */
export interface RpcRouterOptions {
    /** The declared RPCs. */
    rpc: readonly AnyRpcDef[];
    /**
     * Resolves the caller and scopes the request's driver to them — with
     * `requireAuth: false`, so an anonymous caller reaches the call as the
     * anonymous identity. Each RPC's `access` decides who may call it.
     */
    auth: MiddlewareHandler<HonoEnv>;
    /** The backend's per-caller limiter, shared with the data API. */
    rateLimiter?: MiddlewareHandler<HonoEnv>;
    /** The catalogue cache. One per router by default. */
    signatures?: RpcSignatureCache;
}

/** A database error's SQLSTATE and words, found down the `cause` chain. */
interface DatabaseFailure {
    code: string;
    message: string;
    detail?: string;
    hint?: string;
}

function databaseFailure(error: unknown, depth = 0): DatabaseFailure | undefined {
    if (typeof error !== "object" || error === null || depth > 8) return undefined;
    const code: unknown = Reflect.get(error, "code");
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
        const message: unknown = Reflect.get(error, "message");
        const detail: unknown = Reflect.get(error, "detail");
        const hint: unknown = Reflect.get(error, "hint");
        return {
            code,
            message: typeof message === "string" ? message : "",
            ...(typeof detail === "string" && detail ? { detail } : {}),
            ...(typeof hint === "string" && hint ? { hint } : {})
        };
    }
    return databaseFailure(Reflect.get(error, "cause"), depth + 1);
}

/** SQLSTATEs that say the cached signature no longer describes the function. */
const STALE_SIGNATURE_CODES = new Set(["42883", "42804", "42P13", "42725"]);

/**
 * A database failure as the caller should see it, or `undefined` to leave it
 * to the backend's error handler (a permission denied, a broken connection).
 */
function rpcFailure(def: AnyRpcDef, failure: DatabaseFailure): ApiError | undefined {
    // `RAISE EXCEPTION '…'` is the function author speaking to the caller, and
    // `RAISE SQLSTATE 'PT404'` sets the status, as in PostgREST.
    const status = /^PT[1-5]\d\d$/.test(failure.code) ? Number(failure.code.slice(2)) : failure.code === "P0001" ? 400 : undefined;
    if (status !== undefined) {
        return new ApiError(status, "RPC_EXCEPTION", failure.message || `${def.name} raised an exception.`, {
            rpc: def.name,
            sqlState: failure.code,
            ...(failure.detail ? { detail: failure.detail } : {}),
            ...(failure.hint ? { hint: failure.hint } : {})
        }, status < 500);
    }
    if (failure.code === "25006") {
        return new ApiError(500, "RPC_READ_ONLY",
            `${def.name} tried to write, and an RPC runs in a read-only transaction unless it is declared ` +
            "`write: true` in its `defineRpc`.", { rpc: def.name });
    }
    if (failure.code.startsWith("22")) {
        const syntax = /invalid input syntax for type ([\w ]+): "(.*)"/.exec(failure.message);
        const enumValue = /invalid input value for enum ([\w."]+): "(.*)"/.exec(failure.message);
        const message = syntax
            ? `"${syntax[2]}" is not a valid ${syntax[1]}.`
            : enumValue
                ? `"${enumValue[2]}" is not one of the values of ${enumValue[1]}.`
                : `A value passed to or computed by ${def.name} is not valid for its type (SQLSTATE ${failure.code}).`;
        return new ApiError(400, "RPC_INVALID_ARGUMENT", message, { rpc: def.name, sqlState: failure.code }, true);
    }
    return undefined;
}

/** The limit a call to `def` is held to, or `undefined` for none. */
function limitOf(def: AnyRpcDef): RpcRateLimit | undefined {
    return def.config.rateLimit ?? (def.config.access === "public" ? DEFAULT_PUBLIC_RPC_RATE_LIMIT : undefined);
}

/**
 * Count this call against the RPC's own limit, per caller: a signed-in caller
 * by uid, anyone else by address. The service key is the server's own and is
 * not counted. Answers the `429` when the limit is reached.
 */
async function overLimit(c: Context<HonoEnv>, def: AnyRpcDef): Promise<Response | undefined> {
    const limit = limitOf(def);
    if (!limit) return undefined;
    const user = getUser(c);
    if (user?.uid === "service") return undefined;
    const decision = await checkRateLimit(c, {
        name: `rpc:${def.name}`,
        limit: limit.limit,
        windowMs: limit.windowMs,
        key: user ? `uid:${user.uid}` : clientAddress(c)
    });
    c.header("X-RateLimit-Limit", String(limit.limit));
    c.header("X-RateLimit-Remaining", String(decision.remaining));
    if (decision.allowed) return undefined;
    c.header("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
    return c.json({ error: { message: `Too many calls to ${def.name}, please try again later.`, code: "RATE_LIMITED" } }, 429);
}

/** The call's body: `{}` when there is none. A body that is not JSON is the error handler's `400 INVALID_JSON`. */
async function readBody(c: Context<HonoEnv>): Promise<unknown> {
    const text = await c.req.text();
    return text.trim() === "" ? {} : JSON.parse(text);
}

/** Run `def` with `args` as the caller, reading the catalogue again once if it changed under the cache. */
async function call(def: AnyRpcDef, args: Record<string, unknown>, sql: RpcSqlRunner, signatures: RpcSignatureCache): Promise<unknown> {
    const sent = Object.keys(args);
    // Read from the cache, the catalogue may have changed since; read fresh,
    // a second read would say the same.
    const cached = signatures.holds(def);
    const attempt = async (): Promise<unknown> => {
        const candidate: RpcCandidate = resolveCandidate(def, await signatures.candidates(def, sql), sent);
        const { query, params } = buildRpcStatement(def, candidate, args);
        const rows = await sql(query, { params, write: def.config.write === true });
        return shapeRpcResult(candidate, rows);
    };
    try {
        return await attempt();
    } catch (error: unknown) {
        const failure = databaseFailure(error);
        const stale = (failure && STALE_SIGNATURE_CODES.has(failure.code)) || error instanceof RpcResolutionError;
        if (!stale || !cached) throw error;
        signatures.forget(def);
        return await attempt();
    }
}

/**
 * The RPC router: `POST /<name>` for each declared RPC, behind `auth` and the
 * backend's limiter. Mounted at `/api/rpc`.
 */
export function createRpcRouter(options: RpcRouterOptions): Hono<HonoEnv> {
    const byName = new Map<string, AnyRpcDef>();
    for (const def of options.rpc) {
        if (byName.has(def.name)) {
            throw new Error(`RPC "${def.name}" is declared more than once. Each RPC is one URL, /rpc/${def.name}: keep one \`defineRpc("${def.name}", …)\`.`);
        }
        byName.set(def.name, def);
    }
    const signatures = options.signatures ?? new RpcSignatureCache();
    const router = new Hono<HonoEnv>();
    router.onError(errorHandler);
    router.use("/*", recordMountPath());
    router.use("/*", options.auth);
    if (options.rateLimiter) router.use("/*", options.rateLimiter);

    const notFound = (name: string): never => {
        throw new ApiError(404, "RPC_NOT_FOUND",
            `No RPC named '${name}' is declared on this backend. A SQL function is callable at /rpc/<name> only once ` +
            "`defineRpc(\"<name>\", …)` is exported from backend/schema.", { rpc: name }, true);
    };

    router.post("/:name", async (c) => {
        const name = c.req.param("name");
        const def = byName.get(name);
        if (!def) return notFound(name);

        if (def.config.access === "authenticated" && !getUser(c)) {
            throw ApiError.unauthenticated(`${def.name} is for signed-in callers: send a session token or an API key.`);
        }
        const needed = def.config.write === true ? "data:write" : "data:read";
        const narrowed = c.get("scopes");
        if (narrowed && !scopeGrants(narrowed, needed)) {
            throw new ApiError(403, "SCOPE_MISSING",
                `This credential does not hold the "${needed}" scope, which calling ${def.name} needs.`,
                { requiredScope: needed });
        }
        refuseSimulatedWrite(c, def.config.write === true ? "write" : "read");

        const limited = await overLimit(c, def);
        if (limited) return limited;

        const args = validateRpcArgs(def, await readBody(c));
        try {
            return c.json(await call(def, args, getSql(c), signatures));
        } catch (error: unknown) {
            if (error instanceof RpcResolutionError) {
                if (error.reason === "no-match") throw new ApiError(400, "RPC_ARGUMENTS_MISMATCH", error.message, { rpc: def.name }, true);
                if (error.reason === "missing") throw new ApiError(500, "RPC_FUNCTION_MISSING", error.message, { rpc: def.name });
                throw new ApiError(500, "RPC_AMBIGUOUS", error.message, { rpc: def.name });
            }
            const failure = databaseFailure(error);
            const answer = failure ? rpcFailure(def, failure) : undefined;
            throw answer ?? error;
        }
    });

    router.all("/:name{.*}", (c): never => {
        const segments = (c.req.param("name") ?? "").split("/").filter(Boolean);
        const name = segments[0] ?? "";
        if (segments.length === 1 && byName.has(name)) {
            c.header("Allow", "POST");
            throw new ApiError(405, "METHOD_NOT_ALLOWED",
                `${name} is called with POST and a JSON body of named arguments, at ${c.get("mountPath") ?? "/rpc"}/${name}.`,
                { rpc: name }, true);
        }
        return notFound(name);
    });

    return router;
}
