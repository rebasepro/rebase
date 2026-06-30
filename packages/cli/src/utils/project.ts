/**
 * Project discovery utilities for the Rebase CLI.
 *
 * These helpers locate the project root, backend directory, .env file,
 * and local binaries — used by all CLI command modules.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import chalk from "chalk";

/**
 * Walk up from `startDir` to find the Rebase project root.
 *
 * The root is identified by a `package.json` that either:
 * - has `workspaces` containing "backend" or "frontend", OR
 * - has a sibling `backend/` directory
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
    let dir = path.resolve(startDir);
    const root = path.parse(dir).root;

    while (dir !== root) {
        const pkgPath = path.join(dir, "package.json");

        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                // Check for workspace-based project (monorepo root)
                if (pkg.workspaces && Array.isArray(pkg.workspaces)) {
                    const hasBackend = pkg.workspaces.some((w: string) =>
                        w === "backend"
                    );
                    if (hasBackend) return dir;
                }
            } catch {
                // ignore parse errors
            }

            // Check for sibling backend directory
            if (fs.existsSync(path.join(dir, "backend")) && fs.existsSync(path.join(dir, "config"))) {
                return dir;
            }
        }

        dir = path.dirname(dir);
    }

    return null;
}

/**
 * Locate the backend directory within the project root.
 */
export function findBackendDir(projectRoot: string): string | null {
    const backendDir = path.join(projectRoot, "backend");
    return fs.existsSync(backendDir) ? backendDir : null;
}

/**
 * Detect the active backend plugin (e.g. @rebasepro/server-postgresql) from the backend's package.json.
 */
export function getActiveBackendPlugin(backendDir: string): string | null {
    const pkgPath = path.join(backendDir, "package.json");
    if (!fs.existsSync(pkgPath)) return null;

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const deps = { ...pkg.dependencies,
...pkg.devDependencies };

        // Collect all @rebasepro/server-* driver plugins (exclude server-core)
        const candidates = Object.keys(deps).filter(
            dep => dep.startsWith("@rebasepro/server-") && dep !== "@rebasepro/server-core"
        );

        if (candidates.length === 0) return null;

        // Prefer server-postgresql — it's the primary supported driver
        if (candidates.includes("@rebasepro/server-postgresql")) {
            return "@rebasepro/server-postgresql";
        }

        // Fallback: return the first candidate that actually has a CLI entry point
        for (const candidate of candidates) {
            if (resolvePluginCliScript(backendDir, candidate)) {
                return candidate;
            }
        }

        // Last resort: return whatever we found
        return candidates[0];
    } catch {
        // Ignore parse errors
    }
    return null;
}

/**
 * Resolve the active plugin's CLI script.
 */
export function resolvePluginCliScript(backendDir: string, pluginName: string): string | null {
    const candidates = [
        path.join(backendDir, "node_modules", pluginName, "src", "cli.ts"),
        path.join(backendDir, "node_modules", pluginName, "dist", "cli.js"),
        // For monorepo dev mode:
        path.resolve(backendDir, "..", "..", "..", "packages", pluginName.replace("@rebasepro/", ""), "src", "cli.ts"),
        path.resolve(backendDir, "..", "..", "packages", pluginName.replace("@rebasepro/", ""), "src", "cli.ts"),
        path.resolve(backendDir, "..", "packages", pluginName.replace("@rebasepro/", ""), "src", "cli.ts")
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Locate the frontend directory within the project root.
 */
export function findFrontendDir(projectRoot: string): string | null {
    const frontendDir = path.join(projectRoot, "frontend");
    return fs.existsSync(frontendDir) ? frontendDir : null;
}

/**
 * Find the .env file. Checks the project root first, then backend.
 */
export function findEnvFile(projectRoot: string): string | null {
    const candidates = [
        path.join(projectRoot, ".env"),
        path.join(projectRoot, "backend", ".env")
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return null;
}

/**
 * Resolve a binary from the project's node_modules/.bin.
 * Checks backend, root, parent monorepo root, then falls back to PATH.
 */
export function resolveLocalBin(projectRoot: string, binName: string): string | null {
    const candidates = [
        path.join(projectRoot, "backend", "node_modules", ".bin", binName),
        path.join(projectRoot, "node_modules", ".bin", binName)
    ];

    // Also check parent directories (for monorepo setups where app/ is nested)
    let parent = path.dirname(projectRoot);
    const rootDir = path.parse(parent).root;
    while (parent !== rootDir) {
        candidates.push(path.join(parent, "node_modules", ".bin", binName));
        parent = path.dirname(parent);
    }

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    // Fall back to globally installed binary via which
    try {
        const globalPath = execSync(`which ${binName}`, { encoding: "utf-8" }).trim();
        if (globalPath && fs.existsSync(globalPath)) return globalPath;
    } catch {
        // not found globally
    }

    return null;
}

/**
 * Resolve the tsx binary. Checks backend node_modules first, then root.
 */
export function resolveTsx(projectRoot: string): string | null {
    return resolveLocalBin(projectRoot, "tsx");
}

/**
 * Validate that a resolved tsx binary actually has an intact installation.
 *
 * `resolveLocalBin` only checks whether `node_modules/.bin/tsx` (a symlink)
 * exists. If the pnpm content-addressable store was cleaned or a previous
 * install was interrupted, the symlink can exist while critical files inside
 * the tsx package (e.g. `dist/preflight.cjs`) are missing — causing a
 * confusing MODULE_NOT_FOUND error at runtime.
 *
 * This function follows the symlink, walks up to find the tsx package root
 * (`package.json` with `name: "tsx"`), and verifies that `dist/preflight.cjs`
 * is present. Returns `null` when the installation looks healthy, or an
 * error description string when it appears corrupted.
 */
export function validateTsxInstallation(tsxBinPath: string): string | null {
    try {
        // Follow the symlink chain to the real tsx entry script
        const realPath = fs.realpathSync(tsxBinPath);

        // Walk up from the real binary to locate the tsx package root
        let dir = path.dirname(realPath);
        const fsRoot = path.parse(dir).root;
        for (let depth = 0; depth < 10 && dir !== fsRoot; depth++) {
            const pkgPath = path.join(dir, "package.json");
            if (fs.existsSync(pkgPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                    if (pkg.name === "tsx") {
                        // Found the tsx package root — verify critical preload file
                        const preflightPath = path.join(dir, "dist", "preflight.cjs");
                        if (!fs.existsSync(preflightPath)) {
                            return `tsx package at ${dir} is missing dist/preflight.cjs`;
                        }
                        return null; // Installation looks healthy
                    }
                } catch {
                    // Malformed package.json — keep walking
                }
            }
            dir = path.dirname(dir);
        }

        // Could not determine tsx root — don't block, assume valid
        return null;
    } catch (err) {
        // realpathSync throws if the symlink target is completely gone
        return `tsx binary symlink is broken: ${err instanceof Error ? err.message : String(err)}`;
    }
}

/**
 * Require the project root or exit with a helpful error.
 */
export function requireProjectRoot(): string {
    const root = findProjectRoot();
    if (!root) {
        console.error(chalk.red("✗ Could not find a Rebase project root."));
        console.error(chalk.gray("  Make sure you are inside a Rebase project directory"));
        console.error(chalk.gray("  (one with backend/, frontend/, and config/ directories)."));
        process.exit(1);
    }
    return root;
}

/**
 * Require the backend directory or exit with a helpful error.
 */
export function requireBackendDir(projectRoot: string): string {
    const backendDir = findBackendDir(projectRoot);
    if (!backendDir) {
        console.error(chalk.red("✗ Could not find a backend/ directory."));
        console.error(chalk.gray(`  Expected at: ${path.join(projectRoot, "backend")}`));
        process.exit(1);
    }
    return backendDir;
}
