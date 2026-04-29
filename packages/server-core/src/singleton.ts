import type { RebaseClient } from "@rebasepro/types";

let _instance: RebaseClient | null = null;

/**
 * @internal Called once during server initialization to set the backing instance.
 * This is invoked by `initializeRebaseBackend()` — never call it manually.
 */
export function _initRebase(client: RebaseClient): void {
    _instance = client;
}

/**
 * The server-side Rebase singleton.
 *
 * Initialized automatically during server startup. Provides access to all
 * app-scoped services: **data**, **auth**, **storage**, and **email**.
 *
 * `rebase.data` runs with **admin privileges** (no RLS). For user-scoped
 * queries inside request handlers, continue using the handler's context
 * or the RLS-scoped driver.
 *
 * @example
 * ```typescript
 * import { rebase } from "@rebasepro/server-core";
 *
 * // In a Hono handler, cron job, hook, or service file:
 * await rebase.email?.send({ to: "admin@co.com", subject: "Alert", html: "<p>Hi</p>" });
 * const jobs = await rebase.data.jobs.find({ limit: 10 });
 * ```
 */
export const rebase: RebaseClient = new Proxy({} as RebaseClient, {
    get(_, prop) {
        if (!_instance) {
            throw new Error(
                `rebase.${String(prop)}: server not initialized yet. ` +
                "The singleton is available after Rebase starts — don't call it at import time."
            );
        }
        return (_instance as Record<string, unknown>)[prop as string];
    },
});
