/**
 * Behaviour of the portable authoring surface.
 *
 * `portability.test.ts` proves these modules *can* run anywhere. This one
 * proves they do the right thing when they do — driven through a real Hono app,
 * because every one of them is defined by what it reads off a request context
 * that some other middleware populated, and a unit test with a hand-built fake
 * context would be testing the fake.
 */
import { Hono } from "hono";
import type { HonoEnv } from "../api/types";
import {
    getUser,
    getUserId,
    getRoles,
    hasRole,
    isAdmin,
    isAuthenticated,
    getDriver,
    requireDriver,
    getRequestId,
    identityResolved,
    requireAuth,
    requireAdmin,
    requireRole,
    getEnv,
    env,
    requireEnv,
    runtimeKey,
    isNodeRuntime,
    lazyResource,
    waitUntil
} from "./index";
import { pendingBackgroundWork, drainBackgroundWork, _resetBackgroundWork } from "./wait-until";

/**
 * Stand-in for what the auth middleware leaves behind. Deliberately mimics the
 * real shapes — including the ones that motivated `getUser`'s narrowing.
 */
type Identity = Record<string, unknown> | undefined;

function appWith(identity: Identity, opts: { driver?: unknown; requestId?: string } = {}) {
    const app = new Hono<HonoEnv>();
    app.use("/*", async (c, next) => {
        if (identity !== undefined) c.set("user", identity as never);
        if (opts.driver !== undefined) c.set("driver", opts.driver as never);
        if (opts.requestId) c.set("requestId", opts.requestId);
        return next();
    });
    return app;
}

describe("identity accessors", () => {
    it("narrows the resolved identity to uid + roles", async () => {
        const app = appWith({ uid: "u1", roles: ["editor"], email: "a@b.c", org: 7 });
        app.get("/", c => c.json({
            user: getUser(c),
            uid: getUserId(c),
            roles: getRoles(c),
            authed: isAuthenticated(c)
        }));

        const body = await (await app.request("/")).json();
        expect(body.uid).toBe("u1");
        expect(body.roles).toEqual(["editor"]);
        expect(body.authed).toBe(true);
        // Extra claims survive — that is what the index signature is for.
        expect(body.user.email).toBe("a@b.c");
        expect(body.user.org).toBe(7);
    });

    it("reports an anonymous request as undefined, not as an empty user", async () => {
        const app = appWith(undefined, { driver: {} });
        app.get("/", c => c.json({
            user: getUser(c) ?? null,
            roles: getRoles(c),
            authed: isAuthenticated(c)
        }));

        const body = await (await app.request("/")).json();
        expect(body.user).toBeNull();
        // Never undefined: a caller writing `getRoles(c).includes(...)` should
        // not have to null-check first.
        expect(body.roles).toEqual([]);
        expect(body.authed).toBe(false);
    });

    it("accepts the older `userId` spelling a custom validator may set", async () => {
        const app = appWith({ userId: "legacy", roles: ["viewer"] });
        app.get("/", c => c.json({ uid: getUserId(c) }));
        expect((await (await app.request("/")).json()).uid).toBe("legacy");
    });

    it("treats a non-object identity as anonymous rather than throwing", async () => {
        // `AuthResult` genuinely includes `boolean`. A guard that threw here
        // would turn an odd auth result into a 500 instead of a 401.
        const app = new Hono<HonoEnv>();
        app.use("/*", async (c, next) => {
            c.set("user", true as never);
            return next();
        });
        app.get("/", c => c.json({ user: getUser(c) ?? null }));
        expect((await (await app.request("/")).json()).user).toBeNull();
    });

    it("drops non-string entries out of roles", async () => {
        const app = appWith({ uid: "u1", roles: ["admin", 42, null] });
        app.get("/", c => c.json({ roles: getRoles(c), admin: isAdmin(c) }));
        const body = await (await app.request("/")).json();
        expect(body.roles).toEqual(["admin"]);
        expect(body.admin).toBe(true);
    });

    it("counts schema-admin as administrative, matching auth/admin-roles", async () => {
        const app = appWith({ uid: "u1", roles: ["schema-admin"] });
        app.get("/", c => c.json({ admin: isAdmin(c), hasEditor: hasRole(c, "editor", "schema-admin") }));
        const body = await (await app.request("/")).json();
        expect(body.admin).toBe(true);
        expect(body.hasEditor).toBe(true);
    });

    it("hasRole with no roles named is false, not vacuously true", async () => {
        const app = appWith({ uid: "u1", roles: ["admin"] });
        app.get("/", c => c.json({ any: hasRole(c) }));
        expect((await (await app.request("/")).json()).any).toBe(false);
    });

    it("exposes the driver and the request id the middleware set", async () => {
        const driver = { key: "test-driver" };
        const app = appWith({ uid: "u1" }, { driver, requestId: "req-9" });
        app.get("/", c => c.json({
            driver: (getDriver(c) as { key: string }).key,
            required: (requireDriver(c) as unknown as { key: string }).key,
            requestId: getRequestId(c)
        }));
        const body = await (await app.request("/")).json();
        expect(body.driver).toBe("test-driver");
        expect(body.required).toBe("test-driver");
        expect(body.requestId).toBe("req-9");
    });

    it("requireDriver names the wiring problem instead of failing later", async () => {
        const app = new Hono<HonoEnv>();
        app.get("/", c => {
            expect(() => requireDriver(c)).toThrow(/mounted outside the functions router/);
            return c.text("ok");
        });
        expect((await app.request("/")).status).toBe(200);
    });

    it("identityResolved distinguishes anonymous from unmounted", async () => {
        const anonymous = appWith(undefined, { driver: {} });
        anonymous.get("/", c => c.json({ resolved: identityResolved(c) }));
        expect((await (await anonymous.request("/")).json()).resolved).toBe(true);

        const bare = new Hono<HonoEnv>();
        bare.get("/", c => c.json({ resolved: identityResolved(c) }));
        expect((await (await bare.request("/")).json()).resolved).toBe(false);
    });
});

describe("route guards", () => {
    it("requireAuth admits a signed-in caller and refuses an anonymous one", async () => {
        const signedIn = appWith({ uid: "u1", roles: [] });
        signedIn.get("/", requireAuth, c => c.text("ok"));
        expect((await signedIn.request("/")).status).toBe(200);

        const anonymous = appWith(undefined, { driver: {} });
        anonymous.get("/", requireAuth, c => c.text("ok"));
        const refused = await anonymous.request("/");
        expect(refused.status).toBe(401);
        expect((await refused.json()).error.code).toBe("UNAUTHORIZED");
    });

    it("answers 500, not 401, when no auth middleware ran at all", async () => {
        // The distinction matters: 401 sends whoever is debugging to look at
        // the caller's token, and the token was never the problem.
        const bare = new Hono<HonoEnv>();
        bare.get("/", requireAuth, c => c.text("ok"));
        const response = await bare.request("/");
        expect(response.status).toBe(500);
        expect((await response.json()).error.code).toBe("AUTH_MIDDLEWARE_MISSING");
    });

    it("requireAdmin separates 401 from 403", async () => {
        const anonymous = appWith(undefined, { driver: {} });
        anonymous.get("/", requireAdmin, c => c.text("ok"));
        expect((await anonymous.request("/")).status).toBe(401);

        const plain = appWith({ uid: "u1", roles: ["editor"] });
        plain.get("/", requireAdmin, c => c.text("ok"));
        const forbidden = await plain.request("/");
        expect(forbidden.status).toBe(403);
        expect((await forbidden.json()).error.code).toBe("FORBIDDEN");

        const admin = appWith({ uid: "u1", roles: ["admin"] });
        admin.get("/", requireAdmin, c => c.text("ok"));
        expect((await admin.request("/")).status).toBe(200);
    });

    it("requireRole admits any of the named roles", async () => {
        const app = appWith({ uid: "u1", roles: ["editor"] });
        app.get("/", requireRole("admin", "editor"), c => c.text("ok"));
        expect((await app.request("/")).status).toBe(200);

        const other = appWith({ uid: "u2", roles: ["viewer"] });
        other.get("/", requireRole("admin", "editor"), c => c.text("ok"));
        const refused = await other.request("/");
        expect(refused.status).toBe(403);
        expect((await refused.json()).error.message).toContain("admin, editor");
    });

    it("requireRole() with no roles throws at wiring time, not request time", () => {
        // An empty list would read as a restriction while admitting everyone,
        // and it would do so silently for as long as the file existed.
        expect(() => requireRole()).toThrow(/at least one role/);
    });
});

describe("configuration", () => {
    // A fresh app per test: Hono builds its matcher on first request and
    // refuses routes added afterwards.
    it("reads the host's environment through the context", async () => {
        const app = new Hono<HonoEnv>();
        process.env.REBASE_TEST_PORTABLE = "  spaced  ";
        process.env.REBASE_TEST_BLANK = "   ";
        try {
            app.get("/env", c => c.json({
                value: env(c, "REBASE_TEST_PORTABLE"),
                blank: env(c, "REBASE_TEST_BLANK") ?? null,
                missing: env(c, "REBASE_TEST_ABSENT") ?? null,
                present: "REBASE_TEST_PORTABLE" in getEnv(c)
            }));
            const body = await (await app.request("/env")).json();
            // Trimmed, because a value with surrounding whitespace is a
            // deployment typo every time.
            expect(body.value).toBe("spaced");
            // Blank means unset. `Number("")` being 0 is how the functions
            // timeout ceiling got switched off silently once already.
            expect(body.blank).toBeNull();
            expect(body.missing).toBeNull();
            expect(body.present).toBe(true);
        } finally {
            delete process.env.REBASE_TEST_PORTABLE;
            delete process.env.REBASE_TEST_BLANK;
        }
    });

    it("requireEnv names the variable it wanted", async () => {
        const app = new Hono<HonoEnv>();
        app.get("/required", c => {
            expect(() => requireEnv(c, "REBASE_TEST_DEFINITELY_ABSENT"))
                .toThrow(/REBASE_TEST_DEFINITELY_ABSENT/);
            return c.text("ok");
        });
        expect((await app.request("/required")).status).toBe(200);
    });

    it("identifies the runtime", () => {
        expect(runtimeKey()).toBe("node");
        expect(isNodeRuntime()).toBe(true);
    });

    it("lazyResource builds once per environment, on first request", async () => {
        let built = 0;
        const resource = lazyResource(() => {
            built += 1;
            return { id: built };
        });

        // Nothing has run yet: the whole point is that construction is deferred
        // past module evaluation, when a host may have no configuration to give.
        expect(built).toBe(0);

        const lazyApp = new Hono<HonoEnv>();
        lazyApp.get("/", c => c.json(resource(c) as { id: number }));

        expect((await (await lazyApp.request("/")).json()).id).toBe(1);
        expect((await (await lazyApp.request("/")).json()).id).toBe(1);
        expect(built).toBe(1);
    });
});

describe("waitUntil", () => {
    // Two of these deliberately fail their background work, and the framework
    // logging it is the correct behaviour under test — but it is also a wall of
    // stack trace in the run output, which trains people to ignore the run
    // output.
    let consoleError: jest.SpyInstance;
    beforeEach(() => {
        _resetBackgroundWork();
        consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => consoleError.mockRestore());

    it("does not delay the response", async () => {
        let finished = false;
        let release: () => void = () => undefined;
        const slow = new Promise<void>(resolve => {
            release = () => {
                finished = true;
                resolve();
            };
        });

        const app = new Hono<HonoEnv>();
        app.get("/", c => {
            waitUntil(c, slow);
            return c.text("sent");
        });

        const response = await app.request("/");
        expect(await response.text()).toBe("sent");
        expect(finished).toBe(false);
        expect(pendingBackgroundWork()).toBe(1);

        release();
        expect(await drainBackgroundWork(1000)).toBe(0);
    });

    it("accepts a thunk, so the natural spelling is not a silent no-op", async () => {
        let ran = false;
        const app = new Hono<HonoEnv>();
        app.get("/", c => {
            waitUntil(c, () => {
                ran = true;
                return Promise.resolve();
            });
            return c.text("ok");
        });

        await app.request("/");
        await drainBackgroundWork(1000);
        expect(ran).toBe(true);
    });

    it("swallows and logs a rejection instead of failing the request", async () => {
        const app = new Hono<HonoEnv>();
        app.get("/", c => {
            waitUntil(c, Promise.reject(new Error("webhook refused")));
            return c.text("ok");
        });

        const response = await app.request("/");
        expect(response.status).toBe(200);
        expect(await drainBackgroundWork(1000)).toBe(0);
        // Swallowed, but not silently: a dropped webhook with no log line is
        // indistinguishable from one that was never attempted.
        expect(consoleError).toHaveBeenCalled();
        expect(String(consoleError.mock.calls[0][0])).toContain("webhook refused");
    });

    it("survives a thunk that throws synchronously", async () => {
        const app = new Hono<HonoEnv>();
        app.get("/", c => {
            waitUntil(c, () => {
                throw new Error("bad setup");
            });
            return c.text("ok");
        });
        expect((await app.request("/")).status).toBe(200);
    });

    it("hands the promise to the host's execution context when there is one", async () => {
        // What an isolate host does with it: this is the call that keeps the
        // isolate alive past the response, and its absence is the whole bug
        // this primitive exists to prevent.
        const seen: Promise<unknown>[] = [];
        const app = new Hono<HonoEnv>();
        app.get("/", c => {
            waitUntil(c, Promise.resolve("done"));
            return c.text("ok");
        });

        await app.fetch(new Request("http://local/"), {}, {
            waitUntil: (p: Promise<unknown>) => { seen.push(p); },
            passThroughOnException: () => undefined
        } as never);

        expect(seen).toHaveLength(1);
        await drainBackgroundWork(1000);
    });

    it("drainBackgroundWork reports what it could not wait for", async () => {
        const app = new Hono<HonoEnv>();
        app.get("/", c => {
            // Never settles: exactly the case a shutdown budget exists for.
            waitUntil(c, new Promise(() => undefined));
            return c.text("ok");
        });

        await app.request("/");
        expect(await drainBackgroundWork(20)).toBe(1);
        _resetBackgroundWork();
    });
});
