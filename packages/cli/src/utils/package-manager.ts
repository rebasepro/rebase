/**
 * Package manager detection and command abstraction.
 *
 * Detects whether the user is running pnpm or npm and provides
 * a unified interface for common package-manager operations so
 * the rest of the CLI never has to hardcode a specific PM.
 */
import fs from "fs";
import path from "path";

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
 * Detect the package manager from the environment or the target directory.
 *
 * Detection order:
 * 1. Explicit override (if provided)
 * 2. `npm_config_user_agent` env var (set by npm/pnpm when running via `npx`/`pnpm dlx`)
 * 3. Lock-file presence in the target directory
 * 4. Default to pnpm (Rebase's recommended PM)
 */
export function detectPackageManager(targetDir?: string): PackageManager {
    // 1. Check user agent (set when invoked via npx / pnpm dlx)
    const userAgent = process.env.npm_config_user_agent ?? "";
    if (userAgent.startsWith("npm/")) return "npm";
    if (userAgent.startsWith("pnpm/")) return "pnpm";

    // 2. Check for lock files in the target directory
    if (targetDir) {
        if (fs.existsSync(path.join(targetDir, "package-lock.json"))) return "npm";
        if (fs.existsSync(path.join(targetDir, "pnpm-lock.yaml"))) return "pnpm";
    }

    // 3. Check for lock files in cwd
    const cwd = process.cwd();
    if (cwd !== targetDir) {
        if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm";
        if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
    }

    // 4. Default to pnpm
    return "pnpm";
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
