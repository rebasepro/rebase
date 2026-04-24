/**
 * Dev-mode port resolution utilities.
 *
 * Provides a `listen` wrapper that automatically retries the next port when
 * the requested one is already in use, and writes the resolved port to a
 * well-known temp file so the CLI / frontend can discover it.
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
 * Resolves with the port that was actually bound.
 */
export function listenWithPortRetry(
    server: Server,
    startPort: number,
    options?: {
        host?: string;
        maxAttempts?: number;
        /** Absolute path to write the resolved port file into.  Defaults to `process.cwd()`. */
        portFileDir?: string;
    }
): Promise<number> {
    const host = options?.host ?? "0.0.0.0";
    const maxAttempts = options?.maxAttempts ?? MAX_PORT_ATTEMPTS;
    const portFileDir = options?.portFileDir;

    return new Promise<number>((resolve, reject) => {
        let attempt = 0;

        function tryPort(port: number) {
            attempt++;

            const onError = (err: NodeJS.ErrnoException) => {
                if (err.code === "EADDRINUSE") {
                    if (attempt >= maxAttempts) {
                        reject(new Error(
                            `All ports ${startPort}–${startPort + maxAttempts - 1} are in use. ` +
                            `Stop other Rebase instances or specify a different port.`
                        ));
                        return;
                    }
                    // Clean up the listener before retrying
                    server.removeListener("error", onError);
                    tryPort(port + 1);
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
                }

                resolve(port);
            });
        }

        tryPort(startPort);
    });
}

/**
 * Clean up the dev port file (call on graceful shutdown).
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
}
