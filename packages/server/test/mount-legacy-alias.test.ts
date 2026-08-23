/**
 * The alias that keeps a moved surface reachable.
 *
 * Three admin surfaces moved under `/api/admin` so that the shape of a path
 * predicts whether a caller has to be an admin (`docs/api-conventions.md`).
 * `/api/cron`, `/api/logs` and `/api/schema-editor` had shipped, so they stay
 * reachable — and the thing worth testing is not that the old path answers, it
 * is that it answers *identically*, gate included. An alias that served the
 * handler while skipping the gate would be a considerably worse bug than the
 * inconsistency it was introduced to fix.
 */
import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { mountWithLegacyAlias } from "../src/api/mount";

const surface = (): Hono<HonoEnv> => {
    const router = new Hono<HonoEnv>();
    router.get("/thing", (c) => c.json({ ok: true }));
    router.post("/thing", (c) => c.json({ created: true }, 201));
    return router;
};

/** A gate of the shape `applyAdminGate` installs: `use("/*")`, before the routes. */
const gated = (): Hono<HonoEnv> => {
    const router = new Hono<HonoEnv>();
    router.use("/*", async (c, next) => {
        if (c.req.header("authorization") !== "Bearer ok") {
            return c.json({ error: { code: "UNAUTHORIZED", message: "no" } }, 401);
        }
        await next();
    });
    router.route("/", surface());
    return router;
};

const get = (app: Hono<HonoEnv>, path: string, headers: Record<string, string> = {}) =>
    app.fetch(new Request(`http://localhost${path}`, { headers }));

describe("mounting a surface that has moved", () => {
    it("serves the canonical path", async () => {
        const app = new Hono<HonoEnv>();
        mountWithLegacyAlias(app, surface(), {
            canonical: "/api/admin/cron",
            legacy: "/api/cron",
            surface: "Cron"
        });

        const res = await get(app, "/api/admin/cron/thing");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    it("serves the legacy path too, and says it is deprecated", async () => {
        const app = new Hono<HonoEnv>();
        mountWithLegacyAlias(app, surface(), {
            canonical: "/api/admin/cron",
            legacy: "/api/cron",
            surface: "Cron"
        });

        const res = await get(app, "/api/cron/thing");
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        // What makes the old path removable later: an operator can find the
        // callers still on it in their own logs, rather than discovering them
        // when it is gone.
        expect(res.headers.get("Deprecation")).toBe("true");
        expect(res.headers.get("Link")).toBe('</api/admin/cron>; rel="successor-version"');
    });

    it("does not mark the canonical path deprecated", async () => {
        const app = new Hono<HonoEnv>();
        mountWithLegacyAlias(app, surface(), {
            canonical: "/api/admin/cron",
            legacy: "/api/cron",
            surface: "Cron"
        });

        const res = await get(app, "/api/admin/cron/thing");
        expect(res.headers.get("Deprecation")).toBeNull();
    });

    it("carries the gate onto the legacy path", async () => {
        // The failure this exists for: an alias built by re-registering the
        // handlers rather than the gated router would serve an admin surface
        // to anyone who knew the old URL.
        const app = new Hono<HonoEnv>();
        mountWithLegacyAlias(app, gated(), {
            canonical: "/api/admin/logs",
            legacy: "/api/logs",
            surface: "Logs"
        });

        expect((await get(app, "/api/logs/thing")).status).toBe(401);
        expect((await get(app, "/api/admin/logs/thing")).status).toBe(401);

        const authed = await get(app, "/api/logs/thing", { authorization: "Bearer ok" });
        expect(authed.status).toBe(200);
        expect(authed.headers.get("Deprecation")).toBe("true");
    });

    it("keeps every method, not just GET", async () => {
        const app = new Hono<HonoEnv>();
        mountWithLegacyAlias(app, surface(), {
            canonical: "/api/admin/cron",
            legacy: "/api/cron",
            surface: "Cron"
        });

        const res = await app.fetch(new Request("http://localhost/api/cron/thing", { method: "POST" }));
        expect(res.status).toBe(201);
        expect(res.headers.get("Deprecation")).toBe("true");
    });

    it("mounts only the canonical path when there is no legacy one", async () => {
        const app = new Hono<HonoEnv>();
        mountWithLegacyAlias(app, surface(), {
            canonical: "/api/admin/schema",
            surface: "Live schema editing"
        });

        expect((await get(app, "/api/admin/schema/thing")).status).toBe(200);
        expect((await get(app, "/api/schema/thing")).status).toBe(404);
    });
});
