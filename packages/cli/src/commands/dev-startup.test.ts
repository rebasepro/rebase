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
let generation = deferred<void>();
const prepareDatabaseEnv = vi.fn<(root: string, options: { additionalKeys?: readonly string[] }) => Promise<PreparedDatabase>>();
const runDriverSchemaCommand = vi.fn<(argv: string[], options?: { quiet?: boolean }) => Promise<void>>();

vi.mock("../utils/project", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/project")>();
    return {
        ...actual,
        requireProjectRoot: () => scratch,
        findBackendDir: () => path.join(scratch, "backend"),
        findFrontendDir: () => null,
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
        prepareDatabaseEnv: (root: string, options: { additionalKeys?: readonly string[] }) => prepareDatabaseEnv(root, options)
    };
});

vi.mock("../utils/dev-preflight", async importOriginal => {
    const actual = await importOriginal<typeof import("../utils/dev-preflight")>();
    return {
        ...actual,
        // Nothing is listening anywhere: the pinned port is free, and the
        // liveness poll never runs long enough to matter.
        probeTcp: async () => false,
        ensureDevDatabase: async () => ({ action: "no-dsn" as const })
    };
});

/**
 * One fake child for every spawn. The SDK generator's resolves at once; the
 * backend's stays up until the test ends it, as `tsx watch` would.
 */
const spawned: Array<{ file: string; args: readonly string[]; end: () => void }> = [];
vi.mock("execa", () => ({
    execaCommandSync: () => undefined,
    execa: (file: string, args: readonly string[] = []) => {
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
            kill: () => true
        });
        const end = () => {
            child.stdout.end();
            child.stderr.end();
            events.emit("exit", 0, null);
            life.resolve();
        };
        spawned.push({ file, args, end });
        if (args.includes("generate-sdk")) end();
        return child;
    }
}));

import { devCommand, overlapDevStartup } from "./dev";

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
