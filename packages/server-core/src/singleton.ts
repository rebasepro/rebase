import type { RebaseServerClient } from "@rebasepro/types";

let _instance: RebaseServerClient | null = null;

/**
 * @internal Called once during server initialization to set the backing instance.
 * This is invoked by `initializeRebaseBackend()` — never call it manually.
 */
export function _initRebase(client: RebaseServerClient): void {
    _instance = client;
}

/**
 * @internal Allows overriding the underlying instance for unit testing.
 * Throws an error if used in a non-test environment to prevent production abuse.
 */
export function _setRebaseMock(mockInstance: Partial<RebaseServerClient>): void {
    if (process.env.NODE_ENV !== "test") {
        throw new Error("_setRebaseMock can only be called in a test environment (NODE_ENV=test).");
    }
    _instance = { ...(_instance || {} as RebaseServerClient),
...mockInstance } as RebaseServerClient;
}

/**
 * @internal Resets the singleton instance, useful for afterEach() in test suites.
 */
export function _resetRebaseMock(): void {
    if (process.env.NODE_ENV !== "test") {
        throw new Error("_resetRebaseMock can only be called in a test environment.");
    }
    _instance = null;
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
 * scoped as `{ uid: "service", roles: ["admin"] }`, so **every read and write
 * bypasses row-level-security policies**. No `REBASE_SERVICE_KEY` is required.
 *
 * ⚠️ Because it bypasses RLS, `rebase.dataAsAdmin` is for trusted background
 * work (cron jobs, migrations, service tasks) — **not** for serving user-facing
 * data. Inside a request handler, run user-scoped queries through the
 * request-scoped driver (`c.var.driver`), which carries the caller's identity
 * so RLS applies.
 *
 * `rebase.data` is a **deprecated alias** for `rebase.dataAsAdmin` — identical
 * admin scope at runtime. Prefer `dataAsAdmin` so the privilege is explicit.
 *
 * **Control plane** (`rebase.auth`, `rebase.admin`, `rebase.storage`, etc.):
 * Routes through the Hono app's internal request handler. An internal per-boot
 * credential is generated automatically when `REBASE_SERVICE_KEY` is not set,
 * so control-plane calls always authenticate.
 *
 * @example
 * ```typescript
 * import { rebase } from "@rebasepro/server-core";
 *
 * // In a cron job, hook, or trusted service file (admin scope, bypasses RLS):
 * await rebase.email.send({ to: "admin@co.com", subject: "Alert", html: "<p>Hi</p>" });
 * const jobs = await rebase.dataAsAdmin.jobs.find({ limit: 10 });
 * ```
 */
export const rebase: RebaseServerClient = new Proxy({} as RebaseServerClient, {
    get(_, prop) {
        if (!_instance) {
            throw new Error(
                `rebase.${String(prop)}: server not initialized yet. ` +
                "The singleton is available after Rebase starts — don't call it at import time."
            );
        }
        return _instance[prop as keyof RebaseServerClient];
    },
    set(_, prop) {
        throw new Error(
            `Cannot set rebase.${String(prop)} directly. ` +
            "The singleton is read-only. Use _initRebase() during server startup."
        );
    }
});
