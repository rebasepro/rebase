/**
 * Simulating `anon` simulates no session, as a real anonymous request has.
 *
 * `applySimulation` put `{ uid: <anonymous>, roles: ["anon"] }` in `user`, where
 * a real anonymous request has no `user` at all. So every API-level check took
 * the simulated anonymous caller for a signed-in one: a custom function guarded
 * by `requireAuth` answered 200 where a real anonymous caller gets 401, and
 * `callerScopes` gave it the data plane and every app scope where a real one
 * holds none — the simulator over-reported what anonymous callers can reach.
 *
 * The data API's own `requireAuth` gate still lets a simulated anonymous
 * request past (documented): the answer is what the rows' policies give an
 * anonymous caller, and a 401 would send the admin panel to refresh a session
 * that is fine.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { Hono } from "hono";
import type { AuthAdapter, AuthenticatedUser, DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { requireAuth } from "../src/functions/guards";
import { getUser } from "../src/functions/context";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const admin = { uid: "admin-1", roles: ["admin"], isAdmin: true } as AuthenticatedUser;
const adapter = {
    id: "fake",
    verifyRequest: async (req: Request) => (req.headers.get("authorization") === "Bearer admin-token" ? admin : null),
    resolveUser: async (uid: string) => (uid === admin.uid ? admin : null)
} as unknown as AuthAdapter;

function build(enforceAuth: boolean) {
    const scopedFor: unknown[] = [];
    const driver = {
        key: "d",
        initialised: true,
        withAuth: async (identity: unknown) => { scopedFor.push(identity); return driver; }
    } as unknown as DataDriver;
    const app = new Hono<HonoEnv>();
    app.use("/*", createAdapterAuthMiddleware({ adapter, driver, requireAuth: enforceAuth }));
    app.get("/guarded", requireAuth, (c) => c.json({ uid: getUser(c)?.uid }));
    app.get("/open", (c) => c.json({ user: getUser(c)?.uid ?? null }));
    return { app, scopedFor };
}

const SIMULATE_ANON = { Authorization: "Bearer admin-token", "x-rebase-simulate-role": "anon" };

describe("a simulated anonymous caller", () => {
    it("is refused by a function's requireAuth, as a real anonymous caller is", async () => {
        const { app } = build(false);
        expect((await app.request("/guarded")).status).toBe(401);
        expect((await app.request("/guarded", { headers: SIMULATE_ANON })).status).toBe(401);
    });

    it("has no user, and its driver is scoped as anonymous", async () => {
        const { app, scopedFor } = build(false);
        const res = await app.request("/open", { headers: SIMULATE_ANON });
        expect(await res.json()).toEqual({ user: null });
        expect(scopedFor.at(-1)).toMatchObject({ roles: ["anon"] });
    });

    it("is still let past the data API's requireAuth gate, to see what the rows' policies give it", async () => {
        const { app } = build(true);
        expect((await app.request("/open")).status).toBe(401);
        expect((await app.request("/open", { headers: SIMULATE_ANON })).status).toBe(200);
    });
});
