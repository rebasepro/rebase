import { Hono } from "hono";
import type { RebaseServerClient } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { rebase } from "../singleton";

/**
 * Typed context injected into a function authored with {@link defineFunction}.
 *
 * Surfaces the app-scoped Rebase singleton so handlers don't need to reach
 * for the global `rebase` import. Request-scoped values (the authenticated
 * `user`, the RLS-scoped `driver`, the `apiKey`, the `requestId`) are typed
 * on the Hono context via {@link HonoEnv} — read them with `c.get("user")`
 * / `c.var.driver` inside a handler.
 */
export interface RebaseFunctionContext {
    /**
     * The server-side Rebase singleton (`dataAsAdmin`, `auth`, `storage`,
     * `email`, `sql`).
     *
     * `rebase.dataAsAdmin` runs with **admin privileges and bypasses RLS** — use
     * it only for trusted admin work. For user-scoped queries inside a handler,
     * use the request `driver` (`c.var.driver`), which carries the caller's
     * identity so RLS applies. (`rebase.data` no longer exists on this type —
     * `dataAsAdmin` is the only name for the admin-scoped accessor.)
     */
    rebase: RebaseServerClient;
}

/**
 * Typed authoring contract for a custom backend function.
 *
 * A custom function is a file in the `functionsDir` that default-exports a
 * Hono app; the loader mounts it at `/<filename>`. `defineFunction` is the
 * typed opt-in for that contract: it hands you a pre-typed `Hono<HonoEnv>`
 * app (so `c.var.user` / `c.var.driver` are typed) plus a
 * {@link RebaseFunctionContext}, and returns exactly the Hono app the loader
 * already accepts — so it is fully interchangeable with a plain
 * `export default new Hono()`.
 *
 * @example
 * ```ts
 * import { defineFunction, requireAuth } from "@rebasepro/server";
 *
 * export default defineFunction((app, { rebase }) => {
 *     app.use("/*", requireAuth);
 *     app.get("/home", async (c) => {
 *         const [stats] = await rebase.sql(`SELECT count(*) AS n FROM orders`);
 *         return c.json({ orders: Number(stats.n) });
 *     });
 * });
 * ```
 *
 * @param definition Receives the function's Hono app and the typed context.
 *   Register routes on the provided `app` and return nothing, or return your
 *   own `Hono<HonoEnv>` app to use instead.
 * @returns The Hono app to default-export from the function file.
 */
export function defineFunction(
    definition: (app: Hono<HonoEnv>, ctx: RebaseFunctionContext) => void | Hono<HonoEnv>
): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>();
    const returned = definition(app, { rebase });
    return returned instanceof Hono ? returned : app;
}
