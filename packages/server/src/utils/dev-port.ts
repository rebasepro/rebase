/**
 * Dev-mode port resolution utilities.
 *
 * Provides a `listen` wrapper that automatically retries the next port when
 * the requested one is already in use, and writes the resolved port to a
 * well-known temp file so the CLI / frontend can discover it.
 *
 * Port affinity: when a port file already exists (e.g. after a tsx watch
 * restart), the saved port is tried FIRST so the backend stays on the same
 * port the frontend was configured with.
 *
 * One server in a project holds the files at a time, and each removes only its
 * own: see `heldByAnotherServer` and {@link cleanupDevPortFile}.
 *
 * This module is dev-only and should never run in production.
 */
import type { Server } from "http";
import net, { type AddressInfo } from "net";
import path from "path";
import fs from "fs";
import { parseEnvBoolean } from "@rebasepro/types";

import { logger } from "./logger";

const MAX_PORT_ATTEMPTS = 20;

/** How long to wait for a loopback squatter to answer before assuming there is none. */
const LOOPBACK_PROBE_TIMEOUT_MS = 300;

/**
 * Is something already serving this port on loopback?
 *
 * Asked by *connecting*, not by binding, because binding cannot answer it.
 * The dev server binds `0.0.0.0`, and on Linux and macOS that succeeds while
 * another process holds `127.0.0.1:<port>` — the two sockets coexist, the
 * kernel routes loopback traffic to the more specific bind, and `EADDRINUSE`
 * never fires. Vite's default is exactly that bind.
 *
 * What it looked like: `node -e "…listen(3013,'127.0.0.1')"`, then
 * `rebase dev --port 3013` announced `Server running at
 * http://localhost:3013`, and `curl localhost:3013` answered from the other
 * process. `lsof` showed both sockets. The retry the port-collision warning
 * exists for could not fire, because from `listen`'s point of view nothing
 * had collided.
 *
 * Both loopback addresses, because a listener on `::1` alone produces the
 * identical failure and costs one more connect attempt to rule out.
 */
async function loopbackInUse(port: number, timeoutMs = LOOPBACK_PROBE_TIMEOUT_MS): Promise<boolean> {
    const probe = (host: string) => new Promise<boolean>(resolve => {
        const socket = new net.Socket();
        const settle = (answer: boolean) => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(answer);
        };
        socket.setTimeout(timeoutMs);
        // A refused connection is the answer we want: nothing is there.
        socket.once("error", () => settle(false));
        socket.once("timeout", () => settle(false));
        socket.once("connect", () => settle(true));
        socket.connect(port, host);
    });

    return (await Promise.all([probe("127.0.0.1"), probe("::1")])).some(Boolean);
}

/** Filename written next to the project `.env` so the CLI can read it. */
export const DEV_PORT_FILENAME = ".rebase-dev-port";

/**
 * Try to `listen` on `startPort`. If the port is busy (`EADDRINUSE`), increment
 * and retry up to `maxAttempts` times.
 *
 * When a port file written by a previous run exists *and that run asked for the
 * same `startPort`*, the port it landed on is tried first, so tsx watch restarts
 * keep the address the frontend was configured with. A different `startPort` means
 * the configuration changed and the file is ignored — an explicitly requested port
 * is never overridden by a stale one.
 *
 * Resolves with the port that was actually bound.
 *
 * @internal Not part of the stable public API. Exported only because the
 * official app template (`packages/cli/templates/template/backend/src/index.ts`
 * and `app/backend/src/index.ts`) calls it directly in dev mode. Its dev-only
 * port-affinity behavior is an implementation detail and may change without
 * a major version bump.
 */
export function listenWithPortRetry(
    server: Server,
    startPort: number,
    options?: {
        host?: string;
        maxAttempts?: number;
        /** Absolute path to write the resolved port file into.  Defaults to `process.cwd()`. */
        portFileDir?: string;
        /** Service key to include in the state file for MCP server auto-discovery. */
        serviceKey?: string;
        /**
         * The port was named, not derived — so bind it or fail.
         *
         * Walking is right for the port this project *computed* for itself: it
         * is one hash of a path away from another project's, and moving to the
         * next free one is invisible and harmless. It is wrong for a port a
         * developer typed. `rebase dev --port 3140` with a backend already on
         * 3140 announced `↳ PORT = 3140`, walked to 3142, and left a `curl
         * localhost:3140` answering 200 from the *other* project — because dev
         * ports are derived per project, the number you type is very often
         * another Rebase backend, and the wrong-app answer looks exactly like
         * the right one.
         *
         * Defaults from `REBASE_DEV_PORT_EXPLICIT`, which `rebase dev` sets on
         * the backend it spawns: the CLI is where `--port` is known, and the
         * child's environment is the only channel between them.
         */
        explicit?: boolean;
    }
): Promise<number> {
    const host = options?.host ?? "0.0.0.0";
    const maxAttempts = options?.maxAttempts ?? MAX_PORT_ATTEMPTS;
    const portFileDir = options?.portFileDir;
    const explicit = options?.explicit ?? parseEnvBoolean(process.env.REBASE_DEV_PORT_EXPLICIT) === true;

    const isProd = process.env.NODE_ENV === "production";
    if (isProd) {
        return new Promise<number>((resolve, reject) => {
            const onError = (err: Error) => {
                reject(err);
            };
            server.once("error", onError);
            server.listen(startPort, host, () => {
                server.removeListener("error", onError);
                // Same reason as the dev path below: `startPort` may be `0`.
                resolve(boundPort(server) ?? startPort);
            });
        });
    }

    // Read affinity port from a previous run's port file.
    // This ensures tsx watch restarts land on the same port the frontend was
    // configured with, even if the CLI-computed port was different.
    //
    // It applies only when the port being *asked for* has not changed since that
    // file was written, which is why the file records both. Affinity used to win
    // outright, so a stale file silently overrode an explicit port: set `PORT=4000`
    // in `.env` and the server would keep binding whatever the last run happened to
    // land on, reporting the old number. `resolvePort` in the CLI has always ranked
    // these correctly — explicit `--port`, then `PORT`, then affinity — and this is
    // the server agreeing with it.
    //
    // The e2e suite is what surfaced it: it assigns each backend a fresh free port,
    // and the second boot in a project ignored it and re-bound the first one.
    //
    // A named port has no affinity at all: the file records where the *last*
    // run landed, and trying that first is the same silent substitution the
    // walk below refuses.
    let affinityPort: number | null = null;
    if (portFileDir && !explicit) {
        try {
            const portFile = path.join(portFileDir, DEV_PORT_FILENAME);
            if (fs.existsSync(portFile)) {
                // "<bound> <requested>" — `parseInt` stops at the space, so older
                // readers that expect a bare number still read the bound port.
                const [savedRaw, requestedRaw] = fs.readFileSync(portFile, "utf-8").trim().split(/\s+/);
                const saved = parseInt(savedRaw, 10);
                const requestedThen = requestedRaw === undefined ? NaN : parseInt(requestedRaw, 10);
                const sameRequest = Number.isNaN(requestedThen) || requestedThen === startPort;
                if (saved > 0 && saved < 65536 && saved !== startPort && sameRequest) {
                    affinityPort = saved;
                }
            }
        } catch { /* ignore */ }
    }

    return new Promise<number>((resolve, reject) => {
        let attempt = 0;
        // Build the ordered list of ports to try:
        // 1. The affinity port (if different from startPort)
        // 2. startPort, startPort+1, startPort+2, ...
        const portsToTry: number[] = [];
        if (affinityPort) portsToTry.push(affinityPort);
        for (let i = 0; i < maxAttempts; i++) {
            const p = startPort + i;
            if (p !== affinityPort) portsToTry.push(p);
        }

        function tryNext(index: number) {
            if (index >= portsToTry.length) {
                reject(new Error(
                    "All attempted ports are in use. " +
                    "Stop other Rebase instances or specify a different port with --port."
                ));
                return;
            }

            const port = portsToTry[index];
            attempt++;

            // Both listeners are removed on either outcome.
            //
            // This used to pass the success handler as `server.listen(port, host, cb)`,
            // and that form registers `cb` as a one-shot `listening` listener which a
            // *failed* attempt never removes. So after an EADDRINUSE, the next attempt's
            // success ran both handlers, and the earliest one won the promise: the
            // function resolved with — and wrote into the port file — the port it had
            // just failed to bind.
            //
            // What that looked like: with something already on 3001, the server bound
            // 3002 and announced "API running at http://localhost:3001". Every caller
            // that trusted the banner reached the *other* process, which answered
            // normally from its own database. No error was logged anywhere. It cost the
            // templates e2e six failures that blamed registration, and it would hand a
            // developer running two projects a URL that silently serves the wrong app.
            const onListening = () => {
                cleanup();

                // Ask the socket, do not assume the request was granted.
                //
                // `port` here is what we *asked* for, and for one legitimate
                // value that is not what we got: `0` means "any free port", so
                // the OS picks one and the request itself is never a real
                // address. Resolving with the request announced
                // `http://localhost:0`, wrote `0` into the port file and into
                // `.rebase/state.json`, and every consumer of those — the CLI's
                // banner, MCP discovery, a health check — then pointed at a port
                // nothing listens on. This is the same class as the retry bug
                // documented above (announcing a port we are not on); the fix is
                // the same in both: the socket is the only thing that knows.
                const bound = boundPort(server) ?? port;

                if (!portFileDir) {
                    resolve(bound);
                    return;
                }

                // Only when no other live server holds the files — see
                // `heldByAnotherServer`. Never a reason not to serve.
                void heldByAnotherServer(portFileDir, bound).catch(() => false).then(held => {
                    if (!held) writeDevFiles(portFileDir, bound, startPort, options?.serviceKey);
                    resolve(bound);
                });
            };

            /**
             * Say which port was refused and which one is next.
             *
             * The retry is silent otherwise, and silence here is how a
             * developer ends up staring at a server on 3002 while their
             * frontend, their bookmark and their curl all point at 3001 — with
             * nothing anywhere saying a port was ever skipped. The most common
             * cause is the previous run still holding the socket, and that is
             * worth knowing before the next twenty minutes go into a phantom
             * bug.
             */
            const moveOn = () => {
                // A named port does not move. See `options.explicit`: the walk
                // is a convenience for a port nobody chose, and applying it to
                // one somebody typed hands them another project's backend on
                // the address they asked for.
                if (explicit) {
                    reject(new Error(
                        `Port ${port} is in use, and it was requested explicitly — ` +
                        "the dev server does not move to the next free port when the port was named. " +
                        `Stop whatever is listening on ${port}, or ask for a different one.`
                    ));
                    return;
                }
                const next = portsToTry[index + 1];
                logger.warn(next !== undefined
                    ? `Port ${port} is in use — trying ${next}.`
                    : `Port ${port} is in use, and it was the last one to try.`);
                tryNext(index + 1);
            };

            const onError = (err: NodeJS.ErrnoException) => {
                cleanup();
                if (err.code === "EADDRINUSE") moveOn();
                else reject(err);
            };

            function cleanup() {
                server.removeListener("listening", onListening);
                server.removeListener("error", onError);
            }

            const bind = () => {
                server.once("error", onError);
                server.once("listening", onListening);
                server.listen(port, host);
            };

            // Port 0 means "any free port", so there is nothing to be in use.
            if (port === 0) {
                bind();
                return;
            }

            // Asked before binding, because binding cannot answer it — see
            // `loopbackInUse`. A probe that itself fails is not evidence of a
            // squatter, so the bind goes ahead and `EADDRINUSE` stays the
            // authority for every collision it can actually see.
            void loopbackInUse(port).then(
                taken => (taken ? moveOn() : bind()),
                () => bind()
            );
        }

        tryNext(0);
    });
}

/**
 * What this process wrote into each project's `.rebase-dev-port`, by
 * directory, so that stopping removes the file only while it still says that.
 */
const writtenPortFiles = new Map<string, string>();

function stateFilePath(dir: string): string {
    return path.join(dir, ".rebase", "state.json");
}

/** The pid and port `.rebase/state.json` names, or `null` when there is none to read. */
function readStateOwner(dir: string): { pid: number | null; port: number | null } | null {
    let raw: string;
    try {
        raw = fs.readFileSync(stateFilePath(dir), "utf-8");
    } catch {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return { pid: null, port: null };
        const pid = "pid" in parsed && typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0 ? parsed.pid : null;
        const port = "port" in parsed && typeof parsed.port === "number" && Number.isInteger(parsed.port) ? parsed.port : null;
        return { pid, port };
    } catch {
        return { pid: null, port: null };
    }
}

/** Is *some* process with this pid running? EPERM means it is, as someone else. */
function processAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

/**
 * Whether `rebase dev` started this server.
 *
 * It states `REBASE_DEV_PORT_EXPLICIT`, true or false, on every backend it
 * spawns (see `options.explicit` above), so the variable reading as either at
 * all is the mark. The dev files are named for that server and describe it
 * first.
 */
function startedByRebaseDev(): boolean {
    return parseEnvBoolean(process.env.REBASE_DEV_PORT_EXPLICIT) !== undefined;
}

/**
 * Whether another server in this project holds the dev files, so this one must
 * leave them alone.
 *
 * `rebase start` beside `rebase dev` is the documented local check, and both
 * bind through {@link listenWithPortRetry}. The files used to belong to
 * whoever bound last: `start` took them over while it ran, so `rebase
 * api-keys`, `generate-sdk` and MCP discovery all reached it rather than dev,
 * and when it stopped it deleted them under a dev that was still serving —
 * `api-keys list` then answered "This project's server is not running".
 *
 * So the files belong to the server `state.json` names while that server is
 * still there: its pid alive, and its port answering, because a pid alone can
 * be a stranger's after a crash and a reboot. A server on the very port it
 * names is not "another" one — that is a `tsx watch` restart, or a crash this
 * server has replaced. A server `rebase dev` started takes the files over in
 * every case: they are its own.
 */
async function heldByAnotherServer(dir: string, bound: number): Promise<boolean> {
    if (startedByRebaseDev()) return false;
    const owner = readStateOwner(dir);
    if (!owner || owner.pid === null || owner.pid === process.pid) return false;
    if (owner.port === null || owner.port === bound) return false;
    if (!processAlive(owner.pid)) return false;
    return loopbackInUse(owner.port);
}

/** Write `.rebase-dev-port` and `.rebase/state.json` for a server this process just bound. */
function writeDevFiles(dir: string, bound: number, requested: number, serviceKey?: string): void {
    try {
        // Bound port first so `parseInt` still yields it, then the port that
        // was requested — that is what makes the affinity above conditional
        // rather than absolute.
        const contents = `${bound} ${requested}`;
        fs.writeFileSync(path.join(dir, DEV_PORT_FILENAME), contents, "utf-8");
        writtenPortFiles.set(path.resolve(dir), contents);
    } catch {
        // Non-fatal — the CLI will fall back to parsing stdout
    }

    // Write .rebase/state.json so external scripts can discover
    // the running server port, URL, etc.
    writeStateFile(dir, bound, serviceKey);
}

/**
 * Clean up the dev port file and state file (call on graceful shutdown).
 *
 * Only this process's own: `state.json` while it names this pid, and
 * `.rebase-dev-port` while it holds what this process wrote and no other
 * server has taken `state.json` over. A `rebase start` that stopped beside a
 * running `rebase dev` used to delete dev's files — see `heldByAnotherServer`.
 *
 * @internal Not part of the stable public API. See {@link listenWithPortRetry}.
 */
export function cleanupDevPortFile(dir: string): void {
    const owner = readStateOwner(dir);
    const ownsState = owner?.pid === process.pid;
    if (ownsState) {
        try {
            fs.unlinkSync(stateFilePath(dir));
        } catch {
            // Already gone is the desired end state.
        }
    }

    const key = path.resolve(dir);
    const wrote = writtenPortFiles.get(key);
    if (wrote === undefined || !(ownsState || owner === null)) return;
    try {
        const portFile = path.join(dir, DEV_PORT_FILENAME);
        if (fs.readFileSync(portFile, "utf-8") === wrote) fs.unlinkSync(portFile);
        writtenPortFiles.delete(key);
    } catch {
        // Already gone is the desired end state.
    }
}

/**
 * Write `.rebase/state.json` with runtime info for external scripts.
 *
 * Scripts can read this file to discover:
 * - `port`       — the actual port the backend is listening on
 * - `baseUrl`    — full URL including protocol and port
 * - `pid`        — the backend process ID
 * - `startedAt`  — ISO timestamp of when the server started
 * - `serviceKey` — (dev only) the REBASE_SERVICE_KEY for MCP auto-discovery
 *
 * @example Reading from a script:
 * ```ts
 * const state = JSON.parse(fs.readFileSync('.rebase/state.json', 'utf-8'));
 * const apiUrl = state.baseUrl; // "http://localhost:3519"
 * ```
 */
function writeStateFile(projectRoot: string, port: number, serviceKey?: string): void {
    try {
        const rebaseDir = path.join(projectRoot, ".rebase");
        if (!fs.existsSync(rebaseDir)) {
            fs.mkdirSync(rebaseDir, { recursive: true });
        }
        const stateFile = path.join(rebaseDir, "state.json");
        const state: Record<string, unknown> = {
            port,
            baseUrl: `http://localhost:${port}`,
            pid: process.pid,
            startedAt: new Date().toISOString()
        };
        if (serviceKey) {
            state.serviceKey = serviceKey;
        }
        // Owner-only: the file can carry the dev service key. `mode` only
        // applies on create, so chmod covers a pre-existing file.
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
        fs.chmodSync(stateFile, 0o600);
    } catch {
        // Non-fatal
    }
}

/**
 * The port a server is actually listening on, or `undefined` if it cannot say.
 *
 * `Server.address()` returns a string for a UNIX socket and `null` before the
 * socket is bound, so neither is a port and both fall back to the caller's own
 * answer rather than being coerced into a number.
 */
function boundPort(server: Server): number | undefined {
    const address = server.address();
    if (!address || typeof address === "string") return undefined;
    return (address as AddressInfo).port;
}
