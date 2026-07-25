/**
 * Folding a project's frontend into its backend bundle.
 *
 * Shared by `rebase build` and `rebase cloud deploy` deliberately. It lived in
 * the build *command* first, and `deploy` rebuilds the bundle itself — so a
 * deploy silently produced a bundle without the frontend, packed 164 KB where
 * 39 MB was expected, and the site 404'd on the managed runtime exactly as if
 * folding had never been written. Two callers building the same artefact must
 * share the step that completes it.
 *
 * Why fold at all: `bootFromBundle` already serves a SPA from `entry.static`
 * behind `REBASE_SERVE_STATIC` (default on). A managed tenant runs one pod, so
 * putting the built site in the bundle gives it the shape a custom container
 * already had — site at `/`, API at `/api` — which is the only honest baseline
 * for calling the managed runtime a drop-in replacement.
 */
import fs from "fs";
import path from "path";
import { execa } from "execa";
import chalk from "chalk";
import { foldStaticIntoBundle } from "./bundle";

/** The apps section of a project manifest, as much of it as folding needs. */
export interface FoldableManifest {
    apps?: Record<string, { type?: string; build?: string; output?: string }>;
}

export interface FoldOptions {
    projectRoot: string;
    manifest: FoldableManifest;
    /** The backend bundle directory, already written. */
    bundleDir: string;
    /** Skip running the app's own build command; fold what is already built. */
    skipBuild?: boolean;
    log?: (message: string) => void;
}

export interface FoldOutcome {
    appName: string;
    fileCount: number;
}

/**
 * Which static app, if any, should be served by the backend.
 *
 * Exactly one `static` app is folded. With several, folding would have to choose,
 * and silently picking one of two websites is worse than doing nothing — so it
 * declines and names what it saw. Pure, so the decision is testable without a
 * filesystem.
 */
export function selectFoldableApp(manifest: FoldableManifest): {
    app?: { name: string; build?: string; output?: string };
    /** Why nothing will be folded, when that is the answer. */
    reason?: string;
} {
    const statics = Object.entries(manifest.apps ?? {})
        .filter(([, app]) => app?.type === "static")
        .map(([name, app]) => ({ name, build: app?.build, output: app?.output }));

    if (statics.length === 0) return {};
    if (statics.length > 1) {
        return {
            reason:
                `${statics.length} static apps (${statics.map(s => s.name).join(", ")}) — none folded in. ` +
                "Pick one to serve from the backend, or host them separately."
        };
    }
    const only = statics[0];
    if (!only.output) {
        return { reason: `"${only.name}" declares no output directory — not folded in.` };
    }
    return { app: only };
}

/**
 * Build the project's frontend and fold it into the backend bundle.
 *
 * Throws rather than exiting, so the caller decides whether a missing frontend
 * should fail its command — a `build` may reasonably want to stop, and so should
 * a deploy, but that is not this function's call to make.
 */
export async function foldFrontendIntoBundle(options: FoldOptions): Promise<FoldOutcome | null> {
    const { projectRoot, manifest, bundleDir, skipBuild } = options;
    const log = options.log ?? ((m: string) => console.log(m));

    const { app, reason } = selectFoldableApp(manifest);
    if (reason) {
        log(chalk.yellow(`    ⚠ ${reason}`));
        return null;
    }
    if (!app) return null;

    if (app.build && !skipBuild) {
        await execa(app.build, { cwd: projectRoot, stdio: "inherit", shell: true });
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

    const { fileCount } = foldStaticIntoBundle({ bundleDir, assetsDir });
    return { appName: app.name, fileCount };
}
