/**
 * `@rebasepro/server/functions` — the portable authoring surface.
 *
 * Everything a custom function needs, and nothing that ties it to one runtime.
 * Import from here rather than from `@rebasepro/server`:
 *
 * ```ts
 * import { defineFunction, requireAuth, getUser, rebase } from "@rebasepro/server/functions";
 * ```
 *
 * ## Why this entry point exists
 *
 * `@rebasepro/server` is a single barrel over the whole framework: the boot
 * sequence, the collection loader, the backup routes, the SPA server, the
 * WebSocket layer. Importing one name from it pulls `@hono/node-server`, `ws`,
 * `jsonwebtoken`, Drizzle and a dozen modules that open files. On Node that
 * costs a little start-up time and nothing else, which is why it stood for as
 * long as it did. On a host without Node built-ins it does not resolve at all —
 * so with only that entry point, *no* custom function could ever run anywhere
 * but Node, no matter how portable the function's own code was.
 *
 * That is not a limitation you can lift later. `import { defineFunction } from
 * "@rebasepro/server"` is the line in every function file, every template and
 * every documentation page; changing it afterwards is a breaking change for
 * everyone who has written one. The entry point has to exist before the code
 * that would depend on it does.
 *
 * ## What "portable" means here, precisely
 *
 * Every module reachable from this file:
 *
 * - imports no Node built-in, directly or transitively;
 * - imports no package that needs one (`@hono/node-server`, `ws`,
 *   `jsonwebtoken`, `drizzle-orm`, `pg`, …);
 * - touches no host global — `process`, `Buffer`, `__dirname` — at module
 *   scope, so the module *evaluates* on a runtime that has none.
 *
 * `portability.test.ts` walks this graph on every run and fails naming the
 * import chain that broke it. The rule is not a convention; it is a test.
 *
 * ## What is deliberately not here
 *
 * - **`rebase.sql()`** — reachable through `rebase`, and Node-only in practice:
 *   it runs on the database owner connection over a TCP socket. It is left on
 *   the object rather than hidden because there is nothing wrong with using it
 *   on a Node deployment; see its docblock, and `runtimeKey()` if a function
 *   needs to degrade rather than fail.
 * - **Token verification.** Deciding whether a caller is who they say needs the
 *   signing key and belongs to the host; deciding whether *this* caller may
 *   call *this* route needs only the resolved identity and belongs here. That
 *   is why `requireAuth` below carries no crypto — see `./guards.ts`.
 * - **The loader, the router, the proxy, the timeout middleware.** Host
 *   machinery. It lives in `./internal.ts`.
 *
 * @module
 */

// ── Authoring ────────────────────────────────────────────────────────────
export { defineFunction } from "./define-function";
export type { RebaseFunctionContext } from "./define-function";

/**
 * The app-scoped Rebase client: `dataAsAdmin`, `auth`, `storage`, `email`,
 * `sql`.
 *
 * Re-exported here — the same object the package root exports, not a copy —
 * because it is the one piece of the framework a function reaches for at
 * runtime, and requiring a second import from the Node-only barrel to get it
 * would defeat the entry point.
 *
 * It is safe to hold at module scope, unlike a configuration value, because it
 * is a lazy Proxy: nothing is resolved until a property is read, which happens
 * inside a request. That indirection is also the whole of what a future
 * isolate-based host has to hook — see `_setRebaseResolver` in
 * `../singleton.ts`.
 */
export { rebase } from "../singleton";

// ── Request context ──────────────────────────────────────────────────────
export {
    getUser,
    getUserId,
    getRoles,
    hasRole,
    isAdmin,
    isAuthenticated,
    getDriver,
    requireDriver,
    getApiKey,
    getRequestId,
    identityResolved
} from "./context";
export type { FunctionUser } from "./context";

// ── Route guards ─────────────────────────────────────────────────────────
export { requireAuth, requireAdmin, requireRole } from "./guards";

// ── Configuration ────────────────────────────────────────────────────────
export { getEnv, env, requireEnv, runtimeKey, isNodeRuntime, lazyResource } from "./runtime-env";

// ── Background work ──────────────────────────────────────────────────────
export { waitUntil } from "./wait-until";

// ── Types and errors ─────────────────────────────────────────────────────
/**
 * The Hono environment a Rebase function runs in: `c.get("user")`,
 * `c.get("driver")`, `c.get("apiKey")` and `c.get("requestId")` are typed
 * through it.
 *
 * `defineFunction` applies it for you. Declare it explicitly only when building
 * the Hono app by hand: `new Hono<HonoEnv>()`.
 */
export type { HonoEnv, ApiResponse } from "../api/types";

/**
 * Throw this to answer with a specific status.
 *
 * The functions router installs the framework's error handler, so an `ApiError`
 * thrown anywhere inside a handler becomes the status and body it names,
 * whereas any other throw becomes a 500 with its detail withheld.
 */
export { ApiError } from "../api/errors";
