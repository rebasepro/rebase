import type { RebaseServerClient } from "@rebasepro/types";
import { hostEnv } from "./utils/host";

/**
 * The backing instance lives on a process-global slot, NOT in a module-local
 * variable — because more than one copy of this module can be loaded into one
 * process, and a module-local would leave every copy but the booting one dead.
 *
 * That is the normal layout under the managed runtime, not an edge case: the
 * image ships the framework at `/app/node_modules`, while a project's bundle
 * installs its own dependencies into `/bundle/node_modules` — and every custom
 * function imports `defineFunction` from `@rebasepro/server`, which resolves to
 * the bundle's transitively-installed copy. `initializeRebaseBackend()` then ran
 * against `/app`'s copy while every function held `/bundle`'s, so `rebase.data`,
 * `rebase.storage` and `rebase.dataAsAdmin` threw "server not initialized yet"
 * on EVERY request, forever, in an otherwise healthy process.
 *
 * `Symbol.for` is the fix because its registry is per-process rather than
 * per-module: whichever copy boots publishes here, and every other copy — same
 * version or not — reads the same live client.
 */
const INSTANCE_SLOT = Symbol.for("@rebasepro/server:singleton-instance");

/**
 * A *function* that answers "which client is this call for", for hosts where
 * one answer per process is the wrong shape.
 *
 * A Node server boots once and serves every request from the same client, so
 * {@link INSTANCE_SLOT} is the whole story. An isolate-based host is different
 * in a way that matters: the environment arrives attached to the **request**,
 * not to the module, so there is nothing to publish at import time, and an
 * isolate can be reused across requests that must not share state. Such a host
 * registers a resolver — typically reading an `AsyncLocalStorage` populated per
 * request — and it is consulted first.
 *
 * This exists now, before there is a host that needs it, because of what it
 * protects: `rebase` is a lazy Proxy, so every property access already goes
 * through `getInstance()`. Backing that lookup with a resolver is therefore the
 * entire porting story for the singleton — **no function anyone has already
 * written changes**. Take the resolver away and the only alternative is asking
 * users to thread a client through their handlers, which is a rewrite of every
 * function file in existence.
 */
const RESOLVER_SLOT = Symbol.for("@rebasepro/server:singleton-resolver");

type GlobalWithInstance = typeof globalThis & {
    [INSTANCE_SLOT]?: RebaseServerClient | null;
    [RESOLVER_SLOT]?: (() => RebaseServerClient | null) | null;
};

function getInstance(): RebaseServerClient | null {
    const global = globalThis as GlobalWithInstance;
    // Resolver first: a host that registered one knows something per-request
    // that a process-wide slot cannot express, and a host that boots normally
    // never registers one.
    const resolver = global[RESOLVER_SLOT];
    if (resolver) {
        const resolved = resolver();
        if (resolved) return resolved;
    }
    return global[INSTANCE_SLOT] ?? null;
}

function setInstance(client: RebaseServerClient | null): void {
    (globalThis as GlobalWithInstance)[INSTANCE_SLOT] = client;
}

/**
 * @internal Register the per-call resolver described on {@link RESOLVER_SLOT}.
 *
 * For runtime adapters, not for application code. Pass `null` to unregister.
 * Returns the previous resolver so an adapter can restore it.
 */
export function _setRebaseResolver(
    resolve: (() => RebaseServerClient | null) | null
): (() => RebaseServerClient | null) | null {
    const global = globalThis as GlobalWithInstance;
    const previous = global[RESOLVER_SLOT] ?? null;
    global[RESOLVER_SLOT] = resolve;
    return previous;
}

/**
 * @internal Called once during server initialization to set the backing instance.
 * This is invoked by `initializeRebaseBackend()` — never call it manually.
 */
export function _initRebase(client: RebaseServerClient): void {
    setInstance(client);
}

/**
 * @internal Allows overriding the underlying instance for unit testing.
 * Throws an error if used in a non-test environment to prevent production abuse.
 */
export function _setRebaseMock(mockInstance: Partial<RebaseServerClient>): void {
    if (hostEnv().NODE_ENV !== "test") {
        throw new Error("_setRebaseMock can only be called in a test environment (NODE_ENV=test).");
    }
    setInstance({ ...(getInstance() || {} as RebaseServerClient),
...mockInstance } as RebaseServerClient);
}

/**
 * @internal Resets the singleton instance, useful for afterEach() in test suites.
 */
export function _resetRebaseMock(): void {
    if (hostEnv().NODE_ENV !== "test") {
        throw new Error("_resetRebaseMock can only be called in a test environment.");
    }
    setInstance(null);
}

/**
 * The server-side Rebase singleton.
 *
 * Initialized automatically during server startup. Provides access to all
 * app-scoped services: **data**, **auth**, **storage**, and **email**.
 *
 * **Admin data plane** (`rebase.dataAsAdmin`):
 * Backed by the native DataDriver — calls go directly to the database without
 * JSON serialization, HTTP dispatch, or middleware overhead. The driver is
 * scoped once as `{ uid: "service", roles: ["admin"] }` (`SERVICE_IDENTITY`),
 * which makes it **admin-scoped, not RLS-bypassing**: every read and write runs
 * in a transaction that has done `SET LOCAL ROLE rebase_user` with
 * `app.uid = 'service'`, and policies are evaluated against that. No
 * `REBASE_SERVICE_KEY` is required.
 *
 * It clears the default policies through their `rolesOverlap(['admin'])` arm —
 * which is why the difference rarely shows. It shows when you write your own:
 *
 * - `policy.serverContext()` compiles to `rebase.uid() IS NULL` and is therefore
 *   **false** for this accessor. A collection with `disableDefaultPolicies:
 *   true` whose rule is `serverContext()` denies these writes (`42501`) and
 *   returns zero rows — HTTP 200, empty — for these reads.
 * - Its reach equals an `admin`-roled application user's reach. It is not a
 *   private door.
 *
 * `rebase.sql()` *is* an unconditional bypass — it runs on the owner connection
 * and never goes through `withAuth`. Of the two accessors on this object, the
 * quieter one is the more privileged.
 *
 * ⚠️ `rebase.dataAsAdmin` is for trusted background work (cron jobs,
 * migrations, service tasks) — **not** for serving user-facing data. Inside a
 * request handler, run user-scoped queries through the request-scoped driver
 * (`c.var.driver`), which carries the caller's identity.
 *
 * `rebase.data` is **gone from the type**: `RebaseServerClient` omits it, so the
 * admin-scoped accessor has exactly one name and the privilege is visible at the
 * call site. The property still exists at runtime, aliasing `dataAsAdmin`, so an
 * untyped JavaScript caller keeps working rather than failing on `undefined`.
 *
 * **Control plane** (`rebase.auth`, `rebase.admin`, `rebase.storage`, etc.):
 * Routes through the Hono app's internal request handler. An internal per-boot
 * credential is generated automatically when `REBASE_SERVICE_KEY` is not set,
 * so control-plane calls always authenticate.
 *
 * @example
 * ```typescript
 * import { rebase } from "@rebasepro/server";
 *
 * // In a cron job, hook, or trusted service file (admin scope, RLS evaluated
 * // as `{ uid: "service", roles: ["admin"] }`):
 * await rebase.email.send({ to: "admin@co.com", subject: "Alert", html: "<p>Hi</p>" });
 * const jobs = await rebase.dataAsAdmin.jobs.find({ limit: 10 });
 * ```
 */
export const rebase: RebaseServerClient = new Proxy({} as RebaseServerClient, {
    get(_, prop) {
        const instance = getInstance();
        if (!instance) {
            throw new Error(
                `rebase.${String(prop)}: server not initialized yet. ` +
                "The singleton is available after Rebase starts — don't call it at import time."
            );
        }
        return instance[prop as keyof RebaseServerClient];
    },
    set(_, prop) {
        throw new Error(
            `Cannot set rebase.${String(prop)} directly. ` +
            "The singleton is read-only. Use _initRebase() during server startup."
        );
    }
});
