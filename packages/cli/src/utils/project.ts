/**
 * Project discovery utilities for the Rebase CLI.
 *
 * These helpers locate the project root, backend directory, .env file,
 * and local binaries — used by all CLI command modules.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import dotenv from "dotenv";
import chalk from "chalk";
import { detectPackageManager, getPMCommands } from "./package-manager";

/** The authored project manifest. Its presence alone marks a project root. */
export const MANIFEST_FILENAME = "rebase.json";

/**
 * Walk up from `startDir` to find the Rebase project root.
 *
 * A directory is the root when it holds a `rebase.json`, or when it holds a
 * `package.json` that either lists `backend` as a workspace or sits beside both
 * `backend/` and `config/`.
 *
 * `rebase.json` is checked first and needs no `package.json` beside it, because
 * the conventions below all describe a repository that *contains the backend*.
 * A repository holding only a frontend — the normal shape once a project's apps
 * live in separate repositories — matches none of them, so without this the
 * tooling could not run there at all.
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
    let dir = path.resolve(startDir);
    const root = path.parse(dir).root;

    while (dir !== root) {
        if (fs.existsSync(path.join(dir, MANIFEST_FILENAME))) {
            return dir;
        }

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
 * Detect the active backend plugin (e.g. @rebasepro/server-postgres) from the backend's package.json.
 */
export function getActiveBackendPlugin(backendDir: string): string | null {
    const pkgPath = path.join(backendDir, "package.json");
    if (!fs.existsSync(pkgPath)) return null;

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const deps = { ...pkg.dependencies,
...pkg.devDependencies };

        // Collect all @rebasepro/server-* driver plugins (exclude server itself)
        const candidates = Object.keys(deps).filter(
            dep => dep.startsWith("@rebasepro/server-") && dep !== "@rebasepro/server"
        );

        if (candidates.length === 0) return null;

        // Prefer server-postgres — it's the primary supported driver
        if (candidates.includes("@rebasepro/server-postgres")) {
            return "@rebasepro/server-postgres";
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
    const candidates: string[] = [];

    // Walk up from the backend dir: pnpm links the plugin into
    // backend/node_modules, while npm workspaces hoist it to the project (or an
    // enclosing monorepo) root.
    let dir = path.resolve(backendDir);
    const fsRoot = path.parse(dir).root;
    while (dir !== fsRoot) {
        candidates.push(
            path.join(dir, "node_modules", pluginName, "src", "cli.ts"),
            path.join(dir, "node_modules", pluginName, "dist", "cli.js")
        );
        dir = path.dirname(dir);
    }

    candidates.push(
        // For monorepo dev mode:
        path.resolve(backendDir, "..", "..", "..", "packages", pluginName.replace("@rebasepro/", ""), "src", "cli.ts"),
        path.resolve(backendDir, "..", "..", "packages", pluginName.replace("@rebasepro/", ""), "src", "cli.ts"),
        path.resolve(backendDir, "..", "packages", pluginName.replace("@rebasepro/", ""), "src", "cli.ts")
    );

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
 * Read the project's `.env` into a plain object.
 *
 * One reader, because there were four: `dotenv` in `start`, a hand-rolled
 * `indexOf("=")` loop in `api-keys`, a single-key regex in `auth`, and its own
 * splitting in `cloud env`. `dotenv` is a declared dependency of this package,
 * so the other three existed for no reason and disagreed with the correct one
 * on the two things people actually write in a `.env`:
 *
 *   - `export KEY=value`, which the hand-rolled parser keyed as
 *     `export KEY` — so the command reported the key as unset while it was
 *     right there in the file;
 *   - `KEY=value # comment`, whose comment travelled into the value and then
 *     into an `Authorization` header, coming back as a 401 with nothing
 *     pointing at the cause.
 *
 * Returns `{}` when the project has no `.env`, so callers can treat "absent"
 * and "empty" alike.
 */
export function readEnvFile(projectRoot: string): Record<string, string> {
    const envFile = findEnvFile(projectRoot);
    if (!envFile || !fs.existsSync(envFile)) return {};
    try {
        return dotenv.parse(fs.readFileSync(envFile, "utf-8"));
    } catch {
        // An unreadable or malformed file is not worth failing a command over;
        // the caller reports the missing value it was looking for.
        return {};
    }
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
 * The one sentence a command says when the project's dependencies are missing.
 *
 * Six commands each had their own wording for the same state, and none of them
 * named the remedy:
 *
 *   ✗ Could not find CLI entry point for @rebasepro/server-postgres.
 *   ✗ Could not find tsx binary.
 *   ✗ Could not find tsx binary for backend.
 *
 * All three mean "you have not installed yet" — `getActiveBackendPlugin` has
 * already read the driver out of `backend/package.json` by the time the first
 * one fires, so the package is declared and simply not on disk, and `tsx` is a
 * devDependency of every scaffold. But they read as *Rebase* being broken, and
 * they name an internal path or a binary the developer never asked for rather
 * than the command that fixes it. That is the whole of the failure someone sees
 * on a fresh clone, where `node_modules/` is the one thing a checkout does not
 * carry.
 *
 * So: one sentence, naming the package manager this project uses and the
 * directory to run it in — the working directory is usually neither.
 */
export function dependenciesNotInstalled(projectRoot: string): string {
    const install = getPMCommands(detectPackageManager(projectRoot)).install.join(" ");
    return `Dependencies are not installed — run \`${install}\` in ${projectRoot}`;
}

/**
 * Print {@link dependenciesNotInstalled} and exit 1.
 *
 * For the five commands that report and stop. `db.ts` throws instead, because
 * its caller adds the `✗` and the exit itself.
 */
export function exitDependenciesNotInstalled(projectRoot: string): never {
    console.error(chalk.red(`✗ ${dependenciesNotInstalled(projectRoot)}`));
    process.exit(1);
}

/**
 * The refusal envelope, for a caller that asked for JSON.
 *
 * Same shape as the cloud family's `fail()` — `{ error: { message, code, hint } }`
 * — because there is one CLI and a caller should not have to know which half of
 * it answered. `code` is what a caller branches on and is never absent; the
 * cloud family's reasoning about that applies here unchanged.
 *
 * On **stdout**, like every other `--json` result: the contract those commands
 * make is that stdout holds one JSON value, and a caller that pipes stdout to a
 * parser must get a parseable refusal rather than an empty stream and a
 * human sentence it never sees.
 *
 * The flag is read off `process.argv` because the failure happens inside a
 * helper the command calls before it has parsed anything. Coarse — a literal
 * `--json` as some other flag's value would count — and worth it: the failure
 * mode of being coarse is a JSON error where a human one was wanted, and the
 * failure mode of not doing it is an unparseable stream.
 */
function failAsJson(message: string, code: string, hint: string): never {
    console.log(JSON.stringify({ error: { message, code, hint } }, null, 2));
    process.exit(1);
}

/** Did the command line ask for machine-readable output? */
export function wantsJsonOutput(argv: readonly string[] = process.argv): boolean {
    return argv.includes("--json");
}

/**
 * Require the project root or exit with a helpful error.
 */
export function requireProjectRoot(): string {
    const root = findProjectRoot();
    if (!root) {
        if (wantsJsonOutput()) {
            // `rebase status --json` outside a project wrote four grey lines to
            // stderr and nothing at all to stdout, so the agent or CI step that
            // asked for JSON got an empty parse and no reason.
            failAsJson(
                "Could not find a Rebase project root.",
                "no_project_root",
                `Looked in this directory and every parent for a ${MANIFEST_FILENAME}, `
                + "a package.json with a \"backend\" workspace, or a backend/ next to a config/."
            );
        }
        // Name what is actually looked for, in the order `findProjectRoot`
        // looks for it. The old wording ("backend/, frontend/, and config/")
        // described neither the manifest — which is the primary marker and the
        // only one `rebase init` writes — nor a `--headless` project, which has
        // no frontend at all and would read this as "you are in the wrong
        // place" while standing in the right one.
        console.error(chalk.red("✗ Could not find a Rebase project root."));
        console.error(chalk.gray(`  Looked in this directory and every parent for a ${MANIFEST_FILENAME},`));
        console.error(chalk.gray("  a package.json with a \"backend\" workspace, or a backend/ next to a config/."));
        console.error(chalk.gray("  Run this from inside a project, or create one with `rebase init`."));
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
        if (wantsJsonOutput()) {
            failAsJson(
                "Could not find a backend/ directory.",
                "no_backend_dir",
                `Expected at: ${path.join(projectRoot, "backend")}`
            );
        }
        console.error(chalk.red("✗ Could not find a backend/ directory."));
        console.error(chalk.gray(`  Expected at: ${path.join(projectRoot, "backend")}`));
        process.exit(1);
    }
    return backendDir;
}
