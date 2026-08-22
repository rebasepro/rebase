/**
 * Starting, finding and stopping the managed database, from the caller's side.
 *
 * Every command that needs Postgres calls {@link ensureManagedDatabase} and
 * gets a connection string back. Whether that started a process or found one
 * already running is not the caller's business, which is the point: `rebase
 * db push`, `rebase dev` and `rebase studio` in three terminals must all reach
 * the same database without coordinating, because two processes opening one
 * PGlite data directory would corrupt it.
 *
 * The hard part is not starting the daemon; it is deciding whether the one the
 * state file describes is still there. A pid can be recycled after a reboot and
 * a port can be taken by a stranger, so believing either on its own would let
 * Rebase send a migration somewhere unintended. {@link isDaemonAlive} asks the
 * daemon to identify itself instead.
 */

import { randomBytes } from "crypto";
import { type ChildProcess, spawn } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";

import {
    clearState,
    type DaemonState,
    dataDir,
    devDbDir,
    findFreePort,
    pidRunning,
    readState,
    stateFile
} from "./state";

/** How long to wait for a first boot. PGlite runs initdb on an empty data dir. */
const START_TIMEOUT_MS = 60_000;
/** Poll interval while waiting for the daemon to publish its state file. */
const POLL_INTERVAL_MS = 150;
/** How long the identity handshake may take before we call it dead. */
const IDENTITY_TIMEOUT_MS = 1_500;

export interface ManagedDatabase {
    /** Connection string for this project's managed database. */
    url: string;
    /** Where the data lives, for diagnostics and `--reset`. */
    dataDir: string;
    port: number;
    pid: number;
    /** True when this call started the daemon rather than finding it. */
    started: boolean;
}

/**
 * PGlite's built-in superuser and database.
 *
 * Fixed by PGlite rather than chosen here, and asserted by the socket spike:
 * `session_user` comes back as `postgres`.
 */
const MANAGED_USER = "postgres";
const MANAGED_DATABASE = "postgres";

export function managedUrl(port: number): string {
    return `postgresql://${MANAGED_USER}@127.0.0.1:${port}/${MANAGED_DATABASE}`;
}

/**
 * Ask the process behind a state record to prove it is the one we wrote down.
 *
 * A pid check alone answers "is *a* process running", and a port check alone
 * answers "is *something* listening" — after a reboot both say yes about
 * strangers. The daemon answers with the token from its own state file, so a
 * match is the only evidence accepted.
 */
export function isDaemonAlive(state: DaemonState): Promise<boolean> {
    if (!pidRunning(state.pid)) return Promise.resolve(false);

    return new Promise((resolve) => {
        const socket = new net.Socket();
        let answer = "";
        const settle = (alive: boolean) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(alive);
        };
        socket.setTimeout(IDENTITY_TIMEOUT_MS);
        socket.once("timeout", () => settle(false));
        socket.once("error", () => settle(false));
        socket.on("data", (chunk) => {
            answer += chunk.toString("utf8");
            if (answer.includes("\n")) settle(answer.trim() === `rebase-dev-db ${state.token}`);
        });
        socket.once("close", () => settle(answer.trim() === `rebase-dev-db ${state.token}`));
        socket.connect(state.identityPort, "127.0.0.1");
    });
}

/** The running daemon for this project, or `null`. Never starts anything. */
export async function findRunningDaemon(projectRoot: string): Promise<DaemonState | null> {
    const state = readState(projectRoot);
    if (!state) return null;
    if (await isDaemonAlive(state)) return state;

    // The record describes something that is not there. Clearing it is the
    // whole recovery: the next ensure call starts a fresh daemon, and leaving
    // it would make every subsequent check pay the identity timeout.
    clearState(projectRoot);

    return null;
}

/**
 * Resolve the CLI entry point, so the daemon can be spawned as ourselves.
 *
 * A hidden subcommand rather than a second build entry: under `tsx` this file
 * is `src/dev-db/daemon.ts` and in a published CLI it is bundled into
 * `dist/index.js`, and in both cases the executable to re-invoke is the one
 * already running.
 */
function resolveCliEntry(): string {
    // `process.argv[1]` is `bin/rebase.js` for a real invocation, which is
    // exactly what should be re-run. Under a test runner it is the runner, so
    // fall back to this module's own directory.
    const argvEntry = process.argv[1];
    if (argvEntry && fs.existsSync(argvEntry)) return argvEntry;

    return fileURLToPath(new URL("../index.js", import.meta.url));
}

/**
 * How to re-invoke ourselves, which differs between a published CLI and this
 * repository.
 *
 * A published `rebase` is `node bin/rebase.js`, and re-running that is trivial.
 * Inside the monorepo the entry is TypeScript, which plain `node` cannot load —
 * so the daemon has to be started through the same loader that is running now.
 * Getting this wrong fails as a spawn that exits instantly with a syntax error,
 * which is why the caller reads `pglite.log` on failure.
 */
export function resolveSpawn(entry: string): { execPath: string; prefixArgs: string[] } {
    if (!/\.[cm]?ts$/.test(entry)) return { execPath: process.execPath, prefixArgs: [] };

    // Node can load TypeScript when tsx is registered as an import hook. tsx is
    // already a dependency of this package, because `rebase dev` runs the
    // backend through it.
    return { execPath: process.execPath, prefixArgs: ["--import", "tsx"] };
}

export interface EnsureOptions {
    /** Silence the "starting…" progress line. */
    quiet?: boolean;
    /** Milliseconds of inactivity before the daemon exits. 0 disables. */
    idleTimeoutMs?: number;
    /** Where progress goes. Injected for tests. */
    onProgress?: (message: string) => void;
    /** Override how the daemon process is launched. For tests. */
    spawn?: { execPath: string; prefixArgs: string[] };
    /**
     * Override the CLI entry to re-invoke. For tests.
     *
     * Necessary because under a test runner `process.argv[1]` is the runner
     * itself, which exists and is therefore accepted by {@link resolveCliEntry}
     * — spawning vitest with `__dev-db-daemon` rather than the CLI.
     */
    entry?: string;
}

/**
 * The project's managed database, started if it is not already running.
 *
 * Safe to call concurrently from several commands: the loser of the race finds
 * the winner's state file during its poll and adopts it rather than starting a
 * second daemon.
 */
export async function ensureManagedDatabase(
    projectRoot: string,
    options: EnsureOptions = {}
): Promise<ManagedDatabase> {
    const existing = await findRunningDaemon(projectRoot);
    if (existing) {
        return {
            url: managedUrl(existing.port),
            dataDir: existing.dataDir,
            port: existing.port,
            pid: existing.pid,
            started: false
        };
    }

    fs.mkdirSync(devDbDir(projectRoot), { recursive: true });
    ensureGitignore(projectRoot);

    const port = await findFreePort();
    const token = randomBytes(16).toString("hex");
    const entry = options.entry ?? resolveCliEntry();

    const spawnPlan = options.spawn ?? resolveSpawn(entry);
    const args = [
        ...spawnPlan.prefixArgs,
        entry,
        "__dev-db-daemon",
        "--project", projectRoot,
        "--port", String(port),
        "--token", token
    ];
    if (options.idleTimeoutMs !== undefined) {
        args.push("--idle-timeout", String(options.idleTimeoutMs));
    }

    const log = fs.openSync(path.join(devDbDir(projectRoot), "pglite.log"), "a");
    const child: ChildProcess = spawn(spawnPlan.execPath, args, {
        // Detached with no stdin and its output on a file: the daemon must
        // survive the command that started it, and must not hold the terminal
        // open when that command exits.
        detached: true,
        stdio: ["ignore", log, log]
    });
    child.unref();

    const deadline = Date.now() + START_TIMEOUT_MS;
    let announced = false;
    while (Date.now() < deadline) {
        const state = readState(projectRoot);
        if (state && (await isDaemonAlive(state))) {
            return {
                url: managedUrl(state.port),
                dataDir: state.dataDir,
                port: state.port,
                pid: state.pid,
                started: true
            };
        }

        if (!announced && !options.quiet) {
            announced = true;
            options.onProgress?.("Starting the development database…");
        }

        // A daemon that died on startup will never publish a state file, and
        // waiting the full minute for that is a bad way to learn it. The log is
        // the only place the reason exists.
        if (child.exitCode !== null && child.exitCode !== 0) {
            throw new Error(
                `The development database failed to start (exit ${child.exitCode}).\n` +
                `  See ${path.join(devDbDir(projectRoot), "pglite.log")} for the reason.`
            );
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    throw new Error(
        `The development database did not start within ${Math.round(START_TIMEOUT_MS / 1000)}s.\n` +
        `  See ${path.join(devDbDir(projectRoot), "pglite.log")} for the reason.\n` +
        "  To use your own Postgres instead, set DATABASE_URL or pass --database-url."
    );
}

/** Stop the daemon. Returns false when there was nothing running. */
export async function stopManagedDatabase(projectRoot: string): Promise<boolean> {
    const state = await findRunningDaemon(projectRoot);
    if (!state) return false;

    try {
        process.kill(state.pid, "SIGTERM");
    } catch {
        clearState(projectRoot);

        return false;
    }

    // Wait for it to clear its own state file, which is how it says it closed
    // the data directory cleanly. A hard kill here would risk the WAL.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if (!fs.existsSync(stateFile(projectRoot))) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    clearState(projectRoot);

    return true;
}

/**
 * Stop the daemon and delete the data directory.
 *
 * Destructive and deliberately not clever: it removes the whole directory
 * rather than dropping schemas, because "give me an empty database" is the only
 * thing anyone means by it.
 */
export async function resetManagedDatabase(projectRoot: string): Promise<void> {
    await stopManagedDatabase(projectRoot);
    fs.rmSync(dataDir(projectRoot), { recursive: true, force: true });
    clearState(projectRoot);
}

/**
 * Keep the generated directory out of git.
 *
 * `.rebase/` holds a Postgres data directory and a log. A project that commits
 * it will push hundreds of megabytes and a database that only makes sense on
 * one machine, so the ignore file is written next to the data rather than
 * relying on the project's root `.gitignore` having been updated.
 */
function ensureGitignore(projectRoot: string): void {
    const target = path.join(devDbDir(projectRoot), ".gitignore");
    if (fs.existsSync(target)) return;
    fs.writeFileSync(
        target,
        "# Generated by `rebase dev` — a local Postgres data directory and its log.\n" +
        "# Machine-specific and large; never commit it.\n*\n",
        "utf8"
    );
}
