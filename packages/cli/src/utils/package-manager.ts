/**
 * Package manager detection and command abstraction.
 *
 * Detects whether the user is running pnpm or npm and provides
 * a unified interface for common package-manager operations so
 * the rest of the CLI never has to hardcode a specific PM.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

/**
 * The two package managers the CLI can scaffold for.
 *
 * Yarn and bun are deliberately absent, and this is the note that says so
 * rather than leaving it to be discovered. A yarn or bun user gets an npm
 * project: `detectPackageManager` finds no `pnpm-lock.yaml` and no
 * `package-lock.json`, falls through to the pnpm probe, and lands on npm —
 * silently, and with a `yarn.lock` or `bun.lockb` sitting right there in the
 * directory it was asked about.
 *
 * The reason is not indifference. Every generated project is a workspace, and
 * the scaffold writes one protocol for the workspace links —
 * `workspaceProtocol` below is `"workspace:*"` or `"*"`. Yarn understands
 * `workspace:*` and bun does not; the two also disagree with pnpm about where
 * `node_modules` goes, which is what `rebase dev` walks to find the backend.
 * Supporting them means a fourth and fifth scaffold shape, each needing its own
 * end-to-end test, and neither exists.
 *
 * So the honest position is: pnpm (recommended) or npm. A yarn or bun user is
 * better served knowing they will get an npm workspace than finding out from
 * the lockfile that appears after their first install. See
 * {@link detectPackageManager}, which now says so out loud.
 */
export type PackageManager = "pnpm" | "npm";

export interface PMCommands {
    /** The binary name ("pnpm" | "npm"). */
    name: PackageManager;
    /** Install all dependencies — e.g. `pnpm install` / `npm install`. */
    install: string[];
    /** Run a script — e.g. `pnpm run dev` / `npm run dev`. */
    run: (script: string) => string[];
    /** Execute a local bin — e.g. `pnpm exec rebase ...` / `npx rebase ...`. */
    exec: (bin: string, args: string[]) => string[];
    /** Query the registry — e.g. `pnpm view <pkg> version` / `npm view <pkg> version`. */
    view: (pkg: string, field: string) => string[];
    /** Run all workspace scripts — e.g. `pnpm -r run build` / `npm run build --workspaces`. */
    runAll: (script: string) => string[];
    /** Run a script in a specific workspace — e.g. `pnpm --filter "*-backend" start` / `npm run start -w backend`. */
    runWorkspace: (workspace: string, script: string) => string[];
    /** Execute a one-off package — e.g. `pnpm dlx skills ...` / `npx -y skills ...`. */
    dlx: (pkg: string, args: string[]) => string[];
    /** The workspace dependency protocol: `"workspace:*"` for pnpm, `"*"` for npm. */
    workspaceProtocol: string;
}

/**
 * How long to wait for `pnpm --version` before giving up on the probe.
 *
 * `pnpm --version` is a cold Node start, and on a machine that is busy — a
 * parallel install, a full test run — it routinely takes seconds. Measured at
 * 630ms, 990ms and 4293ms on three consecutive runs of one developer laptop
 * under load, so the previous 3s budget was inside the normal spread rather
 * than safely outside it.
 */
const PNPM_PROBE_TIMEOUT_MS = 5000;

/** Memoised result of the probe. pnpm cannot appear or vanish mid-process. */
let cachedPnpmAvailable: boolean | undefined;

/**
 * Decide availability from a `spawnSync` outcome.
 *
 * Split out from the spawn itself so the decision is testable without starting
 * a process — which is what made the old test load-sensitive and occasionally
 * red for reasons that had nothing to do with the code under test.
 *
 * The three outcomes are distinguishable, and the old code conflated two of
 * them by asking only `status === 0`:
 *
 *   not installed   status null, signal null,    error.code ENOENT
 *   timed out       status null, signal SIGTERM, error.code ETIMEDOUT
 *   broken install  status non-zero, no error
 */
export function pnpmAvailabilityFromProbe(res: {
    status: number | null;
    signal?: NodeJS.Signals | null;
    error?: { code?: string } | Error;
}): boolean {
    const code = (res.error as { code?: string } | undefined)?.code;

    // The binary is not on PATH. Genuinely absent.
    if (code === "ENOENT") return false;

    // We killed it for taking too long. That means it WAS found and did start,
    // so pnpm is installed — it was merely slow, which on a loaded machine is
    // routine rather than exceptional. Reporting "absent" here is what silently
    // scaffolded npm projects for developers who had pnpm all along.
    //
    // The trade-off, stated plainly: a pnpm that hangs forever (a misbehaving
    // corepack shim) now resolves to pnpm instead of falling back to npm. That
    // is the rarer and more visible failure — the user sees their next command
    // hang — whereas the case this fixes was silent and produced a project
    // pinned to the wrong package manager. The timeout still bounds how long
    // detection itself waits, which was always its real job.
    if (code === "ETIMEDOUT" || res.signal) return true;

    // Any other spawn error: treat as unavailable rather than guess.
    if (res.error) return false;

    return res.status === 0;
}

/**
 * Whether pnpm is runnable on this machine.
 *
 * Used to decide whether a fresh project can be scaffolded with pnpm. Kept
 * cheap and non-interactive (bounded timeout, output discarded) so it never
 * hangs detection if a corepack shim misbehaves, and memoised so that repeated
 * detection in one CLI run costs one process rather than one per call.
 */
export function isPnpmAvailable(): boolean {
    if (cachedPnpmAvailable !== undefined) return cachedPnpmAvailable;
    try {
        const res = spawnSync("pnpm", ["--version"], {
            stdio: "ignore",
            timeout: PNPM_PROBE_TIMEOUT_MS
        });
        cachedPnpmAvailable = pnpmAvailabilityFromProbe(res);
    } catch {
        cachedPnpmAvailable = false;
    }
    return cachedPnpmAvailable;
}

/** Forget the memoised probe. For tests; nothing in a CLI run needs it. */
export function resetPnpmAvailabilityCache(): void {
    cachedPnpmAvailable = undefined;
}

/**
 * Detect the package manager for a Rebase project.
 *
 * Rebase recommends pnpm, so detection prefers it. Crucially, *how the CLI was
 * invoked* (`npx` vs `pnpm dlx`, i.e. `npm_config_user_agent`) is deliberately
 * ignored: running `npx @rebasepro/cli init` says nothing about how the user
 * wants to manage the project they're creating, and letting it pin the scaffold
 * to npm is what made every `npx`-invoked project an npm project.
 *
 * Detection order:
 * 1. An existing lock file — an explicit choice we always respect
 *    (`pnpm-lock.yaml` wins over `package-lock.json` when both are present).
 * 2. pnpm, whenever it is installed.
 * 3. npm, only as a fallback when pnpm is genuinely unavailable.
 */
export function detectPackageManager(targetDir?: string): PackageManager {
    // 1. Respect an existing project's lock file.
    const dirs = [targetDir, process.cwd()].filter((d): d is string => !!d);
    for (const dir of dirs) {
        if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
        if (fs.existsSync(path.join(dir, "package-lock.json"))) return "npm";

        // A yarn or bun lockfile is a stated choice this CLI cannot honour —
        // see the note on `PackageManager`. Say so once, here, rather than
        // scaffolding an npm workspace beside their lockfile without comment.
        for (const [lock, name] of [["yarn.lock", "yarn"], ["bun.lockb", "bun"], ["bun.lock", "bun"]] as const) {
            if (!fs.existsSync(path.join(dir, lock))) continue;
            console.warn(
                `[rebase] Found ${lock}, but Rebase scaffolds pnpm or npm workspaces only — ` +
                `${name} is not supported yet. Continuing with ` +
                `${isPnpmAvailable() ? "pnpm" : "npm"}.`
            );
            return isPnpmAvailable() ? "pnpm" : "npm";
        }
    }

    // 2. Prefer pnpm whenever it's installed.
    if (isPnpmAvailable()) return "pnpm";

    // 3. Fall back to npm only when pnpm is genuinely unavailable.
    return "npm";
}

/** Build the command helpers for a given package manager. */
export function getPMCommands(pm: PackageManager): PMCommands {
    if (pm === "npm") {
        return {
            name: "npm",
            install: ["npm", "install"],
            run: (script) => ["npm", "run", script],
            exec: (bin, args) => ["npx", bin, ...args],
            view: (pkg, field) => ["npm", "view", pkg, field],
            runAll: (script) => ["npm", "run", script, "--workspaces", "--if-present"],
            runWorkspace: (workspace, script) => ["npm", "run", script, "-w", workspace],
            dlx: (pkg, args) => ["npx", "-y", pkg, ...args],
            workspaceProtocol: "*"
        };
    }

    return {
        name: "pnpm",
        install: ["pnpm", "install"],
        run: (script) => ["pnpm", "run", script],
        exec: (bin, args) => ["pnpm", "exec", bin, ...args],
        view: (pkg, field) => ["pnpm", "view", pkg, field],
        runAll: (script) => ["pnpm", "-r", "run", script],
        // Filter by directory (`./backend`), not name: pnpm's `--filter` matches
        // the package *name* (e.g. `my-app-backend`), so a bare `backend` matches
        // nothing. npm's `-w` is path-based, which is why this only bites pnpm.
        runWorkspace: (workspace, script) => ["pnpm", "--filter", `./${workspace}`, "run", script],
        dlx: (pkg, args) => ["pnpm", "dlx", pkg, ...args],
        workspaceProtocol: "workspace:*"
    };
}
