import { defineFunction } from "@rebasepro/server";

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
 * `rebase.dataAsAdmin` gives you admin-level access to your data and
 * **bypasses RLS** — use it only for trusted admin work. For request-scoped /
 * RLS-scoped data access, use c.get("user") and c.get("driver"), which carry
 * the caller's identity. (`rebase` also exposes auth, storage, email.)
 */
export default defineFunction((app, { rebase }) => {
    void rebase; // available for dataAsAdmin/auth/storage/email — see commented usage below

    app.post("/", async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const user = c.get("user");

        const userId = (user && typeof user === "object" && "userId" in user)
            ? user.userId
            : "anonymous";

        // Access any Rebase service via the injected `rebase`:
        // await rebase.email.send({
        //     to: "admin@example.com",
        //     subject: "Function called",
        //     html: `<p>Hello from ${userId}!</p>`,
        // });
        //
        // Admin-scoped data (bypasses RLS — trusted work only):
        // const authors = await rebase.dataAsAdmin.authors.find({ limit: 5 });
        // For user-scoped data (RLS applies), use the request-scoped driver
        // (c.get("driver")), which carries the caller's identity.

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
