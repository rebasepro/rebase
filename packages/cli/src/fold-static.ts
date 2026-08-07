/**
 * Folding a project's static apps into its backend bundle.
 *
 * Shared by `rebase build` and `rebase cloud deploy` deliberately. It lived in
 * the build *command* first, and `deploy` rebuilds the bundle itself — so a
 * deploy silently produced a bundle without the frontend, packed 164 KB where
 * 39 MB was expected, and the site 404'd on the managed runtime exactly as if
 * folding had never been written. Two callers building the same artefact must
 * share the step that completes it.
 *
 * Why fold at all: `bootFromBundle` serves static apps from `entry.static`
 * behind `REBASE_SERVE_STATIC` (default on). A managed tenant runs one pod, so
 * putting the built assets in the bundle gives it the shape a custom container
 * already had — site at `/`, admin at `/admin`, API at `/api` — which is the
 * only honest baseline for calling the managed runtime a drop-in replacement.
 *
 * **Every** static app is folded, each at its declared path. Folding used to
 * pick exactly one and refuse when it found two, which meant a project with a
 * site and an admin panel deployed with neither.
 */
import fs from "fs";
import path from "path";
import { execa } from "execa";
import chalk from "chalk";
import { foldStaticIntoBundle } from "./bundle";

/** The apps section of a project manifest, as much of it as folding needs. */
export interface FoldableManifest {
    apps?: Record<string, {
        type?: string;
        build?: string;
        output?: string;
        path?: string;
        spa?: boolean;
    }>;
}

export interface FoldOptions {
    projectRoot: string;
    manifest: FoldableManifest;
    /** The backend bundle directory, already written. */
    bundleDir: string;
    /** Skip running each app's own build command; fold what is already built. */
    skipBuild?: boolean;
    log?: (message: string) => void;
}

export interface FoldOutcome {
    appName: string;
    fileCount: number;
    /** Public base path this app was folded in at. */
    path: string;
}

/** A static app as folding sees it, with the manifest's defaults applied. */
export interface FoldableApp {
    name: string;
    build?: string;
    output?: string;
    /** Public base path, defaulted to `/`. */
    path: string;
    /** SPA fallback, defaulted to `true`. */
    spa: boolean;
}

/**
 * Every static app in the manifest, in mount order.
 *
 * Longest path first, so the `/`-rooted app is registered last — its catch-all
 * would otherwise claim its siblings' URLs. Pure, so the ordering is testable
 * without a filesystem.
 */
export function foldableApps(manifest: FoldableManifest): {
    apps: FoldableApp[];
    /** Apps that cannot be folded, and why. */
    skipped: { name: string; reason: string }[];
} {
    const apps: FoldableApp[] = [];
    const skipped: { name: string; reason: string }[] = [];

    for (const [name, app] of Object.entries(manifest.apps ?? {})) {
        if (app?.type !== "static") continue;
        if (!app.output) {
            skipped.push({ name,
reason: `"${name}" declares no output directory — not folded in.` });
            continue;
        }
        apps.push({
            name,
            build: app.build,
            output: app.output,
            path: app.path ?? "/",
            spa: app.spa ?? true
        });
    }

    apps.sort((a, b) => b.path.length - a.path.length);
    return { apps,
skipped };
}

/**
 * Assert a built app's assets are actually rooted at the path it is served from.
 *
 * An app mounted at `/admin` but built with Vite's default `base: "/"` emits
 * `<script src="/assets/index-a1b2.js">`. The server serves `index.html` fine
 * and 404s every asset: a blank page, no server error, nothing in the logs. It
 * is the single most expensive silent failure in this design, so it is a build
 * error rather than a runtime surprise.
 *
 * Only `<script src>` and `<link href>` are inspected — those are what a bundler
 * rewrites through `base`. Author-written anchors and canonical URLs are not
 * evidence of a misbuild.
 */
export function assertBuiltForPath(
    indexHtml: string,
    basePath: string,
    appName: string
): void {
    if (basePath === "/") return;

    const offenders: string[] = [];
    const pattern = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    for (const match of indexHtml.matchAll(pattern)) {
        const ref = match[1];
        if (!ref.startsWith("/")) continue;
        if (ref === `${basePath}` || ref.startsWith(`${basePath}/`)) continue;
        offenders.push(ref);
    }

    if (offenders.length === 0) return;

    throw new Error(
        `"${appName}" is declared at ${basePath} but its build emitted assets rooted at /.\n` +
        `    index.html references: ${offenders.slice(0, 3).join(", ")}\n` +
        "    The app would load a blank page. Set `base` from REBASE_APP_BASE in its\n" +
        "    build config — see docs/apps-and-runtimes.md §4.2."
    );
}

/**
 * The environment every static app is built with, wherever that build is driven from.
 *
 * Shared because there are two drivers — `foldFrontendIntoBundle` here, and
 * `buildAssetApp` in `build.ts` for a standalone `type: "static"` app — and they
 * had already drifted: the path variables were duplicated into both, so a fix
 * applied to one shipped a bundle built the old way from the other. One function
 * makes that impossible rather than merely unlikely.
 *
 * ## REBASE_APP_*
 *
 * The declared path is a build-time input, not only a serving concern: Vite
 * reads `base` from REBASE_APP_BASE, and the trailing slash is that field's
 * convention. See `assertBuiltForPath`.
 *
 * ## NODE_ENV
 *
 * A built app is a production artifact by construction, so build it as one. Not
 * a formality: the scaffold's `.env` carries `NODE_ENV=development` for the dev
 * backend, and Vite's `loadEnv` promotes a `NODE_ENV` found in an env file into
 * the build unless the environment already sets one. So `rebase build` and
 * `rebase cloud deploy` shipped a *development* bundle — `import.meta.env.DEV
 * === true`, development React, dev-only branches live — from commands whose
 * whole purpose is to produce something deployable. Setting it here is what
 * closes it: Vite consults the env file's NODE_ENV only when `process.env`
 * has none.
 *
 * ## VITE_API_URL
 *
 * An app served by the backend it talks to has its API on its own origin by
 * construction, so a baked-in absolute URL can only be wrong. It was: that same
 * `.env` carries `VITE_API_URL=http://localhost:3001` and
 * `frontend/vite.config.ts` reads the project root via `envDir: ".."`, so a
 * stock deploy shipped a site whose every request went to whoever ran the build
 * — passing every server-side health check on the way out. Blanking it here
 * fixes the bundle even for a project whose `.env` predates the `init` fix, or
 * was written by hand. Empty is the right value rather than a missing one: the
 * client falls back to `window.location.origin`, which keeps working when a
 * custom domain is added.
 *
 * Vite prioritises `process.env.VITE_*` over `.env` files, so an explicit
 * `VITE_API_URL=https://api.example.com rebase cloud deploy` still wins — the
 * cross-origin escape hatch stays open, it just has to be deliberate. Nothing on
 * this path loads the project `.env` into `process.env`, so a value inherited
 * here really was set by the caller.
 */
export function staticBuildEnv(appPath: string, appName: string): Record<string, string> {
    return {
        REBASE_APP_PATH: appPath,
        REBASE_APP_BASE: appPath === "/" ? "/" : `${appPath}/`,
        REBASE_APP_NAME: appName,
        NODE_ENV: "production",
        VITE_API_URL: process.env.VITE_API_URL ?? ""
    };
}

/**
 * Build the project's static apps and fold them into the backend bundle.
 *
 * Throws rather than exiting, so the caller decides whether a missing frontend
 * should fail its command — a `build` may reasonably want to stop, and so should
 * a deploy, but that is not this function's call to make.
 */
export async function foldFrontendIntoBundle(options: FoldOptions): Promise<FoldOutcome[]> {
    const { projectRoot, manifest, bundleDir, skipBuild } = options;
    const log = options.log ?? ((m: string) => console.log(m));

    const { apps, skipped } = foldableApps(manifest);
    for (const { reason } of skipped) log(chalk.yellow(`    ⚠ ${reason}`));
    if (apps.length === 0) return [];

    const outcomes: FoldOutcome[] = [];

    for (const app of apps) {
        if (app.build && !skipBuild) {
            await execa(app.build, {
                cwd: projectRoot,
                stdio: "inherit",
                shell: true,
                env: staticBuildEnv(app.path, app.name)
            });
        }

        const assetsDir = path.join(projectRoot, app.output as string);
        if (!fs.existsSync(assetsDir)) {
            // Exited 0 and produced nothing where the manifest says it should.
            // Folding that ships an empty site, which from the outside is
            // indistinguishable from a broken deploy.
            throw new Error(
                `"${app.name}" declared output "${app.output}" does not exist after building — ` +
                "the bundle would ship without a frontend."
            );
        }

        const indexHtml = path.join(assetsDir, "index.html");
        if (fs.existsSync(indexHtml)) {
            assertBuiltForPath(fs.readFileSync(indexHtml, "utf8"), app.path, app.name);
        }

        const { fileCount } = foldStaticIntoBundle({
            bundleDir,
            assetsDir,
            appName: app.name,
            path: app.path,
            spa: app.spa
        });
        outcomes.push({ appName: app.name,
fileCount,
path: app.path });
    }

    return outcomes;
}
