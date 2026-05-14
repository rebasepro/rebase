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
import execa, { ExecaChildProcess } from "execa";
import path from "path";
import fs from "fs";
import {
    requireProjectRoot,
    findBackendDir,
    findFrontendDir,
    findEnvFile,
    resolveTsx
} from "../utils/project";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";

/** Well-known filename the backend writes its actual port to. */
const DEV_PORT_FILENAME = ".rebase-dev-port";

/**
 * Compute a deterministic port from the project root path.
 * Range: 3001–3999 (avoids privileged ports and common services).
 * Two different project directories will almost always get different ports.
 */
function getProjectPort(projectRoot: string): number {
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
function resolveStartPort(projectRoot: string, explicitPort?: number): number {
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
            "--help": Boolean,
            "-b": "--backend-only",
            "-f": "--frontend-only",
            "-p": "--port",
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
    const backendDir = findBackendDir(projectRoot);
    const frontendDir = findFrontendDir(projectRoot);
    const backendOnly = args["--backend-only"] || false;
    const frontendOnly = args["--frontend-only"] || false;

    // Resolve the port ONCE, before starting anything
    const startPort = resolveStartPort(projectRoot, args["--port"]);

    console.log("");
    console.log(chalk.bold("  🚀 Rebase Dev Server"));
    console.log("");

    const children: ExecaChildProcess[] = [];

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
            console.log(chalk.cyan("│   ✨ Rebase Admin App is ready!                            │"));
            const cleanUrl = stripAnsi(frontendUrl);
            const paddedUrl = cleanUrl.padEnd(40);
            console.log(chalk.cyan("│   👉 Frontend URL: ") + chalk.white(paddedUrl) + chalk.cyan("│"));
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
                        execa.commandSync(`taskkill /pid ${child.pid} /T /F`);
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
            const pmName = detectPackageManager(projectRoot);
            const addCmd = pmName === "npm" ? "npm install -D tsx" : "pnpm add -D tsx";
            console.error(chalk.red("  ✗ Could not find tsx binary for backend."));
            console.error(chalk.gray(`    Install it with: ${addCmd}`));
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

        /** Whether the frontend has been launched (we only launch it once). */
        let frontendLaunched = false;

        const backendChild = execa(
            tsxBin,
            ["watch", `--watch="${path.join("..", "config", "**", "*")}"`, "--conditions", "development", "src/index.ts"],
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

        backendChild.stderr?.on("data", (data: Buffer) => {
            const lines = data.toString().split("\n").filter(Boolean);
            lines.forEach((line: string) => {
                console.log(`${chalk.cyan.bold("[backend]")}  ${line}`);
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

${chalk.green.bold("Description")}
  Starts both the backend (tsx watch + Hono) and frontend (Vite)
  dev servers concurrently with color-coded output prefixes.

  Each project automatically receives a unique default port derived
  from its directory path, preventing collisions when running multiple
  Rebase instances simultaneously.

  If the assigned port is already in use, the server will automatically
  try the next available port. The frontend is started only after the
  backend is ready, and VITE_API_URL is injected automatically.
`);
}
