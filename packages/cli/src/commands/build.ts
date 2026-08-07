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
import type { RebaseAppConfig, RebaseStaticAppConfig } from "@rebasepro/types";
import { requireProjectRoot } from "../utils/project";
import { detectPackageManager, getPMCommands } from "../utils/package-manager";
import { buildableApps, findBackendApp, loadManifest, ManifestError } from "../manifest";
import {
    buildBundle,
    buildStaticBundle,
    detectFrameworkDepDrift,
    resolveCliVersion,
    DEFAULT_BUNDLE_DIR
} from "../bundle";
import { assertBuiltForPath, foldFrontendIntoBundle, staticBuildEnv } from "../fold-static";

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
            "--output": String,
            // `--out` kept as an accepted alias. `generate-sdk` has always
            // spelled this `--output`, and two names for one concept across one
            // CLI is a thing you have to remember rather than know. `--output`
            // is canonical now; `--out` still works so no script breaks.
            "--out": "--output",
            "--skip-type-check": Boolean,
            "--skip-schema": Boolean,
            /* Do not fold the frontend into the backend bundle. For a project
               that publishes its frontend elsewhere and does not want the assets
               travelling with its API. */
            "--no-static": Boolean,
            /* Fold assets that are already built, without re-running the app's
               build command — for a CI job that built the frontend in an earlier
               step. */
            "--skip-static-build": Boolean,
            "--legacy": Boolean,
            "--help": Boolean,
            "-h": "--help"
        },
        { argv: rawArgs.slice(3),
permissive: true }
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

        if (app.type === "backend" && app.runtime === "custom") {
            // An ejected backend's artifact is an IMAGE, not a bundle. Building
            // one anyway produced a `dist-bundle/` the project never deploys,
            // which is worse than doing nothing: it looks like the thing that
            // ships. The workspace's own `build` script compiles this app, and
            // the Dockerfile turns it into the image.
            console.log(chalk.dim("  custom runtime — this project builds its own image, not a bundle"));
            console.log(chalk.dim(`    ${chalk.cyan(`npm run build --workspace ${name}`)}  then  ${chalk.cyan(`docker build -f ${app.dockerfile ?? "Dockerfile"} .`)}`));
            console.log("");
            continue;
        }

        if (app.type === "backend") {
            const result = await buildBundle({
                projectRoot,
                appName: name,
                app,
                outDir: args["--output"],
                runtimeRange: manifest.rebase,
                storage: manifest.storage,
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

            /* Framework pins older than this CLI.

               Warned here because this is the only moment anyone can be told.
               Locally every `@rebasepro/*` resolves through pnpm's workspace and
               `link:` overrides to the checkout, so the version strings in
               package.json are never exercised — the project runs fine on a
               developer's machine while declaring something years old. Those
               strings are first honoured when the runtime npm-installs them in
               the cloud, and by then the symptom is a tenant that boots and then
               misbehaves against its database.

               A warning rather than a hard failure: the CLI cannot know that a
               newer package has actually been published, and refusing to build
               over a guess would be worse than saying it out loud. */
            const drift = detectFrameworkDepDrift(projectRoot, resolveCliVersion());
            if (drift.behind.length > 0) {
                console.log(chalk.yellow(`    ⚠ framework dependencies older than this CLI (${resolveCliVersion()}):`));
                for (const dep of drift.behind) {
                    console.log(chalk.dim(`      ${dep.name}@${dep.range}  (${dep.file})`));
                }
                console.log(chalk.dim("      The image supplies the server, but your bundle supplies the database"));
                console.log(chalk.dim("      driver — a newer runtime does not update it. Bump these and rebuild."));
            } else if (drift.disagreeing.length > 0) {
                console.log(chalk.yellow(`    ⚠ mixed @rebasepro versions declared: ${drift.disagreeing.join(", ")}`));
                console.log(chalk.dim("      These are published together and expect to run together; pin them alike."));
            }

            /* Fold the project's static apps into the backend bundle, so ONE
               runtime serves the site at `/`, the admin at `/admin` and the API
               at `/api` — the shape the scaffolded template produces and the
               shape a custom container already had.

               Without this, moving a project to the managed runtime silently
               removed its website: the API answered perfectly and every page
               404'd, because the managed pod runs the backend bundle and nothing
               else. Parity with the container being replaced is the only honest
               baseline for calling managed a drop-in.

               `--no-static` opts out, for a project that publishes its frontend
               somewhere else and does not want the assets in its bundle. */
            if (!args["--no-static"]) {
                const folded = await foldFrontendIntoBundle({
                    projectRoot,
                    manifest,
                    bundleDir: result.outDir,
                    skipBuild: args["--skip-static-build"] === true,
                    log: (m) => console.log(m)
                }).catch((err: unknown) => {
                    console.error(chalk.red(`    ✗ ${err instanceof Error ? err.message : String(err)}`));
                    process.exit(1);
                });
                for (const outcome of folded ?? []) {
                    console.log(
                        chalk.green(`    ✓ ${outcome.appName} folded in`) +
                        chalk.dim(` (${outcome.fileCount} file(s) → served at ${outcome.path})`)
                    );
                }
            }
        } else if (app.type === "static") {
            await buildAssetApp(projectRoot, name, app, manifest.rebase, args["--output"]);
        }

        console.log("");
    }

    console.log(chalk.green("✓ Build complete."));
}

/**
 * Build a static app and package it into a static bundle.
 *
 * Runs the app's own build command, checks it produced the declared output, then
 * packages that output into a `static`-kind bundle — the same deployable shape as
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
    const asset = app as RebaseStaticAppConfig;
    const basePath = asset.path ?? "/";

    if (!asset.build) {
        console.log(chalk.dim("  no build command declared — skipping"));
        return;
    }

    try {
        await execa(asset.build, {
            cwd: projectRoot,
            stdio: "inherit",
            shell: true,
            env: staticBuildEnv(basePath, name)
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

    // The assets were built for `basePath`; refusing here is the difference
    // between a build error and a blank page nobody can diagnose.
    const indexHtml = path.join(outputPath, "index.html");
    if (fs.existsSync(indexHtml)) {
        try {
            assertBuiltForPath(fs.readFileSync(indexHtml, "utf8"), basePath, name);
        } catch (err) {
            console.error(chalk.red(`  ✗ ${err instanceof Error ? err.message : String(err)}`));
            process.exit(1);
        }
    }

    // Per-app bundle directory, so a project's several static apps do not clobber
    // one another or the backend's `dist-bundle`.
    const outDir = outOverride
        ? path.resolve(process.cwd(), outOverride)
        : path.join(projectRoot, `dist-bundle-${name}`);
    const result = buildStaticBundle({
        projectRoot,
        appName: name,
        assetsDir: outputPath,
        outDir,
        runtimeRange,
        path: basePath,
        spa: asset.spa ?? true
    });
    const rel = path.relative(projectRoot, result.outDir);
    console.log(
        chalk.green(`  ✓ static bundle → ${rel}/`) +
        chalk.dim(` (${result.fileCount} file(s) → served at ${basePath})`)
    );
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
