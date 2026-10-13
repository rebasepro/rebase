import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";

import {
    createRebaseBackend,
    defineCron,
    defineFunction,
    getDriver,
    getUser,
    realtimeSocketPath,
    type HonoEnv,
    type RebaseBackend
} from "../src/index";
import { CronScheduler } from "../src/cron/cron-scheduler";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { _resetRebaseMock } from "../src/singleton";

/**
 * `createRebaseBackend` and the public pieces `initializeRebaseBackend` is made
 * of, used the way an application would: imported from the package entry, a
 * group mounted on a Hono app of its own, at a path of its own choosing.
 *
 * The contract: building a backend mounts nothing, starts nothing and listens
 * to nothing; every group answers wherever it is mounted, carrying its own auth
 * context; the instance is usable in-process with no HTTP server at all.
 */

const JWT_SECRET = "create-backend-test-secret-0123456789abcdef";

function collection(slug: string, extra: Record<string, unknown> = {}): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } },
        ...extra
    } as unknown as CollectionConfig;
}

type Identity = { uid: string; roles?: string[] };

/** A driver whose scoped clones say who they were scoped for, and which source they came from. */
function scopingDriver(source: string): DataDriver {
    const scoped = (user: Identity | null) => ({
        source,
        scopedFor: user?.uid ?? null,
        fetchCollection: jest.fn(async () => [{ id: "1", source, as: user?.uid ?? null }]),
        fetchOne: jest.fn(async () => undefined),
        save: jest.fn(async () => ({})),
        delete: jest.fn(async () => undefined),
        countCollection: jest.fn(async () => 1)
    });
    return {
        ...scoped(null),
        withAuth: jest.fn(async (user: Identity) => scoped(user) as unknown as DataDriver),
        admin: { executeSql: jest.fn(async () => [{ ok: 1 }]) }
    } as unknown as DataDriver;
}

interface Recorded {
    initConfigs: Record<string, unknown>[];
    schemaCalls: number;
    policyCalls: number;
    websockets: Array<{ path?: string }>;
}

function bootstrapper(rec: Recorded, options: { id?: string; isDefault?: boolean; driver?: DataDriver } = {}): BackendBootstrapper {
    const driver = options.driver ?? scopingDriver(options.id ?? "(default)");
    return {
        type: "postgres",
        id: options.id,
        isDefault: options.isDefault ?? true,
        async initializeDriver(config: unknown): Promise<InitializedDriver> {
            rec.initConfigs.push(config as Record<string, unknown>);
            return { driver, collections: undefined, internals: {}, realtimeProvider: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            // Roles are re-read per request, so the repository answers them.
            const authRepository = { getUserRoleIds: async () => [] };
            return { userService: authRepository, authRepository };
        },
        async ensureCollectionSchema() {
            rec.schemaCalls++;
            return { applied: 0 };
        },
        async ensureCollectionPolicies() {
            rec.policyCalls++;
            return { applied: 0 };
        },
        getAdmin: () => ({ executeSql: async () => [] }),
        async initializeWebsockets(_server: unknown, _rt: unknown, _driver: unknown, _config: unknown, _adapter: unknown, limits?: { path?: string }) {
            rec.websockets.push({ path: limits?.path });
        }
    } as unknown as BackendBootstrapper;
}

const recorder = (): Recorded => ({ initConfigs: [], schemaCalls: 0, policyCalls: 0, websockets: [] });

const whoami = defineFunction((app) => {
    app.get("/", (c) => {
        const driver = getDriver(c) as unknown as { scopedFor?: string | null } | undefined;
        return c.json({ user: getUser(c)?.uid ?? null, driverScopedFor: driver ? driver.scopedFor : "no driver" });
    });
});

const built: RebaseBackend[] = [];

async function create(extra: Record<string, unknown> = {}, rec: Recorded = recorder()) {
    const backend = await createRebaseBackend({
        collections: [collection("widgets")],
        bootstrappers: [bootstrapper(rec)],
        auth: { jwtSecret: JWT_SECRET },
        functions: { whoami },
        cronPersistence: false,
        provision: true,
        ...extra
    } as never);
    built.push(backend);
    return backend;
}

const bearer = async (uid: string, roles: string[] = []) => {
    configureJwt({ secret: JWT_SECRET, accessExpiresIn: "1h" });
    return { headers: { authorization: `Bearer ${await generateAccessToken(uid, roles)}` } };
};

afterEach(async () => {
    while (built.length) await built.pop()!.shutdown(0);
    _resetRebaseMock();
    jest.restoreAllMocks();
});

describe("one group, mounted alone, at a path of the application's choosing", () => {
    it("functions: getUser and getDriver work inside, scoped to the caller", async () => {
        const backend = await create();
        const app = new Hono<HonoEnv>();
        app.route("/hooks", backend.routes.functions());

        const signedIn = await app.request("/hooks/whoami", await bearer("u-42"));
        expect(signedIn.status).toBe(200);
        expect(await signedIn.json()).toEqual({ user: "u-42", driverScopedFor: "u-42" });

        // Functions are public by default (webhooks), and still get a driver —
        // scoped as an anonymous caller, never the owner's.
        const anonymous = await app.request("/hooks/whoami");
        expect(await anonymous.json()).toMatchObject({ user: null });
    });

    it("functions: the listing names the paths the group is actually mounted at", async () => {
        const backend = await create();
        const app = new Hono<HonoEnv>();
        app.route("/v2/hooks", backend.routes.functions());

        const listed = await (await app.request("/v2/hooks", await bearer("u-1"))).json() as { functions: unknown[] };
        expect(listed.functions).toEqual([{ name: "whoami", endpoint: "/v2/hooks/whoami" }]);
    });

    it("data: authenticates, scopes the driver to the caller, and refuses an anonymous one", async () => {
        const backend = await create();
        const app = new Hono<HonoEnv>();
        app.route("/v2/data", backend.routes.data());

        expect((await app.request("/v2/data/widgets")).status).toBe(401);

        const res = await app.request("/v2/data/widgets", await bearer("u-7"));
        expect(res.status).toBe(200);
        const body = await res.json() as { data: Array<{ as: string }> };
        expect(body.data[0].as).toBe("u-7");
    });

    it("data: routes each collection to its own data source under a parameterised mount", async () => {
        const rec = recorder();
        const backend = await createRebaseBackend({
            collections: [collection("widgets"), collection("events", { dataSource: "analytics" })],
            bootstrappers: [
                bootstrapper(rec, { id: "(default)", isDefault: true, driver: scopingDriver("main") }),
                bootstrapper(rec, { id: "analytics", isDefault: false, driver: scopingDriver("analytics") })
            ],
            auth: { jwtSecret: JWT_SECRET },
            provision: true
        } as never);
        built.push(backend);
        const app = new Hono<HonoEnv>();
        app.route("/:tenant/data", backend.routes.data());

        const auth = await bearer("u-1");
        const events = await (await app.request("/acme/data/events", auth)).json() as { data: Array<{ source: string }> };
        const widgets = await (await app.request("/acme/data/widgets", auth)).json() as { data: Array<{ source: string }> };

        // The collection path is read from where the group is mounted, so a
        // prefix the group was never told about still routes by collection.
        expect(events.data[0].source).toBe("analytics");
        expect(widgets.data[0].source).toBe("main");
    });

    it("refuses a group whose surface is off, by name", async () => {
        const backend = await create({ surfaces: { data: false } });
        expect(() => backend.routes.data()).toThrow(/surfaces: \{ data: false \}/);
    });
});

describe("building a backend does nothing on its own", () => {
    it("mounts nothing, starts no timer, and adds no process listener", async () => {
        const listeners = process.listenerCount("unhandledRejection");
        const startCron = jest.spyOn(CronScheduler.prototype, "start");
        const rec = recorder();

        const backend = await create({ crons: { nightly: defineCron({ schedule: "0 3 * * *", handler: async () => undefined }) } }, rec);

        expect(process.listenerCount("unhandledRejection")).toBe(listeners);
        expect(startCron).not.toHaveBeenCalled();
        expect(rec.websockets).toEqual([]);

        backend.start();
        backend.start();
        expect(startCron).toHaveBeenCalledTimes(1);
    });

    it("is usable in-process with no HTTP server: fetch, and the client's native planes", async () => {
        const backend = await create();

        const res = await backend.fetch(new Request("http://local/api/functions/whoami"));
        expect(res.status).toBe(200);

        expect(typeof backend.rebase.dataAsAdmin.collection).toBe("function");
        expect(typeof backend.rebase.sql).toBe("function");
        expect(backend.rebase.email.isConfigured()).toBe(false);
        // The control plane reaches this backend's own routes in-process.
        const invoked = await backend.rebase.functions.invoke<{ user: string | null }>("whoami", undefined, { method: "GET" });
        expect(invoked).toMatchObject({ user: "service" });
    });
});

describe("mount", () => {
    it("lays every group out under the base path, as initializeRebaseBackend does", async () => {
        const backend = await create();
        const app = new Hono<HonoEnv>();
        backend.mount(app, { basePath: "/x/api" });

        expect((await app.request("/x/api/functions/whoami")).status).toBe(200);
        expect((await app.request("/x/api/data/widgets")).status).toBe(401);
        expect((await app.request("/x/api/auth/config")).status).toBe(200);
        // The legacy alias, with its deprecation header.
        const legacy = await app.request("/x/api/cron");
        expect(legacy.headers.get("Deprecation")).toBe("true");
        // An unmatched path under the base answers the JSON envelope.
        const unmatched = await app.request("/x/api/nope");
        expect(unmatched.status).toBe(404);
        expect((await unmatched.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    });
});

describe("attachRealtime", () => {
    it("opens the socket where the SDK dials for the mounted base path", async () => {
        const rec = recorder();
        const backend = await create({}, rec);
        backend.mount(new Hono<HonoEnv>(), { basePath: "/x/api" });

        await backend.attachRealtime({} as never);

        expect(rec.websockets).toEqual([{ path: "/x" }]);
    });

    it("takes an explicit path, and refuses a second attachment", async () => {
        const rec = recorder();
        const backend = await create({}, rec);

        await backend.attachRealtime({} as never, { path: "/live" });

        expect(rec.websockets).toEqual([{ path: "/live" }]);
        await expect(backend.attachRealtime({} as never)).rejects.toThrow(/already attached/);
    });

    it.each([
        [undefined, "/"],
        ["/api", "/"],
        ["/api/", "/"],
        ["/x/api", "/x"],
        ["/v1", "/"]
    ])("derives the socket path for base path %s as %s", (basePath, expected) => {
        expect(realtimeSocketPath(basePath)).toBe(expected);
    });
});

describe("provision", () => {
    it("`true` creates the collection schema and tells the driver it may change the database", async () => {
        const rec = recorder();
        await create({ provision: true }, rec);

        expect(rec.schemaCalls).toBe(1);
        expect(rec.policyCalls).toBe(1);
        expect(rec.initConfigs[0]).toMatchObject({ provision: true, realtime: { provision: true } });
    });

    it("`false` changes nothing: no collection DDL, and the driver opens without provisioning", async () => {
        const rec = recorder();
        await create({ provision: false }, rec);

        expect(rec.schemaCalls).toBe(0);
        expect(rec.policyCalls).toBe(0);
        expect(rec.initConfigs[0]).toMatchObject({ provision: false, realtime: { provision: false } });
    });

    it("a part can be left to another process", async () => {
        const rec = recorder();
        await create({ provision: { collections: false, realtime: false } }, rec);

        expect(rec.schemaCalls).toBe(0);
        expect(rec.initConfigs[0]).toMatchObject({ provision: true, realtime: { provision: false } });
    });

    it("is a decision the caller has to make", async () => {
        await expect(createRebaseBackend({ bootstrappers: [bootstrapper(recorder())] } as never))
            .rejects.toThrow(/needs `provision`/);
    });
});
