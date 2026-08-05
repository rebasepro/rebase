/**
 * CLI command: rebase dev
 *
 * Starts the full development environment:
 * - Backend: tsx watch with auto-reload
 * - Frontend: vite dev server
 *
 * Both processes stream output with color-coded prefixes.
 *
 * When the backend uses port-retry (i.e. the configured port is busy and it
 * binds to the next free one), the CLI detects the actual port from stdout
 * and injects VITE_API_URL into the frontend so it connects automatically.
 *
 * Each project gets a deterministic default port derived from the project
 * root path, so multiple Rebase instances never collide.
 */
import arg from "arg";
import chalk from "chalk";
import { execa, execaCommandSync, type ResultPromise } from "execa";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { findBackendApp, loadManifest, resolveBackendPaths } from "../manifest";
import {
    requireProjectRoot,
    findBackendDir,
    findFrontendDir,
    findEnvFile,
    resolveTsx,
    validateTsxInstallation,
    getActiveBackendPlugin,
    resolvePluginCliScript
} from "../utils/project";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";
import { affectsSqlSchema } from "../utils/collection-drift";
import { recordEvent } from "../telemetry";

/**
 * Quote a path for the shell `execa` runs the backend through.
 *
 * The dev runtime's path is absolute and therefore contains whatever the
 * developer's directories are called. Double quotes do not neutralize `$`,
 * backticks or backslashes in a POSIX shell, so a checkout under a directory
 * named `$(...)` would execute it. Single quotes disable all expansion; on
 * Windows, `cmd.exe` performs no such expansion and wants double quotes.
 */
function quoteForShell(value: string): string {
    if (process.platform === "win32") return `"${value.replace(/"/g, "\\\"")}"`;
    return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Locate the dev runtime shim shipped with the CLI.
 *
 * Published under `runtime/` in the package rather than compiled into `dist/`,
 * because tsx executes it as a file and it must exist on disk at a stable path.
 */
function resolveDevRuntimeEntry(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // Walk up from wherever this module ended up (src/ in development, dist/ in
    // a published install) until the package root with `runtime/` is found.
    let dir = here;
    for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, "runtime", "dev-server.mjs");
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(
        "Could not find the Rebase dev runtime (runtime/dev-server.mjs). " +
        "Reinstall @rebasepro/cli, or add a backend/src/index.ts to run your own entrypoint."
    );
}

/**
 * Tell the dev runtime where this project keeps its parts.
 *
 * Read from `rebase.json` when there is one, so a project that moved its config
 * directory is honoured; otherwise the conventional layout.
 */
function devRuntimeEnv(projectRoot: string): Record<string, string> {
    const result: Record<string, string> = {
        REBASE_DEV_PROJECT_ROOT: projectRoot,
        REBASE_DEV_CONFIG: "config",
        REBASE_DEV_FUNCTIONS: "backend/functions",
        REBASE_DEV_CRONS: "backend/crons",
        REBASE_DEV_SCHEMA: "backend/src/schema.generated.ts"
    };

    try {
        const loaded = loadManifest(projectRoot);
        const backend = findBackendApp(loaded.manifest);
        if (backend) {
            const paths = resolveBackendPaths(backend.app, projectRoot);
            result.REBASE_DEV_CONFIG = paths.config;
            result.REBASE_DEV_FUNCTIONS = paths.functions;
            result.REBASE_DEV_CRONS = paths.crons;
            result.REBASE_DEV_SCHEMA = paths.schema;
            result.REBASE_DEV_APP = backend.name;
        }
    } catch {
        // An invalid manifest is reported by `rebase build`; dev falls back to
        // the conventional layout rather than refusing to start.
    }

    // Nothing here says whether collections are declared or introspected, and
    // nothing should: `createSourceBundle` drops a config directory that does
    // not exist, and the server derives the answer from that. A REBASE_DEV_MODE
    // env var said it a second time, and a second place to say it is a second
    // place for it to disagree.
    return result;
}

/** Well-known filename the backend writes its actual port to. */
export const DEV_PORT_FILENAME = ".rebase-dev-port";

/**
 * Compute a deterministic port from the project root path.
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

/**
 * Resolve the best starting port for this project:
 * 1. Explicit --port flag (highest priority)
 * 2. PORT env var
 * 3. Previously used port from .rebase-dev-port (port affinity across restarts)
 * 4. Deterministic hash from project path (unique per project)
 */
export function resolveStartPort(projectRoot: string, explicitPort?: number): number {
    // 1. Explicit flag
    if (explicitPort) return explicitPort;

    // 2. PORT env var
    if (process.env.PORT) return parseInt(process.env.PORT, 10);

    // 3. Port affinity — check if we wrote a port file from a previous run
    try {
        const portFile = path.join(projectRoot, DEV_PORT_FILENAME);
        if (fs.existsSync(portFile)) {
            const saved = parseInt(fs.readFileSync(portFile, "utf-8").trim(), 10);
            if (saved > 0 && saved < 65536) return saved;
        }
    } catch { /* ignore */ }

    // 4. Deterministic hash
    return getProjectPort(projectRoot);
}

export async function devCommand(rawArgs: string[]): Promise<void> {
    const args = arg(
        {
            "--backend-only": Boolean,
            "--frontend-only": Boolean,
            "--port": Number,
            "--generate": Boolean,
            "--help": Boolean,
            "-b": "--backend-only",
            "-f": "--frontend-only",
            "-p": "--port",
            "-g": "--generate",
            "-h": "--help"
        },
        {
            argv: rawArgs.slice(3), // skip "node rebase dev"
            permissive: true
        }
    );

    if (args["--help"]) {
        printDevHelp();
        return;
    }

    const projectRoot = requireProjectRoot();

    // Fire-and-forget, and a no-op unless the developer opted in. Deliberately
    // not awaited: `rebase dev` starting is the thing the user is waiting for,
    // and a slow collector must never be in front of it.
    void recordEvent("cli.dev", {
        backend_only: Boolean(args["--backend-only"]),
        frontend_only: Boolean(args["--frontend-only"]),
        generate: Boolean(args["--generate"])
    }, { projectRoot });
    const backendDir = findBackendDir(projectRoot);
    const frontendDir = findFrontendDir(projectRoot);
    const backendOnly = args["--backend-only"] || false;
    const frontendOnly = args["--frontend-only"] || false;
    const shouldGenerate = args["--generate"] || process.env.REBASE_AUTO_GENERATE === "true" || process.env.REBASE_GENERATE === "true";

    // Resolve the port ONCE, before starting anything
    const startPort = resolveStartPort(projectRoot, args["--port"]);

    console.log("");
    console.log(chalk.bold("  🚀 Rebase Dev Server"));
    console.log("");

    const children: ResultPromise[] = [];

    // --- State for printing the banner ---
    let frontendUrl = "";
    let backendUrl = "";
    let debounceSummary: NodeJS.Timeout | null = null;
    let bannerPrinted = false;

    /** Actual backend port, resolved once the server prints its URL. */
    let resolvedBackendPort: number | null = null;

    // Use regex to strip ANSI codes before matching
    // eslint-disable-next-line no-control-regex
    const stripAnsi = (str: string) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

    function printSummary() {
        if (!frontendUrl || !backendUrl) return;
        if (debounceSummary) clearTimeout(debounceSummary);
        debounceSummary = setTimeout(() => {
            if (bannerPrinted) return;
            console.log("");
            console.log(chalk.cyan("┌────────────────────────────────────────────────────────────┐"));
            console.log(chalk.cyan("│                                                            │"));
            console.log(chalk.cyan("│   ✦ Rebase Admin App is ready!                             │"));
            const cleanUrl = stripAnsi(frontendUrl);
            const paddedUrl = cleanUrl.padEnd(41);
            console.log(chalk.cyan("│   ➜ Frontend URL: ") + chalk.white(paddedUrl) + chalk.cyan("│"));
            console.log(chalk.cyan("│                                                            │"));
            console.log(chalk.cyan("└────────────────────────────────────────────────────────────┘"));
            console.log("");
            bannerPrinted = true;
        }, 500);
    }

    // Handle graceful shutdown
    const cleanup = () => {
        // Clean up dev port file
        try {
            const portFile = path.join(projectRoot, DEV_PORT_FILENAME);
            if (fs.existsSync(portFile)) fs.unlinkSync(portFile);

            const urlFile = path.join(projectRoot, ".rebase-dev-url");
            if (fs.existsSync(urlFile)) fs.unlinkSync(urlFile);
        } catch { /* ignore */ }

        children.forEach((child) => {
            if (child.pid && !child.killed) {
                try {
                    if (process.platform === "win32") {
                        execaCommandSync(`taskkill /pid ${child.pid} /T /F`);
                    } else {
                        process.kill(-child.pid, "SIGKILL");
                    }
                } catch (e) {
                    try {
                        child.kill("SIGKILL");
                    } catch (err) {
                        // ignore
                    }
                }
            }
        });
        process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    /**
     * Start the Vite frontend, optionally injecting the backend port.
     */
    function startFrontend(backendPort: number | null) {
        if (!frontendDir) return;

        console.log(`  ${chalk.magenta("▶")} Frontend: ${chalk.gray(frontendDir)}`);

        const frontendEnv: Record<string, string> = { ...process.env as Record<string, string> };

        // Inject the resolved backend URL so Vite picks it up
        if (backendPort) {
            frontendEnv.VITE_API_URL = `http://localhost:${backendPort}`;
            console.log(`  ${chalk.gray("↳ VITE_API_URL")} = ${chalk.white(`http://localhost:${backendPort}`)}`);
        }

        const pm = detectPackageManager(projectRoot);
        const pmCmds = getPMCommands(pm);
        const runDevCmd = pmCmds.run("dev");

        const frontendChild = execa(
            runDevCmd[0],
            runDevCmd.slice(1),
            {
                cwd: frontendDir,
                stdio: ["inherit", "pipe", "pipe"],
                env: frontendEnv,
                shell: true,
                detached: process.platform !== "win32"
            }
        );
        frontendChild.catch(() => {}); // prevent unhandled promise rejection on exit

        frontendChild.stdout?.on("data", (data: Buffer) => {
            const lines = data.toString().split("\n").filter(Boolean);
            lines.forEach((line: string) => {
                console.log(`${chalk.magenta.bold("[admin]")} ${line}`);
                const cleanLine = stripAnsi(line);
                const urlMatch = cleanLine.match(/(http:\/\/(?:localhost|127\.0\.0\.1):\d+)/);
                if (cleanLine.includes("Local:") && urlMatch) {
                    frontendUrl = urlMatch[1];
                    printSummary();
                }
            });
        });

        frontendChild.stderr?.on("data", (data: Buffer) => {
            const lines = data.toString().split("\n").filter(Boolean);
            lines.forEach((line: string) => {
                console.log(`${chalk.magenta.bold("[admin]")} ${line}`);
            });
        });

        children.push(frontendChild);
    }

    // Start backend
    if (!frontendOnly && backendDir) {
        const tsxBin = resolveTsx(projectRoot);
        if (!tsxBin) {
            const pmCmdsLocal = getPMCommands(detectPackageManager(projectRoot));
            const addCmd = [...pmCmdsLocal.install, "-D", "tsx"].join(" ");
            console.error(chalk.red("  ✗ Could not find tsx binary for backend."));
            console.error(chalk.gray(`    Install it with: ${addCmd}`));
            process.exit(1);
        }

        // Verify the tsx installation is intact (not just the symlink)
        const tsxValidationError = validateTsxInstallation(tsxBin);
        if (tsxValidationError) {
            const pmCmdsLocal = getPMCommands(detectPackageManager(projectRoot));
            const installCmd = pmCmdsLocal.install.join(" ");
            console.error(chalk.red("  ✗ tsx installation appears corrupted."));
            console.error(chalk.gray(`    ${tsxValidationError}`));
            console.error("");
            console.error(chalk.gray("    To fix, run:"));
            console.error(chalk.cyan(`      rm -rf node_modules && ${installCmd}`));
            process.exit(1);
        }

        const envFile = findEnvFile(projectRoot);
        const env: Record<string, string> = { ...process.env as Record<string, string> };
        if (envFile) {
            env.DOTENV_CONFIG_PATH = envFile;
        }

        // Always inject PORT so the backend uses our resolved port instead of
        // its hardcoded default (3001). This prevents cross-project collisions
        // when multiple Rebase instances run simultaneously.
        env.PORT = String(startPort);

        console.log(`  ${chalk.cyan("▶")} Backend:  ${chalk.gray(backendDir)}`);
        console.log(`  ${chalk.gray("↳ PORT")} = ${chalk.white(String(startPort))}`);

        // The .env's PORT / VITE_API_URL look authoritative but are overridden in
        // dev: we derive a per-project port to avoid cross-project collisions and
        // point the frontend at it. Surface that so a mismatched .env doesn't turn
        // into a silent "connecting to the wrong port" debugging loop.
        if (envFile) {
            try {
                const envText = fs.readFileSync(envFile, "utf-8");
                const readEnvKey = (key: string): string | undefined => {
                    const m = envText.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));
                    return m ? m[1].replace(/^["']|["']$/g, "") : undefined;
                };
                const envPort = readEnvKey("PORT");
                const envApiUrl = readEnvKey("VITE_API_URL");
                // Only name the keys — never echo a raw `http://localhost:<port>`
                // value, so log scrapers don't mistake it for the dev server URL.
                const overridden: string[] = [];
                if (envPort && envPort !== String(startPort)) overridden.push("PORT");
                if (envApiUrl && envApiUrl !== `http://localhost:${startPort}`) overridden.push("VITE_API_URL");
                if (overridden.length > 0) {
                    console.log(chalk.yellow(
                        `  ⚠ dev uses a derived per-project port (${startPort}); your .env ${overridden.join(" / ")} ` +
                        `${overridden.length > 1 ? "are" : "is"} ignored here (avoids cross-project collisions). ` +
                        `Pass ${chalk.white("--port")} to pin a port.`
                    ));
                }
            } catch { /* ignore — best-effort notice */ }
        }

        /** Whether the frontend has been launched (we only launch it once). */
        let frontendLaunched = false;

        // A generated schema that a *library upgrade* invalidated, repaired before
        // the backend sees it.
        //
        // Distinct from the drift warning further down, which watches
        // `config/collections` and so only fires when the developer edits
        // something. This case has no edit: 0.13 derives `category_id` where 0.12
        // derived `categorie_id`, from an unchanged collection. Boot-ensure renames
        // the database column, relation validation reads the stale generated module
        // and refuses to start — on this boot and every boot after, since the
        // rename does not run twice. Regenerating is the whole fix, and the release
        // note promises the rename is handled, so do it rather than announce it.
        //
        // Runs regardless of `--generate`: this is not "keep my schema fresh", it
        // is "do not hand the runtime a file that cannot boot".
        try {
            const activePlugin = getActiveBackendPlugin(backendDir);
            const pluginCli = activePlugin ? resolvePluginCliScript(backendDir, activePlugin) : null;
            if (pluginCli) {
                await execa(tsxBin, [pluginCli, "schema", "stale", "--fix"], {
                    cwd: backendDir,
                    stdio: "inherit",
                    env
                });
            }
        } catch {
            // Never block `dev` on this. A project with no generated schema, a
            // driver too old to know the subcommand, or a collections directory
            // that will not load all land here, and the boot itself reports each
            // of them better than a preflight can.
        }

        // Initial schema and SDK generation (disabled by default, enabled via --generate or env var)
        if (shouldGenerate) {
            console.log(chalk.gray("  → Ensuring schema and SDK are generated on start..."));
            try {
                const activePlugin = getActiveBackendPlugin(backendDir);
                const pluginCli = activePlugin ? resolvePluginCliScript(backendDir, activePlugin) : null;
                if (pluginCli) {
                    await execa(tsxBin, [pluginCli, "schema", "generate"], {
                        cwd: backendDir,
                        stdio: "inherit",
                        env
                    });
                }
                const sdkCmd = getPMCommands(detectPackageManager(projectRoot)).exec("rebase", ["generate-sdk"]);
                await execa(sdkCmd[0], sdkCmd.slice(1), {
                    cwd: projectRoot,
                    stdio: "inherit",
                    env
                });
                console.log(chalk.green("  ✓ Initial schema and SDK generated successfully.\n"));
            } catch (err: unknown) {
                console.error(chalk.red(`  ✗ Initial schema/SDK generation failed: ${err instanceof Error ? err.message : err}\n`));
            }

            // Watch collections folder for changes
            const collectionsDir = path.join(projectRoot, "config", "collections");
            if (fs.existsSync(collectionsDir)) {
                let watchDebounce: NodeJS.Timeout | null = null;
                // The SQL schema and the SDK do not answer to the same edits.
                // The SDK is generated from the collections `index` module, which
                // can re-export anything the project puts under this directory,
                // so every change is a reason to rebuild it. The Drizzle schema
                // covers only the SQL-backed collections the loader reads — see
                // `affectsSqlSchema`. Tracked across the debounce window because
                // one burst can touch both kinds of file.
                let sqlSchemaAffected = false;
                fs.watch(collectionsDir, { recursive: true }, (eventType, filename) => {
                    if (!filename || filename.startsWith(".") || filename.endsWith(".tmp")) return;

                    sqlSchemaAffected = sqlSchemaAffected || affectsSqlSchema(collectionsDir, filename);
                    if (watchDebounce) clearTimeout(watchDebounce);
                    watchDebounce = setTimeout(async () => {
                        const regenerateSchema = sqlSchemaAffected;
                        sqlSchemaAffected = false;
                        console.log(chalk.yellow(
                            `\n  🔄 Collection change detected (${filename}). Regenerating ${regenerateSchema ? "schema & SDK" : "SDK"}...`
                        ));
                        try {
                            const activePlugin = getActiveBackendPlugin(backendDir);
                            const pluginCli = regenerateSchema && activePlugin ? resolvePluginCliScript(backendDir, activePlugin) : null;
                            if (pluginCli) {
                                await execa(tsxBin, [pluginCli, "schema", "generate"], {
                                    cwd: backendDir,
                                    stdio: "inherit",
                                    env
                                });
                            }
                            const sdkCmd = getPMCommands(detectPackageManager(projectRoot)).exec("rebase", ["generate-sdk"]);
                            await execa(sdkCmd[0], sdkCmd.slice(1), {
                                cwd: projectRoot,
                                stdio: "inherit",
                                env
                            });
                            console.log(chalk.green(
                                `  ✓ ${regenerateSchema ? "Schema & SDK" : "SDK"} regenerated successfully. Hono will reload.`
                            ));
                        } catch (err: unknown) {
                            console.error(chalk.red(`  ✗ Failed to regenerate schema/SDK: ${err instanceof Error ? err.message : err}`));
                        }
                    }, 300);
                });
            }
        }

        // A project with its own `backend/src/index.ts` runs it, exactly as
        // before. Without one, dev boots the stock runtime over the project's
        // TypeScript source — the same boot path a deployment takes, so what runs
        // locally is what will run deployed. This is what makes the hand-written
        // entrypoint optional instead of something every project must carry.
        const ejectedEntry = path.join(backendDir, "src", "index.ts");
        const usesStockRuntime = !fs.existsSync(ejectedEntry);
        const entryTarget = usesStockRuntime ? resolveDevRuntimeEntry() : "src/index.ts";

        if (usesStockRuntime) {
            Object.assign(env, devRuntimeEnv(projectRoot));
        }

        const watchArgs = ["watch", "--conditions", "development", quoteForShell(entryTarget)];
        if (!shouldGenerate) {
            // When auto-generation is disabled, watch the config/collections dir directly so the dev server
            // still reloads automatically when files there are edited/updated manually.
            watchArgs.splice(1, 0, `--watch="${path.join("..", "config", "**", "*")}"`);

            // Watch collections folder and warn about potential schema drift
            const collectionsDir = path.join(projectRoot, "config", "collections");
            if (fs.existsSync(collectionsDir)) {
                let driftDebounce: NodeJS.Timeout | null = null;
                fs.watch(collectionsDir, { recursive: true }, (_eventType, filename) => {
                    if (!filename || filename.startsWith(".") || filename.endsWith(".tmp")) return;
                    // Only a change to a SQL-backed collection can put the
                    // generated schema out of sync — a Firestore collection has
                    // nothing to generate, push or check for drift.
                    if (!affectsSqlSchema(collectionsDir, filename)) return;
                    if (driftDebounce) clearTimeout(driftDebounce);
                    driftDebounce = setTimeout(() => {
                        // The box is drawn at a fixed width, so a name longer
                        // than the cell would push the right border off.
                        const shown = filename!.length > 31 ? `…${filename!.slice(-30)}` : filename!.padEnd(31);
                        console.log([
                            "",
                            chalk.yellow("  ┌──────────────────────────────────────────────────────────────┐"),
                            chalk.yellow("  │  ⚠️  Collection file changed: ") + chalk.white(shown) + chalk.yellow("│"),
                            chalk.yellow("  │                                                              │"),
                            chalk.yellow("  │  Your schema may be out of sync. Run:                        │"),
                            chalk.yellow("  │    ") + chalk.cyan("rebase schema generate") + chalk.yellow("   regenerate Drizzle schema        │"),
                            chalk.yellow("  │    ") + chalk.cyan("rebase db push        ") + chalk.yellow("   sync schema to database          │"),
                            chalk.yellow("  │    ") + chalk.cyan("rebase doctor         ") + chalk.yellow("   check for drift                  │"),
                            chalk.yellow("  │                                                              │"),
                            chalk.yellow("  │  TIP: Use ") + chalk.bold("rebase dev --generate") + chalk.yellow(" for auto-regeneration        │"),
                            chalk.yellow("  └──────────────────────────────────────────────────────────────┘"),
                            ""
                        ].join("\n"));
                    }, 500);
                });
            }
        }

        const backendChild = execa(
            tsxBin,
            watchArgs,
            {
                cwd: backendDir,
                stdio: ["inherit", "pipe", "pipe"],
                env,
                shell: true,
                detached: process.platform !== "win32"
            }
        );
        backendChild.catch(() => {}); // prevent unhandled promise rejection on exit

        backendChild.stdout?.on("data", (data: Buffer) => {
            const lines = data.toString().split("\n").filter(Boolean);
            lines.forEach((line: string) => {
                console.log(`${chalk.cyan.bold("[backend]")}  ${line}`);
                const cleanLine = stripAnsi(line);
                const serverMatch = cleanLine.match(/Server running at http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
                if (serverMatch) {
                    resolvedBackendPort = parseInt(serverMatch[1], 10);
                    backendUrl = "started";
                    printSummary();

                    // Save the url to a temp file for scripts to pick up
                    const urlFile = path.join(projectRoot, ".rebase-dev-url");
                    fs.writeFileSync(urlFile, `http://localhost:${resolvedBackendPort}`, "utf-8");

                    // Save the port to .rebase-dev-port for port affinity
                    const portFile = path.join(projectRoot, DEV_PORT_FILENAME);
                    fs.writeFileSync(portFile, String(resolvedBackendPort), "utf-8");

                    // Start frontend now that we know the real port
                    if (!backendOnly && frontendDir && !frontendLaunched) {
                        frontendLaunched = true;
                        startFrontend(resolvedBackendPort);
                    }
                }
            });
        });

        /** Whether we've already shown a corrupted-modules recovery hint. */
        let corruptedModulesWarned = false;

        backendChild.stderr?.on("data", (data: Buffer) => {
            const lines = data.toString().split("\n").filter(Boolean);
            lines.forEach((line: string) => {
                console.log(`${chalk.cyan.bold("[backend]")}  ${line}`);

                // Detect corrupted node_modules at runtime
                // (covers tsx and any other dependency whose pnpm store entry is broken)
                if (!corruptedModulesWarned) {
                    const cleanLine = stripAnsi(line);
                    if (
                        cleanLine.includes("Cannot find module") &&
                        cleanLine.includes("node_modules/.pnpm/")
                    ) {
                        corruptedModulesWarned = true;
                        // Delay slightly so the full Node.js error stack prints first
                        setTimeout(() => {
                            const pm = detectPackageManager(projectRoot);
                            const installCmd = getPMCommands(pm).install.join(" ");
                            console.error("");
                            console.error(chalk.red("  ✗ node_modules appears corrupted — a required file is missing."));
                            console.error(chalk.gray("    This usually happens when a previous install was interrupted"));
                            console.error(chalk.gray("    or the package manager store was cleaned."));
                            console.error("");
                            console.error(chalk.gray("    To fix, stop the dev server and run:"));
                            console.error(chalk.cyan(`      rm -rf node_modules && ${installCmd}`));
                            console.error("");
                        }, 200);
                    }
                }
            });
        });

        children.push(backendChild);
    } else if (!frontendOnly && !backendDir) {
        console.warn(chalk.yellow("  ⚠ No backend/ directory found, skipping backend."));
    }

    // Start frontend immediately if backend-only mode or no backend
    if (!backendOnly && frontendDir && (frontendOnly || !backendDir)) {
        startFrontend(null);
    } else if (!backendOnly && !frontendDir) {
        console.warn(chalk.yellow("  ⚠ No frontend/ directory found, skipping frontend."));
    }

    if (children.length === 0) {
        console.error(chalk.red("  ✗ Nothing to start. Check your project structure."));
        process.exit(1);
    }

    console.log("");
    console.log(chalk.gray("  Press Ctrl+C to stop all servers."));
    console.log("");

    // Wait for all children to exit
    await Promise.all(
        children.map(
            (child) =>
                new Promise<void>((resolve) => {
                    child.finally(() => resolve());
                })
        )
    );
}

function printDevHelp() {
    console.log(`
${chalk.bold("rebase dev")} — Start the development server

${chalk.green.bold("Usage")}
  rebase dev [options]

${chalk.green.bold("Options")}
  ${chalk.blue("--backend-only, -b")}   Only start the backend server
  ${chalk.blue("--frontend-only, -f")}  Only start the frontend server
  ${chalk.blue("--port, -p")}           Backend port (default: auto-detected per project)
  ${chalk.blue("--generate, -g")}        Enable automatic schema and SDK generation on startup and file changes

${chalk.green.bold("Description")}
  Starts both the backend (tsx watch + Hono) and frontend (Vite)
  dev servers concurrently with color-coded output prefixes.

  Each project automatically receives a unique default port derived
  from its directory path, preventing collisions when running multiple
  Rebase instances simultaneously.

  If the assigned port is already in use, the server will automatically
  try the next available port. The frontend is started only after the
  backend is ready, and VITE_API_URL is injected automatically.

  By default, automatic schema and SDK generation is disabled on startup
  and file changes. Pass --generate (-g) or set REBASE_AUTO_GENERATE=true
  in your environment to enable it.
`);
}
