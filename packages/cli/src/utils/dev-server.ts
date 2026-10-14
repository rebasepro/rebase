/**
 * Where `rebase dev` serves a project's backend.
 *
 * Not the `PORT` in `.env`: `rebase dev` overrides it with a port derived from
 * the project's path, so two projects on one machine do not collide, and that
 * `PORT` is what `rebase start` listens on. A command that talks to the backend
 * and gets no answer has to be able to say both — its hint named only `.env`'s
 * 3001, for a project whose dev server had been on 3732.
 */
import fs from "fs";
import path from "path";

import { findProjectRoot } from "./project";

/**
 * The address `rebase dev` is starting its backend on, handed to the
 * `generate-sdk` child it runs.
 *
 * Dev regenerates the SDK at boot, beside the database start and before the
 * backend binds — so before the backend writes `.rebase/state.json`, which is
 * where `generate-sdk` otherwise reads the address for the README's example.
 * Dev knows the port it hands the backend, and the child's environment is the
 * only channel between them.
 */
export const DEV_BACKEND_URL_ENV = "REBASE_DEV_BACKEND_URL";

/**
 * The port `rebase dev` derives from the project root path.
 * Range: 3001–3999 (avoids privileged ports and common services).
 * Two different project directories will almost always get different ports.
 */
export function getProjectPort(projectRoot: string): number {
    let hash = 0;
    for (let i = 0; i < projectRoot.length; i++) {
        hash = ((hash << 5) - hash + projectRoot.charCodeAt(i)) | 0;
    }
    return 3001 + (Math.abs(hash) % 999);
}

/** A TCP port out of a string or a number, or null. */
function portOf(raw: unknown): number | null {
    const port = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

function readText(file: string): string | null {
    try {
        return fs.readFileSync(file, "utf-8").trim();
    } catch {
        return null;
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
 * The address of this project's backend while it runs, or `null`.
 *
 * From `.rebase/state.json`, which the server writes when it binds — under
 * `rebase dev` and `rebase start` alike — and only while the pid it names is
 * alive: a backend that was killed leaves the file behind.
 */
export function runningBackendUrl(projectRoot: string): string | null {
    const state = readText(path.join(projectRoot, ".rebase", "state.json"));
    if (!state) return null;
    try {
        const parsed: unknown = JSON.parse(state);
        if (typeof parsed !== "object" || parsed === null || !("pid" in parsed)) return null;
        const pid = parsed.pid;
        if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) return null;
        if ("baseUrl" in parsed && typeof parsed.baseUrl === "string" && parsed.baseUrl.trim()) return parsed.baseUrl.trim();
        const port = "port" in parsed ? portOf(parsed.port) : null;
        return port !== null ? `http://localhost:${port}` : null;
    } catch {
        return null;
    }
}

/**
 * The URL `rebase dev` serves this project on, and how that is known:
 *
 *   - `running` — the URL a running dev wrote to `.rebase-dev-url`;
 *   - `recorded` — the port the last run left in `.rebase/state.json` or
 *     `.rebase-dev-port` (both outlive a dev that did not shut down cleanly);
 *   - `derived` — nothing is recorded, so the port it derives for this path.
 *
 * Asked only to describe where dev is; a `PORT` in the shell would move the
 * next run, and is not something a stopped dev left behind.
 */
export function devServerUrl(projectRoot: string): { url: string; source: "running" | "recorded" | "derived" } {
    const running = readText(path.join(projectRoot, ".rebase-dev-url"));
    if (running) return { url: running, source: "running" };

    const state = readText(path.join(projectRoot, ".rebase", "state.json"));
    if (state) {
        try {
            const parsed: unknown = JSON.parse(state);
            const port = typeof parsed === "object" && parsed !== null && "port" in parsed ? portOf(parsed.port) : null;
            if (port !== null) return { url: `http://localhost:${port}`, source: "recorded" };
        } catch { /* fall through to the port file */ }
    }

    const portFile = portOf(readText(path.join(projectRoot, ".rebase-dev-port"))?.split(/\s+/)[0]);
    if (portFile !== null) return { url: `http://localhost:${portFile}`, source: "recorded" };

    return { url: `http://localhost:${getProjectPort(projectRoot)}`, source: "derived" };
}

/**
 * What to say when nothing answered at `baseUrl`.
 *
 * The first line is the question it always asked. The second is added when
 * `rebase dev` serves this project somewhere else, because then `baseUrl` is
 * almost always `.env`'s `PORT`, and a reader who just stopped `rebase dev`
 * reads the number as the one it was using.
 */
export function serverUnreachableHint(baseUrl: string, projectRoot: string | null = findProjectRoot()): string[] {
    const lines = [`  Is the Rebase server running at ${baseUrl}? Start it with \`rebase dev\`, or set REBASE_BASE_URL in .env.`];
    if (!projectRoot) return lines;

    const dev = devServerUrl(projectRoot);
    let same = false;
    try {
        same = new URL(dev.url).origin === new URL(baseUrl).origin;
    } catch {
        // An unparseable URL on either side is not the same address.
    }
    if (same) return lines;

    const why = dev.source === "derived" ? "the port it picks for this project" : "the port it last used";
    lines.push(`  \`rebase dev\` serves this project at ${dev.url} (${why}), and this command uses that address while it runs.`);

    return lines;
}
