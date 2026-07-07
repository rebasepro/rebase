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
import path from "path";
import fs from "fs";

const MAX_PORT_ATTEMPTS = 20;

/** Filename written next to the project `.env` so the CLI can read it. */
export const DEV_PORT_FILENAME = ".rebase-dev-port";

/**
 * Try to `listen` on `startPort`. If the port is busy (`EADDRINUSE`), increment
 * and retry up to `maxAttempts` times.
 *
 * When a port file already exists (written by a previous run), the saved port
 * is tried first to maintain port affinity across tsx watch restarts.
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
                resolve(startPort);
            });
        });
    }

    // Read affinity port from a previous run's port file.
    // This ensures tsx watch restarts land on the same port the frontend was
    // configured with, even if the CLI-computed port was different.
    let affinityPort: number | null = null;
    if (portFileDir) {
        try {
            const portFile = path.join(portFileDir, DEV_PORT_FILENAME);
            if (fs.existsSync(portFile)) {
                const saved = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
                if (saved > 0 && saved < 65536 && saved !== startPort) {
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

            const onError = (err: NodeJS.ErrnoException) => {
                if (err.code === "EADDRINUSE") {
                    server.removeListener("error", onError);
                    tryNext(index + 1);
                } else {
                    reject(err);
                }
            };

            server.once("error", onError);

            server.listen(port, host, () => {
                server.removeListener("error", onError);

                // Write the port file so the CLI can pick it up
                if (portFileDir) {
                    try {
                        const portFile = path.join(portFileDir, DEV_PORT_FILENAME);
                        fs.writeFileSync(portFile, String(port), "utf-8");
                    } catch {
                        // Non-fatal — the CLI will fall back to parsing stdout
                    }

                    // Write .rebase/state.json so external scripts can discover
                    // the running server port, URL, etc.
                    writeStateFile(portFileDir, port, options?.serviceKey);
                }

                resolve(port);
            });
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
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
    } catch {
        // Non-fatal
    }
}
