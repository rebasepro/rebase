import type { RebaseServerClient } from "@rebasepro/types";

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

type GlobalWithInstance = typeof globalThis & {
    [INSTANCE_SLOT]?: RebaseServerClient | null;
};

function getInstance(): RebaseServerClient | null {
    return (globalThis as GlobalWithInstance)[INSTANCE_SLOT] ?? null;
}

function setInstance(client: RebaseServerClient | null): void {
    (globalThis as GlobalWithInstance)[INSTANCE_SLOT] = client;
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
    if (process.env.NODE_ENV !== "test") {
        throw new Error("_setRebaseMock can only be called in a test environment (NODE_ENV=test).");
    }
    setInstance({ ...(getInstance() || {} as RebaseServerClient),
...mockInstance } as RebaseServerClient);
}

/**
 * @internal Resets the singleton instance, useful for afterEach() in test suites.
 */
export function _resetRebaseMock(): void {
    if (process.env.NODE_ENV !== "test") {
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
 * - `policy.serverContext()` compiles to `auth.uid() IS NULL` and is therefore
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
