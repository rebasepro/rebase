// Committed fixture for the functions-proxy test (CJS — see sibling package.json).
// Reports back what the *upstream* process actually received, so the test can
// compare a proxied call against a direct one rather than asserting a status.
const { Hono } = require("hono");

const app = new Hono();

app.get("/hello", (c) => c.json({ ok: true }));

// The identity the auth middleware resolved on this process. The whole point of
// the proxy test: a dropped Authorization header leaves this null, and every
// handler still runs.
app.get("/whoami", (c) => {
    const user = c.get("user");
    return c.json(user ? { uid: user.uid, roles: user.roles } : { uid: null, roles: null });
});

app.get("/query", (c) => c.json(c.req.query()));

app.post("/body", async (c) => c.json({ received: await c.req.json() }));

app.get("/teapot", (c) => c.json({ error: "no coffee" }, 418));

app.get("/headers", (c) => c.json({
    forwardedFor: c.req.header("x-forwarded-for") ?? null,
    host: c.req.header("host") ?? null
}));

module.exports = app;
