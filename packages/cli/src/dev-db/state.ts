/**
 * The managed database's state file, and the rules for trusting it.
 *
 * The daemon outlives the command that started it — `rebase db push` in one
 * terminal and `rebase dev` in another have to reach the *same* PGlite, because
 * two processes opening one data directory would corrupt it. So the daemon
 * records where it is, and every command reads that record.
 *
 * A record on disk is a claim, not a fact. The process it names may have been
 * killed, the machine may have rebooted and handed the pid to something else,
 * and the port may now belong to a stranger. {@link readState} therefore only
 * parses; deciding whether a record is live is {@link isDaemonAlive}'s job, and
 * it asks the daemon rather than the operating system.
 */

import { createHash } from "crypto";
import fs from "fs";
import { DEFAULT_RESOURCE_KEY, resourceEnvSuffix } from "@rebasepro/types";
import net from "net";
import path from "path";

/** Everything under here is generated and gitignored. */
export const DEV_DB_DIR = ".rebase";
/** PGlite's own data directory. Deleting it is what `--reset` means. */
export const DATA_DIR_NAME = "pgdata";
/** The record the daemon writes once it is accepting connections. */
export const STATE_FILE_NAME = "pglite.json";
/**
 * Held by whoever is currently starting a daemon.
 *
 * Without it, `rebase dev` and `rebase db push` started in the same second both
 * see no state file, both spawn, and two processes open one PGlite data
 * directory — the exact corruption the single-daemon design exists to prevent.
 * Observed as `ENOTEMPTY` during cleanup, which is the harmless way for it to
 * show up; the harmful way is a damaged database.
 */
export const START_LOCK_NAME = "starting.lock";
/**
 * The port each managed database last listened on, by key.
 *
 * Kept apart from the state file because it has to outlive the daemon: the
 * state file is cleared on every stop, and it is what a stopped daemon's
 * successor reads to come back where the last one was. See
 * {@link chooseManagedPort}.
 */
export const PORTS_FILE_NAME = "pglite-ports.json";

export interface DaemonState {
    /** TCP port the socket server is listening on, chosen when it started. */
    port: number;
    /** The daemon process. Used only as a fast negative check. */
    pid: number;
    /** Absolute path of the PGlite data directory this daemon has open. */
    dataDir: string;
    /** ISO timestamp, for diagnostics. */
    startedAt: string;
    /**
     * A random token the daemon also answers with over the wire, on
     * {@link identityPort}.
     *
     * Without it, "is the daemon alive?" degrades to "is something listening on
     * that port?", which is a different question and answers yes for whatever
     * process happened to take the port after a reboot. Rebase would then send
     * migrations to a stranger.
     */
    token: string;
    /** Loopback port that answers the identity check. */
    identityPort: number;
    /**
     * The additional databases this daemon serves, by declared key.
     *
     * One PGlite instance each — PGlite is one database per instance, so
     * `database("analytics")` is a second data directory and a second port,
     * not a `CREATE DATABASE`. Started on demand when a command asks for the
     * key over the identity socket, and recorded here so `rebase status` and
     * a reset can see them. The default database is the fields above.
     */
    databases?: Record<string, { port: number; dataDir: string }>;
    /**
     * The version of the CLI that started this daemon.
     *
     * The daemon outlives the command that started it, and the database proxy
     * runs inside it — so after `rebase upgrade` the old proxy, and its bugs,
     * kept serving until `rebase db stop` or thirty idle minutes. A daemon
     * started before this was recorded has none; see `daemonOutdated`.
     */
    cliVersion?: string;
}

export function devDbDir(projectRoot: string): string {
    return path.join(projectRoot, DEV_DB_DIR);
}

export function dataDir(projectRoot: string): string {
    return path.join(devDbDir(projectRoot), DATA_DIR_NAME);
}

/**
 * The data directory for an additional declared database.
 *
 * `pgdata__analytics`: the key spelled the way its variable is, so the
 * directory beside `pgdata` and `DATABASE_URL__ANALYTICS` are visibly the
 * same thing.
 */
export function additionalDataDir(projectRoot: string, key: string): string {
    return path.join(devDbDir(projectRoot), `${DATA_DIR_NAME}${resourceEnvSuffix(key).toLowerCase()}`);
}

export function stateFile(projectRoot: string): string {
    return path.join(devDbDir(projectRoot), STATE_FILE_NAME);
}

export function startLockFile(projectRoot: string): string {
    return path.join(devDbDir(projectRoot), START_LOCK_NAME);
}

/**
 * Take the start lock, or report that somebody else holds it.
 *
 * `wx` is the whole mechanism: create-if-absent is a single atomic syscall, so
 * exactly one of two racing processes can succeed no matter how close together
 * they arrive.
 *
 * A lock older than `staleAfterMs` is broken rather than waited on — the holder
 * may have been killed between creating it and starting anything, and a
 * developer should never have to know this file exists in order to unstick
 * their project.
 */
export function acquireStartLock(projectRoot: string, staleAfterMs: number): boolean {
    const target = startLockFile(projectRoot);
    fs.mkdirSync(devDbDir(projectRoot), { recursive: true });

    const attempt = (): boolean => {
        try {
            const handle = fs.openSync(target, "wx");
            fs.writeSync(handle, `${process.pid} ${new Date().toISOString()}\n`);
            fs.closeSync(handle);

            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;

            return false;
        }
    };

    if (attempt()) return true;

    try {
        // Clamped at zero: a filesystem whose timestamp granularity rounds the
        // mtime *up* reports a negative age for a lock created moments ago,
        // and a negative age is below every threshold — so `staleAfterMs: 0`,
        // which means "break any lock", would refuse to break one.
        const age = Math.max(0, Date.now() - fs.statSync(target).mtimeMs);
        if (age < staleAfterMs) return false;
        fs.unlinkSync(target);
    } catch {
        // Vanished under us, which means the holder finished. Either way the
        // next attempt is the answer.
    }

    return attempt();
}

export function releaseStartLock(projectRoot: string): void {
    try {
        fs.unlinkSync(startLockFile(projectRoot));
    } catch {
        // Already released is the desired end state.
    }
}

/**
 * Parse the record, or `null` for anything that is not one.
 *
 * Every failure is the same answer — absent — because every failure has the
 * same remedy: start a daemon. A corrupt state file is not worth an error
 * message to a user who never wrote it.
 */
export function readState(projectRoot: string): DaemonState | null {
    let raw: string;
    try {
        raw = fs.readFileSync(stateFile(projectRoot), "utf8");
    } catch {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<DaemonState>;
        if (
            typeof parsed.port !== "number" ||
            !Number.isInteger(parsed.port) ||
            parsed.port <= 0 ||
            parsed.port > 65535 ||
            typeof parsed.pid !== "number" ||
            typeof parsed.dataDir !== "string" ||
            typeof parsed.token !== "string" ||
            parsed.token.length === 0 ||
            typeof parsed.identityPort !== "number" ||
            !Number.isInteger(parsed.identityPort) ||
            parsed.identityPort <= 0 ||
            parsed.identityPort > 65535
        ) {
            return null;
        }

        // Only well-formed entries survive: a malformed one is treated as
        // absent, and the next ensure asks the daemon for it again.
        const databases: Record<string, { port: number; dataDir: string }> = {};
        if (parsed.databases && typeof parsed.databases === "object") {
            for (const [key, entry] of Object.entries(parsed.databases)) {
                if (
                    entry && typeof entry.port === "number" && Number.isInteger(entry.port)
                    && entry.port > 0 && entry.port <= 65535 && typeof entry.dataDir === "string"
                ) {
                    databases[key] = { port: entry.port, dataDir: entry.dataDir };
                }
            }
        }

        return {
            port: parsed.port,
            pid: parsed.pid,
            dataDir: parsed.dataDir,
            startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
            token: parsed.token,
            identityPort: parsed.identityPort,
            ...(Object.keys(databases).length > 0 ? { databases } : {}),
            ...(typeof parsed.cliVersion === "string" && parsed.cliVersion.trim() ? { cliVersion: parsed.cliVersion.trim() } : {})
        };
    } catch {
        return null;
    }
}

export function writeState(projectRoot: string, state: DaemonState): void {
    fs.mkdirSync(devDbDir(projectRoot), { recursive: true });
    // Written whole then moved, so a reader never sees half a record — commands
    // poll this file while the daemon is starting.
    const target = stateFile(projectRoot);
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, target);
}

export function clearState(projectRoot: string): void {
    try {
        fs.unlinkSync(stateFile(projectRoot));
    } catch {
        // Already gone is the desired end state.
    }
}

/** Is *some* process with this pid running? A fast, cheap negative check. */
export function pidRunning(pid: number): boolean {
    try {
        // Signal 0 performs the permission and existence checks without
        // delivering anything.
        process.kill(pid, 0);

        return true;
    } catch (error) {
        // EPERM means it exists and belongs to someone else, which for our
        // purposes is still "running".
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

/** Can a TCP connection be opened to this port on loopback? */
export function portAccepting(port: number, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const settle = (answer: boolean) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(answer);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => settle(true));
        socket.once("timeout", () => settle(false));
        socket.once("error", () => settle(false));
        socket.connect(port, "127.0.0.1");
    });
}

/**
 * Ask a port for a free one, then hand back the number.
 *
 * Deliberately not the probe `rebase init` uses: that one has a documented
 * failure where a port is free to probe and unusable to publish. This binds on
 * loopback only, which is also where the daemon listens, so a port that binds
 * here binds there.
 */
export function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address === null || typeof address === "string") {
                server.close(() => reject(new Error("Could not determine a free port.")));

                return;
            }
            const { port } = address;
            server.close(() => resolve(port));
        });
    });
}

/** Where a project's derived database port falls: 25432–26431. */
const MANAGED_PORT_FIRST = 25432;
const MANAGED_PORT_SPAN = 1000;

/**
 * The port a project's managed database tries first when nothing is recorded:
 * derived from the project path, and for an additional database from its key
 * too, so two projects — and a project's two databases — rarely ask for the
 * same one.
 *
 * Below every ephemeral range (Linux hands out 32768 and up, macOS 49152 and
 * up), so an outgoing connection's source port never sits on it, and clear of
 * the ports `rebase dev` derives for the backend (3001–3999), the admin panel
 * (5173–5372) and the compose database (5433–5632).
 */
export function derivedManagedPort(projectRoot: string, key: string = DEFAULT_RESOURCE_KEY): number {
    const seed = key === DEFAULT_RESOURCE_KEY ? path.resolve(projectRoot) : `${path.resolve(projectRoot)}\0${key}`;
    const digest = createHash("sha256").update(seed).digest();
    return MANAGED_PORT_FIRST + (digest.readUInt32BE(0) % MANAGED_PORT_SPAN);
}

function portsFile(projectRoot: string): string {
    return path.join(devDbDir(projectRoot), PORTS_FILE_NAME);
}

/** The port each database last listened on, by key; empty when nothing is recorded or the record is unreadable. */
function readRecordedPorts(projectRoot: string): Record<string, number> {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(portsFile(projectRoot), "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const ports: Record<string, number> = {};
        for (const [key, port] of Object.entries(parsed)) {
            if (typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535) ports[key] = port;
        }
        return ports;
    } catch {
        return {};
    }
}

/**
 * Remember where these databases listen, merged into what is recorded.
 *
 * Best effort: a `.rebase/` that cannot be written costs the next start its
 * preference, not the start itself.
 */
export function recordManagedPorts(projectRoot: string, ports: Record<string, number>): void {
    try {
        fs.mkdirSync(devDbDir(projectRoot), { recursive: true });
        const merged = { ...readRecordedPorts(projectRoot), ...ports };
        const target = portsFile(projectRoot);
        const temporary = `${target}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
        fs.renameSync(temporary, target);
    } catch {
        // See above.
    }
}

/** Can a server listen on this loopback port right now? */
export function portBindable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
    });
}

/**
 * The port a managed database should listen on: where it listened last time,
 * else the one derived from the project path, else any free one.
 *
 * Stable on purpose. A backend holds the URL it was started with, and a pool
 * reconnects to the same address on its own — so a database that comes back on
 * the port it had is one a running `rebase dev` recovers from without a
 * restart. It used to be whatever the operating system handed out, and a `rebase
 * db stop` followed by any command that starts it again left the backend
 * dialling a port nothing listened on, answering 503 until dev was restarted.
 *
 * @param canBind stands in for {@link portBindable} in the tests.
 */
export async function chooseManagedPort(
    projectRoot: string,
    key: string = DEFAULT_RESOURCE_KEY,
    canBind: (port: number) => Promise<boolean> = portBindable
): Promise<number> {
    const candidates = [readRecordedPorts(projectRoot)[key], derivedManagedPort(projectRoot, key)];
    for (const port of new Set(candidates.filter((candidate): candidate is number => candidate !== undefined))) {
        if (await canBind(port)) return port;
    }
    return findFreePort();
}
