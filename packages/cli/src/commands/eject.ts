/**
 * CLI command: rebase eject
 *
 * The supported route from the managed runtime to a custom one.
 *
 * Without it, `runtime: "custom"` is a mode a user can only reach by
 * hand-writing an entrypoint they have never seen. The template used to solve
 * that by scaffolding `backend/src/index.ts` into every project — ~190 lines
 * configuring CORS, auth, cookies, storage and history, which the managed
 * runtime never loads. It was the most important-looking file in a new project
 * and editing it did nothing.
 *
 * So the file moved here. A managed project does not carry it; a project that
 * asks for it gets it together with the Dockerfile and the manifest change that
 * make it actually run.
 *
 * There is deliberately no `rebase uneject`. Going back is deleting two files
 * and editing one line, and a command that silently discarded a user's server
 * code would be worse than its absence.
 */
import arg from "arg";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { RebaseBackendAppConfig } from "@rebasepro/types";
import { requireProjectRoot } from "../utils/project";
import { findBackendApp, loadManifest, ManifestError, writeManifest } from "../manifest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Walk up to the package root, which holds `templates/`. */
function findCliRoot(from: string): string | null {
    const root = path.parse(from).root;
    let dir = from;
    while (dir && dir !== root) {
        if (fs.existsSync(path.join(dir, "templates", "eject"))) return dir;
        dir = path.dirname(dir);
    }
    return null;
}

/** Files the eject payload contributes, as `<source> → <destination>`. */
const PAYLOAD: { from: string; to: string; overwrite: boolean }[] = [
    // The entrypoint IS the point of ejecting, so it is written even if
    // something is already there — but only after the guard below has
    // established that this project is not already ejected.
    { from: "backend/src/index.ts",
to: "backend/src/index.ts",
overwrite: true },
    { from: "backend/src/env.ts",
to: "backend/src/env.ts",
overwrite: true },
    // Never overwritten: a Dockerfile someone already wrote is theirs.
    { from: "Dockerfile",
to: "Dockerfile",
overwrite: false }
];

function printHelp(): void {
    console.log(`
${chalk.bold("rebase eject")} — take ownership of the server process

Writes the backend entrypoint and a Dockerfile into this project, and flips its
backend to ${chalk.cyan('runtime: "custom"')}. From then on this repository builds its own
image: platform runtime upgrades no longer reach it, and CORS, auth wiring,
storage and shutdown become yours to configure.

${chalk.bold("Usage")}
  rebase eject [app]

${chalk.bold("Options")}
  --dry-run                    List what would change, and change nothing
  -h, --help                   Show this help
`.trim());
}

export async function ejectCommand(rawArgs: string[] = []): Promise<void> {
    const args = arg(
        {
            "--dry-run": Boolean,
            "--help": Boolean,
            "-h": "--help"
        },
        { argv: rawArgs.slice(2),
permissive: true }
    );

    if (args["--help"]) {
        printHelp();
        return;
    }

    const projectRoot = requireProjectRoot();
    const dryRun = Boolean(args["--dry-run"]);
    // `_[0]` is the command itself.
    const requested = args._.slice(1).find(value => !value.startsWith("-"));

    let loaded;
    try {
        loaded = loadManifest(projectRoot);
    } catch (err) {
        if (err instanceof ManifestError) {
            console.error(chalk.red(`✗ ${err.message}`));
            for (const issue of err.issues) {
                console.error(chalk.dim(`    ${issue.path}: ${issue.message}`));
            }
            process.exit(1);
        }
        throw err;
    }

    const { manifest } = loaded;

    let appName: string;
    let app: RebaseBackendAppConfig;

    if (requested) {
        const declared = manifest.apps[requested];
        if (!declared) {
            console.error(chalk.red(`✗ No app named "${requested}" in rebase.json.`));
            console.error(chalk.dim(`  Declared: ${Object.keys(manifest.apps).join(", ") || "(none)"}`));
            process.exit(1);
        }
        if (declared.type !== "backend") {
            // Ejecting is about who runs the server. A static app has no server.
            console.error(chalk.red(`✗ "${requested}" is a ${declared.type} app — only a backend can be ejected.`));
            process.exit(1);
        }
        appName = requested;
        app = declared;
    } else {
        const backend = findBackendApp(manifest);
        if (!backend) {
            console.error(chalk.red("✗ This repository declares no backend app."));
            console.error(chalk.dim("  Only the repository that declares the backend chooses its runtime."));
            process.exit(1);
        }
        appName = backend.name;
        app = backend.app;
    }

    if (app.runtime === "custom") {
        console.error(chalk.red(`✗ "${appName}" is already ejected — it declares runtime: "custom".`));
        console.error(chalk.dim(`  Its entrypoint is ${app.dockerfile ?? "Dockerfile"} and backend/src/index.ts.`));
        process.exit(1);
    }

    const cliRoot = findCliRoot(__dirname);
    if (!cliRoot) {
        console.error(chalk.red("✗ Could not locate the eject templates. Reinstall @rebasepro/cli."));
        process.exit(1);
    }
    const payloadDir = path.join(cliRoot!, "templates", "eject");

    // Decide everything before writing anything, so --dry-run and the real run
    // report the same list and a mid-way failure cannot leave a half-ejected
    // project.
    const planned: { to: string; action: "write" | "keep" }[] = [];
    for (const file of PAYLOAD) {
        const source = path.join(payloadDir, file.from);
        if (!fs.existsSync(source)) {
            console.error(chalk.red(`✗ The eject template is missing ${file.from}. Reinstall @rebasepro/cli.`));
            process.exit(1);
        }
        const exists = fs.existsSync(path.join(projectRoot, file.to));
        planned.push({
            to: file.to,
            action: exists && !file.overwrite ? "keep" : "write"
        });
    }

    if (dryRun) {
        console.log(chalk.bold(`Would eject "${appName}" to a custom runtime:`));
        console.log("");
        for (const item of planned) {
            console.log(item.action === "write"
                ? `  ${chalk.green("write")}  ${item.to}`
                : `  ${chalk.dim("keep")}   ${item.to} ${chalk.dim("(already exists)")}`);
        }
        console.log(`  ${chalk.green("write")}  rebase.json ${chalk.dim('(runtime: "custom")')}`);
        console.log("");
        console.log(chalk.dim("Nothing was changed."));
        return;
    }

    for (const [index, file] of PAYLOAD.entries()) {
        if (planned[index].action === "keep") continue;
        const destination = path.join(projectRoot, file.to);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(payloadDir, file.from), destination);
    }

    const dockerfile = app.dockerfile ?? "Dockerfile";
    manifest.apps[appName] = {
        ...app,
        runtime: "custom",
        dockerfile,
        port: app.port ?? 8080
    };
    writeManifest(projectRoot, manifest);

    // The backend workspace stops being a package the runtime reads and becomes
    // one that is run. Its scripts have to say so, or `npm start` in the image
    // has nothing to call.
    restoreBackendScripts(projectRoot);

    console.log("");
    console.log(chalk.green(`✓ Ejected "${appName}" to a custom runtime.`));
    console.log("");
    console.log(`  ${chalk.cyan("backend/src/index.ts")}   your entrypoint — the runtime no longer boots the bundle`);
    console.log(`  ${chalk.cyan("backend/src/env.ts")}     the environment it reads`);
    console.log(`  ${chalk.cyan(dockerfile.padEnd(20))}   your image`);
    console.log(`  ${chalk.cyan("rebase.json".padEnd(20))}   runtime: custom`);
    console.log("");
    console.log(chalk.yellow("  You now own CORS, auth wiring, storage and shutdown. Platform runtime"));
    console.log(chalk.yellow("  upgrades no longer reach this project."));
    console.log("");
}

/**
 * Point the backend workspace's scripts at the entrypoint that now exists.
 *
 * A managed project's backend package deliberately declares no `main` and no
 * `start`: there is no entrypoint to name. Ejecting creates one.
 */
function restoreBackendScripts(projectRoot: string): void {
    const packagePath = path.join(projectRoot, "backend", "package.json");
    if (!fs.existsSync(packagePath)) return;

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    } catch {
        // A malformed package.json is the user's to fix, and refusing to finish
        // the eject over it would leave the project half-changed.
        console.log(chalk.yellow("  ⚠ backend/package.json is not valid JSON — its scripts were left alone."));
        return;
    }

    const scripts = (parsed.scripts ?? {}) as Record<string, string>;
    parsed.main ??= "src/index.ts";
    scripts.dev ??= 'tsx watch --include="../config/**/*" --include="./functions/**/*" src/index.ts';
    scripts.start ??= "node dist/backend/src/index.js";
    parsed.scripts = scripts;

    fs.writeFileSync(packagePath, `${JSON.stringify(parsed, null, 4)}\n`, "utf8");
}
