import { defineFunction } from "@rebasepro/server-core";

/**
 * Example custom function route.
 *
 * This file is auto-discovered by Rebase and mounted at:
 *   POST /api/functions/hello
 *   GET  /api/functions/hello
 *
 * Call from the client SDK:
 *   const result = await client.call("functions/hello", { name: "World" });
 *
 * Authored with `defineFunction`, which hands you a pre-typed Hono app
 * (so `c.get("user")` / `c.get("driver")` are typed) and the `rebase`
 * singleton via the injected context — use any Hono middleware, define any
 * HTTP methods, access the request/response directly.
 *
 * `rebase` gives you admin-level access to all app-scoped services
 * (data, auth, storage, email). For request-scoped / RLS-scoped access,
 * use c.get("user") and c.get("driver").
 */
export default defineFunction((app, { rebase }) => {
    void rebase; // available for data/auth/storage/email — see commented usage below

    app.post("/", async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const user = c.get("user");

        const userId = (user && typeof user === "object" && "userId" in user)
            ? user.userId
            : "anonymous";

        // Access any Rebase service via the injected `rebase`:
        // await rebase.email?.send({
        //     to: "admin@example.com",
        //     subject: "Function called",
        //     html: `<p>Hello from ${userId}!</p>`,
        // });
        //
        // const authors = await rebase.data.authors.find({ limit: 5 });

        return c.json({
            message: `Hello, ${body.name || "World"}!`,
            user: userId
        });
    });

    app.get("/", (c) => {
        return c.json({ status: "ok",
            endpoint: "hello" });
    });
});
