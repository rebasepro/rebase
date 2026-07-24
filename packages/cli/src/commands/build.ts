/**
 * CLI command: rebase build [app...]
 *
 * Builds the apps a repository declares in `rebase.json`.
 *
 * For a `backend` app this produces a **bundle** — compiled collections,
 * functions and schema plus a manifest — which is the artifact the runtime
 * loads. For `static` and bundled `admin` apps it runs the declared build
 * command and reports where the output landed.
 *
 * A project with no manifest, or one whose backend has been ejected to its own
 * entrypoint, falls back to the previous behaviour: run every workspace's own
 * `build` script. Nothing that built before stops building.
 */
import fs from "fs";
import path from "path";
import arg from "arg";
import chalk from "chalk";
import { execa } from "execa";
import type { RebaseAppConfig, RebaseStaticAppConfig, RebaseAdminAppConfig } from "@rebasepro/types";
import { requireProjectRoot } from "../utils/project";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";
import { buildableApps, findBackendApp, loadManifest, ManifestError } from "../manifest";
import { buildBundle, buildStaticBundle, DEFAULT_BUNDLE_DIR } from "../bundle";

function printHelp(): void {
    console.log(`
${chalk.bold("rebase build")} — build the apps declared in rebase.json

${chalk.bold("Usage")}
  rebase build [app...]        Build the named apps (default: all)

${chalk.bold("Options")}
  --out <dir>                  Bundle output directory (default: ${DEFAULT_BUNDLE_DIR})
  --skip-type-check            Compile without type checking (faster; use for iteration only)
  --skip-schema                Do not regenerate the database schema from collections
  --legacy                     Run every workspace's own build script instead
  -h, --help                   Show this help

${chalk.bold("Examples")}
  rebase build                 Build every app in this repository
  rebase build backend         Build only the backend bundle
  rebase build web             Build only the "web" static app
`.trim());
}

export async function buildCommand(rawArgs: string[] = []): Promise<void> {
    const args = arg(
        {
            "--out": String,
            "--skip-type-check": Boolean,
            "--skip-schema": Boolean,
            "--legacy": Boolean,
            "--help": Boolean,
            "-h": "--help"
        },
        { argv: rawArgs.slice(3), permissive: true }
    );

    if (args["--help"]) {
        printHelp();
        return;
    }

    const projectRoot = requireProjectRoot();

    if (args["--legacy"]) {
        await runWorkspaceBuilds(projectRoot);
        return;
    }

    let loaded;
    try {
        loaded = loadManifest(projectRoot);
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

    const { manifest, source } = loaded;
    const requested = args._.filter(a => !a.startsWith("-"));

    let targets = buildableApps(manifest);
    if (requested.length > 0) {
        const known = new Set(targets.map(t => t.name));
        const unknown = requested.filter(name => !known.has(name));
        if (unknown.length > 0) {
            console.error(chalk.red(`✗ Unknown app(s): ${unknown.join(", ")}`));
            console.error(chalk.dim(`  This repository declares: ${targets.map(t => t.name).join(", ") || "(none)"}`));
            process.exit(1);
        }
        targets = targets.filter(t => requested.includes(t.name));
    }

    if (targets.length === 0) {
        console.log(chalk.yellow("No buildable apps declared. Nothing to do."));
        return;
    }

    // An ejected backend owns its own build; the workspace scripts are the only
    // thing that knows how to run it.
    const backend = findBackendApp(manifest);
    if (!backend && source === "synthesized") {
        console.log(chalk.dim("No rebase.json found — building workspace packages.\n"));
        await runWorkspaceBuilds(projectRoot);
        return;
    }

    console.log(`${chalk.bold("Rebase")} — building ${targets.length} app(s)\n`);

    for (const { name, app } of targets) {
        console.log(chalk.cyan(`▸ ${name}`) + chalk.dim(` (${app.type})`));

        if (app.type === "backend") {
            const result = await buildBundle({
                projectRoot,
                appName: name,
                app,
                outDir: args["--out"],
                runtimeRange: manifest.runtime,
                skipTypeCheck: args["--skip-type-check"],
                skipSchema: args["--skip-schema"]
            });
            const rel = path.relative(projectRoot, result.outDir);
            console.log(chalk.green(`  ✓ bundle → ${rel}/`));
            console.log(chalk.dim(`    ${result.collectionCount} collection(s), schema ${result.manifest.schemaVersion}`));
            if (result.manifest.hooks.native) {
                const names = (result.manifest.hooks.nativeModules ?? []).map(m => m.name).join(", ");
                console.log(chalk.yellow(`    ⚠ native dependencies detected: ${names}`));
                console.log(chalk.dim("      These cannot run on the managed runtime. See `rebase doctor`."));
            }
        } else if (app.type === "static" || app.type === "admin") {
            await buildAssetApp(projectRoot, name, app, manifest.runtime, args["--out"]);
        } else if (app.type === "custom") {
            console.log(chalk.dim("  custom container — built at deploy time from its Dockerfile"));
        }

        console.log("");
    }

    console.log(chalk.green("✓ Build complete."));
}

/**
 * Build a static or bundled-admin app and package it into a static bundle.
 *
 * Runs the app's own build command, checks it produced the declared output, then
 * packages that output into a `static`-mode bundle — the same deployable shape as
 * a backend bundle, so a frontend or admin app deploys through the identical
 * path and runs on the identical image, just serving files instead of an API.
 */
async function buildAssetApp(
    projectRoot: string,
    name: string,
    app: RebaseAppConfig,
    runtimeRange: string,
    outOverride?: string
): Promise<void> {
    const asset = app as RebaseStaticAppConfig | RebaseAdminAppConfig;

    if (app.type === "admin" && (app as RebaseAdminAppConfig).mode !== "bundled") {
        console.log(chalk.dim("  hosted admin panel — nothing to build"));
        return;
    }

    if (!asset.build) {
        console.log(chalk.dim("  no build command declared — skipping"));
        return;
    }

    try {
        await execa(asset.build, {
            cwd: projectRoot,
            stdio: "inherit",
            shell: true
        });
    } catch {
        console.error(chalk.red(`  ✗ build command failed for "${name}"`));
        process.exit(1);
    }

    if (!asset.output) {
        console.log(chalk.yellow("  no output directory declared — built, but nothing to bundle"));
        return;
    }

    const outputPath = path.join(projectRoot, asset.output);
    if (!fs.existsSync(outputPath)) {
        // The command exited 0 but produced nothing where the manifest says it
        // should. Bundling that would ship an empty site.
        console.error(chalk.red(`  ✗ declared output "${asset.output}" does not exist after building`));
        process.exit(1);
    }

    // Per-app bundle directory, so a project's several static apps do not clobber
    // one another or the backend's `dist-bundle`.
    const outDir = outOverride
        ? path.resolve(process.cwd(), outOverride)
        : path.join(projectRoot, `dist-bundle-${name}`);
    const result = buildStaticBundle({ projectRoot, appName: name, assetsDir: outputPath, outDir, runtimeRange });
    const rel = path.relative(projectRoot, result.outDir);
    console.log(chalk.green(`  ✓ static bundle → ${rel}/`) + chalk.dim(` (${result.fileCount} file(s))`));
}

/** The pre-manifest behaviour: build every workspace package. */
async function runWorkspaceBuilds(projectRoot: string): Promise<void> {
    const pm = detectPackageManager(projectRoot);
    const cmds = getPMCommands(pm);
    const buildCmd = cmds.runAll("build");

    console.log(`${chalk.bold("Rebase")} — Building all workspaces with ${chalk.cyan(pm)}...\n`);

    try {
        await execa(buildCmd[0], buildCmd.slice(1), {
            cwd: projectRoot,
            stdio: "inherit"
        });
    } catch {
        console.error(chalk.red("\n✗ Build failed."));
        process.exit(1);
    }
}
