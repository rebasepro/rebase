import {
    defineFunction,
    requireAuth,
    requireAdmin,
    getUser,
    getUserId
} from "@rebasepro/server/functions";

/**
 * Example custom function route.
 *
 * This file is auto-discovered by Rebase and mounted at:
 *   GET  /api/functions/hello          (public)
 *   POST /api/functions/hello          (signed in)
 *   GET  /api/functions/hello/stats    (admins only)
 *
 * Call from the client SDK:
 *   const result = await client.functions.invoke("hello", { name: "World" });
 *
 * `invoke` sends POST by default, which is why the POST route below is the one
 * that takes a body. For the public GET above, pass the method:
 *   await client.functions.invoke("hello", undefined, { method: "GET" });
 *
 * Authored with `defineFunction`, which hands you a pre-typed Hono app (so
 * `c.get("user")` / `c.get("driver")` are typed) and the `rebase` singleton via
 * the injected context — use any Hono middleware, define any HTTP methods,
 * access the request/response directly.
 *
 * **Import from `@rebasepro/server/functions`, not `@rebasepro/server`.** Same
 * code, but that entry point is the portable one: it pulls in nothing that
 * needs Node, so a function written against it can run on any JavaScript
 * runtime. The package root reaches the whole framework — the boot sequence,
 * the file loaders, the WebSocket layer — which is correct for a server
 * entrypoint and is not what a route handler needs.
 *
 * **Custom functions are not authenticated for you.** The functions router
 * parses the caller's token and puts the result in the context, but it does
 * not reject anonymous requests — a webhook receiver (Stripe, GitHub) has no
 * token to send, and that has to keep working. So every route in this folder
 * is public until you say otherwise, and reading `getUser(c)` is not a check:
 * an anonymous caller just gets `undefined` and the handler runs anyway.
 *
 * Say otherwise with `requireAuth` / `requireAdmin`, in the route's own
 * middleware slot as below. `requireAuth` answers 401 without a valid token.
 * `requireAdmin` answers 403 without the `admin` role and must come *after*
 * `requireAuth` — on its own it has no user to inspect. Prefer the per-route
 * slot over `app.use("/*", requireAuth)`: `use()` only covers routes declared
 * *below* it, so a route appended later above it is silently unprotected.
 *
 * `rebase.dataAsAdmin` gives you admin-level access to your data: it runs as
 * `{ uid: "service", roles: ["admin"] }`, which is **admin-scoped, not an RLS
 * bypass** — your policies are still evaluated, just against that identity. So
 * `policy.serverContext()` is false for it (that arm means "no uid at all"),
 * and anything an `admin` user can reach, it can reach too. For request-scoped
 * data access use `getUser(c)` and `getDriver(c)`, which carry the caller's
 * identity. `rebase.sql()` is the real bypass — owner connection, no policies,
 * and the one accessor that is Node-only. (`rebase` also exposes auth, storage,
 * email.)
 *
 * Two habits worth keeping from the start, because both are free here and
 * expensive to retrofit later:
 *
 *   - Read configuration **inside** a handler — `requireEnv(c, "STRIPE_KEY")`
 *     or `lazyResource(...)` — never `process.env.X` at the top of the file. A
 *     module-scope read that comes back undefined takes the whole file down at
 *     import time, and the loader reports that only as "skipped".
 *   - Wrap work that outlives the response in `waitUntil(c, promise)` rather
 *     than leaving a floating promise. It is what lets a graceful shutdown wait
 *     for your webhook instead of dropping it.
 */
export default defineFunction((app, { rebase }) => {
    void rebase; // available for dataAsAdmin/auth/storage/email — see commented usage below

    // ── Public ────────────────────────────────────────────────────────────
    // Deliberately public: no guard, so anyone can call it. That is a fine
    // choice for health probes, webhook receivers and public content — the
    // point is that it is a choice, written down, and not the default you got
    // by forgetting.
    app.get("/", (c) => {
        return c.json({ status: "ok",
            endpoint: "hello" });
    });

    // ── Signed in ─────────────────────────────────────────────────────────
    // `requireAuth` replies 401 before the handler runs, so the user here is
    // guaranteed rather than hoped for.
    app.post("/", requireAuth, async (c) => {
        const body = await c.req.json().catch(() => ({}));

        // Access any Rebase service via the injected `rebase`:
        // await rebase.email.send({
        //     to: "admin@example.com",
        //     subject: "Function called",
        //     html: `<p>Hello from ${getUserId(c)}!</p>`,
        // });
        //
        // Admin-scoped data (RLS evaluated as the `admin` role — trusted work
        // only):
        // const authors = await rebase.dataAsAdmin.authors.find({ limit: 5 });
        // For user-scoped data (RLS applies as the caller), use getDriver(c).

        return c.json({
            message: `Hello, ${body.name || "World"}!`,
            user: getUserId(c)
        });
    });

    // ── Admins only ───────────────────────────────────────────────────────
    // Order matters: `requireAuth` first (401 for anonymous), then
    // `requireAdmin` (403 for a signed-in non-admin).
    app.get("/stats", requireAuth, requireAdmin, (c) => {
        // `getUser` returns a narrowed `{ uid, roles, ...claims }` — no cast,
        // and `roles` is always an array.
        return c.json({ admin: getUser(c)?.uid });
    });
});
