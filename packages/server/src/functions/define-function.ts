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
     * `rebase.dataAsAdmin` runs as the service identity
     * `{ uid: "service", roles: ["admin"] }` — **admin-scoped, not an RLS
     * bypass**. Policies are still evaluated; it passes the default ones
     * through their `rolesOverlap(['admin'])` arm, the same arm an application
     * user holding the `admin` role passes. Two things follow:
     *
     * - `policy.serverContext()` (`rebase.uid() IS NULL`) is **false** here. A
     *   collection with `disableDefaultPolicies: true` whose write rule is
     *   `serverContext()` will refuse these writes with `42501`, and reads
     *   against a hand-written admin policy that does not name the `admin` role
     *   return zero rows with a 200.
     * - Do not read it as "nobody else can reach these rows". Whatever an
     *   `admin`-roled user can reach, this can, and vice versa.
     *
     * `rebase.sql()` is the true bypass: it runs on the owner connection and
     * never goes through `withAuth`.
     *
     * For user-scoped queries inside a handler, use the request `driver`
     * (`c.var.driver`), which carries the caller's identity. (`rebase.data` no
     * longer exists on this type — `dataAsAdmin` is the only name for the
     * admin-scoped accessor.)
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
 * // The portable entry point, and a per-route guard — both for the reasons
 * // their own docs give: this subpath pulls in nothing Node-only, and
 * // `app.use("/*", requireAuth)` covers only the routes declared *below* it,
 * // so a route appended later at the bottom of the file is unprotected.
 * import { defineFunction, requireAuth } from "@rebasepro/server/functions";
 *
 * export default defineFunction((app, { rebase }) => {
 *     app.get("/home", requireAuth, async (c) => {
 *         // `rebase.sql` runs on the owner connection: no RLS, no policies,
 *         // every row. It is the most privileged thing in this context —
 *         // more so than `dataAsAdmin`, which is merely admin-scoped.
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
