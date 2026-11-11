/**
 * Server-rendered blog pages, served under /blog by the site's wildcard route.
 */
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.html("<h1>All posts</h1>"));
app.get("/:slug", (c) => c.html(`<h1>${c.req.param("slug")}</h1>`));

export default app;
