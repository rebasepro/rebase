/**
 * Reports what the process serving it actually saw.
 *
 * `whoami` is the one that matters: it proves the caller's identity survived
 * whichever path the request took to get here.
 */
import { Hono } from "hono";
import { rebase } from "@rebasepro/server";

const app = new Hono();

app.get("/hello", (c) => c.json({ ok: true, from: "functions" }));

app.get("/whoami", (c) => {
    const user = c.get("user");
    return c.json(user ? { uid: user.uid, roles: user.roles } : { uid: null, roles: null });
});

// Proves a function can still reach the database from a process that serves no
// data routes of its own — the capability a functions-only role would silently
// lose if the split had gated the driver rather than the mount.
app.get("/count", async (c) => {
    const rows = await rebase.sql("SELECT count(*)::int AS n FROM public.split_notes");
    return c.json({ n: rows?.[0]?.n ?? null });
});

export default app;
