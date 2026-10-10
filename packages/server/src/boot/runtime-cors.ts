import type { MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import type { RebaseCorsOptions } from "./env";

/**
 * Hono's `cors()`, answering only the requests that are CORS preflights.
 *
 * `cors()` answers every `OPTIONS` itself and never calls the route, preflight
 * or not. A plain `OPTIONS` is also a request in its own right: it is how a TUS
 * client asks `/api/storage/tus` for `Tus-Version`, `Tus-Extension` and
 * `Tus-Max-Size`. With `cors()` mounted in front of every route that request
 * got a bare 204 and the TUS handler's `OPTIONS` route was unreachable.
 *
 * A preflight is an `OPTIONS` carrying `Access-Control-Request-Method` — the
 * one header a browser always sends on one. Those are still answered here.
 * Any other `OPTIONS` is handled like a `GET`: `cors()` adds the allow-origin,
 * credentials and exposed headers, then the route answers.
 */
export function runtimeCors(options: RebaseCorsOptions): MiddlewareHandler {
    const middleware = cors(options);
    return async (c, next) => {
        if (c.req.method !== "OPTIONS" || c.req.header("Access-Control-Request-Method") !== undefined) {
            return middleware(c, next);
        }
        // What `cors()` sets on a response that is not a preflight, set here
        // because `cors()` would take this request for one.
        // On `c.res`, as `cors()` does: Hono carries headers set there onto
        // the route's own `Response`, which `c.header()` before `next()` does
        // not reach when the route builds one itself.
        const set = (name: string, value: string) => c.res.headers.set(name, value);
        const allowOrigin = options.origin(c.req.header("origin") || "");
        if (allowOrigin) set("Access-Control-Allow-Origin", allowOrigin);
        if (options.credentials) set("Access-Control-Allow-Credentials", "true");
        if (options.exposeHeaders.length > 0) set("Access-Control-Expose-Headers", options.exposeHeaders.join(","));
        await next();
        c.header("Vary", "Origin", { append: true });
    };
}
