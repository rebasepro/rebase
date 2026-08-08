/**
 * CLI command: rebase apps
 *
 * Inspect the apps this repository contributes to a project, adopt a
 * `rebase.json` for a project that predates it, and print the client bootstrap
 * an app needs to reach its backend.
 *
 * The distinction that runs through all of this: a *repository* declares apps,
 * a *project* owns them. Two repositories can contribute to the same project and
 * never know about each other, which is what makes a separate frontend repo — or
 * a mobile app with no repo relationship at all — an ordinary thing rather than
 * a special case.
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import type { RebaseAppConfig } from "@rebasepro/types";
import { requireProjectRoot } from "../utils/project";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import {
    assessManagedCompatibility,
    loadManifest,
    ManifestError,
    manifestExists,
    synthesizeManifest,
    writeManifest
} from "../manifest";
import { readLink } from "./cloud/context";

function printHelp(): void {
    console.log(`
${chalk.bold("rebase apps")} — the apps this repository contributes

${chalk.bold("Usage")}
  rebase apps list             List declared apps and their build outputs
  rebase apps init             Write a rebase.json inferred from this project
  rebase apps config <app>     Print the client configuration for an app

${chalk.bold("Options")}
  --json                       Machine-readable output
  --force                      Overwrite an existing rebase.json (apps init)
  -h, --help                   Show this help
`.trim());
}

export async function appsCommand(subcommand: string | undefined, rawArgs: string[] = []): Promise<void> {
    // Help is answered before parsing, so `rebase apps config --help` prints the
    // page rather than being rejected for naming no app.
    if (!subcommand || subcommand === "--help" || wantsHelp(rawArgs)) {
        printHelp();
        return;
    }

    // Only `apps` is a command word here: this one parser serves every
    // subcommand, so the subcommand stays in the positionals and the app name
    // `apps config` takes follows it.
    const { flags: args, positionals } = parseCommandArgs({
        spec: {
            "--json": Boolean,
            "--force": Boolean
        },
        rawArgs,
        commandWords: 1,
        command: "apps",
        maxPositionals: 2
    });

    switch (subcommand) {
        case "list":
            await listApps(Boolean(args["--json"]));
            break;
        case "init":
            await initManifest(Boolean(args["--force"]));
            break;
        case "config":
            await printAppConfig(positionals[1], Boolean(args["--json"]));
            break;
        default:
            console.error(chalk.red(`Unknown subcommand: ${subcommand}`));
            console.log("");
            printHelp();
            process.exit(1);
    }
}

function describeApp(app: RebaseAppConfig): string {
    switch (app.type) {
        case "backend":
            return app.runtime === "custom"
                ? `custom runtime — ${app.dockerfile ?? "Dockerfile"}`
                : `managed runtime, config: ${app.config ?? "config"}`;
        case "static":
            return `${app.root} → ${app.output} @ ${app.path ?? "/"}`;
        default:
            return "";
    }
}

async function listApps(asJson: boolean): Promise<void> {
    const projectRoot = requireProjectRoot();
    const loaded = loadManifestOrExit(projectRoot);
    const compatibility = assessManagedCompatibility(loaded.manifest);

    if (asJson) {
        console.log(JSON.stringify(
            {
                source: loaded.source,
                rebase: loaded.manifest.rebase,
                apps: loaded.manifest.apps,
                managed: compatibility
            },
            null,
            2
        ));
        return;
    }

    if (loaded.source === "synthesized") {
        console.log(chalk.dim("No rebase.json — showing the layout inferred from this project."));
        console.log(chalk.dim(`Run ${chalk.cyan("rebase apps init")} to write it down.\n`));
    }

    console.log(chalk.bold(`Rebase   ${loaded.manifest.rebase}`));
    console.log("");

    const entries = Object.entries(loaded.manifest.apps);
    if (entries.length === 0) {
        console.log(chalk.yellow("No apps declared."));
        return;
    }

    const width = Math.max(...entries.map(([name]) => name.length));
    for (const [name, app] of entries) {
        console.log(
            `  ${chalk.cyan(name.padEnd(width))}  ${chalk.dim(app.type.padEnd(8))}  ${describeApp(app)}`
        );
    }

    console.log("");
    if (compatibility.eligible) {
        console.log(chalk.green("✓ Eligible for the managed runtime."));
    } else {
        console.log(chalk.yellow("• Uses the custom runtime:"));
        for (const reason of compatibility.reasons) {
            console.log(chalk.dim(`    ${reason}`));
        }
    }
}

async function initManifest(force: boolean): Promise<void> {
    const projectRoot = requireProjectRoot();

    if (manifestExists(projectRoot) && !force) {
        console.error(chalk.red("✗ rebase.json already exists."));
        console.error(chalk.dim("  Pass --force to overwrite it."));
        process.exit(1);
    }

    const manifest = synthesizeManifest(projectRoot);
    const filePath = writeManifest(projectRoot, manifest);

    console.log(chalk.green(`✓ Wrote ${path.relative(projectRoot, filePath)}`));
    console.log("");
    for (const [name, app] of Object.entries(manifest.apps)) {
        console.log(`  ${chalk.cyan(name)} ${chalk.dim(`(${app.type})`)}`);
    }

    const compatibility = assessManagedCompatibility(manifest);
    if (!compatibility.eligible) {
        console.log("");
        console.log(chalk.yellow("This project will use the custom runtime:"));
        for (const reason of compatibility.reasons) {
            console.log(chalk.dim(`  ${reason}`));
        }
    }
}

/**
 * Print what a client needs to reach this project.
 *
 * Never prints a secret. The API URL and an app's publishable identity are meant
 * to ship inside a client bundle; anything that is not safe there does not belong
 * in output that will inevitably be pasted into a `.env` that gets committed.
 */
async function printAppConfig(appName: string | undefined, asJson: boolean): Promise<void> {
    const projectRoot = requireProjectRoot();
    const loaded = loadManifestOrExit(projectRoot);

    if (!appName) {
        console.error(chalk.red("✗ Which app? Usage: rebase apps config <app>"));
        process.exit(1);
    }

    const app = loaded.manifest.apps[appName];
    if (!app) {
        console.error(chalk.red(`✗ No app named "${appName}" in rebase.json.`));
        console.error(chalk.dim(`  Declared: ${Object.keys(loaded.manifest.apps).join(", ") || "(none)"}`));
        process.exit(1);
    }

    const link = readLink(projectRoot);
    const apiUrl = resolveApiUrl(projectRoot, link);

    const config = {
        app: appName,
        type: app.type,
        apiUrl: apiUrl ?? null,
        project: link?.projectId ?? link?.slug ?? null
    };

    if (asJson) {
        console.log(JSON.stringify(config, null, 2));
        return;
    }

    if (!apiUrl) {
        console.log(chalk.yellow("This checkout is not linked to a project yet."));
        console.log(chalk.dim(`  Run ${chalk.cyan("rebase link")} (cloud) or ${chalk.cyan("rebase link <url>")} (self-hosted).`));
        console.log("");
    }

    console.log(chalk.bold(`# ${appName}`));
    console.log("");
    console.log(`VITE_API_URL=${apiUrl ?? "http://localhost:3001"}`);
    console.log("");
    console.log(chalk.dim("Then, in the app:"));
    console.log(chalk.dim("  const rebase = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });"));
}

/**
 * Work out the API base URL for this checkout.
 *
 * Prefers an explicit link, then the dev server's own record of where it bound.
 * The dev port is chosen dynamically, so a hardcoded default would be wrong on
 * any machine running more than one project.
 */
function resolveApiUrl(projectRoot: string, link: ReturnType<typeof readLink>): string | undefined {
    if (link?.apiUrl) return link.apiUrl;

    const statePath = path.join(projectRoot, ".rebase", "state.json");
    if (fs.existsSync(statePath)) {
        try {
            const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as { baseUrl?: string };
            if (state.baseUrl) return state.baseUrl;
        } catch {
            // Stale or partially written state file: fall through.
        }
    }

    return undefined;
}

function loadManifestOrExit(projectRoot: string): ReturnType<typeof loadManifest> {
    try {
        return loadManifest(projectRoot);
    } catch (err) {
        if (err instanceof ManifestError) {
            console.error(chalk.red(`✗ ${err.message}`));
            for (const issue of err.issues) {
                console.error(chalk.red(`    ${issue.path ? `${issue.path}: ` : ""}${issue.message}`));
            }
            process.exit(1);
        }
        throw err;
    }
}
