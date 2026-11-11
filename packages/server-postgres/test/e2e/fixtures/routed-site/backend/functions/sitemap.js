/**
 * The site's sitemap, served at /sitemap.xml by the site's route.
 *
 * Built from the request's own origin, which is the site's hostname when the
 * route serves it: that is what a sitemap's absolute URLs have to name.
 */
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
    const origin = new URL(c.req.url).origin;
    return c.body(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/blog/hello</loc></url></urlset>\n`,
        200,
        { "Content-Type": "application/xml; charset=utf-8" }
    );
});

export default app;
