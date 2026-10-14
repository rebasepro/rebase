/**
 * `rebase dev`'s start-up order: what waits for what, and what no longer does.
 *
 * The database used to start only after both generators had finished, and the
 * resource-graph derivation in front of it evaluated every collection again —
 * about a second of a cold start spent waiting on work that reads none of what
 * the generators write. These hold the overlap in place, and hold the one wait
 * that must stay: the `--docker` preflight pushes the schema the generators
 * have just written.
 */
import { EventEmitter } from "events";
import fs from "fs";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreparedDatabase } from "../dev-db/prepare";

/** A promise and the two levers that settle it. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Let every queued microtask and timer-free continuation run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

let scratch: string;
let frontendDir: string | null = null;
/** Ports the loopback probe finds something listening on. */
const busyPorts = new Set<number>();
let generation = deferred<void>();
type PrepareCall = { additionalKeys?: readonly string[]; followLastDev?: boolean };
const prepareDatabaseEnv = vi.fn<(root: string, options: PrepareCall) => Promise<PreparedDatabase>>();
const runDriverSchemaCommand = vi.fn<(argv: string[], options?: { quiet?: boolean }) => Promise<void>>();
/** The DSN each `--docker` preflight decided from. */
const preflightUrls: Array<string | undefined> = [];
/** Whether each preflight was told to start nothing. */
const preflightDisabled: boolean[] = [];

vi.mock("../utils/project", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/project")>();
    return {
        ...actual,
        requireProjectRoot: () => scratch,
        findBackendDir: () => path.join(scratch, "backend"),
        findFrontendDir: () => frontendDir,
        findEnvFile: () => null,
        resolveTsx: () => "/bin/true",
        validateTsxInstallation: () => null,
        getActiveBackendPlugin: () => null
    };
});

vi.mock("./db", () => ({
    runDriverSchemaCommand: (argv: string[], options?: { quiet?: boolean }) => runDriverSchemaCommand(argv, options),
    runDriverDbCommand: async () => undefined
}));

vi.mock("../dev-db/prepare", async importOriginal => {
    const actual = await importOriginal<typeof import("../dev-db/prepare")>();
    return {
        ...actual,
        prepareDatabaseEnv: (root: string, options: PrepareCall) => prepareDatabaseEnv(root, options)
    };
});

vi.mock("../utils/dev-preflight", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/dev-preflight")>();
    return {
        ...actual,
        // Only what a test says is busy: the pinned port is free, and the
        // liveness poll never runs long enough to matter.
        probeTcp: async (_host: string, port: number) => busyPorts.has(port),
        ensureDevDatabase: async (options: { databaseUrl?: string; disabled?: boolean }) => {
            preflightUrls.push(options.databaseUrl);
            preflightDisabled.push(options.disabled === true);
            return { action: "no-dsn" as const };
        }
    };
});

/**
 * One fake child for every spawn. The SDK generator's resolves at once; the
 * backend's and the admin panel's stay up until the test ends them, as
 * `tsx watch` and Vite would — or until they are killed.
 */
interface Spawned {
    file: string;
    args: readonly string[];
    options: { cwd?: string; env?: Record<string, string | undefined> };
    stdout: PassThrough;
    killed: boolean;
    end: (killedBy?: Error) => void;
}
const spawned: Spawned[] = [];
vi.mock("execa", () => ({
    execaCommandSync: () => undefined,
    execa: (file: string, args: readonly string[] = [], options: Spawned["options"] = {}) => {
        const events = new EventEmitter();
        const life = deferred<void>();
        const child = Object.assign(life.promise, {
            pid: undefined,
            killed: false,
            stdout: new PassThrough(),
            stderr: new PassThrough(),
            on: (name: string, listener: (...a: unknown[]) => void) => {
                events.on(name, listener);
                return child;
            },
            // As execa's does: a killed child's promise rejects.
            kill: () => {
                record.killed = true;
                end(new Error("Command was killed with SIGKILL (Forced termination)"));
                return true;
            }
        });
        let ended = false;
        const end = (killedBy?: Error) => {
            if (ended) return;
            ended = true;
            child.stdout.end();
            child.stderr.end();
            events.emit("exit", killedBy ? null : 0, killedBy ? "SIGKILL" : null);
            if (killedBy) life.reject(killedBy);
            else life.resolve();
        };
        const record: Spawned = { file, args, options, stdout: child.stdout, killed: false, end };
        spawned.push(record);
        if (args.includes("generate-sdk")) end();
        return child;
    }
}));

import { DEV_PORT_FILENAME, devCommand, frontendCanStartWithBackend, overlapDevStartup } from "./dev";

const managedDatabase: PreparedDatabase = {
    database: { kind: "external", source: "flag", url: "postgres://u@127.0.0.1:5432/app" },
    env: {},
    description: "test database"
} as PreparedDatabase;

let listeners: { SIGINT: number; SIGTERM: number };

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-dev-startup-"));
    fs.mkdirSync(path.join(scratch, "backend", "src"), { recursive: true });
    // An ejected entry, so the stock runtime is not looked for.
    fs.writeFileSync(path.join(scratch, "backend", "src", "index.ts"), "");
    fs.mkdirSync(path.join(scratch, "config", "collections"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "config", "collections", "posts.ts"), "export default {};\n");

    frontendDir = null;
    busyPorts.clear();
    generation = deferred<void>();
    runDriverSchemaCommand.mockReset().mockImplementation(() => generation.promise);
    prepareDatabaseEnv.mockReset().mockResolvedValue(managedDatabase);
    spawned.length = 0;

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // The collections watcher would outlive the test.
    vi.spyOn(fs, "watch").mockReturnValue({ close: () => undefined } as unknown as fs.FSWatcher);
    listeners = { SIGINT: process.listenerCount("SIGINT"), SIGTERM: process.listenerCount("SIGTERM") };
});

afterEach(() => {
    vi.restoreAllMocks();
    // `devCommand` installs its Ctrl+C handlers on the real process.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        const extra = process.listeners(signal).slice(listeners[signal]);
        for (const listener of extra) process.removeListener(signal, listener);
    }
    process.exitCode = undefined;
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe("overlapDevStartup", () => {
    it("starts the database before the generators have finished", async () => {
        const generate = deferred<"generated">();
        const database = vi.fn(async () => "db");
        const run = overlapDevStartup({
            generate: () => generate.promise,
            preflight: async () => undefined,
            database
        });
        await settle();

        expect(database).toHaveBeenCalledTimes(1);

        generate.resolve("generated");
        await expect(run).resolves.toEqual({ schemaGeneration: "generated", database: "db" });
    });

    it("keeps the preflight — the --docker push — behind the generators", async () => {
        const generate = deferred<"generated">();
        const preflight = vi.fn(async () => undefined);
        const run = overlapDevStartup({ generate: () => generate.promise, preflight, database: null });
        await settle();

        expect(preflight).not.toHaveBeenCalled();

        generate.resolve("generated");
        await expect(run).resolves.toEqual({ schemaGeneration: "generated", database: null });
        expect(preflight).toHaveBeenCalledTimes(1);
    });

    it("reports a database that failed after the generators and the preflight, not before", async () => {
        const generate = deferred<"failed">();
        const order: string[] = [];
        const run = overlapDevStartup({
            generate: async () => {
                const result = await generate.promise;
                order.push("generated");
                return result;
            },
            preflight: async () => {
                order.push("preflight");
            },
            database: async () => {
                throw new Error("The development database failed to start (exit 1).");
            }
        });
        const outcome = run.then(() => "resolved", (error: Error) => {
            order.push("rejected");
            return error.message;
        });
        await settle();
        expect(order).toEqual([]);

        generate.resolve("failed");
        await expect(outcome).resolves.toBe("The development database failed to start (exit 1).");
        expect(order).toEqual(["generated", "preflight", "rejected"]);
    });
});

describe("rebase dev's start-up", () => {
    it("asks for the database while the schema is still being generated", async () => {
        const run = devCommand(["node", "rebase", "dev", "--backend-only", "--port", "45123"]);

        await vi.waitFor(() => expect(runDriverSchemaCommand).toHaveBeenCalled());
        await vi.waitFor(() => expect(prepareDatabaseEnv).toHaveBeenCalledTimes(1));
        // Still generating: the database did not wait for it.
        expect(spawned.some(s => s.file === "/bin/true")).toBe(false);

        generation.resolve();
        await vi.waitFor(() => expect(spawned.some(s => s.file === "/bin/true")).toBe(true));

        for (const child of spawned) child.end();
        await run;
    });

    it("records the database it runs on, for the other commands to follow", async () => {
        // `rebase dev --docker` was not remembered, so `rebase db url` beside it
        // started and printed a managed PGlite instead of the container.
        const record = path.join(scratch, ".rebase", "dev-database.json");
        const startOn = async (database: PreparedDatabase, port: string): Promise<void> => {
            prepareDatabaseEnv.mockResolvedValueOnce(database);
            generation = deferred<void>();
            runDriverSchemaCommand.mockImplementation(() => generation.promise);
            spawned.length = 0;
            const run = devCommand(["node", "rebase", "dev", "--backend-only", "--port", port]);
            generation.resolve();
            await vi.waitFor(() => expect(spawned.some(s => s.file === "/bin/true")).toBe(true));
            for (const child of spawned) child.end();
            await run;
        };
        const logged = vi.mocked(console.log);

        await startOn({
            database: { kind: "docker", source: "docker", url: "postgresql://u:p@127.0.0.1:5435/rebase" },
            env: { DATABASE_URL: "postgresql://u:p@127.0.0.1:5435/rebase" },
            description: "Postgres in Docker"
        }, "45125");
        expect(JSON.parse(fs.readFileSync(record, "utf8"))).toMatchObject({ kind: "docker" });
        // Its own flags decide; it does not follow the record it writes.
        expect(prepareDatabaseEnv.mock.calls[0][1]).toMatchObject({ followLastDev: false });

        logged.mockClear();
        await startOn({
            database: { kind: "managed", source: "managed" },
            env: { DATABASE_URL: "postgresql://postgres@127.0.0.1:5999/postgres" },
            description: "the managed development database (PGlite)"
        }, "45126");
        expect(fs.existsSync(record)).toBe(false);
        expect(logged.mock.calls.map(call => call.map(String).join(" ")).join("\n"))
            .toContain("The last `rebase dev` ran on Postgres in Docker");
    });

    it("starts and pushes to no container when a DATABASE_URL outranks --docker", async () => {
        // The backend runs on the DATABASE_URL; the preflight used to start the
        // compose container anyway and push the schema into it, because it was
        // handed the compose URL whenever --docker was typed.
        fs.writeFileSync(path.join(scratch, "docker-compose.yml"), [
            "services:",
            "  db:",
            "    environment:",
            "      POSTGRES_USER: rebase_app",
            "      POSTGRES_PASSWORD: pw",
            "      POSTGRES_DB: rebase",
            "    ports:",
            "      - \"5435:5432\"",
            ""
        ].join("\n"));
        vi.stubEnv("DATABASE_URL", "postgresql://u:pw@staging.example.com:5432/app");
        preflightUrls.length = 0;
        try {
            const run = devCommand(["node", "rebase", "dev", "--backend-only", "--docker", "--port", "45127"]);
            generation.resolve();
            await vi.waitFor(() => expect(spawned.some(s => s.file === "/bin/true")).toBe(true));
            for (const child of spawned) child.end();
            await run;
        } finally {
            vi.unstubAllEnvs();
        }

        expect(preflightUrls).toHaveLength(1);
        expect(preflightUrls[0] ?? "").not.toContain(":5435/");
    });

    /**
     * `rebase dev --database-url <dead>` printed the backend's banner, "Verify
     * DATABASE_URL in your .env file" — the reader had typed a flag — and kept
     * running with the backend dead.
     */
    it("exits naming --database-url when nothing answers where it points, having started nothing", async () => {
        const exit = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Error(`process.exit(${code})`);
        });
        preflightUrls.length = 0;
        await expect(devCommand(["node", "rebase", "dev", "--backend-only", "--port", "45131",
            "--database-url", "postgres://u@127.0.0.1:5999/app"])).rejects.toThrow("process.exit(1)");

        const errors = vi.mocked(console.error).mock.calls.map(call => call.map(String).join(" ")).join("\n");
        expect(errors).toContain("--database-url");
        expect(errors).toContain("127.0.0.1:5999");
        expect(errors).not.toContain(".env");
        expect(spawned.some(s => s.file === "/bin/true")).toBe(false);
        expect(prepareDatabaseEnv).not.toHaveBeenCalled();
        expect(preflightUrls).toEqual([]);
        exit.mockRestore();
    });

    it("runs on a --database-url that answers, and leaves .env's database to the preflight not at all", async () => {
        // The preflight decides from `.env` and may start its compose
        // container; a flag that outranks `.env` is not that database.
        busyPorts.add(5998);
        preflightDisabled.length = 0;
        const run = devCommand(["node", "rebase", "dev", "--backend-only", "--port", "45132",
            "--database-url", "postgres://u@127.0.0.1:5998/app"]);
        generation.resolve();
        await vi.waitFor(() => expect(spawned.some(s => s.file === "/bin/true")).toBe(true));
        for (const child of spawned) child.end();
        await run;
        expect(preflightDisabled).toEqual([true]);
    });

    it("hands the --docker preflight the compose URL when Docker is what it runs on", async () => {
        fs.writeFileSync(path.join(scratch, "docker-compose.yml"), [
            "services:",
            "  db:",
            "    environment:",
            "      POSTGRES_USER: rebase_app",
            "      POSTGRES_PASSWORD: pw",
            "      POSTGRES_DB: rebase",
            "    ports:",
            "      - \"5435:5432\"",
            ""
        ].join("\n"));
        const shell = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        preflightUrls.length = 0;
        try {
            const run = devCommand(["node", "rebase", "dev", "--backend-only", "--docker", "--port", "45128"]);
            generation.resolve();
            await vi.waitFor(() => expect(spawned.some(s => s.file === "/bin/true")).toBe(true));
            for (const child of spawned) child.end();
            await run;
        } finally {
            if (shell !== undefined) process.env.DATABASE_URL = shell;
        }

        expect(preflightUrls).toEqual([expect.stringContaining("@127.0.0.1:5435/rebase")]);
    });

    it("says when it regenerated a schema that was out of date, and only then", async () => {
        // A stale schema was regenerated on start without a word, so the reader
        // never learned their collections and the committed file had drifted.
        const schemaFile = path.join(scratch, "backend", "src", "schema.generated.ts");
        const startWith = async (before: string, after: string, port: string): Promise<string> => {
            fs.writeFileSync(schemaFile, before);
            runDriverSchemaCommand.mockImplementation(async () => { fs.writeFileSync(schemaFile, after); });
            spawned.length = 0;
            const logged = vi.mocked(console.log);
            logged.mockClear();
            const run = devCommand(["node", "rebase", "dev", "--backend-only", "--port", port]);
            await vi.waitFor(() => expect(spawned.some(s => s.file === "/bin/true")).toBe(true));
            for (const child of spawned) child.end();
            await run;
            return logged.mock.calls.map(call => call.map(String).join(" ")).join("\n");
        };

        expect(await startWith("export const tables = { old };\n", "export const tables = { posts };\n", "45129"))
            .toContain("backend/src/schema.generated.ts was out of date with the collections");
        expect(await startWith("export const tables = { posts };\n", "export const tables = { posts };\n", "45130"))
            .not.toContain("was out of date");
    });

    it("starts no database under --no-db, and still generates", async () => {
        const run = devCommand(["node", "rebase", "dev", "--backend-only", "--no-db", "--port", "45124"]);
        await vi.waitFor(() => expect(runDriverSchemaCommand).toHaveBeenCalled());

        generation.resolve();
        await vi.waitFor(() => expect(spawned.some(s => s.file === "/bin/true")).toBe(true));
        expect(prepareDatabaseEnv).not.toHaveBeenCalled();

        for (const child of spawned) child.end();
        await run;
    });
});

describe("frontendCanStartWithBackend", () => {
    const probeNothing = vi.fn(async () => false);

    it("trusts a port named with --port without asking again", async () => {
        const probe = vi.fn(async () => true);
        await expect(frontendCanStartWithBackend({ projectRoot: scratch, port: 3500, pinned: true, probe })).resolves.toBe(true);
        expect(probe).not.toHaveBeenCalled();
    });

    it("starts beside a backend whose port is free and is the one it will try first", async () => {
        await expect(frontendCanStartWithBackend({ projectRoot: scratch, port: 3500, pinned: false, probe: probeNothing })).resolves.toBe(true);

        // The remembered port is this port, in either file shape.
        for (const content of ["3500", "3500 3500"]) {
            fs.writeFileSync(path.join(scratch, DEV_PORT_FILENAME), content);
            await expect(frontendCanStartWithBackend({ projectRoot: scratch, port: 3500, pinned: false, probe: probeNothing })).resolves.toBe(true);
        }
    });

    it("waits when the backend will move: the port answers, on either loopback", async () => {
        for (const busyHost of ["127.0.0.1", "::1"]) {
            const probe = async (host: string) => host === busyHost;
            await expect(frontendCanStartWithBackend({ projectRoot: scratch, port: 3500, pinned: false, probe })).resolves.toBe(false);
        }
    });

    it("waits when the server will try a remembered port first", async () => {
        fs.writeFileSync(path.join(scratch, DEV_PORT_FILENAME), "3502 3500");
        await expect(frontendCanStartWithBackend({ projectRoot: scratch, port: 3500, pinned: false, probe: probeNothing })).resolves.toBe(false);
    });
});

describe("the admin panel and the backend", () => {
    const isFrontend = (s: Spawned) => s.options.cwd === frontendDir;
    const isBackend = (s: Spawned) => s.file === "/bin/true";

    beforeEach(() => {
        frontendDir = path.join(scratch, "frontend");
        fs.mkdirSync(frontendDir, { recursive: true });
        // npm, so the package manager is read from a lockfile rather than probed for.
        fs.writeFileSync(path.join(scratch, "package-lock.json"), "{}");
    });

    /** Boxed: an async function returning the run itself would wait for it to end. */
    async function startUntilBackendSpawned(argv: string[]): Promise<{ run: Promise<void> }> {
        const run = devCommand(["node", "rebase", "dev", ...argv]);
        await vi.waitFor(() => expect(runDriverSchemaCommand).toHaveBeenCalled());
        generation.resolve();
        await vi.waitFor(() => expect(spawned.some(isBackend)).toBe(true));
        return { run };
    }

    function announce(port: number): void {
        spawned.find(isBackend)?.stdout.write(`ℹ️ [INFO] Server running at http://localhost:${port}\n`);
    }

    async function finish(run: Promise<void>): Promise<void> {
        for (const child of spawned) child.end();
        await run;
    }

    it("starts beside the backend when the port is pinned, before the backend is up", async () => {
        const { run } = await startUntilBackendSpawned(["--port", "45130"]);

        const early = spawned.filter(isFrontend);
        expect(early).toHaveLength(1);
        expect(early[0].options.env?.VITE_API_URL).toBe("http://localhost:45130");

        announce(45130);
        await settle();
        expect(spawned.filter(isFrontend)).toHaveLength(1);
        expect(early[0].killed).toBe(false);

        await finish(run);
    });

    it("starts beside the backend on a free derived port, and restarts it if the backend moved", async () => {
        const { run } = await startUntilBackendSpawned([]);

        const early = spawned.filter(isFrontend);
        expect(early).toHaveLength(1);
        const told = Number(new URL(early[0].options.env?.VITE_API_URL ?? "").port);

        // Something took the port in the second the backend booted.
        announce(told + 1);
        await vi.waitFor(() => expect(spawned.filter(isFrontend)).toHaveLength(2));
        expect(early[0].killed).toBe(true);
        expect(spawned.filter(isFrontend)[1].options.env?.VITE_API_URL).toBe(`http://localhost:${told + 1}`);

        // Once: a later restart of the backend leaves the admin panel alone.
        announce(told + 2);
        await settle();
        expect(spawned.filter(isFrontend)).toHaveLength(2);

        await finish(run);
    });

    it("waits for the backend when its port is taken, then starts on the port it bound", async () => {
        fs.writeFileSync(path.join(scratch, DEV_PORT_FILENAME), "45140");
        busyPorts.add(45140);
        const { run } = await startUntilBackendSpawned([]);

        expect(spawned.filter(isFrontend)).toHaveLength(0);

        announce(45141);
        await vi.waitFor(() => expect(spawned.filter(isFrontend)).toHaveLength(1));
        expect(spawned.filter(isFrontend)[0].options.env?.VITE_API_URL).toBe("http://localhost:45141");

        await finish(run);
    });

    it("starts no admin panel under --backend-only", async () => {
        const { run } = await startUntilBackendSpawned(["--backend-only", "--port", "45150"]);
        announce(45150);
        await settle();
        expect(spawned.filter(isFrontend)).toHaveLength(0);
        await finish(run);
    });
});

/**
 * `generated/sdk/README.md` names the backend's address, and `rebase dev`
 * regenerates the SDK at boot — before the backend has bound, so before it
 * writes `.rebase/state.json`, which is all `generate-sdk` read. Every start
 * left the README saying `localhost:3001`, a port this project's dev server is
 * almost never on.
 */
describe("the SDK's example address", () => {
    const isSdk = (s: Spawned) => s.args.includes("generate-sdk");
    const isBackend = (s: Spawned) => s.file === "/bin/true";
    const sdkUrls = () => spawned.filter(isSdk).map(s => s.options.env?.REBASE_DEV_BACKEND_URL);

    /** Boxed: an async function returning the run itself would wait for it to end. */
    async function start(argv: string[]): Promise<{ run: Promise<void> }> {
        const run = devCommand(["node", "rebase", "dev", "--backend-only", ...argv]);
        await vi.waitFor(() => expect(runDriverSchemaCommand).toHaveBeenCalled());
        generation.resolve();
        await vi.waitFor(() => expect(spawned.some(isBackend)).toBe(true));
        return { run };
    }

    function announce(port: number): void {
        spawned.find(isBackend)?.stdout.write(`ℹ️ [INFO] Server running at http://localhost:${port}\n`);
    }

    it("is the port dev starts the backend on, from the first generation", async () => {
        const { run } = await start(["--port", "45160"]);

        expect(sdkUrls()).toEqual(["http://localhost:45160"]);

        announce(45160);
        await settle();
        // The backend landed where the SDK said: nothing to regenerate.
        expect(sdkUrls()).toEqual(["http://localhost:45160"]);

        for (const child of spawned) child.end();
        await run;
    });

    it("follows the backend when it binds another port", async () => {
        const { run } = await start([]);
        const told = Number(new URL(sdkUrls()[0] ?? "").port);

        announce(told + 1);
        await vi.waitFor(() => expect(sdkUrls()).toEqual([`http://localhost:${told}`, `http://localhost:${told + 1}`]));

        // A restart on the same port changes nothing.
        announce(told + 1);
        await settle();
        expect(sdkUrls()).toHaveLength(2);

        for (const child of spawned) child.end();
        await run;
    });
});
