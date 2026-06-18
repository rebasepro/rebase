import { Hono } from "hono";
import { rebase } from "@rebasepro/server-core";

const app = new Hono();

/**
 * GET /api/functions/insights/home
 *
 * Returns all home-page KPI values in a single round trip.
 * Runs server-side SQL aggregations instead of fetching
 * hundreds of rows to the browser.
 */
app.get("/home", async (c) => {
    if (!rebase.sql) {
        return c.json({ error: "SQL not available" }, 501);
    }

    const [stats] = await rebase.sql(`
        SELECT
            COALESCE(SUM(total), 0)   AS total_revenue,
            COUNT(*)                  AS total_orders,
            COALESCE(AVG(total), 0)   AS avg_order_value,
            COUNT(*) FILTER (WHERE status = 'refunded') AS refunded_orders
        FROM orders
    `);

    return c.json({
        totalRevenue: Number(stats.total_revenue),
        totalOrders: Number(stats.total_orders),
        avgOrderValue: Number(stats.avg_order_value),
        refundedOrders: Number(stats.refunded_orders)
    });
});

/**
 * GET /api/functions/insights/collection/:slug
 *
 * Returns collection-level KPI values.
 */
app.get("/collection/:slug", async (c) => {
    if (!rebase.sql) {
        return c.json({ error: "SQL not available" }, 501);
    }

    const slug = c.req.param("slug");

    switch (slug) {
        case "orders": {
            const [stats] = await rebase.sql(`
                SELECT
                    COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
                    COUNT(*) FILTER (WHERE status = 'shipped')   AS shipped,
                    COALESCE(SUM(total), 0)                      AS revenue
                FROM orders
            `);
            return c.json({
                confirmed: Number(stats.confirmed),
                shipped: Number(stats.shipped),
                revenue: Number(stats.revenue)
            });
        }

        case "products": {
            const [stats] = await rebase.sql("SELECT COUNT(*) AS total FROM products");
            return c.json({ total: Number(stats.total) });
        }

        case "tickets": {
            const [stats] = await rebase.sql(`
                SELECT COUNT(*) FILTER (WHERE status = 'open') AS open_count
                FROM tickets
            `);
            return c.json({ openCount: Number(stats.open_count) });
        }

        default:
            return c.json({ error: `No insights defined for "${slug}"` }, 404);
    }
});

export default app;
