import { Hono } from "hono";

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
 * The authenticated user and RLS-scoped driver are available
 * via c.get("user") and c.get("driver").
 */
const app = new Hono();

app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const user = c.get("user") as any;

    return c.json({
        message: `Hello, ${body.name || "World"}!`,
        user: user?.userId || "anonymous",
    });
});

app.get("/", (c) => {
    return c.json({ status: "ok", endpoint: "hello" });
});

export default app;
