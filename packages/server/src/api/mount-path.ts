import type { Context, MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { HonoEnv } from "./types";

/**
 * Where a route group is mounted, read from the request rather than configured.
 *
 * A group — the data API, the functions router — is a Hono sub-app a caller can
 * mount anywhere: `/api/data`, `/v2/data`, `/:tenant/data`. A few of its
 * decisions need that prefix (which collection a path names, which function a
 * scoped key is calling, what URL the listing reports), and it used to be passed
 * in as `${basePath}/data` when the group was built — which pinned the group to
 * the one path its builder assumed.
 *
 * Hono already knows: a middleware registered at the root of a group with
 * `use("/*")` is stored under the merged path `<mount>/*`, however deeply the
 * group was nested, and `routePath(c)` returns the path of the handler running
 * now. Must therefore be called from such a middleware — see
 * {@link recordMountPath}, which is how a group does it.
 *
 * A mount path with parameters (`/:tenant/data`) is resolved against the request
 * segment by segment, so the answer is the concrete prefix (`/acme/data`).
 */
export function requestMountPath(c: Context): string {
    const pattern = routePath(c).replace(/\/?\*$/, "");
    if (!/[:*{]/.test(pattern)) return pattern;
    const depth = pattern.split("/").filter(Boolean).length;
    const segments = c.req.path.split("/").filter(Boolean).slice(0, depth);
    return `/${segments.join("/")}`;
}

/**
 * A group's first middleware: record where the group is mounted as
 * `c.var.mountPath`, for everything after it in the same request.
 *
 * Registered with `use("/*")` on the group's own router, before anything else —
 * that registration is what makes {@link requestMountPath} see the mount.
 */
export function recordMountPath(): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        c.set("mountPath", requestMountPath(c));
        return next();
    };
}
