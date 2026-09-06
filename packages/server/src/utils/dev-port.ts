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
 * This module is dev-only and should never run in production.
 */
import type { Server } from "http";
import net, { type AddressInfo } from "net";
import path from "path";
import fs from "fs";

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
    }
): Promise<number> {
    const host = options?.host ?? "0.0.0.0";
    const maxAttempts = options?.maxAttempts ?? MAX_PORT_ATTEMPTS;
    const portFileDir = options?.portFileDir;

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
    let affinityPort: number | null = null;
    if (portFileDir) {
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

                // Write the port file so the CLI can pick it up
                if (portFileDir) {
                    try {
                        const portFile = path.join(portFileDir, DEV_PORT_FILENAME);
                        // Bound port first so `parseInt` still yields it, then the
                        // port that was requested — that is what makes the affinity
                        // above conditional rather than absolute.
                        fs.writeFileSync(portFile, `${bound} ${startPort}`, "utf-8");
                    } catch {
                        // Non-fatal — the CLI will fall back to parsing stdout
                    }

                    // Write .rebase/state.json so external scripts can discover
                    // the running server port, URL, etc.
                    writeStateFile(portFileDir, bound, options?.serviceKey);
                }

                resolve(bound);
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
 * Clean up the dev port file and state file (call on graceful shutdown).
 *
 * @internal Not part of the stable public API. See {@link listenWithPortRetry}.
 */
export function cleanupDevPortFile(dir: string): void {
    try {
        const portFile = path.join(dir, DEV_PORT_FILENAME);
        if (fs.existsSync(portFile)) {
            fs.unlinkSync(portFile);
        }
    } catch {
        // ignore
    }
    try {
        const stateFile = path.join(dir, ".rebase", "state.json");
        if (fs.existsSync(stateFile)) {
            fs.unlinkSync(stateFile);
        }
    } catch {
        // ignore
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
