import { isUnderPath, nestedAppPaths, type StaticAppRequest } from "../serve-spa";
import { compareStaticApps, type LoadedStaticApp } from "./bundle";

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
