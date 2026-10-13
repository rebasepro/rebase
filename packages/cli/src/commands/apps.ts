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
import type { RebaseAppConfig, RebaseProjectManifest } from "@rebasepro/types";
import { failAsJson, requireProjectRoot } from "../utils/project";
import { devServerUrl } from "../utils/dev-server";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import {
    assessManagedCompatibility,
    findBackendApp,
    formatAppAddress,
    loadManifest,
    ManifestError,
    manifestExists,
    staticAppAddress,
    synthesizeManifest,
    writeManifest
} from "../manifest";
import { readLink } from "./cloud/context";
import { unknownCommand } from "../utils/unknown-command";
import { foldableApps } from "../fold-static";

function printHelp(): void {
    console.log(`
${chalk.bold("rebase apps")} — the apps this repository contributes

${chalk.bold("Usage")}
  rebase apps list             List declared apps and their build outputs
  rebase apps init             Write a rebase.json inferred from this project
  rebase apps config <app>     Print the client configuration for an app

${chalk.bold("Options")}
  --json                       Machine-readable output
  --force                      Replace an existing rebase.json (apps init), keeping
                               each app's name, path and cms
  -h, --help                   Show this help
`.trim());
}

/** Everything the switch below dispatches, for the did-you-mean. */
export const APPS_SUBCOMMANDS = ["list", "init", "config"] as const;

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
            if (positionals[1] !== undefined) {
                // It never registered one app: the name was ignored and the
                // whole manifest inferred, which is not what the reader asked for.
                console.error(chalk.red(`✗ rebase apps init takes no app name (got "${positionals[1]}").`));
                console.error(chalk.dim("  It infers every app from this project and writes the whole rebase.json."));
                console.error(chalk.dim("  To add one app, declare it under \"apps\" in rebase.json."));
                process.exit(1);
            }
            await initManifest(Boolean(args["--force"]));
            break;
        case "config":
            await printAppConfig(positionals[1], Boolean(args["--json"]));
            break;
        default:
            unknownCommand(subcommand, APPS_SUBCOMMANDS, "apps");
    }
}

/**
 * One app's line in `rebase apps list`.
 *
 * A static app shows its full address — the https URL when its `path` gives it
 * a hostname — and the CMS as the address a browser would open. `CMS at /` on
 * an app that lives on `admin.example.com` reads as the project's own root,
 * which is the one place that CMS is not.
 */
export function describeApp(name: string, app: RebaseAppConfig): string {
    switch (app.type) {
        case "backend":
            return app.runtime === "custom"
                // The context is named only when it is not the project, which is
                // the case where it changes what you would type. A workspace app
                // builds from the workspace root, and a listing that showed only
                // the Dockerfile implied a `docker build .` beside it that fails.
                ? `custom runtime — ${app.dockerfile ?? "Dockerfile"}`
                    + (app.context && app.context !== "." ? ` (context: ${app.context})` : "")
                : `managed runtime, config: ${app.config ?? "config"}`;
        case "static": {
            const address = staticAppAddress(name, app);
            return `${app.root} → ${app.output} @ ${formatAppAddress(address)}`
                + (app.cms ? `  ${chalk.magenta(`CMS at ${formatAppAddress({ ...address, path: app.cms })}`)}` : "");
        }
        default:
            return "";
    }
}

async function listApps(asJson: boolean): Promise<void> {
    const projectRoot = requireProjectRoot();
    const loaded = loadManifestOrExit(projectRoot, asJson);
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
            `  ${chalk.cyan(name.padEnd(width))}  ${chalk.dim(app.type.padEnd(8))}  ${describeApp(name, app)}`
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

/** A static app's `root`, compared as a directory: `./frontend/` is `frontend`. */
function sameRoot(a: string, b: string): boolean {
    const normal = (root: string): string => path.posix.normalize(root.replace(/\\/g, "/")).replace(/\/+$/, "");
    return normal(a) === normal(b);
}

/**
 * Re-infer over a manifest the project already declares, keeping what only the
 * declaration knows.
 *
 * An inferred app takes the name the file gives the app it matches — the
 * backend, or the static app with the same `root` — and that app's `path` and
 * `cms`. The name is the app's identity on a deployed project, so renaming it
 * would deploy a second app beside the first. `path` can carry the hostname the
 * app is registered on. `cms` is a client-side route that nothing in the project
 * shows. Everything else is inferred again, which is what `--force` asks for.
 *
 * A declared app the inference does not find is returned in `removed`, so the
 * command can say so rather than drop it in silence.
 */
function keepDeclaredIdentity(
    inferred: RebaseProjectManifest,
    declared: RebaseProjectManifest
): { manifest: RebaseProjectManifest; removed: Array<{ name: string; app: RebaseAppConfig }> } {
    const apps: Record<string, RebaseAppConfig> = {};
    const matched = new Set<string>();

    for (const [name, app] of Object.entries(inferred.apps)) {
        if (app.type === "backend") {
            const backend = findBackendApp(declared);
            const keptName = backend && !matched.has(backend.name) ? backend.name : name;
            matched.add(keptName);
            apps[keptName] = app;
            continue;
        }
        const match = Object.entries(declared.apps).find(([declaredName, candidate]) =>
            !matched.has(declaredName) && candidate.type === "static" && sameRoot(candidate.root, app.root));
        const declaredApp = match?.[1];
        if (!match || declaredApp?.type !== "static") {
            apps[name] = app;
            continue;
        }
        const keptName = match[0];
        matched.add(keptName);
        const address = declaredApp.path ?? app.path;
        apps[keptName] = {
            ...app,
            ...(address !== undefined ? { path: address } : {}),
            ...(declaredApp.cms !== undefined ? { cms: declaredApp.cms } : {})
        };
    }

    const removed = Object.entries(declared.apps)
        .filter(([name]) => !matched.has(name))
        .map(([name, app]) => ({ name, app }));
    return { manifest: { ...inferred, apps }, removed };
}

async function initManifest(force: boolean): Promise<void> {
    const projectRoot = requireProjectRoot();

    let declared: RebaseProjectManifest | undefined;
    if (manifestExists(projectRoot)) {
        if (!force) {
            console.error(chalk.red("✗ rebase.json already exists."));
            console.error(chalk.dim("  Pass --force to replace it with an inferred one, keeping each app's name, path and cms."));
            process.exit(1);
        }
        try {
            declared = loadManifest(projectRoot).manifest;
        } catch (err) {
            if (!(err instanceof ManifestError)) throw err;
            const issues = err.issues.map(issue => `${issue.path ? `${issue.path}: ` : ""}${issue.message}`);
            console.log(chalk.yellow("• The existing rebase.json is invalid, so no app name, path or cms in it is kept:"));
            for (const issue of issues.length > 0 ? issues : [err.message]) console.log(chalk.dim(`    ${issue}`));
        }
    }

    const inferred = synthesizeManifest(projectRoot);
    const { manifest, removed } = declared
        ? keepDeclaredIdentity(inferred, declared)
        : { manifest: inferred, removed: [] };
    const filePath = writeManifest(projectRoot, manifest);

    console.log(chalk.green(`✓ Wrote ${path.relative(projectRoot, filePath)}`));
    console.log("");
    for (const [name, app] of Object.entries(manifest.apps)) {
        console.log(`  ${chalk.cyan(name)} ${chalk.dim(`(${app.type})`)}`);
    }
    for (const { name, app } of removed) {
        const where = app.type === "static" ? `, root ${app.root}` : "";
        console.log(`  ${chalk.yellow(name)} ${chalk.dim(`(${app.type}${where})`)} ${chalk.yellow("— not found in this project, removed")}`);
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
    const loaded = loadManifestOrExit(projectRoot, asJson);

    if (!appName) {
        if (asJson) {
            failAsJson("Which app? Usage: rebase apps config <app>", "app_not_named",
                `Declared: ${Object.keys(loaded.manifest.apps).join(", ") || "(none)"}`);
        }
        console.error(chalk.red("✗ Which app? Usage: rebase apps config <app>"));
        process.exit(1);
    }

    const app = loaded.manifest.apps[appName];
    if (!app) {
        if (asJson) {
            failAsJson(`No app named "${appName}" in rebase.json.`, "app_not_found",
                `Declared: ${Object.keys(loaded.manifest.apps).join(", ") || "(none)"}`);
        }
        console.error(chalk.red(`✗ No app named "${appName}" in rebase.json.`));
        console.error(chalk.dim(`  Declared: ${Object.keys(loaded.manifest.apps).join(", ") || "(none)"}`));
        process.exit(1);
    }

    const link = readLink(projectRoot);
    // An app the backend bundle serves calls the API on its own origin, so the
    // right value is empty — wherever the project is linked, and whatever a
    // dev server once wrote down. A URL here is baked into the build and
    // follows the bundle into production.
    const sameOrigin = servedByBackend(loaded.manifest, appName);
    const apiUrl = sameOrigin ? "" : resolveApiUrl(projectRoot, link);

    const config = {
        app: appName,
        type: app.type,
        apiUrl: apiUrl ?? null,
        sameOrigin,
        project: link?.projectId ?? link?.slug ?? null
    };

    if (asJson) {
        console.log(JSON.stringify(config, null, 2));
        return;
    }

    if (sameOrigin) {
        console.log(chalk.bold(`# ${appName}`));
        console.log("");
        console.log("VITE_API_URL=");
        console.log("");
        console.log(chalk.dim(`Empty on purpose: \`rebase build\` folds ${appName} into the backend bundle, so it`));
        console.log(chalk.dim("calls the API on the same origin it is served from, locally and deployed alike."));
        console.log(chalk.dim("(`rebase dev` points it at the dev backend by itself.)"));
        return;
    }

    if (!apiUrl) {
        console.log(chalk.yellow("This checkout is not linked to a project yet."));
        // `rebase cloud link`, not `rebase link`. There has never been a
        // top-level `link` command — `cli.ts` dispatches `cloud`, and the link
        // lives inside that family — so this hint named something that exits 1
        // on the very screen that exists to tell you what to run next.
        console.log(chalk.dim(`  Run ${chalk.cyan("rebase cloud link")} (cloud) or ${chalk.cyan("rebase cloud link <url>")} (self-hosted).`));
        console.log("");
    }

    console.log(chalk.bold(`# ${appName}`));
    console.log("");
    // Unlinked: the dev backend this project runs on, not a fixed 3001 — `rebase dev`
    // derives a port per project.
    console.log(`VITE_API_URL=${apiUrl ?? devServerUrl(projectRoot).url}`);
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
            const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as { baseUrl?: string; pid?: number };
            // Only a dev server that is still running: the file outlives the
            // process, and a port nothing listens on is not an address.
            if (state.baseUrl && typeof state.pid === "number" && isRunning(state.pid)) return state.baseUrl;
        } catch {
            // Stale or partially written state file: fall through.
        }
    }

    return undefined;
}

/** Signal 0 checks a process exists without touching it; EPERM means it does, as someone else. */
function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === "EPERM";
    }
}

/**
 * Whether `rebase build` folds this static app into the backend bundle, which
 * then serves it on the API's own origin: a managed backend, and an app with
 * built output to fold. The same predicate the build folds by.
 */
export function servedByBackend(manifest: ReturnType<typeof loadManifest>["manifest"], appName: string): boolean {
    const backend = findBackendApp(manifest);
    if (!backend || backend.app.type !== "backend" || backend.app.runtime === "custom") return false;
    return foldableApps(manifest).apps.some(app => app.name === appName);
}

function loadManifestOrExit(projectRoot: string, asJson = false): ReturnType<typeof loadManifest> {
    try {
        return loadManifest(projectRoot);
    } catch (err) {
        if (err instanceof ManifestError) {
            // A caller that asked for JSON gets one on this exit too. It used
            // to get the human bullet list on stderr and an empty stdout —
            // `apps list --json` against the one manifest a caller most needs
            // to be told about.
            if (asJson) {
                failAsJson(err.message, "manifest_invalid", "Fix rebase.json, then run this again.",
                    err.issues.map(issue => ({ path: issue.path, message: issue.message })));
            }
            console.error(chalk.red(`✗ ${err.message}`));
            for (const issue of err.issues) {
                console.error(chalk.red(`    ${issue.path ? `${issue.path}: ` : ""}${issue.message}`));
            }
            process.exit(1);
        }
        throw err;
    }
}
