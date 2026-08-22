/**
 * The managed database process: one PGlite instance behind a Postgres socket.
 *
 * Runs as `rebase __dev-db-daemon`, a hidden subcommand rather than a separate
 * build entry point, so the same resolution works from `src` under tsx and from
 * the bundled `dist` a published CLI ships — there is no second file for a
 * build config to forget.
 *
 * It is deliberately detached from whoever started it. `rebase db push` in one
 * terminal and `rebase dev` in another must reach the same database, because
 * two processes opening one PGlite data directory would corrupt it, so the
 * daemon belongs to the *project* rather than to a command. What starts it is
 * incidental; what stops it is an explicit `rebase db stop`, an idle timeout,
 * or the machine going away.
 *
 * PGlite is imported dynamically. It is an optional dependency carrying a 25MB
 * WASM build, and the cost of that must fall only on someone who actually uses
 * the managed database — never on `rebase init`, and never on a CLI startup
 * that is about to print help.
 */

import fs from "fs";
import net from "net";

import {
    MANAGED_SERVER_MAX_CONNECTIONS,
    PGLITE_EXTENSION_NAMES
} from "./constraints";
import { clearState, dataDir, writeState } from "./state";

/** Shut down after this long with nothing connected. */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000;

/** How often to check for idleness. */
const IDLE_CHECK_INTERVAL_MS = 60_000;

export interface DaemonArgs {
    projectRoot: string;
    port: number;
    token: string;
    idleTimeoutMs: number;
}

/**
 * `--project <dir> --port <n> --token <t> [--idle-timeout <ms>]`.
 *
 * Every field is required and unvalidated input is fatal: this process is
 * spawned by the CLI, never typed by a person, so a malformed argument is a bug
 * in the caller and guessing would hide it.
 */
export function parseDaemonArgs(argv: readonly string[]): DaemonArgs {
    const take = (flag: string): string | null => {
        const index = argv.indexOf(flag);

        return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
    };

    const projectRoot = take("--project");
    const port = Number(take("--port"));
    const token = take("--token");
    const idleRaw = take("--idle-timeout");

    if (!projectRoot) throw new Error("__dev-db-daemon: --project is required");
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error("__dev-db-daemon: --port must be a valid port");
    }
    if (!token) throw new Error("__dev-db-daemon: --token is required");

    const idleTimeoutMs = idleRaw === null ? DEFAULT_IDLE_TIMEOUT_MS : Number(idleRaw);
    if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs < 0) {
        throw new Error("__dev-db-daemon: --idle-timeout must be a non-negative number of milliseconds");
    }

    return { projectRoot, port, token, idleTimeoutMs };
}

/**
 * Load the extension bundles PGlite needs by name.
 *
 * `CREATE EXTENSION pg_trgm` cannot install anything on its own here — PGlite
 * resolves extensions from bundles handed to the constructor, and a missing one
 * fails at migration time with `extension "pg_trgm" is not available`, which
 * reads like a broken database rather than a missing import.
 */
async function loadExtensions(): Promise<Record<string, unknown>> {
    const extensions: Record<string, unknown> = {};
    for (const name of PGLITE_EXTENSION_NAMES) {
        const module = (await import(`@electric-sql/pglite/contrib/${name}`)) as Record<string, unknown>;
        const bundle = module[name];
        if (!bundle) {
            throw new Error(
                `@electric-sql/pglite/contrib/${name} did not export "${name}". ` +
                "The installed PGlite version may not ship this extension."
            );
        }
        extensions[name] = bundle;
    }

    return extensions;
}

/**
 * A tiny sidecar listener that answers one question: "are you the daemon this
 * state file describes?"
 *
 * Liveness cannot be answered by the pid — after a reboot the number belongs to
 * something else — nor by the port alone, for the same reason. Both would let
 * Rebase send a migration to a stranger. So the daemon publishes a token on a
 * second loopback port and the answer is only yes when the token matches.
 */
function startIdentityServer(token: string, onConnection: () => void): Promise<net.Server> {
    return new Promise((resolve, reject) => {
        const server = net.createServer((socket) => {
            onConnection();
            socket.end(`rebase-dev-db ${token}\n`);
        });
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve(server));
    });
}

export async function runDaemon(args: DaemonArgs): Promise<void> {
    const directory = dataDir(args.projectRoot);
    fs.mkdirSync(directory, { recursive: true });

    const { PGlite } = (await import("@electric-sql/pglite")) as {
        PGlite: { create(options: unknown): Promise<unknown> };
    };
    const { PGLiteSocketServer } = (await import("@electric-sql/pglite-socket")) as {
        PGLiteSocketServer: new (options: unknown) => {
            start(): Promise<void>;
            stop(): Promise<void>;
            getStats(): { activeConnections: number; queuedQueries: number };
        };
    };

    const extensions = await loadExtensions();
    const db = (await PGlite.create({ dataDir: directory, extensions })) as { close(): Promise<void> };

    const server = new PGLiteSocketServer({
        db,
        port: args.port,
        host: "127.0.0.1",
        // Above the client pool limit so a second *non-transactional* client is
        // refused with a connection error rather than deadlocking the
        // multiplexer. See `constraints.ts` — the pool limit is what actually
        // prevents overlapping transactions.
        maxConnections: MANAGED_SERVER_MAX_CONNECTIONS
    });
    await server.start();

    // "Idle" means nothing is connected to the *database*. An earlier version
    // tracked identity pings instead, which meant a daemon serving queries
    // steadily for an hour would decide it was idle and shut down under a
    // running dev server.
    let idleSince: number | null = Date.now();
    const identity = await startIdentityServer(args.token, () => {
        idleSince = null;
    });
    const identityAddress = identity.address();
    const identityPort = identityAddress !== null && typeof identityAddress !== "string" ? identityAddress.port : 0;

    writeState(args.projectRoot, {
        port: args.port,
        pid: process.pid,
        dataDir: directory,
        startedAt: new Date().toISOString(),
        token: args.token,
        identityPort
    });

    let shuttingDown = false;
    const shutdown = async (reason: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        process.stdout.write(`dev-db: stopping (${reason})\n`);
        // The state file goes first: a command that reads it during shutdown
        // should conclude "not running" and start a fresh daemon, rather than
        // connect to a socket that is closing under it.
        clearState(args.projectRoot);
        try {
            await server.stop();
        } catch { /* already down */ }
        identity.close();
        try {
            await db.close();
        } catch { /* already closed */ }
        process.exit(0);
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    // The parent going away must not take the database with it — the daemon
    // belongs to the project. But an orphan with nobody left to serve should
    // not outlive the session either, which is what the idle timer is for.
    process.on("disconnect", () => { /* detached on purpose */ });

    if (args.idleTimeoutMs > 0) {
        const timer = setInterval(() => {
            const stats = server.getStats();
            const busy = stats.activeConnections > 0 || stats.queuedQueries > 0;
            if (busy) {
                idleSince = null;

                return;
            }
            if (idleSince === null) {
                idleSince = Date.now();

                return;
            }
            if (Date.now() - idleSince >= args.idleTimeoutMs) {
                void shutdown(`idle for ${Math.round(args.idleTimeoutMs / 60_000)} minutes`);
            }
        }, IDLE_CHECK_INTERVAL_MS);
        timer.unref();
    }

    process.stdout.write(`dev-db: ready on 127.0.0.1:${args.port}\n`);
}
