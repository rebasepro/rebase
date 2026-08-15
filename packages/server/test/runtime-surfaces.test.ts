import { describe, expect, it, afterEach } from "@jest/globals";
import { Hono } from "hono";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { ALL_RUNTIME_SURFACES, type RuntimeSurface } from "../src/init/surfaces";

/**
 * Which surfaces a process mounts.
 *
 * The contract these tests defend is not "the gates work" — it is **the default
 * did not move**. A caller that passes no `surfaces` must get the process this
 * server has always booted, because every existing deployment is that caller.
 * So the table below is written out by hand, one probe per mount point, and the
 * first test asserts all of it answers on a stock boot.
 *
 * The second test is the one that catches the likely future mistake. For each
 * surface it boots with that surface off and asserts *exactly* its own probes
 * stopped answering: a mount wired to the wrong surface shows up as a probe that
 * went missing when an unrelated surface was switched off.
 *
 * `expect404` is deliberately the only thing checked. A mounted surface may
 * legitimately answer 200, 401, 403 or 501 depending on how this fixture is
 * configured, and pinning those would make this a test of the gates instead of a
 * test of the mounts.
 */

const CRONS_DIR = path.join(__dirname, "fixtures", "crons");
const FUNCTIONS_DIR = path.join(__dirname, "fixtures", "functions");
const JWT_SECRET = "runtime-surfaces-test-secret-1234567890";

/** One probe per mount point, mapped to the surface that owns it. */
const PROBES: ReadonlyArray<{ surface: RuntimeSurface; url: string; method?: string }> = [
    { surface: "auth", url: "/api/auth/login", method: "POST" },
    { surface: "auth", url: "/.well-known/jwks.json" },
    { surface: "data", url: "/api/data/jobs" },
    { surface: "data", url: "/api/docs" },
    { surface: "storage", url: "/api/storage/files" },
    { surface: "admin", url: "/api/admin/users" },
    { surface: "admin", url: "/api/admin/api-keys" },
    { surface: "admin", url: "/api/admin/backups" },
    { surface: "admin", url: "/api/logs?limit=1" },
    { surface: "admin", url: "/api/schema-editor/status" },
    { surface: "functions", url: "/api/functions" },
    { surface: "functions", url: "/api/functions/valid-app/hello" },
    { surface: "cron", url: "/api/cron" },
    { surface: "meta", url: "/api/meta/schema-version" }
];

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" }
        }
    } as unknown as CollectionConfig;
}

function stubDriver() {
    return {
        fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
        fetchEntity: async () => undefined,
        saveEntity: async () => ({}),
        deleteEntity: async () => undefined,
        countCollection: async () => 0,
        checkUniqueField: async () => true,
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        admin: {
            executeSql: async () => []
        }
    } as never;
}

const bootstrapper: BackendBootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver(): Promise<InitializedDriver> {
        return { driver: stubDriver(), collections: [], internals: {} } as unknown as InitializedDriver;
    },
    async initializeAuth() {
        return { userService: {}, authRepository: {} };
    }
} as unknown as BackendBootstrapper;

type Boot = { app: Hono; stop: () => void };

const started: Boot[] = [];

async function boot(
    surfaces?: Partial<Record<RuntimeSurface, boolean>>,
    functionsSelection?: { only?: string[]; exclude?: string[] }
): Promise<Hono> {
    const app = new Hono();
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("jobs")],
        collectionsDir: path.join(__dirname, "fixtures"),
        cronsDir: CRONS_DIR,
        cronPersistence: false,
        functionsDir: FUNCTIONS_DIR,
        bootstrappers: [bootstrapper],
        auth: { jwtSecret: JWT_SECRET },
        ...(surfaces ? { surfaces } : {}),
        ...(functionsSelection ? { functionsSelection } : {})
    } as never);
    const b: Boot = {
        app,
        stop: () => (backend as { cronScheduler?: { stop?: () => void } }).cronScheduler?.stop?.()
    };
    started.push(b);
    return app;
}

/** Every probe that answered anything other than 404. */
async function mounted(app: Hono): Promise<string[]> {
    const answering: string[] = [];
    for (const probe of PROBES) {
        const res = await app.request(probe.url, { method: probe.method ?? "GET" });
        if (res.status !== 404) answering.push(probe.url);
    }
    return answering;
}

afterEach(() => {
    while (started.length) started.pop()!.stop();
});

describe("runtime surfaces", () => {
    it("mounts every probe when no surfaces are named — the default must not move", async () => {
        const app = await boot();

        expect((await mounted(app)).sort()).toEqual(PROBES.map(p => p.url).sort());
    });

    it("has a probe for every declared surface", async () => {
        // Without this, a surface added later can be introduced with no coverage
        // at all and the suite below still passes — it only ever asserts about
        // the surfaces it already knows.
        const covered = new Set(PROBES.map(p => p.surface));

        expect([...ALL_RUNTIME_SURFACES].filter(s => !covered.has(s))).toEqual([]);
    });

    it.each(ALL_RUNTIME_SURFACES)("drops exactly the %s probes when that surface is off", async (surface) => {
        const app = await boot({ [surface]: false });

        const expected = PROBES.filter(p => p.surface !== surface).map(p => p.url);

        expect((await mounted(app)).sort()).toEqual(expected.sort());
    });

    it("mounts only the selected functions", async () => {
        // The fixture directory holds two loadable functions; ask for one.
        const app = await boot(undefined, { only: ["valid-app"] });

        expect((await app.request("/api/functions/valid-app/hello")).status).not.toBe(404);
        expect((await app.request("/api/functions/valid-factory/hello")).status).toBe(404);

        // The listing has to agree with what is mounted, or a caller reading it
        // is told about a function this process will 404.
        const listed = await (await app.request("/api/functions")).json() as { functions: { name: string }[] };
        expect(listed.functions.map(f => f.name)).toEqual(["valid-app"]);
    });

    it("serves nothing but leaves the process healthy with every surface off", async () => {
        // The shape a `worker` role boots in. It must not throw: the singleton,
        // the drivers and the storage controller are all still built, because
        // cron handlers and job tasks read through them.
        const app = await boot(
            Object.fromEntries(ALL_RUNTIME_SURFACES.map(s => [s, false])) as Record<RuntimeSurface, boolean>
        );

        expect(await mounted(app)).toEqual([]);
    });
});
