/**
 * CLI command: rebase start
 *
 * Runs a built bundle through the Rebase runtime — the same path the official
 * container image takes, so what you test locally is what a deployment runs.
 *
 * When there is no bundle (an ejected backend, or a project that has not adopted
 * `rebase.json`) this falls back to the backend workspace's own `start` script,
 * which is what such a project has always used.
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import { execa } from "execa";
import { requireProjectRoot, findEnvFile, readEnvFile } from "../utils/project";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";
import { DEFAULT_BUNDLE_DIR } from "../bundle";
import type { RebaseBundleStatic } from "@rebasepro/types";

function printHelp(): void {
    console.log(`
${chalk.bold("rebase start")} — run a built bundle

${chalk.bold("Usage")}
  rebase start [options]

${chalk.bold("Options")}
  --bundle <dir>     Bundle directory (default: ${DEFAULT_BUNDLE_DIR})
  --workspace        Run the backend workspace's own start script
  -h, --help         Show this help

Runs the bundle the way a deployment does, reading PORT and the rest of .env,
in whatever NODE_ENV the shell or .env sets. A scaffolded .env says
development, which keeps development behaviour on — the first account to
register becomes the admin. For a production server, run it with
NODE_ENV=production; it says so at start when it is not one.

Build first with ${chalk.cyan("rebase build")}.
`.trim());
}

/** The NODE_ENV the runtime will see, and where it comes from. */
export interface StartNodeEnv {
    value: string | undefined;
    source: "shell" | ".env" | "unset";
}

/**
 * What NODE_ENV the server will boot in. The shell wins — dotenv never
 * overrides a variable that is already set — then `.env`.
 */
export function startNodeEnv(projectRoot: string): StartNodeEnv {
    if (process.env.NODE_ENV !== undefined) return { value: process.env.NODE_ENV, source: "shell" };
    const fromFile = readEnvFile(projectRoot).NODE_ENV;
    return fromFile !== undefined ? { value: fromFile, source: ".env" } : { value: undefined, source: "unset" };
}

/**
 * The banner for a `rebase start` that is not a production server, or `null`.
 *
 * Not forced to production: the scaffold's `.env` points at a loopback
 * database, which a production boot refuses, so forcing it would break the
 * documented local run. What must not happen is the silence — a command the
 * help called "(production)" booting with the first-registration window open.
 */
export function nonProductionWarning(nodeEnv: StartNodeEnv): string[] | null {
    if (nodeEnv.value === "production") return null;
    const what = nodeEnv.value === undefined
        ? "NODE_ENV is not set"
        : `NODE_ENV=${nodeEnv.value}${nodeEnv.source === ".env" ? " (from .env)" : ""}`;
    return [
        chalk.yellow.bold(`⚠ ${what} — this is not a production server.`),
        chalk.yellow("  Development behaviour is on: the first account to register becomes the admin"),
        chalk.yellow("  (REBASE_ADMIN_EMAIL is ignored), and with no SMTP configured, sign-in and"),
        chalk.yellow("  password-reset links are printed to this log instead of sent."),
        chalk.gray("  For a production server, run it with NODE_ENV=production (in the shell or .env).")
    ];
}

/**
 * What to say about the apps a bundle serves only on their own hostname.
 *
 * The runtime prints "Server running at http://localhost:<port>", and an app
 * whose `path` names a hostname answers only requests carrying that `Host` —
 * so opening the printed URL showed a 404 for an app that was running fine,
 * and nothing said why. One line per such app, with a command that reaches it.
 */
export function hostRoutedNotice(staticApps: readonly RebaseBundleStatic[], port: string | undefined): string[] {
    const routed = staticApps.filter(app => app.host);
    if (routed.length === 0) return [];
    const origin = `http://localhost:${port || "<port>"}`;
    return [
        ...routed.map(app => {
            const name = app.name ?? path.posix.basename(app.dir);
            return chalk.yellow(`⚠ ${name} answers only on ${app.host}, so ${origin}${app.path} will not show it here. Reach it with:`)
                + `\n    ${chalk.cyan(`curl -H "Host: ${app.host}" ${origin}${app.path}`)}`;
        }),
        chalk.gray(`  (or point ${routed.map(app => app.host).join(", ")} at 127.0.0.1 in /etc/hosts)`),
        ""
    ];
}

function readBundleStatic(bundleDir: string): RebaseBundleStatic[] {
    try {
        const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, "manifest.json"), "utf8")) as { entry?: { static?: RebaseBundleStatic[] } };
        return manifest.entry?.static ?? [];
    } catch {
        return [];
    }
}

function printNonProductionWarning(projectRoot: string): void {
    const warning = nonProductionWarning(startNodeEnv(projectRoot));
    if (!warning) return;
    console.log(warning.join("\n") + "\n");
}

export async function startCommand(rawArgs: string[] = []): Promise<void> {
    if (wantsHelp(rawArgs)) {
        printHelp();
        return;
    }

    const { flags: args } = parseCommandArgs({
        spec: {
            "--bundle": String,
            "--workspace": Boolean
        },
        rawArgs,
        commandWords: 1,
        command: "start",
        maxPositionals: 0
    });

    const projectRoot = requireProjectRoot();

    const envFile = findEnvFile(projectRoot);
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (envFile) {
        env.DOTENV_CONFIG_PATH = envFile;
    }

    const bundleDir = path.resolve(projectRoot, args["--bundle"] ?? DEFAULT_BUNDLE_DIR);
    const hasBundle = fs.existsSync(path.join(bundleDir, "manifest.json"));

    // Before either path, and before the runtime's own boot logs bury it.
    printNonProductionWarning(projectRoot);

    if (args["--workspace"] || !hasBundle) {
        if (!args["--workspace"] && !hasBundle) {
            console.log(chalk.dim(
                `No bundle at ${path.relative(projectRoot, bundleDir)}/ — ` +
                "starting the backend workspace instead.\n"
            ));
        }
        await startWorkspaceBackend(projectRoot, env);
        return;
    }

    ensureBundleDependencies(projectRoot, bundleDir);

    console.log(`${chalk.bold("Rebase")} — starting runtime from ${chalk.cyan(path.relative(projectRoot, bundleDir))}/\n`);

    // Loaded in-process rather than spawned: the runtime is a library here, so
    // signals, exit codes and stdio need no forwarding, and there is one less
    // process between the developer and a stack trace.
    if (envFile && fs.existsSync(envFile)) {
        const dotenv = await import("dotenv");
        dotenv.config({ path: envFile, quiet: true });
    }

    process.env.REBASE_BUNDLE = bundleDir;

    for (const line of hostRoutedNotice(readBundleStatic(bundleDir), process.env.PORT)) console.log(line);

    try {
        const { runFromBundle } = await import("@rebasepro/server");
        await runFromBundle({ bundleDir });
    } catch (err) {
        console.error(chalk.red("\n✗ Failed to start the runtime."));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}

/**
 * Make a bundle's imports resolvable for a local run.
 *
 * Node resolves a module by walking up from the *importing file*, so compiled
 * code sitting in `dist-bundle/` no longer sees the per-package `node_modules`
 * its source could: pnpm and npm both install a workspace package's
 * dependencies inside that package, and the bundle is not inside any of them.
 *
 * A deployment solves this by installing the bundle's own `package.json` beside
 * it — that is what the generated `package.json` is for. Locally, doing a second
 * install to run code whose dependencies are already on disk would be wasteful,
 * so this links what is already there instead.
 *
 * Only ever created when absent, and only under the bundle directory, so a real
 * install always wins and nothing here is ever uploaded (`rebase build` cleans
 * the directory and never writes this).
 */
function ensureBundleDependencies(projectRoot: string, bundleDir: string): void {
    const target = path.join(bundleDir, "node_modules");
    if (fs.existsSync(target)) return;

    // Later sources fill gaps left by earlier ones; the backend's tree wins
    // because it holds the server and driver the runtime itself needs.
    const sources = ["backend/node_modules", "config/node_modules", "node_modules"]
        .map(relative => path.join(projectRoot, relative))
        .filter(dir => fs.existsSync(dir));

    if (sources.length === 0) return;

    let linked = 0;
    fs.mkdirSync(target, { recursive: true });

    const linkInto = (sourceDir: string, targetDir: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(sourceDir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (entry.name === ".bin" || entry.name.startsWith(".")) continue;
            const from = path.join(sourceDir, entry.name);
            const to = path.join(targetDir, entry.name);

            // A scope is a directory of packages, not a package — merge into it
            // so `@a/one` from one tree and `@a/two` from another both resolve.
            if (entry.name.startsWith("@") && entry.isDirectory()) {
                fs.mkdirSync(to, { recursive: true });
                linkInto(from, to);
                continue;
            }

            if (fs.existsSync(to)) continue;
            try {
                fs.symlinkSync(fs.realpathSync(from), to, "junction");
                linked++;
            } catch {
                // A package that cannot be linked simply stays unresolved, and
                // the runtime will say so by name if it actually needed it.
            }
        }
    };

    for (const source of sources) linkInto(source, target);

    if (linked > 0) {
        console.log(chalk.dim(
            `  linked ${linked} package(s) into the bundle for this local run\n` +
            "  (a deployment installs the bundle's package.json instead)\n"
        ));
    }
}

async function startWorkspaceBackend(projectRoot: string, env: Record<string, string>): Promise<void> {
    const pm = detectPackageManager(projectRoot);
    const cmds = getPMCommands(pm);
    const startCmd = cmds.runWorkspace("backend", "start");

    console.log(`${chalk.bold("Rebase")} — Starting backend server...\n`);

    try {
        await execa(startCmd[0], startCmd.slice(1), {
            cwd: projectRoot,
            stdio: "inherit",
            env
        });
    } catch {
        console.error(chalk.red("\n✗ Failed to start server."));
        process.exit(1);
    }
}
