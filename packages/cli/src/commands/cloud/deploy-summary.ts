/**
 * What `rebase cloud deploy` says when it is done: which apps it shipped, where
 * each one answers, whether the new version is actually being served, and — when
 * it failed — which app and why, in one line.
 *
 * A deploy used to end on `{"success":true,…,"hosts":[]}`: no URL, a `hosts`
 * list that was empty for a project with a live host, and nothing that said the
 * new version was being served. Whoever ran it then checked with `curl`, after
 * every deploy. Everything here exists so they do not have to.
 *
 * Pure apart from {@link checkLive}, whose `fetch` and clock are injectable, so
 * all of it is testable without a control plane.
 */
import chalk from "chalk";
import type { RebaseBundleManifest } from "@rebasepro/types";
import type { DeployHost } from "./bundle-deploy";

/**
 * Where a backend's API is mounted on its host. The runtime's default
 * `REBASE_BASE_PATH`, which the platform does not let a project change.
 */
export const BACKEND_API_PATH = "/api";

/** How long the live check waits by default before saying it could not confirm. */
export const DEFAULT_LIVE_TIMEOUT_MS = 60_000;

/** One app a deploy shipped, and the address it now answers on. */
export interface DeployedApp {
    name: string;
    type: "backend" | "static";
    /**
     * The address a person would open — the site for a static app, the API
     * root for a backend. Absent when the host it is served on is unknown:
     * a guessed URL is worse than none.
     */
    url?: string;
    /** The hostname `url` is on. */
    host?: string;
}

/**
 * The apps a bundle ships, read off the bundle's own manifest.
 *
 * The manifest rather than `rebase.json`, because it is what was uploaded: it
 * covers `--bundle-dir` and a static app deployed alone exactly as it covers a
 * backend with its frontends folded in. A static app with a hostname of its own
 * answers there; every other app answers on the project's host.
 */
export function bundleApps(
    manifest: Pick<RebaseBundleManifest, "app" | "kind"> & { entry?: { static?: RebaseBundleManifest["entry"]["static"] } },
    projectHost: string | undefined
): DeployedApp[] {
    const apps: DeployedApp[] = [];
    if (manifest.kind === "backend") {
        apps.push(appAt(manifest.app, "backend", projectHost, BACKEND_API_PATH));
    }
    for (const entry of manifest.entry?.static ?? []) {
        const name = entry.name ?? (manifest.kind === "static" ? manifest.app : lastSegment(entry.dir));
        apps.push(appAt(name, "static", entry.host ?? projectHost, entry.path));
    }
    // A static bundle is its one app, whatever its entry says.
    if (manifest.kind === "static" && apps.length === 0) {
        apps.push(appAt(manifest.app, "static", projectHost, "/"));
    }
    // Root-mounted sites first: the address most people came for.
    return apps.sort((a, b) => order(a) - order(b));
}

/**
 * The one app a source build ships: whatever image the build produced, on the
 * project's host. The CLI did not build it, so it cannot say what is inside.
 */
export function sourceBuildApps(appName: string | undefined, projectHost: string | undefined): DeployedApp[] {
    return [appAt(appName ?? "backend", "backend", projectHost, "/")];
}

function appAt(name: string, type: DeployedApp["type"], host: string | undefined, appPath: string): DeployedApp {
    if (!host) return { name,
type };
    const suffix = appPath === "/" || appPath === "" ? "" : appPath.replace(/\/$/, "");
    return { name,
type,
host,
url: `https://${host}${suffix}` };
}

function lastSegment(dir: string): string {
    const parts = dir.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? dir;
}

function order(app: DeployedApp): number {
    if (app.type === "static" && app.url && !new URL(app.url).pathname.replace(/\/$/, "")) return 0;
    return app.type === "static" ? 1 : 2;
}

/**
 * Every hostname this deploy is served on: the project's own host, then the
 * hostnames the control plane registered for apps that declare one.
 *
 * The control plane's `hosts` lists only the second kind — hostnames an app's
 * `path` names, which a deploy has to register — so for the ordinary project,
 * served on its own `<slug>.rebase.website`, it was always empty. That read as
 * "this deploy is served nowhere". The project's host is served by the platform
 * from the moment the project exists, so it goes first, as verified.
 */
export function deployHosts(registered: DeployHost[] | undefined, projectHost: string | undefined): DeployHost[] {
    const hosts: DeployHost[] = projectHost ? [{ host: projectHost,
status: "verified" }] : [];
    for (const entry of registered ?? []) {
        if (!hosts.some(h => h.host === entry.host)) hosts.push(entry);
    }
    return hosts;
}

/* ─── is the new version live? ───────────────────────────────────────────── */

/** What probing one app's address found. */
export interface LiveCheck {
    app: string;
    /** The address probed: the site itself, or a backend's `/api/health`. */
    url: string;
    live: boolean;
    /** The HTTP status of the last answer, when there was one. */
    httpStatus?: number;
    /**
     * The deployment the answer says it came from (`x-rebase-deployment`), when
     * it says. Only the platform's static hosting stamps it; a managed pod's
     * readiness is the control plane's to confirm, and it did before `success`.
     */
    servingDeployment?: string;
    /** Why it is not live, in a few words. */
    reason?: string;
}

/** The URL that proves an app is up. */
export function probeUrl(app: DeployedApp): string | undefined {
    if (!app.url || !app.host) return undefined;
    return app.type === "backend" ? `https://${app.host}${BACKEND_API_PATH}/health` : app.url;
}

type FetchLike = typeof fetch;

/**
 * Probe one app once.
 *
 * A backend is live when its health route answers `200 {"status":"ok"}` — a
 * site at `/` with client-side routing answers 200 to *any* path, so a bare
 * status would let a folded SPA vouch for an API that is down. A static app is
 * live when its address answers below 400 and, if the answer names the
 * deployment it came from, that deployment is this one.
 */
export async function probeOnce(
    app: DeployedApp,
    deploymentId: string,
    fetchImpl: FetchLike
): Promise<LiveCheck | undefined> {
    const url = probeUrl(app);
    if (!url) return undefined;
    try {
        const res = await fetchImpl(url, {
            redirect: "follow",
            signal: AbortSignal.timeout(10_000),
            headers: { "cache-control": "no-cache" }
        });
        if (app.type === "backend") {
            const body = res.status === 200 ? await res.json().catch(() => undefined) : undefined;
            const ok = typeof body === "object" && body !== null && "status" in body && body.status === "ok";
            return ok
                ? { app: app.name,
url,
live: true,
httpStatus: res.status }
                : { app: app.name,
url,
live: false,
httpStatus: res.status,
                    reason: res.status === 200 ? "health check did not answer ok" : `health check answered ${res.status}` };
        }
        const serving = res.headers.get("x-rebase-deployment") ?? undefined;
        if (res.status >= 400) {
            return { app: app.name,
url,
live: false,
httpStatus: res.status,
reason: `answered ${res.status}` };
        }
        if (serving && serving !== deploymentId) {
            return { app: app.name,
url,
live: false,
httpStatus: res.status,
servingDeployment: serving,
                reason: `still serving deployment ${serving}` };
        }
        return { app: app.name,
url,
live: true,
httpStatus: res.status,
...(serving ? { servingDeployment: serving } : {}) };
    } catch (e) {
        return { app: app.name,
url,
live: false,
reason: networkReason(e) };
    }
}

/** `fetch failed` says nothing; its cause usually says which half failed. */
function networkReason(e: unknown): string {
    if (e instanceof Error) {
        if (e.name === "TimeoutError" || e.name === "AbortError") return "no answer within 10s";
        const cause = "cause" in e ? e.cause : undefined;
        if (cause instanceof Error && "code" in cause && typeof cause.code === "string") {
            return cause.code === "ENOTFOUND" ? "hostname does not resolve yet" : `unreachable (${cause.code})`;
        }
        return e.message;
    }
    return String(e);
}

/**
 * Probe every app on a verified host until each is live or `timeoutMs` passes.
 *
 * An app on a hostname whose DNS is not verified is reported, not probed: the
 * platform does not route it, and waiting on it would only spend the timeout.
 * Returns one entry per app that has a URL.
 */
export async function checkLive(
    apps: DeployedApp[],
    opts: {
        deploymentId: string;
        hosts: DeployHost[];
        timeoutMs: number;
        intervalMs?: number;
        fetchImpl?: FetchLike;
        sleep?: (ms: number) => Promise<void>;
        now?: () => number;
    }
): Promise<LiveCheck[]> {
    const fetchImpl = opts.fetchImpl ?? fetch;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    const now = opts.now ?? Date.now;
    const deadline = now() + opts.timeoutMs;

    const results = new Map<string, LiveCheck>();
    const pending: DeployedApp[] = [];
    for (const app of apps) {
        const url = probeUrl(app);
        if (!url) continue;
        const host = opts.hosts.find(h => h.host === app.host);
        if (host && host.status !== "verified") {
            results.set(app.name, { app: app.name,
url,
live: false,
reason: `DNS for ${app.host} is not verified yet` });
        } else {
            pending.push(app);
        }
    }

    for (;;) {
        const round = await Promise.all(pending.map(app => probeOnce(app, opts.deploymentId, fetchImpl)));
        for (const check of round) if (check) results.set(check.app, check);
        const stillDown = pending.filter(app => results.get(app.name)?.live !== true);
        if (stillDown.length === 0 || now() >= deadline) break;
        pending.splice(0, pending.length, ...stillDown);
        await sleep(Math.min(opts.intervalMs ?? 2_000, Math.max(0, deadline - now())));
    }

    // In the order the apps were listed, not the order they came up in.
    return apps.flatMap(app => results.get(app.name) ?? []);
}

/* ─── what gets printed ──────────────────────────────────────────────────── */

/** `42s`, `1m 12s`, `12m`. */
export function formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export interface DeploySummaryInput {
    projectRef: string;
    deploymentId: string;
    elapsedMs: number;
    apps: DeployedApp[];
    /**
     * The live check's results; `undefined` when it was not run
     * (`--live-timeout 0`), which is said rather than passed over.
     */
    live: LiveCheck[] | undefined;
    liveTimeoutMs: number;
}

/**
 * The human summary a successful deploy ends on: the project, each app with its
 * address and whether it answers, the deployment id and how long it took, and
 * one line that says whether the new version is live.
 */
export function deploySummaryLines(input: DeploySummaryInput): string[] {
    const lines: string[] = [
        "",
        chalk.bold.green(`  ✓ Deployed ${input.projectRef} in ${formatDuration(input.elapsedMs)}`)
            + chalk.gray(`  (deployment ${input.deploymentId})`),
        ""
    ];

    const nameWidth = Math.max(...input.apps.map(a => a.name.length), 0);
    const urlWidth = Math.max(...input.apps.map(a => (a.url ?? "").length), 0);
    for (const app of input.apps) {
        const check = input.live?.find(c => c.app === app.name);
        const state = !check
            ? ""
            : check.live
                ? chalk.green(check.servingDeployment ? "live, serving this deployment" : "live")
                : chalk.yellow(`not live: ${check.reason ?? "no answer"}`);
        const url = app.url ? chalk.cyan(app.url.padEnd(urlWidth)) : chalk.gray("(address unknown — see `rebase cloud status`)");
        lines.push(`    ${app.name.padEnd(nameWidth)}  ${chalk.gray(app.type.padEnd(7))}  ${url}  ${state}`.trimEnd());
    }
    lines.push("");

    const verdict = liveVerdict(input.live, input.liveTimeoutMs);
    lines.push(verdict.live === true
        ? chalk.green(`  ✓ ${verdict.message}`)
        : verdict.live === false ? chalk.yellow(`  ⚠ ${verdict.message}`) : chalk.gray(`  ${verdict.message}`));
    lines.push("");
    return lines;
}

/**
 * Whether the new version is live, as one sentence and one boolean.
 *
 * `live: null` when nothing was checked — the check was skipped, or no app had
 * an address to check — which is not the same answer as "no".
 */
export function liveVerdict(live: LiveCheck[] | undefined, timeoutMs: number): { live: boolean | null; message: string } {
    if (live === undefined) {
        return { live: null,
message: "Live check skipped (--live-timeout 0)." };
    }
    if (live.length === 0) {
        return { live: null,
message: "No address to check: run `rebase cloud status` to see where the project answers." };
    }
    const down = live.filter(c => !c.live);
    if (down.length === 0) {
        return { live: true,
message: "Live: the new version answers on every address above." };
    }
    const which = down.map(c => `${c.app} (${c.reason ?? "no answer"})`).join(", ");
    return {
        live: false,
        message: `Not confirmed live after ${formatDuration(timeoutMs)}: ${which}. `
            + "The deployment itself succeeded — check again with `rebase cloud status`."
    };
}

/**
 * Why a deployment failed, in one line, from its build log.
 *
 * The control plane ends a failed job's log on a `❌ <heading>: <why>` line (a
 * cancelled one on `🛑`), so that line is the reason. A log without one — an
 * older control plane, a job that died mid-write — gives its last line instead,
 * which is still closer to the truth than "failed".
 */
export function failureReason(logs: string): string | undefined {
    const lines = logs.split("\n").map(l => l.trim()).filter(Boolean);
    const marked = [...lines].reverse().find(l => /(^|\]\s*)(❌|🛑)/.test(l));
    const line = marked ?? lines[lines.length - 1];
    if (!line) return undefined;
    return line
        .replace(/^\[[^\]]*\]\s*/, "")
        .replace(/^(❌|🛑)\s*/, "")
        .slice(0, 300);
}

/**
 * The one line a failed deploy ends on: which app, why, and where the rest is.
 */
export function failureLine(opts: { apps: string[]; status: string; deploymentId: string; logs: string }): string {
    const subject = opts.apps.length > 0 ? opts.apps.join(" + ") : "Deployment";
    const why = failureReason(opts.logs) ?? `deployment ${opts.status}`;
    return `${subject} ${opts.status === "cancelled" ? "was cancelled" : "failed to deploy"}: ${why}`;
}

/**
 * Where to read the rest of a failed deploy's story.
 *
 * A preview's build log is not production's: bare `rebase cloud logs` reads
 * the newest PRODUCTION deployment, so pointing a failed preview at it showed
 * the last good production build under the preview's deployment id.
 */
export function failureHint(deploymentId: string, preview?: string): string {
    return preview !== undefined
        ? `Full build log: \`rebase cloud logs --preview ${preview}\` (deployment ${deploymentId}).`
        : `Full build log: \`rebase cloud logs\` (deployment ${deploymentId}).`;
}
