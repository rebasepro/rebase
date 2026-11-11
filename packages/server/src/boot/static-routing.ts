import type { Env, Hono, MiddlewareHandler } from "hono";
import { compareStaticRoutes, matchStaticRoute, type RebaseStaticRoute } from "@rebasepro/types";
import { isUnderPath, nestedAppPaths, type StaticAppRequest } from "../serve-spa";
import { compareStaticApps, type LoadedStaticApp } from "./bundle";
import { staticAppCsp } from "./security-headers";

/**
 * A request's hostname in the form an app's `host` is written in: lowercase,
 * with no port and no trailing dot.
 *
 * All three are ways of naming the same host that a browser, a proxy or a
 * person with curl will send. `Admin.Example.com`, `admin.example.com:443` and
 * the fully-qualified `admin.example.com.` are one site, and an app that
 * answered only the first spelling would be down for whoever typed another.
 *
 * An IPv6 literal comes back as it arrived: its colons are not a port, and no
 * app is ever given one, so all it has to do here is not be mangled into
 * something that could match.
 */
export function normalizeRequestHost(host: string): string {
    const lower = host.trim().toLowerCase();
    if (lower.startsWith("[")) return lower;
    return lower.replace(/:\d*$/, "").replace(/\.$/, "");
}

/**
 * Which static app answers a request: the one rule, written once.
 *
 * An app is a candidate when it names no hostname or names this one, and the
 * path is under its own. Of the candidates, the longest path wins, and at an
 * equal path the app with a hostname beats the one without — which is
 * {@link compareStaticApps}, so the first candidate in that order is the winner.
 * `undefined` when no app claims the request, and then no app answers it.
 *
 * The CLI and the control plane order apps by the same rule, so the app a
 * deploy says is at an address is the app that answers there.
 */
export function createStaticAppResolver(
    apps: readonly LoadedStaticApp[]
): (request: StaticAppRequest) => LoadedStaticApp | undefined {
    const ordered = [...apps].sort(compareStaticApps);
    return ({ host, path }) => {
        const hostname = normalizeRequestHost(host);
        return ordered.find(app =>
            (app.host === undefined || app.host === hostname) && isUnderPath(path, app.path)
        );
    };
}

/**
 * The static apps that sit under the API's base path, and so are never served.
 *
 * The API's routes are mounted first and every app's fallback declines the API
 * base path, so an app at or under it answers nothing. The reserved-path rule
 * the CLI applies names the default `/api`; only the runtime knows
 * `REBASE_BASE_PATH`, so a moved API is checked here.
 */
export function staticAppsShadowedByApi(
    apps: readonly LoadedStaticApp[],
    apiBasePath: string
): LoadedStaticApp[] {
    const base = apiBasePath.replace(/\/+$/, "");
    if (base === "") return [];
    return apps.filter(app => isUnderPath(app.path.replace(/\/+$/, "") || "/", base));
}

/** How one static app is mounted: what `serveSPA` needs beyond its own build. */
export interface StaticAppMount {
    app: LoadedStaticApp;
    /** Sibling paths the app's SPA fallback must decline — the path-only rule. */
    siblingPaths: string[];
    /** Present when apps are told apart by hostname; see `ServeSPAConfig.owns`. */
    owns?: (request: StaticAppRequest) => boolean;
}

/**
 * Decide how each static app is mounted, in the order given.
 *
 * Two rules, chosen by whether any app names a hostname.
 *
 * **None does:** every app declines the paths of the apps nested beneath it
 * (`nestedAppPaths`), exactly as a bundle has always been served. Not the
 * resolver, even though it would agree on every ordinary request: in the
 * corner it disagrees — a file in the root app's build under a sibling's
 * prefix — those bundles are already deployed. A bundle that never mentions
 * a hostname gets byte-for-byte what it got before hostnames existed.
 *
 * **Any does:** a path cannot say which app a request belongs to any more.
 * Two apps can both sit at "/", and a host-less site must still answer
 * `/cms` on its own domain while an admin on another hostname owns `/cms`
 * there — excluding "/cms" by path would 404 the site's. So every mount asks
 * the one resolver instead, and declines whatever another app wins.
 */
export function planStaticAppMounts(apps: readonly LoadedStaticApp[]): StaticAppMount[] {
    if (!apps.some(app => app.host !== undefined)) {
        return apps.map(app => ({
            app,
            siblingPaths: nestedAppPaths(app.path, apps
                .filter(other => other !== app)
                .map(other => other.path))
        }));
    }

    const resolve = createStaticAppResolver(apps);
    return apps.map(app => ({
        app,
        siblingPaths: [],
        owns: request => resolve(request) === app
    }));
}

/** A request one of a static app's routes hands to a custom function. */
export interface StaticRouteMatch {
    /** The app that owns the request, whose route matched. */
    app: LoadedStaticApp;
    route: RebaseStaticRoute;
    /**
     * The function's own URL path: `<api>/functions/<name>`, then whatever a
     * wildcard matched beneath its prefix.
     */
    functionPath: string;
}

/**
 * Which static app route answers a request, if any: the one rule, written once.
 *
 * A route applies only where its app is the one that answers the request — by
 * {@link createStaticAppResolver}, the rule every mount asks — so a route on
 * the site at `/` does not reach a request another app owns, on its hostname
 * or under its path. Of that app's routes the most specific wins
 * (`compareStaticRoutes`).
 *
 * Nothing under the API's base path is ever routed. The CLI keeps routes off
 * `/api`, but only the runtime knows `REBASE_BASE_PATH`, and a route over the
 * moved API would hand the function's own URL back to the route that made it.
 *
 * `undefined` when no app declares a route, so a bundle without any installs
 * nothing at all.
 */
export function createStaticRouteResolver(
    apps: readonly LoadedStaticApp[],
    apiBasePath: string
): ((request: StaticAppRequest) => StaticRouteMatch | undefined) | undefined {
    if (!apps.some(app => app.routes?.length)) return undefined;
    const owner = createStaticAppResolver(apps);
    const ordered = new Map(apps.map(app => [app, [...(app.routes ?? [])].sort(compareStaticRoutes)]));
    // The base the functions group is mounted under, as `mount()` reads it.
    const apiBase = (apiBasePath || "/api").replace(/\/+$/, "") || "/api";
    return (request) => {
        if (isUnderPath(request.path, apiBase)) return undefined;
        const app = owner(request);
        if (!app) return undefined;
        for (const route of ordered.get(app) ?? []) {
            const rest = matchStaticRoute(route, request.path);
            if (rest !== undefined) {
                return { app, route, functionPath: `${apiBase}/functions/${route.function}${rest}` };
            }
        }
        return undefined;
    };
}

/**
 * The routes of each static app that sit under the API's base path, and so are
 * never served — the routes' half of {@link staticAppsShadowedByApi}.
 */
export function staticRoutesShadowedByApi(
    apps: readonly LoadedStaticApp[],
    apiBasePath: string
): Array<{ app: LoadedStaticApp; route: RebaseStaticRoute }> {
    const base = apiBasePath.replace(/\/+$/, "");
    if (base === "") return [];
    return apps.flatMap(app => (app.routes ?? [])
        .filter(route => isUnderPath(route.path.endsWith("/*") ? route.path.slice(0, -2) || "/" : route.path, base))
        .map(route => ({ app, route })));
}

/**
 * Serve static app routes: a request a route matches is dispatched again into
 * `app` as a request for the function's own URL, and its response is the
 * answer.
 *
 * Installed first on the app, before CORS, security headers and metrics, and
 * it answers without calling `next` — so the request passes through every one
 * of them exactly once, as the function's request, and meets the functions
 * group with everything the group expects in front of it: the body limit,
 * CSRF, auth, the scope guard, the rate limit and the function timeout. A
 * forwarder to a functions process answers it as it would answer the
 * function's URL.
 *
 * The request keeps its method, headers (`Host` among them), body, query and
 * the connection it arrived on; only the path changes. The response is the
 * function's, with one header added when it has none: the owning app's
 * Content-Security-Policy, so a routed page can be framed by the origins the
 * app allows and no others.
 */
export function serveStaticAppRoutes<E extends Env>(
    app: Hono<E>,
    resolve: (request: StaticAppRequest) => StaticRouteMatch | undefined
): MiddlewareHandler<E> {
    // One policy per app, built on its first routed request. Its origins were
    // checked when the bundle was loaded.
    const policies = new Map<LoadedStaticApp, string>();
    return async (c, next) => {
        const match = resolve({
            host: c.req.header("host") ?? new URL(c.req.url).host,
            path: c.req.path
        });
        if (!match) return next();

        const url = new URL(c.req.url);
        url.pathname = match.functionPath;
        const method = c.req.method;
        const raw = c.req.raw;
        // `duplex` is undici's, required whenever the body is a stream; the
        // DOM's `RequestInit` does not declare it.
        const init: RequestInit & { duplex: "half" } = {
            method,
            headers: raw.headers,
            body: method === "GET" || method === "HEAD" ? undefined : raw.body,
            duplex: "half",
            redirect: "manual",
            signal: raw.signal
        };
        const response = await app.fetch(new Request(url, init), c.env);
        if (response.headers.has("content-security-policy")) return response;

        let policy = policies.get(match.app);
        if (policy === undefined) {
            policy = staticAppCsp(match.app.frameAncestors);
            policies.set(match.app, policy);
        }
        const headers = new Headers(response.headers);
        headers.set("Content-Security-Policy", policy);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    };
}
