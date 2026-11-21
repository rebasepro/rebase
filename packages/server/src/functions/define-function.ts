import { Hono, type MiddlewareHandler } from "hono";
import type { RebaseServerClient, RegisteredDatabase } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { rebase } from "../singleton";
import { isHonoLike } from "./hono-like";

/**
 * Typed context injected into a function authored with {@link defineFunction}.
 *
 * Surfaces the app-scoped Rebase singleton so handlers don't need to reach
 * for the global `rebase` import. Request-scoped values (the authenticated
 * `user`, the RLS-scoped `driver`, the `apiKey`, the `requestId`) are typed
 * on the Hono context via {@link HonoEnv} — read them with `c.get("user")`
 * / `c.var.driver` inside a handler.
 */
export interface RebaseFunctionContext<DB = RegisteredDatabase> {
    /**
     * The server-side Rebase client (`dataAsAdmin`, `auth`, `storage`,
     * `email`, `sql`) of the backend serving the request — the same object
     * the imported `rebase` is there.
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
     *
     * Typed from the `Database` the project registered on `Register`, or from
     * the type argument of `defineFunction<Database>(…)`; untyped otherwise.
     */
    rebase: RebaseServerClient<DB>;
}

/**
 * The `rebase` handle, seen through the `Database` a function names.
 *
 * One object serves every function; `DB` only describes it. It resolves, per
 * call, to the backend serving the request — the same answer the imported
 * `rebase` gives. Each collection accessor on `dataAsAdmin` is resolved by
 * name at call time, so a generated `Database` adds compile-time checks and
 * changes nothing the object does — the same reason the browser client's
 * `createRebaseClient<Database>()` is one implementation for every `Database`.
 */
function typedSingleton<DB>(): RebaseServerClient<DB> {
    return rebase as RebaseServerClient<unknown> as RebaseServerClient<DB>;
}

/**
 * What a function declares about itself, beside its routes:
 * `defineFunction(definition, { timeoutMs })`.
 */
export interface DefineFunctionOptions {
    /**
     * How long one request to this function may run, in milliseconds, before
     * it is answered `504 FUNCTION_TIMEOUT` and `getSignal(c)` is aborted. It
     * replaces the server-wide timeout (30 s by default,
     * `REBASE_FUNCTIONS_TIMEOUT_MS`) for this function only, longer or
     * shorter, and counts from the moment the request reached the functions
     * router.
     *
     * The server caps it at `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300 s by
     * default): a function file cannot hold a request open for longer than
     * the server allows. Work that takes longer belongs in a job.
     *
     * A positive number; a function cannot switch its timeout off.
     */
    timeoutMs?: number;
}

/** `options.timeoutMs`, checked as the file is loaded: a mistake fails the load, by name. */
function declaredTimeoutMs(options: DefineFunctionOptions): number | undefined {
    const value = options.timeoutMs;
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
        throw new TypeError(
            `defineFunction: \`timeoutMs\` is a number of milliseconds above 0 (got ${String(value)}). ` +
            "A function cannot switch its timeout off; the server caps it at REBASE_FUNCTIONS_MAX_TIMEOUT_MS."
        );
    }
    return Math.floor(value);
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
 * @example A function that waits on a slow service declares its own timeout:
 * ```ts
 * export default defineFunction((app) => {
 *     app.post("/", requireAuth, async (c) => c.json(await summarize(c, getSignal(c))));
 * }, { timeoutMs: 150_000 });
 * ```
 *
 * @param definition Receives the function's Hono app and the typed context.
 *   Register routes on the provided `app` and return nothing, or return your
 *   own `Hono<HonoEnv>` app to use instead.
 * @param options What the function declares about itself: its own
 *   {@link DefineFunctionOptions.timeoutMs | timeout}.
 * @returns The Hono app to default-export from the function file.
 */
export function defineFunction<DB = RegisteredDatabase>(
    definition: (app: Hono<HonoEnv>, ctx: RebaseFunctionContext<DB>) => void | Hono<HonoEnv>,
    options: DefineFunctionOptions = {}
): Hono<HonoEnv> {
    const timeoutMs = declaredTimeoutMs(options);
    // Declared to the functions router's timeout before any route of this
    // function runs. Outside that router (a test calling `app.request`) there
    // is nothing to declare it to, and nothing happens.
    const declareTimeout: MiddlewareHandler<HonoEnv> | undefined = timeoutMs === undefined
        ? undefined
        : async (c, next) => {
            c.get("functionTimeout")?.declare(timeoutMs);
            await next();
        };

    const app = new Hono<HonoEnv>();
    if (declareTimeout) app.use("*", declareTimeout);
    const returned: unknown = definition(app, { rebase: typedSingleton<DB>() });
    // Duck-typed, as the loader does: an app from another copy of `hono` is
    // not `instanceof` this one, and was replaced by the empty `app`.
    if (!isHonoLike(returned)) return app;
    if (!declareTimeout) return returned as Hono<HonoEnv>;
    // An app of the definition's own never saw the declaration above.
    const declared = new Hono<HonoEnv>();
    declared.use("*", declareTimeout);
    declared.route("/", returned as Hono<HonoEnv>);
    return declared;
}
