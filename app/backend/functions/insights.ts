import { defineFunction, requireAuth } from "@rebasepro/server";

/**
 * Period-over-period change as a ratio (0.15 means +15%).
 *
 * Returns null when the previous window is empty: there is no honest
 * percentage for "grew from nothing", and the scorecard drops the
 * comparison entirely when the field isn't a number.
 */
function pctChange(current: number, previous: number): number | null {
    if (previous === 0) return null;
    return (current - previous) / previous;
}

/**
 * Insights function — server-side KPI aggregations.
 *
 * Authored with `defineFunction`, which provides a typed `Hono<HonoEnv>`
 * app (so `c.var.user` / `c.var.driver` are typed) and the `rebase`
 * singleton via the injected context — no global import needed.
 *
 * Every metric is windowed and paired with the same metric over the
 * immediately preceding window of equal length, so the deltas the
 * scorecards render are measured rather than decorative.
 */
export default defineFunction((app, { rebase }) => {
    app.use("/*", requireAuth);

    /**
     * GET /api/functions/insights/home
     *
     * Returns all home-page KPI values in a single round trip.
     * Runs server-side SQL aggregations instead of fetching
     * hundreds of rows to the browser.
     *
     * Window: the last 30 days, compared against the 30 days before it.
     */
    app.get("/home", async (c) => {
        if (!rebase.sql) {
            return c.json({ error: "SQL not available" }, 501);
        }

        const [stats] = await rebase.sql(`
            SELECT
                COALESCE(SUM(total) FILTER (WHERE current_period),  0) AS revenue,
                COALESCE(SUM(total) FILTER (WHERE previous_period), 0) AS prev_revenue,
                COUNT(*)            FILTER (WHERE current_period)      AS orders,
                COUNT(*)            FILTER (WHERE previous_period)     AS prev_orders,
                COALESCE(AVG(total) FILTER (WHERE current_period),  0) AS avg_order_value,
                COALESCE(AVG(total) FILTER (WHERE previous_period), 0) AS prev_avg_order_value,
                COUNT(*) FILTER (WHERE current_period  AND status = 'refunded') AS refunded,
                COUNT(*) FILTER (WHERE previous_period AND status = 'refunded') AS prev_refunded
            FROM (
                SELECT
                    total,
                    status,
                    order_date >= now() - interval '30 days' AS current_period,
                    order_date <  now() - interval '30 days' AS previous_period
                FROM orders
                WHERE order_date >= now() - interval '60 days'
            ) windowed
        `);

        const totalRevenue = Number(stats.revenue);
        const totalOrders = Number(stats.orders);
        const avgOrderValue = Number(stats.avg_order_value);
        const refundedOrders = Number(stats.refunded);

        return c.json({
            totalRevenue,
            totalRevenueChange: pctChange(totalRevenue, Number(stats.prev_revenue)),
            totalOrders,
            totalOrdersChange: pctChange(totalOrders, Number(stats.prev_orders)),
            avgOrderValue,
            avgOrderValueChange: pctChange(avgOrderValue, Number(stats.prev_avg_order_value)),
            refundedOrders,
            refundedOrdersChange: pctChange(refundedOrders, Number(stats.prev_refunded))
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
            // Same 30-day window as the home scorecards. A shorter one would
            // read better as a "recent activity" strip, but the demo seeds
            // ~1 order a day — a 7-day window rounds most of these to noise.
            case "orders": {
                const [stats] = await rebase.sql(`
                    SELECT
                        COUNT(*) FILTER (WHERE current_period  AND status = 'confirmed') AS confirmed,
                        COUNT(*) FILTER (WHERE previous_period AND status = 'confirmed') AS prev_confirmed,
                        COUNT(*) FILTER (WHERE current_period  AND status = 'shipped')   AS shipped,
                        COUNT(*) FILTER (WHERE previous_period AND status = 'shipped')   AS prev_shipped,
                        COALESCE(SUM(total) FILTER (WHERE current_period),  0) AS revenue,
                        COALESCE(SUM(total) FILTER (WHERE previous_period), 0) AS prev_revenue
                    FROM (
                        SELECT
                            total,
                            status,
                            order_date >= now() - interval '30 days' AS current_period,
                            order_date <  now() - interval '30 days' AS previous_period
                        FROM orders
                        WHERE order_date >= now() - interval '60 days'
                    ) windowed
                `);

                const confirmed = Number(stats.confirmed);
                const shipped = Number(stats.shipped);
                const revenue = Number(stats.revenue);

                return c.json({
                    confirmed,
                    confirmedChange: pctChange(confirmed, Number(stats.prev_confirmed)),
                    shipped,
                    shippedChange: pctChange(shipped, Number(stats.prev_shipped)),
                    revenue,
                    revenueChange: pctChange(revenue, Number(stats.prev_revenue))
                });
            }

            // Catalog size and open-ticket count are standing totals, not
            // rates — there is no window to compare them against.
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
});
