/**
 * Reading the request context from inside a custom function.
 *
 * The functions router resolves the caller's identity before any handler runs
 * and leaves the result on the Hono context. Getting it back out used to be the
 * user's problem, and the shape made that worse than it sounds: `HonoEnv`
 * types `user` as `AuthResult`, a union that includes `boolean`, `null` and an
 * index signature, because the same slot is filled by four different middlewares
 * — JWT, service key, API key, and a user-supplied validator that may return
 * `true`. Every example in the documentation therefore opened with
 *
 *     const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
 *
 * and an assertion in a security-relevant position is exactly the kind of line
 * that gets copied once and then never re-examined. It is also wrong in one
 * case that occurs in practice: a custom validator returning `true` stores
 * `{ uid: "default", roles: [] }`, which the assertion above types as having a
 * `uid` — true here, but nothing checks it.
 *
 * These accessors do the narrowing once, in the framework, where it can be
 * tested. They are also **runtime-neutral by construction** — no crypto, no
 * token parsing, no I/O, nothing but property reads on an object another
 * middleware already populated. That is what lets them live in
 * `@rebasepro/server/functions` and run unchanged on a host that has no Node
 * built-ins.
 *
 * @module
 */
import type { Context } from "hono";
import type { DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import type { ApiKeyMasked } from "../auth/api-keys/api-key-types";
import { hasAdministrativeRole } from "../auth/admin-roles";

/**
 * The caller, as a custom function sees them.
 *
 * A narrowed view of whatever the auth middleware resolved: `uid` and `roles`
 * are guaranteed, and the index signature keeps any extra claims the token or
 * the adapter carried (`email`, `org_id`, anything a custom validator added)
 * reachable without a cast.
 */
export interface FunctionUser {
    /** Stable id of the caller. `"service"` for service-key and API-key callers. */
    uid: string;
    /** Roles as resolved for this request. Never `undefined` — an empty array instead. */
    roles: string[];
    /** Present when the identity carried one. Not every auth method does. */
    email?: string;
    /** Any further claim the token, adapter or validator supplied. */
    [claim: string]: unknown;
}

/** Anything with a Hono-style `.get`, so these work on any `Context` shape. */
type CtxLike = Context<HonoEnv> | Context;

function read<K extends keyof HonoEnv["Variables"]>(
    c: CtxLike,
    key: K
): HonoEnv["Variables"][K] | undefined {
    // `c.get` is typed against the app's own Env, which a handler mounted
    // through `app.route()` may have declared more loosely. The cast is
    // confined to this one function rather than repeated at every call site.
    return (c as Context<HonoEnv>).get(key);
}

/**
 * The authenticated caller, or `undefined` for an anonymous request.
 *
 * **`undefined` is not a permission decision.** The functions router mounts its
 * auth middleware with `requireAuth: false` on purpose — a webhook receiver has
 * no token to send — so an anonymous caller reaches the handler and reads
 * `undefined` here while the handler runs on regardless. Use {@link requireAuth}
 * (or a `!user` branch that returns 401) to make it a decision.
 *
 * A caller who presented a *bad* token never gets this far: both auth
 * middlewares reject an unverifiable token with 401 before the router is
 * reached, precisely so an expired session cannot be silently downgraded to an
 * anonymous one.
 */
export function getUser(c: CtxLike): FunctionUser | undefined {
    const raw = read(c, "user");
    if (!raw || typeof raw !== "object") return undefined;

    const record = raw as Record<string, unknown>;
    const uid = typeof record.uid === "string" ? record.uid : undefined;
    if (uid === undefined) return undefined;

    const roles = Array.isArray(record.roles)
        ? record.roles.filter((role): role is string => typeof role === "string")
        : [];

    return { ...record,
        uid,
        roles } as FunctionUser;
}

/** The caller's id, or `undefined` when nobody is signed in. */
export function getUserId(c: CtxLike): string | undefined {
    return getUser(c)?.uid;
}

/** The caller's roles. Empty for an anonymous request — never `undefined`. */
export function getRoles(c: CtxLike): string[] {
    return getUser(c)?.roles ?? [];
}

/**
 * Whether the caller holds **any** of the named roles.
 *
 * Any rather than all, because that is what a route guard means by a list of
 * roles; require several by calling this more than once.
 */
export function hasRole(c: CtxLike, ...roles: string[]): boolean {
    if (roles.length === 0) return false;
    const held = new Set(getRoles(c));
    return roles.some(role => held.has(role));
}

/**
 * Whether the caller holds an administrative role.
 *
 * Delegates to the single definition in `auth/admin-roles.ts` — which is
 * `admin` **or** `schema-admin` — rather than comparing against `"admin"`.
 * Those two lists disagreed once, and the gap made every public registrant an
 * administrator; see that file.
 */
export function isAdmin(c: CtxLike): boolean {
    return hasAdministrativeRole(getRoles(c));
}

/** Whether the request carries an identity at all. */
export function isAuthenticated(c: CtxLike): boolean {
    return getUser(c) !== undefined;
}

/**
 * The request-scoped data driver: reads and writes run as **the caller**, with
 * your row-level security policies evaluated against their identity.
 *
 * This is the accessor to reach for when a function serves user-facing data.
 * `rebase.dataAsAdmin` is the other one, and it is not the same thing — it runs
 * as `{ uid: "service", roles: ["admin"] }` for every caller alike, which is
 * correct for trusted background work and wrong for a request.
 *
 * `undefined` only when no Rebase auth middleware ran (see
 * {@link identityResolved}); inside a function mounted by the framework it is
 * always present, anonymous requests included — they get an anon-scoped driver
 * so policies still have an identity to evaluate.
 */
export function getDriver(c: CtxLike): DataDriver | undefined {
    return read(c, "driver");
}

/**
 * {@link getDriver}, but throws instead of handing back `undefined`.
 *
 * For the common case where a handler cannot proceed without it and would
 * otherwise write `c.get("driver")!` — an assertion that turns a wiring problem
 * into `Cannot read properties of undefined (reading 'fetchCollection')` twenty
 * lines away from the cause.
 */
export function requireDriver(c: CtxLike): DataDriver {
    const driver = getDriver(c);
    if (!driver) {
        throw new Error(
            "No request-scoped driver on this context. A Rebase auth middleware " +
            "populates it before any custom function runs, so this means the handler " +
            "was mounted outside the functions router — e.g. added to your own Hono " +
            "app directly. Mount it from the functions directory, or use " +
            "`rebase.dataAsAdmin` if the work is genuinely service-scoped."
        );
    }
    return driver;
}

/**
 * The API key this request authenticated with, masked, or `undefined` when it
 * did not use one.
 *
 * Useful for attribution and for per-key behaviour. The permission check itself
 * has already happened — reaching a handler means the key was allowed to.
 */
export function getApiKey(c: CtxLike): ApiKeyMasked | undefined {
    return read(c, "apiKey");
}

/**
 * The correlation id for this request — generated, or taken from an inbound
 * `X-Request-ID`.
 *
 * Log it. It is the only thing that ties a line written inside a function to
 * the framework's own lines for the same request.
 */
export function getRequestId(c: CtxLike): string | undefined {
    return read(c, "requestId");
}

/**
 * Whether a Rebase auth middleware has run on this request.
 *
 * Both middlewares populate `driver` for *every* outcome, anonymous included,
 * and populate `user` whenever there is one. So "neither is set" does not mean
 * "anonymous" — it means nothing resolved the identity, and treating that as
 * anonymous is the dangerous reading. The guards use this to tell a genuinely
 * anonymous caller (401) from a misconfigured mount (500), because answering
 * 401 to the second sends whoever is debugging it to look at the token.
 */
export function identityResolved(c: CtxLike): boolean {
    return read(c, "user") !== undefined || read(c, "driver") !== undefined;
}
