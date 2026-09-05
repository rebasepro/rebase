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
    PGLITE_EXTENSIONS
} from "./constraints";
import { NotificationProxy } from "./notification-proxy";
import { additionalDataDir, clearState, dataDir, findFreePort, writeState } from "./state";

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
 * Load the extension bundles PGlite needs.
 *
 * `CREATE EXTENSION pg_trgm` cannot install anything on its own here — PGlite
 * resolves extensions from bundles handed to the constructor, and a missing one
 * fails at migration time with `extension "pg_trgm" is not available`, which
 * reads like a broken database rather than a missing import.
 *
 * Every failure here is loud for that reason, including the one that is new:
 * pgvector arrives from a package of its own, so unlike the contrib bundles it
 * can be absent while PGlite itself is fine.
 */
async function loadExtensions(): Promise<Record<string, unknown>> {
    const extensions: Record<string, unknown> = {};
    for (const extension of PGLITE_EXTENSIONS) {
        let module: Record<string, unknown>;
        try {
            module = (await import(extension.module)) as Record<string, unknown>;
        } catch (err) {
            throw new Error(
                `Could not load "${extension.module}", which supplies the ${extension.name} extension: ` +
                `${err instanceof Error ? err.message : String(err)}\n` +
                "It is an optional dependency of @rebasepro/cli — reinstall the project, " +
                "or run `rebase dev --docker` to use a real Postgres instead."
            );
        }
        const bundle = module[extension.export];
        if (!bundle) {
            throw new Error(
                `${extension.module} did not export "${extension.export}". ` +
                "The installed PGlite version may not ship this extension."
            );
        }
        extensions[extension.name] = bundle;
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
/**
 * How long a client has to send a command after the identity line, before
 * the daemon closes the socket. The liveness check never sends one and
 * closes on its own; this is for a client that connected and hung.
 */
const COMMAND_TIMEOUT_MS = 2_000;

/**
 * One command a client may send after reading the identity line.
 *
 * `ensure <key>` answers `ok <port>` once a PGlite instance for that declared
 * database is serving, starting it if it is not. A daemon started before a
 * second database was declared serves it without a restart, which matters
 * because `rebase studio` in another terminal is connected to the first.
 */
type CommandHandler = (command: string) => Promise<string>;

function startIdentityServer(token: string, onConnection: () => void, onCommand: CommandHandler): Promise<net.Server> {
    return new Promise((resolve, reject) => {
        const server = net.createServer((socket) => {
            onConnection();
            socket.write(`rebase-dev-db ${token}\n`);
            let buffered = "";
            const timer = setTimeout(() => socket.end(), COMMAND_TIMEOUT_MS);
            socket.on("data", (chunk) => {
                buffered += chunk.toString("utf8");
                const newline = buffered.indexOf("\n");
                if (newline === -1) return;
                clearTimeout(timer);
                const command = buffered.slice(0, newline).trim();
                buffered = "";
                onCommand(command)
                    .then((reply) => socket.end(`${reply}\n`))
                    .catch((err) => socket.end(`error ${err instanceof Error ? err.message : String(err)}\n`));
            });
            socket.on("error", () => clearTimeout(timer));
            socket.on("close", () => clearTimeout(timer));
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

    /** One PGlite instance, its socket server and the proxy clients reach it through. */
    interface Instance {
        db: { close(): Promise<void> };
        server: { stop(): Promise<void>; getStats(): { activeConnections: number; queuedQueries: number } };
        proxy: NotificationProxy;
        port: number;
        dataDir: string;
    }

    // The socket server listens privately; clients reach it through the
    // notification proxy on the public port. Realtime does not work
    // otherwise — PGlite is one session, so a NotificationResponse is handed
    // to whichever socket is reading rather than to the one that issued
    // LISTEN. See `notification-proxy.ts` for the measurements.
    const startInstance = async (instanceDir: string, listenPort: number, label: string): Promise<Instance> => {
        fs.mkdirSync(instanceDir, { recursive: true });
        const db = (await PGlite.create({ dataDir: instanceDir, extensions })) as { close(): Promise<void> };
        const upstreamPort = await findFreePort();
        const server = new PGLiteSocketServer({
            db,
            port: upstreamPort,
            host: "127.0.0.1",
            // Above the client pool limit so a second *non-transactional* client is
            // refused with a connection error rather than deadlocking the
            // multiplexer. See `constraints.ts` — the pool limit is what actually
            // prevents overlapping transactions.
            maxConnections: MANAGED_SERVER_MAX_CONNECTIONS
        });
        await server.start();
        const proxy = new NotificationProxy({
            listenPort,
            upstreamPort,
            onNotification: (channel, _payload, copies) => {
                if (copies > 0) process.stdout.write(`dev-db${label}: relayed notification on ${channel} to ${copies} client(s)\n`);
            }
        });
        await proxy.start();
        return { db, server, proxy, port: listenPort, dataDir: instanceDir };
    };

    const primary = await startInstance(directory, args.port, "");
    /** Additional declared databases, by key. Started on demand. */
    const additional = new Map<string, Instance>();
    /** In-flight starts, so two commands asking for one key start one instance. */
    const starting = new Map<string, Promise<Instance>>();

    // "Idle" means nothing is connected to the *database*. An earlier version
    // tracked identity pings instead, which meant a daemon serving queries
    // steadily for an hour would decide it was idle and shut down under a
    // running dev server.
    let idleSince: number | null = Date.now();

    const publishState = (identityPort: number) => {
        const databases: Record<string, { port: number; dataDir: string }> = {};
        for (const [key, instance] of additional) databases[key] = { port: instance.port, dataDir: instance.dataDir };
        writeState(args.projectRoot, {
            port: args.port,
            pid: process.pid,
            dataDir: directory,
            startedAt: new Date().toISOString(),
            token: args.token,
            identityPort,
            ...(additional.size > 0 ? { databases } : {})
        });
    };

    let identityPort = 0;
    const ensureAdditional = async (key: string): Promise<Instance> => {
        const existing = additional.get(key);
        if (existing) return existing;
        const inFlight = starting.get(key);
        if (inFlight) return inFlight;
        const promise = (async () => {
            const instance = await startInstance(additionalDataDir(args.projectRoot, key), await findFreePort(), ` [${key}]`);
            additional.set(key, instance);
            publishState(identityPort);
            process.stdout.write(`dev-db [${key}]: ready on 127.0.0.1:${instance.port}\n`);
            return instance;
        })();
        starting.set(key, promise);
        try {
            return await promise;
        } finally {
            starting.delete(key);
        }
    };

    const identity = await startIdentityServer(args.token, () => {
        idleSince = null;
    }, async (command) => {
        const match = /^ensure\s+(\S+)$/.exec(command);
        if (!match) return `error unknown command "${command}"`;
        const key = match[1];
        // The key becomes a directory name and a variable suffix; the same
        // rule the declaration passed applies here, so nothing a declaration
        // could not say reaches the filesystem.
        if (!/[a-z0-9]/i.test(key) || key.includes("/") || key.includes("..")) return `error invalid key "${key}"`;
        const instance = await ensureAdditional(key);
        return `ok ${instance.port}`;
    });
    const identityAddress = identity.address();
    identityPort = identityAddress !== null && typeof identityAddress !== "string" ? identityAddress.port : 0;

    publishState(identityPort);

    let shuttingDown = false;
    const shutdown = async (reason: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        process.stdout.write(`dev-db: stopping (${reason})\n`);
        // The state file goes first: a command that reads it during shutdown
        // should conclude "not running" and start a fresh daemon, rather than
        // connect to a socket that is closing under it.
        clearState(args.projectRoot);
        identity.close();
        for (const instance of [primary, ...additional.values()]) {
            try {
                await instance.proxy.stop();
            } catch { /* already down */ }
            try {
                await instance.server.stop();
            } catch { /* already down */ }
            try {
                await instance.db.close();
            } catch { /* already closed */ }
        }
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
            const busy = [primary, ...additional.values()].some((instance) => {
                const stats = instance.server.getStats();
                return stats.activeConnections > 0 || stats.queuedQueries > 0;
            });
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
