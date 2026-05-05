import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server-core";
import { rebase } from "@rebasepro/server-core";

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
 * This is a standard Hono app — use any Hono middleware,
 * define any HTTP methods, access the request/response directly.
 *
 * The `rebase` singleton gives you admin-level access to all
 * app-scoped services (data, auth, storage, email) from anywhere.
 * For request-scoped / RLS-scoped access, use c.get("user") and c.get("driver").
 */
const app = new Hono<HonoEnv>();

app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const user = c.get("user");

    const userId = (user && typeof user === "object" && "userId" in user)
        ? user.userId
        : "anonymous";

    // Access any Rebase service — just import and use:
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

export default app;
