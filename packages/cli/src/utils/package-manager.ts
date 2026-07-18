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
 * Whether pnpm is runnable on this machine.
 *
 * Used to decide whether a fresh project can be scaffolded with pnpm. Kept
 * cheap and non-interactive (short timeout, output discarded) so it never
 * hangs detection if a corepack shim misbehaves.
 */
export function isPnpmAvailable(): boolean {
    try {
        const res = spawnSync("pnpm", ["--version"], { stdio: "ignore", timeout: 3000 });
        return res.status === 0;
    } catch {
        return false;
    }
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
        runWorkspace: (workspace, script) => ["pnpm", "--filter", workspace, script],
        dlx: (pkg, args) => ["pnpm", "dlx", pkg, ...args],
        workspaceProtocol: "workspace:*"
    };
}
