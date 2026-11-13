import { defineFunction, requireAuth } from "@rebasepro/server";
/** The longest window a caller may ask for, so one request cannot scan the whole table. */
const MAX_WINDOW_MS = 366 * 86_400_000;
/**
 * The comparison window the admin asks for: the current period is
 * `[from, to)` and the previous one `[previousFrom, from)`.
 *
 * Taken from the request rather than computed here, so the figures describe
 * exactly the window the panel labels them with, and every query of one page
 * load shares the same `to`.
 */
function readWindow(query) {
    const instants = ["previousFrom", "from", "to"].map((name) => new Date(query(name) ?? ""));
    const [previousFrom, from, to] = instants;
    if (instants.some((d) => Number.isNaN(d.getTime())))
        return null;
    if (!(previousFrom < from && from < to))
        return null;
    if (to.getTime() - previousFrom.getTime() > 2 * MAX_WINDOW_MS)
        return null;
    return { previousFrom: previousFrom.toISOString(), from: from.toISOString(), to: to.toISOString() };
}
const WINDOW_REQUIRED = {
    error: "Pass previousFrom, from and to as ISO dates, in that order, with at most a year between each."
};
/**
 * Insights function — the figures and series the admin's KPI tiles and
 * charts draw, aggregated in SQL.
 *
 * Authored with `defineFunction`, which provides a typed `Hono<HonoEnv>`
 * app (so `c.var.user` / `c.var.driver` are typed) and the `rebase`
 * singleton via the injected context — no global import needed.
 *
 * A figure route answers with one record: a windowed figure comes with its
 * `previous*` twin over the window before it, and the tile works out the
 * change. A series route answers with the rows a chart draws.
 */
export default defineFunction((app, { rebase }) => {
    app.use("/*", requireAuth);
    /**
     * GET /api/functions/insights/orders?previousFrom=…&from=…&to=…
     *
     * Every order figure the home page and the Orders collection show, from
     * one query, so the two places cannot disagree.
     */
    app.get("/orders", async (c) => {
        if (!rebase.sql)
            return c.json({ error: "SQL not available" }, 501);
        const range = readWindow((name) => c.req.query(name));
        if (!range)
            return c.json(WINDOW_REQUIRED, 400);
        const [stats] = await rebase.sql(`
            SELECT
                COALESCE(SUM(total) FILTER (WHERE current_period),     0) AS revenue,
                COALESCE(SUM(total) FILTER (WHERE NOT current_period), 0) AS previous_revenue,
                COUNT(*)            FILTER (WHERE current_period)         AS orders,
                COUNT(*)            FILTER (WHERE NOT current_period)     AS previous_orders,
                COALESCE(AVG(total) FILTER (WHERE current_period),     0) AS avg_order_value,
                COALESCE(AVG(total) FILTER (WHERE NOT current_period), 0) AS previous_avg_order_value,
                COUNT(*) FILTER (WHERE current_period     AND status = 'refunded')  AS refunded,
                COUNT(*) FILTER (WHERE NOT current_period AND status = 'refunded')  AS previous_refunded,
                COUNT(*) FILTER (WHERE current_period     AND status = 'confirmed') AS confirmed,
                COUNT(*) FILTER (WHERE NOT current_period AND status = 'confirmed') AS previous_confirmed,
                COUNT(*) FILTER (WHERE current_period     AND status = 'shipped')   AS shipped,
                COUNT(*) FILTER (WHERE NOT current_period AND status = 'shipped')   AS previous_shipped
            FROM (
                SELECT total, status, order_date >= $2::timestamptz AS current_period
                FROM orders
                WHERE order_date >= $1::timestamptz AND order_date < $3::timestamptz
            ) windowed
        `, { params: [range.previousFrom, range.from, range.to] });
        return c.json({
            revenue: Number(stats.revenue),
            previousRevenue: Number(stats.previous_revenue),
            orders: Number(stats.orders),
            previousOrders: Number(stats.previous_orders),
            avgOrderValue: Number(stats.avg_order_value),
            previousAvgOrderValue: Number(stats.previous_avg_order_value),
            refunded: Number(stats.refunded),
            previousRefunded: Number(stats.previous_refunded),
            confirmed: Number(stats.confirmed),
            previousConfirmed: Number(stats.previous_confirmed),
            shipped: Number(stats.shipped),
            previousShipped: Number(stats.previous_shipped)
        });
    });
    /** GET /api/functions/insights/customers?previousFrom=…&from=…&to=… */
    app.get("/customers", async (c) => {
        if (!rebase.sql)
            return c.json({ error: "SQL not available" }, 501);
        const range = readWindow((name) => c.req.query(name));
        if (!range)
            return c.json(WINDOW_REQUIRED, 400);
        const [stats] = await rebase.sql(`
            SELECT
                COUNT(*) FILTER (WHERE created_at >= $2::timestamptz) AS new_customers,
                COUNT(*) FILTER (WHERE created_at <  $2::timestamptz) AS previous_new_customers
            FROM customers
            WHERE created_at >= $1::timestamptz AND created_at < $3::timestamptz
        `, { params: [range.previousFrom, range.from, range.to] });
        return c.json({
            newCustomers: Number(stats.new_customers),
            previousNewCustomers: Number(stats.previous_new_customers)
        });
    });
    /**
     * GET /api/functions/insights/orders/daily?previousFrom=…&from=…&to=…
     *
     * Revenue and order count per UTC day of the current window, every day
     * present (an empty one is zero). The first and last days are clipped to
     * the window, so the days add up to the window's totals above.
     */
    app.get("/orders/daily", async (c) => {
        if (!rebase.sql)
            return c.json({ error: "SQL not available" }, 501);
        const range = readWindow((name) => c.req.query(name));
        if (!range)
            return c.json(WINDOW_REQUIRED, 400);
        const rows = await rebase.sql(`
            SELECT
                to_char(days.day, 'YYYY-MM-DD') AS day,
                COALESCE(SUM(o.total), 0)       AS revenue,
                COUNT(o.order_date)             AS orders
            FROM generate_series(
                date_trunc('day', $1::timestamptz AT TIME ZONE 'UTC'),
                date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC'),
                interval '1 day'
            ) AS days(day)
            LEFT JOIN orders o
                ON o.order_date >= GREATEST(days.day AT TIME ZONE 'UTC', $1::timestamptz)
               AND o.order_date <  LEAST((days.day + interval '1 day') AT TIME ZONE 'UTC', $2::timestamptz)
            GROUP BY days.day
            ORDER BY days.day
        `, { params: [range.from, range.to] });
        return c.json(rows.map((row) => ({
            day: String(row.day),
            revenue: Number(row.revenue),
            orders: Number(row.orders)
        })));
    });
    /** GET /api/functions/insights/orders/status?previousFrom=…&from=…&to=… — orders of the current window per status. */
    app.get("/orders/status", async (c) => {
        if (!rebase.sql)
            return c.json({ error: "SQL not available" }, 501);
        const range = readWindow((name) => c.req.query(name));
        if (!range)
            return c.json(WINDOW_REQUIRED, 400);
        const rows = await rebase.sql(`
            SELECT status, COUNT(*) AS orders
            FROM orders
            WHERE order_date >= $1::timestamptz AND order_date < $2::timestamptz
            GROUP BY status
        `, { params: [range.from, range.to] });
        return c.json(Object.fromEntries(rows.map((row) => [String(row.status), Number(row.orders)])));
    });
    /**
     * GET /api/functions/insights/products/top?previousFrom=…&from=…&to=…
     *
     * The five products with the most revenue from the current window's
     * orders. A line whose product was deleted is grouped under its name.
     */
    app.get("/products/top", async (c) => {
        if (!rebase.sql)
            return c.json({ error: "SQL not available" }, 501);
        const range = readWindow((name) => c.req.query(name));
        if (!range)
            return c.json(WINDOW_REQUIRED, 400);
        const rows = await rebase.sql(`
            SELECT
                p.id                               AS id,
                COALESCE(p.name, oi.product_name)  AS name,
                COALESCE(SUM(oi.line_total), 0)    AS revenue
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE o.order_date >= $1::timestamptz AND o.order_date < $2::timestamptz
            GROUP BY p.id, COALESCE(p.name, oi.product_name)
            ORDER BY revenue DESC
            LIMIT 5
        `, { params: [range.from, range.to] });
        return c.json(rows.map((row) => ({
            id: row.id === null ? null : String(row.id),
            name: String(row.name ?? ""),
            revenue: Number(row.revenue)
        })));
    });
    // Catalog size and open-ticket count are standing totals, not rates —
    // there is no window to compare them against.
    /** GET /api/functions/insights/products */
    app.get("/products", async (c) => {
        if (!rebase.sql)
            return c.json({ error: "SQL not available" }, 501);
        const [stats] = await rebase.sql("SELECT COUNT(*) AS total FROM products");
        return c.json({ total: Number(stats.total) });
    });
    /** GET /api/functions/insights/tickets */
    app.get("/tickets", async (c) => {
        if (!rebase.sql)
            return c.json({ error: "SQL not available" }, 501);
        const [stats] = await rebase.sql("SELECT COUNT(*) FILTER (WHERE status = 'open') AS open FROM tickets");
        return c.json({ open: Number(stats.open) });
    });
    /** GET /api/functions/insights/tickets/priority — open tickets per priority. */
    app.get("/tickets/priority", async (c) => {
        if (!rebase.sql)
            return c.json({ error: "SQL not available" }, 501);
        const rows = await rebase.sql("SELECT priority, COUNT(*) AS open FROM tickets WHERE status = 'open' GROUP BY priority");
        return c.json(Object.fromEntries(rows.map((row) => [String(row.priority), Number(row.open)])));
    });
});
