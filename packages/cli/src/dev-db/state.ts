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

import fs from "fs";
import net from "net";
import path from "path";

/** Everything under here is generated and gitignored. */
export const DEV_DB_DIR = ".rebase";
/** PGlite's own data directory. Deleting it is what `--reset` means. */
export const DATA_DIR_NAME = "pgdata";
/** The record the daemon writes once it is accepting connections. */
export const STATE_FILE_NAME = "pglite.json";

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
}

export function devDbDir(projectRoot: string): string {
    return path.join(projectRoot, DEV_DB_DIR);
}

export function dataDir(projectRoot: string): string {
    return path.join(devDbDir(projectRoot), DATA_DIR_NAME);
}

export function stateFile(projectRoot: string): string {
    return path.join(devDbDir(projectRoot), STATE_FILE_NAME);
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

        return {
            port: parsed.port,
            pid: parsed.pid,
            dataDir: parsed.dataDir,
            startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
            token: parsed.token,
            identityPort: parsed.identityPort
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
