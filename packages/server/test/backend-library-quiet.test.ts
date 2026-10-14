import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";

import { createRebaseBackend, initializeRebaseBackend, logger, type HonoEnv, type RebaseBackend } from "../src/index";
import { _resetRebaseMock } from "../src/singleton";

/**
 * A backend built in a script says nothing on stdout; a backend that serves
 * says what it always said.
 *
 * `createRebaseBackend({ …, provision: false })` is what the scripts page
 * sends a script to when it needs more than `openRebase`. Its stdout opened
 * with the boot's info lines — the posture, change capture, the per-boot key,
 * the request log of `backend.fetch`, the shutdown — ahead of the script's own
 * JSON, and its stderr carried a "routes are mounted but DISABLED" warning for
 * eight admin surfaces it never mounted.
 *
 * The lines a build announces are now held until the backend serves (`mount`,
 * a route group, `attachRealtime`, `start`) and written then, in order. A
 * backend that never serves never writes them. Warnings and errors are not
 * held. The warning about a disabled admin surface belongs to the person who
 * mounts it, so it is said when it is mounted.
 */

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

function driver(): DataDriver {
    return {
        fetchCollection: async () => [],
        fetchOne: async () => undefined,
        save: async () => ({}),
        delete: async () => undefined,
        countCollection: async () => 0,
        withAuth: async function (this: DataDriver) { return this; },
        admin: { executeSql: async () => [] }
    } as unknown as DataDriver;
}

/**
 * What a database driver's boot says, from inside the build: a posture line
 * at info, a fact about the database at warn — and, when asked, a failure.
 */
function bootstrapper(options: { fail?: boolean } = {}): BackendBootstrapper {
    return {
        type: "postgres",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            logger.info("POSTURE: requests run as rebase_user");
            await new Promise(resolve => setTimeout(resolve, 1));
            logger.warn("ROLE: the database role has the same name as a schema");
            if (options.fail) throw new Error("the driver could not open");
            return { driver: driver(), collections: undefined, internals: {}, realtimeProvider: {} } as unknown as InitializedDriver;
        },
        getAdmin: () => ({ executeSql: async () => [] })
    } as unknown as BackendBootstrapper;
}

const built: RebaseBackend[] = [];

async function build(extra: Record<string, unknown> = {}): Promise<RebaseBackend> {
    const backend = await createRebaseBackend({
        collections: [collection("widgets")],
        bootstrappers: [bootstrapper()],
        cronPersistence: false,
        provision: false,
        ...extra
    } as never);
    built.push(backend);
    return backend;
}

let stdout: string[];
let stderr: string[];

beforeEach(() => {
    stdout = [];
    stderr = [];
    // Development format: info goes to `console.log` (stdout), warnings to
    // `console.warn` and errors to `console.error` (stderr).
    jest.spyOn(console, "log").mockImplementation((line: unknown) => { stdout.push(String(line)); });
    jest.spyOn(console, "info").mockImplementation((line: unknown) => { stdout.push(String(line)); });
    jest.spyOn(console, "warn").mockImplementation((line: unknown) => { stderr.push(String(line)); });
    jest.spyOn(console, "error").mockImplementation((line: unknown) => { stderr.push(String(line)); });
    delete process.env.LOG_LEVEL;
});

afterEach(async () => {
    while (built.length) await built.pop()!.shutdown(0);
    _resetRebaseMock();
    jest.restoreAllMocks();
    delete process.env.LOG_LEVEL;
});

const DISABLED = /routes are mounted but DISABLED/;

describe("a backend used from a script, never mounted", () => {
    it("writes nothing on stdout: not the build, not backend.fetch, not the shutdown", async () => {
        const backend = await build();
        const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));
        expect(res.status).toBe(200);
        await backend.shutdown(0);
        built.length = 0;

        expect(stdout).toEqual([]);
    });

    it("still says what is wrong: a warning from the build is written, at once", async () => {
        await build();

        expect(stderr.join("\n")).toContain("ROLE: the database role has the same name as a schema");
    });

    it("warns about no route it did not mount", async () => {
        const backend = await build();
        await backend.fetch(new Request("http://local/api/admin/logs"));

        expect(stderr.join("\n")).not.toMatch(DISABLED);
        expect(stderr.join("\n")).not.toMatch(/Contract endpoint disabled/);
    });

    it("says everything at LOG_LEVEL=debug, as it always did", async () => {
        process.env.LOG_LEVEL = "debug";
        await build();

        expect(stdout.join("\n")).toContain("POSTURE: requests run as rebase_user");
    });

    it("writes what the build said when the build fails, so the failure has its context", async () => {
        await expect(createRebaseBackend({
            collections: [collection("widgets")],
            bootstrappers: [bootstrapper({ fail: true })],
            cronPersistence: false,
            provision: false
        } as never)).rejects.toThrow(/could not open/);

        expect(stdout.join("\n")).toContain("POSTURE: requests run as rebase_user");
    });

    it("holds nothing for a backend built while another one serves", async () => {
        // Two backends in one process: the serving one's lines are its own.
        const serving = await build();
        serving.mount(new Hono<HonoEnv>());
        stdout.length = 0;

        await build();
        logger.info("A LINE FROM THE APPLICATION");

        expect(stdout.join("\n")).toContain("A LINE FROM THE APPLICATION");
        expect(stdout.join("\n")).not.toContain("POSTURE");
    });
});

describe("a backend that serves", () => {
    it("mount() writes the build's lines, in the order they were said, before its own", async () => {
        const backend = await build();
        expect(stdout).toEqual([]);

        backend.mount(new Hono<HonoEnv>());

        const posture = stdout.findIndex(line => line.includes("POSTURE"));
        expect(posture).toBeGreaterThanOrEqual(0);
        // The per-boot key line is said later in the build than the posture.
        const serviceKey = stdout.findIndex(line => line.includes("REBASE_SERVICE_KEY"));
        expect(serviceKey).toBeGreaterThan(posture);
        expect(stdout.join("\n")).toContain("Storage not configured");
    });

    it("initializeRebaseBackend boots with the same lines a server always printed", async () => {
        const backend = await initializeRebaseBackend({
            app: new Hono<HonoEnv>() as never,
            server: { close: (done: () => void) => done() } as never,
            collections: [collection("widgets")],
            bootstrappers: [bootstrapper()],
            cronPersistence: false
        } as never);
        built.push(backend);

        const out = stdout.join("\n");
        expect(out).toContain("POSTURE: requests run as rebase_user");
        expect(out).toContain("REBASE_SERVICE_KEY");
        const err = stderr.join("\n");
        for (const surface of ["Schema editor", "Live schema editing", "Cron", "Backup", "RLS audit", "SQL export", "Development mailbox", "Logs"]) {
            expect(err).toContain(`${surface} routes are mounted but DISABLED`);
        }
        expect(err).toMatch(/Contract endpoint disabled/);
    });

    it("writes the build's lines once, however many times it is mounted", async () => {
        const backend = await build();
        backend.mount(new Hono<HonoEnv>());
        backend.mount(new Hono<HonoEnv>(), { basePath: "/v2" });

        expect(stdout.filter(line => line.includes("POSTURE"))).toHaveLength(1);
        expect(stderr.filter(line => line.includes("Cron routes are mounted but DISABLED"))).toHaveLength(1);
    });

    it("a route group mounted alone warns about its own surfaces only", async () => {
        const backend = await build();
        new Hono<HonoEnv>().route("/cron", backend.routes.cron());

        const warned = stderr.filter(line => DISABLED.test(line));
        expect(warned).toEqual([expect.stringContaining("Cron routes are mounted but DISABLED")]);
        // Serving, so what the build said is written now.
        expect(stdout.join("\n")).toContain("POSTURE");
    });

    it("start() alone serves: a worker that mounts nothing still boots out loud", async () => {
        const backend = await build();
        backend.start();

        expect(stdout.join("\n")).toContain("POSTURE");
        expect(stderr.join("\n")).not.toMatch(DISABLED);
    });
});
