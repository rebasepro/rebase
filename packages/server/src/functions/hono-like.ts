/**
 * Duck-type check for Hono apps.
 *
 * Not `instanceof Hono`: a project's own `hono` and the copy this package
 * resolves are often different installs, which do not share a prototype, so
 * `instanceof` answers false for a perfectly good app. Every Hono instance has
 * `.fetch()` and `.routes`.
 *
 * Node-free: `defineFunction` uses it, and it is exported from the portable
 * `@rebasepro/server/functions` entry point.
 */
export function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
