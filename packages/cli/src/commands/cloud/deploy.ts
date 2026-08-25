/**
 * `rebase cloud deploy` and `rebase cloud logs`.
 *
 * `deploy` triggers the control-plane `deploy` function, then tails the build
 * logs from the deployment record until it succeeds or fails. `logs` shows the
 * latest build log, or runtime logs with `--runtime`.
 *
 * There are three deploys behind the one verb, and which one runs depends on the
 * flags: `--bundle` builds and uploads a managed bundle, `--source .` uploads
 * this directory as a build context, and the bare form uploads nothing and asks
 * the control plane to rebuild what it already holds. That last one is the
 * dangerous one — see `planBareDeploy`.
 */
import arg from "arg";
import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import {
    requireClient,
    resolveProjectRef,
    parseCloudArgs,
    colorStatus,
    emit,
    isJsonMode,
    printJson,
    fail,
    warn,
    reportError,
    type CloudClient
} from "./context";
import { latestDeployment, fmtDate } from "./projects";
import { readBundleManifest, packBundle, uploadBundle, bundleDeployBody, declaredAppsFrom } from "./bundle-deploy";
import { buildBundle } from "../../bundle";
import { buildAssetApp } from "../build";
import { foldFrontendIntoBundle } from "../../fold-static";
import { loadManifest, findBackendApp, resolveBackendPaths, selectDeployApp } from "../../manifest";
import { findProjectRoot, requireProjectRoot } from "../../utils/project";
import { deriveResourceGraph } from "../../resources/derive";
import type { RebaseAppConfig, RebaseBackendAppConfig } from "@rebasepro/types";

interface Deployment {
    id: string | number;
    status?: string;
    logs?: string;
    createdAt?: string;
}

/**
 * What the control plane says about the deployment holding the lock, when it
 * refuses a trigger. Absent on control planes older than that change.
 */
interface BlockingDeployment {
    id?: string;
    createdAt?: string | null;
    status?: string | null;
    triggerSource?: string;
    /** Whether the blocking deployment was triggered by THIS user. */
    mine?: boolean;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 15 * 60 * 1000; // 15 min hard stop

// Keep in sync with the control plane's build-context cap (deploy/upload
// MAX_BYTES and the backend's maxBodySize). Checked before uploading so an
// oversized context fails in milliseconds with a hint, not after the upload
// with a bare 413.
const MAX_SOURCE_UPLOAD_BYTES = 100 * 1024 * 1024;

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function run(cmd: string, cmdArgs: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, cmdArgs, { cwd,
env: env ? { ...process.env,
...env } : undefined,
stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr || `${cmd} exited ${code}`))));
    });
}

/**
 * Package `sourceDir` into a gzipped tarball, honoring `.gitignore`/`.rebaseignore`
 * and always excluding `.git` and `node_modules`. Returns the temp archive path.
 */
async function createSourceTarball(sourceDir: string): Promise<string> {
    const dir = path.resolve(sourceDir);
    if (!fs.existsSync(dir)) fail(`Source directory not found: ${dir}`);

    const tarPath = path.join(os.tmpdir(), `rebase-src-${Date.now()}.tar.gz`);
    const tarArgs = ["-czf", tarPath, "--exclude=.git", "--exclude=node_modules"];
    for (const ignore of [".gitignore", ".rebaseignore"]) {
        if (fs.existsSync(path.join(dir, ignore))) tarArgs.push(`--exclude-from=${ignore}`);
    }
    tarArgs.push(".");

    try {
        // COPYFILE_DISABLE: macOS bsdtar otherwise emits an AppleDouble sidecar
        // (`._foo.ts`) for every file carrying an xattr — and macOS stamps the
        // SIP-protected `com.apple.provenance` xattr routinely, so a stock
        // checkout ships `._*` binary junk that crashes schema generation in
        // the builder. GNU tar ignores the variable, so this is safe everywhere.
        await run("tar", tarArgs, dir, { COPYFILE_DISABLE: "1" });
    } catch (e) {
        fail(`Failed to package source: ${e instanceof Error ? e.message : String(e)}`);
    }
    return tarPath;
}

/**
 * The `@rebasepro/*` version this source directory actually resolves.
 *
 * Recorded on the deployment so a row in Deployment History says which
 * framework build shipped. Nothing else on the platform knows: an app that
 * links the framework locally pins it at package time, and a silent bump is
 * invisible afterwards — it has already cost one debugging session.
 *
 * `@rebasepro/server` first, because that is what the deployed backend runs;
 * `@rebasepro/client` is the fallback for a frontend-only bundle. Resolution is
 * a plain walk up from the source directory rather than `require.resolve`,
 * which would answer for the CLI's own install tree instead of the app's.
 *
 * Best effort by construction: a version that cannot be read is simply not
 * recorded. Nothing about a deploy should fail over a bookkeeping string.
 */
function resolveFrameworkVersion(sourceDir: string): string | undefined {
    let dir = path.resolve(sourceDir);
    for (;;) {
        for (const pkg of ["@rebasepro/server", "@rebasepro/client"]) {
            try {
                const manifest = path.join(dir, "node_modules", ...pkg.split("/"), "package.json");
                const version = (JSON.parse(fs.readFileSync(manifest, "utf8")) as { version?: unknown }).version;
                if (typeof version === "string" && version.trim() !== "") return version.trim();
            } catch {
                /* not here — keep walking */
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/**
 * A progress line for a human — dropped entirely in JSON mode.
 *
 * Progress is not a result. In JSON mode stdout carries the one result value
 * and nothing else, so every unguarded `console.log` on a deploy path was a
 * line printed in front of the JSON, breaking the parser meant to read it.
 * Warnings are the other half of this rule and go the other way: they are
 * `warn`, which prints in every mode, to stderr. See `warn` in `context.ts`.
 */
function progress(line: string): void {
    if (!isJsonMode()) console.log(line);
}

/** Upload a build-context tarball; returns the opaque `source` ref for deploy. */
async function uploadSource(url: string, token: string, projectId: string, tarPath: string): Promise<string> {
    const bytes = fs.readFileSync(tarPath);
    const sizeMb = (bytes.length / 1024 / 1024).toFixed(1);
    if (bytes.length > MAX_SOURCE_UPLOAD_BYTES) {
        fail(
            `Source context is ${sizeMb} MB — the upload cap is ${Math.round(MAX_SOURCE_UPLOAD_BYTES / 1024 / 1024)} MB.`,
            "Trim the build context: exclude sourcemaps (*.map), build output and large assets via .rebaseignore or .gitignore."
        );
    }
    progress(chalk.gray(`  Uploading source (${sizeMb} MB)...`));
    const res = await fetch(`${url}/api/functions/deploy/upload?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`,
"Content-Type": "application/gzip" },
        body: bytes
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        fail(`Source upload failed (${res.status}): ${body || res.statusText}`);
    }
    const data = (await res.json()) as { source?: string };
    if (!data.source) fail("Upload endpoint did not return a source reference.");
    return data.source;
}

/**
 * Build, upload and deploy a project as a managed bundle.
 *
 * Builds the backend app into `dist-bundle` (unless one is pointed at with
 * `--bundle-dir`), packs it without `node_modules`, uploads it, and triggers a
 * deploy carrying the manifest so the control plane can validate intake fast.
 */
async function deployBundle(opts: {
    client: CloudClient;
    url: string;
    projectId: string;
    projectRef: string;
    bundleDir?: string;
    message?: string;
    /** Which app to deploy, when this repository declares more than one. */
    appName?: string;
    /** Compile without type checking, exactly as `rebase build` does. */
    skipTypeCheck?: boolean;
}): Promise<void> {
    // Nothing here reads client/url/projectId/projectRef any more: everything
    // that needs them is reached through `uploadAndTrigger({ ...opts })`, which
    // takes the whole object. Destructuring them anyway is four values computed
    // and dropped.
    const projectRoot = requireProjectRoot();

    let bundleDir = opts.bundleDir
        ? path.resolve(process.cwd(), opts.bundleDir)
        : path.join(projectRoot, "dist-bundle");

    // Build the bundle unless the caller pointed at a prebuilt one.
    if (!opts.bundleDir) {
        const loaded = loadManifest(projectRoot);

        // Which app, decided once and by the manifest. A repository declares
        // apps and a project owns them, so a repository holding only an admin
        // panel is an ordinary thing rather than a repository with a missing
        // backend — which is what this used to call it, refusing the deploy.
        let target: { name: string; app: RebaseAppConfig };
        try {
            target = selectDeployApp(loaded.manifest, opts.appName);
        } catch (err) {
            fail(err instanceof Error ? err.message : String(err));
            return;
        }

        if (target.app.type === "static") {
            // A static app deploys through the identical path — upload, trigger,
            // same endpoint — and differs only in what it builds and in the
            // `kind` its manifest carries. The control plane routes on that.
            progress(chalk.gray(`  Building static app "${target.name}"...`));
            const staticDir = await buildAssetApp(
                projectRoot,
                target.name,
                target.app,
                loaded.manifest.rebase
            );
            if (!staticDir) {
                fail(
                    `App "${target.name}" produced no bundle.`,
                    "A static app needs both a `build` command and an `output` directory in rebase.json."
                );
                return;
            }
            bundleDir = staticDir;
            await uploadAndTrigger({ ...opts,
bundleDir,
appName: target.name });
            return;
        }

        progress(chalk.gray("  Building bundle..."));
        // `target` is decided above, by the manifest. Naming it `backend` here
        // is what the rest of this block reads.
        const backend = { name: target.name,
app: target.app as RebaseBackendAppConfig };

        // Same derivation `rebase build` does, and fatal for the same reason: a
        // bundle whose manifest is missing a bucket the code declares deploys
        // into a tenant with nothing provisioned for it. After `backend` on
        // purpose — the config directory it reads comes from that app.
        const { graph: resourceGraph, issues: resourceIssues } = await deriveResourceGraph({
            configDir: path.join(projectRoot, resolveBackendPaths(backend.app, projectRoot).config)
        });
        if (resourceIssues.length > 0) {
            throw new Error(
                `${resourceIssues.length} problem(s) in the declared resources:\n` +
                resourceIssues.map(i => `  ${i.path}  ${i.message}`).join("\n")
            );
        }
        const result = await buildBundle({
            projectRoot,
            appName: backend.name,
            app: backend.app,
            runtimeRange: loaded.manifest.rebase,
            resources: resourceGraph,
            skipTypeCheck: opts.skipTypeCheck,
            log: (m: string) => progress(chalk.gray(m))
        });
        bundleDir = result.outDir;

        /* Fold the frontend in, exactly as `rebase build` does. This path builds
           its own bundle, so without the same step a deploy shipped a bundle with
           no site in it — the managed pod then served the API perfectly and 404'd
           every page, which is precisely the failure folding exists to prevent.
           Two callers producing the same artefact have to share the step that
           completes it. */
        try {
            const folded = await foldFrontendIntoBundle({
                projectRoot,
                manifest: loaded.manifest as never,
                bundleDir,
                log: (m: string) => progress(m)
            });
            for (const outcome of folded) {
                progress(chalk.gray(
                    `  folded ${outcome.appName} in (${outcome.fileCount} file(s), served at ${outcome.path})`
                ));
            }
        } catch (err) {
            fail(
                err instanceof Error ? err.message : String(err),
                "Fix the frontend build, or pass --no-static to deploy the API alone."
            );
        }
    }

    await uploadAndTrigger({ ...opts,
bundleDir });
}

/**
 * Pack a built bundle, upload it, and trigger the deploy.
 *
 * Shared by every managed deploy, whichever kind of app produced the bundle: a
 * backend and a static app differ in what is built and in the `kind` their
 * manifest carries, and in nothing after that. Keeping one tail is what makes
 * that true rather than nearly true — the folding step was once missing from
 * one of two callers producing the same artifact, and the deploy shipped a
 * bundle with no site in it.
 */
async function uploadAndTrigger(opts: {
    client: CloudClient;
    url: string;
    projectId: string;
    projectRef: string;
    bundleDir: string;
    message?: string;
    appName?: string;
}): Promise<void> {
    const { client, url, projectId, projectRef, bundleDir } = opts;
    const manifest = readBundleManifest(bundleDir);

    // Native modules cannot run on the managed runtime — the server rejects them
    // at intake anyway, but catching it here saves a pointless upload of a bundle
    // that cannot be deployed. Checked against the manifest, so it covers a
    // prebuilt `--bundle-dir` bundle just as much as one we just built.
    if (manifest.hooks?.native) {
        const names = (manifest.hooks.nativeModules ?? []).map(m => m.name).join(", ");
        fail(
            `This bundle depends on native modules${names ? ` (${names})` : ""}, which the managed runtime cannot run.`,
            "Remove the native dependency, or deploy on the custom runtime."
        );
    }

    // Pack + upload.
    const tarPath = path.join(os.tmpdir(), `rebase-bundle-${Date.now()}.tar.gz`);
    const token = client.auth.getSession()?.accessToken;
    if (!token) fail("Not authenticated.", "Run `rebase cloud login`.");

    let bundleId: string;
    try {
        await packBundle(bundleDir, tarPath);
        const sizeMb = (fs.statSync(tarPath).size / 1024 / 1024).toFixed(1);
        progress(chalk.gray(`  Uploading bundle (${sizeMb} MB)...`));
        bundleId = await uploadBundle(url, token!, projectId, tarPath);
    } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
        return;
    } finally {
        fs.rmSync(tarPath, { force: true });
    }

    // Guarded for the same reason as the source-deploy banner below: the JSON
    // result on this path is printed to stdout too.
    if (!isJsonMode()) {
        console.log("");
        console.log(`  🚀 Triggering managed deployment for ${chalk.bold(projectRef)} (schema ${manifest.schemaVersion})...`);
    }

    // Tell the platform about every app this repo declares, not only the one
    // whose bundle is being uploaded. A deploy ships one app; the Apps page is
    // meant to show the set, and without this it only ever knew about the backend.
    let declaredApps: ReturnType<typeof declaredAppsFrom> = [];
    try {
        declaredApps = declaredAppsFrom(loadManifest(process.cwd()).manifest as never);
    } catch {
        // A project with no readable rebase.json still deploys; it just cannot
        // describe its other apps.
    }

    const body = bundleDeployBody({ projectId,
bundleId,
manifest,
app: opts.appName,
message: opts.message,
declaredApps });

    try {
        const res = await client.functions.invoke<{
            success: boolean;
            deployment: { id: string | number };
            managed?: boolean;
        }>("deploy", body);
        if (!res?.deployment?.id) fail("Control plane did not return a deployment id.");
        if (isJsonMode()) {
            printJson({ success: true,
deploymentId: String(res.deployment.id),
managed: res.managed === true });
        } else {
            console.log(chalk.green(`  ✓ Managed deploy started (deployment ${res.deployment.id}).`));
            console.log(chalk.gray("    Track it with `rebase cloud logs` or in the console."));
        }
    } catch (e) {
        reportError(e, "Managed deploy failed to start");
    }
}

/* ─── what a deploy with nothing attached is actually going to build ─────────
 *
 * `rebase cloud deploy` with neither `--source` nor `--bundle` uploads nothing.
 * It asks the control plane to rebuild what it already holds — a git checkout,
 * or the newest source archive some earlier `--source` deploy left in object
 * storage. Both are legitimate; neither is this working directory, and the
 * command said nothing about which one it meant, so a deploy that shipped
 * month-old code was indistinguishable from one that shipped today's.
 *
 * For a project on the managed runtime it is worse than stale: a successful
 * source build sets `runtimeMode: "custom"` server-side, so the bare form
 * silently swaps a managed project back onto a container image. That one is a
 * refusal rather than a note — `--bundle` is what was meant, and `--force`
 * ejects on purpose.
 */

/** A project row, reduced to what says how it deploys (camel or snake columns). */
export interface DeployProjectRow {
    runtimeMode?: string;
    runtime_mode?: string;
    gitRepoUrl?: string;
    git_repo_url?: string;
    gitBranch?: string;
    git_branch?: string;
}

/** A deployment row, reduced to what says what it was built from. */
export interface DeploySourceRow {
    id?: string | number;
    status?: string;
    createdAt?: string | Date;
    created_at?: string | Date;
    sourceRef?: string;
    source_ref?: string;
    bundleId?: string;
    bundle_id?: string;
}

export interface BareDeployPlan {
    /**
     * Whether the project runs the platform runtime — in which case any source
     * build here ejects it back onto a container image.
     */
    managed: boolean;
    /**
     * `git` — the control plane will clone the configured repository.
     * `snapshot` — it will rebuild the newest uploaded source archive.
     * `none` — it holds neither, and will refuse.
     */
    source: "git" | "snapshot" | "none";
    /** Lines describing the build, printed before it is triggered. */
    lines: string[];
}

function pick(row: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const raw = row?.[key];
        if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
    }
    return undefined;
}

/** Rough age of a timestamp, for "…uploaded 6d ago". Undefined if unreadable. */
export function timeAgo(value: string | Date | undefined, now: Date): string | undefined {
    if (value === undefined) return undefined;
    const then = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (Number.isNaN(then)) return undefined;
    const ms = now.getTime() - then;
    // A clock skewed into the future is not an age; saying nothing beats a lie.
    if (ms < 0) return undefined;
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Whether this project runs on the managed runtime.
 *
 * `runtimeMode` on the project row is the authority — the control plane writes
 * it. The bundle-id fallback covers a control plane that does not return the
 * field: a successful deploy that served a bundle only happens on the managed
 * path.
 */
export function isManagedProject(
    project: DeployProjectRow | undefined,
    latest: DeploySourceRow | undefined
): boolean {
    if (pick(project as Record<string, unknown> | undefined, "runtimeMode", "runtime_mode") === "managed") return true;
    return latest?.status === "success"
        && pick(latest as Record<string, unknown> | undefined, "bundleId", "bundle_id") !== undefined;
}

/** What a `deploy` with nothing attached will build, in the words to print. */
export function planBareDeploy(
    project: DeployProjectRow | undefined,
    latest: DeploySourceRow | undefined,
    now: Date
): BareDeployPlan {
    const projectRow = project as Record<string, unknown> | undefined;
    const deploymentRow = latest as Record<string, unknown> | undefined;
    const managed = isManagedProject(project, latest);

    const repo = pick(projectRow, "gitRepoUrl", "git_repo_url");
    if (repo) {
        const branch = pick(projectRow, "gitBranch", "git_branch");
        return { managed,
source: "git",
lines: [`Building from git: ${repo}${branch ? ` (${branch})` : ""}.`] };
    }

    if (pick(deploymentRow, "sourceRef", "source_ref")) {
        const age = timeAgo((latest?.createdAt ?? latest?.created_at) as string | Date | undefined, now);
        return {
            managed,
            source: "snapshot",
            lines: [
                `Rebuilding the stored source archive${latest?.id !== undefined ? ` from deployment ${latest.id}` : ""}` +
                    `${age ? `, uploaded ${age}` : ""}.`,
                "This directory is NOT uploaded — pass `--source .` to build what is on disk."
            ]
        };
    }

    return {
        managed,
        source: "none",
        lines: [
            "This project has no git repository configured and no stored source archive to rebuild.",
            "Upload this directory with `--source .`, or set a repository URL in the project settings."
        ]
    };
}

/**
 * A warning attached to a deploy: printed for the human, carried in the JSON.
 *
 * `code` is the stable half — the message is prose and will be reworded, so it
 * is the code that CI or an agent branches on.
 */
export interface DeployWarning {
    code: string;
    message: string;
    hint?: string;
}

/** `code` of the warning below, and the field name it sets in the payload. */
export const EJECTS_MANAGED_RUNTIME = "ejects_managed_runtime";

/** The one sentence that says a source build undoes `runtimeMode: managed`. */
export function ejectWarning(projectRef: string): DeployWarning {
    return {
        code: EJECTS_MANAGED_RUNTIME,
        message: `${projectRef} runs on the managed runtime — this build ejects it to a custom container.`,
        hint: "Use `rebase cloud deploy --bundle` to stay on managed."
    };
}

/** How a container-image deploy was asked for — the input to both rules below. */
export interface EjectContext {
    /** The project currently runs on the managed runtime. */
    managed: boolean;
    /** `--source` was passed: build this directory. */
    source: boolean;
    /** `--force` was passed: eject on purpose. */
    force: boolean;
}

/**
 * Why a container-image deploy of a managed project is refused — or `undefined`
 * to let it through.
 *
 * Every path below this point builds a container image, and a successful one
 * sets `runtimeMode: "custom"` server-side. So the question is never "which flag
 * was used" but "did the caller ask to leave the managed runtime", and only
 * `--force` answers it.
 *
 * `--source` used to be read as answering it too, on the theory that uploading a
 * build context is self-evidently a deliberate eject. It is not: `--source`
 * picks *which source* gets built — this directory, rather than the stale
 * archive the control plane is holding — and the eject is a side effect of the
 * answer. That is exactly how a live project got flipped to `custom` by someone
 * whose actual intent was "deploy what I have here", and it is the same
 * ignorance the bare form is refused for. Same ignorance, same refusal.
 */
export function ejectRefusal(
    opts: EjectContext,
    projectRef: string
): { message: string; hint: string; code: string } | undefined {
    if (!opts.managed || opts.force) return undefined;
    const eject = "To eject on purpose, add `--force`.";
    if (opts.source) {
        return {
            message:
                `${projectRef} runs on the managed runtime, and \`--source\` builds a container image from ` +
                "this directory — which ejects it from managed. Picking a build method is not the same as " +
                "asking to leave the runtime.",
            hint: `Deploy this directory to the managed runtime with \`rebase cloud deploy --bundle\`. ${eject}`,
            code: "managed_project"
        };
    }
    return {
        message:
            `${projectRef} runs on the managed runtime, and a plain \`rebase cloud deploy\` builds a ` +
            "container image instead — ejecting it from managed, from source the control plane " +
            "already holds rather than this directory.",
        hint:
            `Redeploy it with \`rebase cloud deploy --bundle\`. ${eject} ` +
            "`--source . --force` builds this directory; `--force` alone builds what the control plane holds.",
        code: "managed_project"
    };
}

/**
 * Which warnings a container-image deploy has earned.
 *
 * Pure, and separate from the printing, because the printing is what went
 * wrong: the eject warning used to be written inline behind `!isJsonMode()`, so
 * the fact that a deploy ejects a managed project existed only as a side effect
 * of a TTY being attached. Deciding here, emitting once at the call site, means
 * the decision cannot be output-mode-dependent again.
 *
 * The condition is just `managed`: anything reaching this point is a container
 * image build that `ejectRefusal` has already let through, and on a managed
 * project that is an eject however it was spelled. A caller who passed `--force`
 * knows — the warning is for the transcript and the payload, which is what
 * anyone reviewing the deploy afterwards actually reads.
 */
export function deployWarnings(opts: EjectContext, projectRef: string): DeployWarning[] {
    return opts.managed ? [ejectWarning(projectRef)] : [];
}

/** The warning half of a deploy's JSON payload — merged into whatever it emits. */
export function warningPayload(warnings: DeployWarning[]): Record<string, unknown> {
    return {
        warnings: warnings.map((w) => ({
            code: w.code,
            message: w.message,
            hint: w.hint ?? null
        })),
        // Denormalised from `warnings` on purpose: a boolean is what a CI step
        // can test without walking an array, and this is the one consequence
        // worth failing a pipeline over.
        ejectsManagedRuntime: warnings.some((w) => w.code === EJECTS_MANAGED_RUNTIME)
    };
}

/**
 * Read the two rows the preflight needs.
 *
 * Best effort by construction: a preflight that cannot read is a preflight that
 * says nothing, never a deploy that fails. The managed refusal rides on the same
 * read, so an unreadable project falls through to the old behaviour rather than
 * blocking a deploy on a lookup.
 */
async function readDeployContext(
    client: CloudClient,
    projectId: string
): Promise<{ project?: DeployProjectRow; latest?: DeploySourceRow }> {
    try {
        const [project, latest] = await Promise.all([
            client.data.collection("projects").findById(projectId),
            latestDeployment(client, projectId)
        ]);
        return {
            project: project as unknown as DeployProjectRow | undefined,
            latest: latest as unknown as DeploySourceRow | undefined
        };
    } catch {
        return {};
    }
}

/**
 * Whether this repository's backend declares the managed runtime.
 *
 * Deliberately quiet: a directory that is not a Rebase project, or whose
 * manifest does not parse, simply does not route this way — `rebase build` is
 * where a broken manifest gets reported, and a deploy refusing on one before it
 * has even said what it is doing would be the wrong place to find out.
 */
function declaresManagedRuntime(appName?: string): boolean {
    try {
        const projectRoot = findProjectRoot();
        if (!projectRoot) return false;
        const manifest = loadManifest(projectRoot).manifest;

        // A static app has no runtime to declare and never builds an image. It
        // is always a bundle deploy, so it takes this branch on its own — which
        // is what lets a repository with no backend at all reach the platform.
        if (appName) {
            const app = manifest.apps[appName];
            if (app?.type === "static") return true;
            if (app?.type === "backend") return app.runtime === "managed";
        }

        const backend = findBackendApp(manifest);
        // A repository declaring no backend has nothing that could be a source
        // build, so its apps are bundles by construction.
        if (!backend) return Object.keys(manifest.apps).length > 0;
        return backend.app.runtime === "managed";
    } catch {
        return false;
    }
}

/**
 * `rebase cloud deploy [app]` — its flags, and which app of this repository the
 * line named.
 *
 * Parsed through `parseCloudArgs` rather than `arg` directly, and the reason is
 * the positional. This command used to parse `rawArgs.slice(2)` permissively
 * and read `_[0]` as the app name — but `rawArgs` is the WHOLE `process.argv`,
 * so `_` opens with the command words themselves. `_[0]` was therefore the
 * literal string `"cloud"` on every run, which then went to `selectDeployApp`
 * and came back as:
 *
 *   This repository declares no app named "cloud". It declares: backend, web.
 *
 * So the documented `rebase cloud deploy --bundle` failed on every project that
 * did not happen to declare an app called `cloud`, `rebase cloud deploy web`
 * could not reach `web`, and the refusal named the user's real apps — reading
 * as a fault in their `rebase.json` rather than in the CLI's own parse.
 *
 * `commandWords` counts from `cloud` itself, so `cloud deploy` is 2, and it is
 * applied to the PARSED positionals: a flag written before the group no longer
 * shifts the app name either.
 */
export function resolveDeployArgs(rawArgs: string[]) {
    const { flags, positionals } = parseCloudArgs({
        spec: { "--no-follow": Boolean,
"--source": String,
"--message": String,
"--bundle": Boolean,
"--bundle-dir": String,
/* Same flag `rebase build` has, for the same reason. Without it here, the
   only way to deploy a bundle without type checking was to run the build
   by hand and then point `--bundle-dir` at the result. */
"--skip-type-check": Boolean,
/* Leave the managed runtime on purpose. The ONLY way to build a container
   image for a project the platform runs as managed — for the bare form and
   for `--source` alike, because neither of those says so by itself. See
   `ejectRefusal`. */
"--force": Boolean,
"-m": "--message" },
        rawArgs,
        commandWords: 2, // cloud deploy
        command: "cloud deploy",
        maxPositionals: 1
    });
    return { flags,
appName: positionals[0] as string | undefined };
}

export async function deployCommand(rawArgs: string[], projectRef: string): Promise<void> {
    const { flags: args, appName } = resolveDeployArgs(rawArgs);
    const { client, url } = await requireClient(rawArgs);
    const projectId = await resolveProjectRef(projectRef, client);

    // Managed bundle deploy. Builds the project into a bundle, uploads it, and
    // lets the control plane run the platform runtime with it.
    //
    // Taken either because `--bundle` said so, or because this repository's
    // backend *declares* `runtime: "managed"`. That declaration is the whole
    // point of the field: a project that has written down which runtime it wants
    // should not also have to remember a flag, and forgetting the flag used to
    // mean a plain `deploy` tried to build a container image and eject the
    // project — which is why the refusal further down exists.
    //
    // `--source` and `--bundle-dir` are explicit acts and still route away from
    // here — though on a project the platform *runs* as managed, routing away
    // is now where `ejectRefusal` stops them without `--force`.
    // `rebase cloud deploy <app>` — which app of the project this repository is
    // shipping. Positional because it is the subject of the sentence, not an
    // option: a repository holding only an admin panel deploys it by name, and a
    // repository with one backend keeps saying nothing at all. Resolved by
    // `resolveDeployArgs` above, off the parsed positionals.

    const declaredManaged = !args["--source"] && !args["--bundle"] && declaresManagedRuntime(appName);
    if (args["--bundle"] || declaredManaged) {
        if (args["--bundle"] && args["--source"]) {
            fail("--bundle and --source cannot be combined: one is a managed bundle, the other a source build.");
        }
        if (declaredManaged && !isJsonMode()) {
            console.log(chalk.gray("  rebase.json declares runtime: managed — deploying a bundle."));
        }
        await deployBundle({
            client,
            url,
            projectId,
            projectRef,
            bundleDir: args["--bundle-dir"],
            message: args["--message"],
            appName,
            skipTypeCheck: args["--skip-type-check"] === true
        });
        return;
    }

    // Everything below builds a container image from source. Say what that
    // source is before anything is uploaded or triggered, and refuse the one
    // case where the command would quietly undo the project's runtime.
    const { project, latest } = await readDeployContext(client, projectId);
    const plan = planBareDeploy(project, latest, new Date());

    const eject: EjectContext = {
        managed: plan.managed,
        source: Boolean(args["--source"]),
        force: args["--force"] === true
    };
    const refusal = ejectRefusal(eject, projectRef);
    if (refusal) fail(refusal.message, refusal.hint, refusal.code);

    // What survived that refusal is a deliberate eject, and still worth saying.
    // Warn in every output mode — `warn` writes to stderr, which is not the JSON
    // stream — and carry the same fact into the payload, the half CI reads.
    const warnings = deployWarnings(eject, projectRef);
    for (const w of warnings) warn(w.message, w.hint);

    if (!args["--source"] && !isJsonMode()) {
        console.log("");
        for (const line of plan.lines) console.log(chalk.gray(`  ${line}`));
    }

    // Optional fly-style local source upload: `deploy --source .`
    let source: string | undefined;
    if (args["--source"]) {
        const tarPath = await createSourceTarball(args["--source"]);
        try {
            const token = client.auth.getSession()?.accessToken;
            if (!token) fail("Not authenticated.", "Run `rebase cloud login`.");
            source = await uploadSource(url, token, projectId, tarPath);
        } finally {
            fs.rmSync(tarPath, { force: true });
        }
    }

    // Guarded: this is stdout, and in JSON mode stdout carries the one JSON
    // value and nothing else — an unguarded banner here put a 🚀 line in front
    // of it and broke every parser reading the result.
    if (!isJsonMode()) {
        console.log("");
        console.log(`  🚀 Triggering deployment for project ${chalk.bold(projectRef)}${source ? " from uploaded source" : ""}...`);
    }

    const body: Record<string, unknown> = { projectId };
    if (source) body.source = source;
    if (args["--message"]) body.message = args["--message"];
    // `client` is what the control plane records as `triggerSource`. Omitting it
    // is why every deployment this command has ever created reads `unknown` in
    // Deployment History — `rollback` next door has always sent it.
    body.client = "cli";
    const frameworkVersion = resolveFrameworkVersion(args["--source"] ?? process.cwd());
    if (frameworkVersion) body.frameworkVersion = frameworkVersion;

    let triggered: { deploymentId: string; deduplicated: boolean };
    try {
        const res = await client.functions.invoke<{
            success: boolean;
            deployment: { id: string | number };
            deduplicated?: boolean;
        }>("deploy", body);
        if (!res?.deployment?.id) fail("Control plane did not return a deployment id.");
        triggered = { deploymentId: String(res.deployment.id),
deduplicated: res.deduplicated === true };
    } catch (e) {
        triggered = resolveTriggerFailure(e);
    }
    const { deploymentId, deduplicated } = triggered;

    if (!isJsonMode()) {
        console.log(
            chalk.gray(
                deduplicated
                    ? `  Deployment ${deploymentId} is already running — following it.`
                    : `  Deployment ${deploymentId} created.${frameworkVersion ? `  (@rebasepro/* ${frameworkVersion})` : ""}`
            )
        );
    }

    if (args["--no-follow"]) {
        emit(
            () => {
                console.log(chalk.gray("  Not following logs (--no-follow). Check status with `rebase cloud logs`."));
                console.log("");
            },
            { deploymentId,
deduplicated,
frameworkVersion: frameworkVersion ?? null,
following: false,
...warningPayload(warnings) }
        );
        return;
    }

    if (!isJsonMode()) {
        console.log(chalk.gray("  Streaming build logs (Ctrl-C to stop watching — the build keeps running):"));
        console.log("");
    }

    // In JSON mode the build log is not streamed: interleaving it with the
    // result object would make neither parseable. The deploy is still followed
    // to completion — a caller waiting on the exit code still waits — and the
    // one object printed at the end carries the outcome.
    const status = await streamBuildLogs(client, deploymentId, { quiet: isJsonMode() });
    emit(
        () => {},
        { deploymentId,
deduplicated,
frameworkVersion: frameworkVersion ?? null,
following: true,
status,
...warningPayload(warnings) }
    );
}

/**
 * Turn a failed trigger into either a deployment to follow, or an exit.
 *
 * The 409 is the interesting one. A deploy trigger can reach the control plane
 * twice without anybody asking twice — the SDK transport replays a request once
 * after refreshing an expired token, and any lost response has the same effect
 * — so "a deployment is already in progress" was routinely describing the
 * deployment this very command had just created. With no id in the message the
 * only available reading was "someone else is deploying, back off", and the
 * build stream was lost either way.
 *
 * So: if the control plane says the blocking deployment is ours, we attach to
 * it. If it is not ours, we still name it, because "which one, since when, from
 * where" is the difference between an actionable refusal and a dead end.
 */
function resolveTriggerFailure(e: unknown): { deploymentId: string; deduplicated: boolean } {
    const err = e as {
        status?: number;
        message?: string;
        code?: string;
        details?: { deployment?: BlockingDeployment };
    };

    if (err?.status === 409) {
        const blocking = err.details?.deployment;
        if (blocking?.id && blocking.mine) {
            return { deploymentId: String(blocking.id),
deduplicated: true };
        }
        // Older control planes send a bare 409 with no `details`; the message
        // then stays the honest general one rather than a fabricated id.
        fail(
            blocking?.id
                ? `Deployment ${blocking.id} is already in progress for this project` +
                      `${blocking.triggerSource && blocking.triggerSource !== "unknown" ? `, triggered from the ${blocking.triggerSource}` : ""}` +
                      `${blocking.createdAt ? ` at ${fmtDate(blocking.createdAt)}` : ""}.`
                : "A deployment is already in progress for this project.",
            blocking?.id
                ? `Follow it with \`rebase cloud logs -f\`, or stop it with \`rebase cloud cancel ${blocking.id}\`.`
                : "Follow it with `rebase cloud logs -f`.",
            "deploy_in_progress"
        );
    }

    if (err?.status === 402) {
        // Billing gate: no card on file, card declined, or needs auth.
        fail(
            err.message || "Payment required before deploying.",
            "Attach a card once with `rebase cloud billing setup`, then deploy again.",
            "payment_required"
        );
    }

    reportError(e, "Failed to trigger deployment");
}

/**
 * Poll a deployment record and print new log output as it arrives. Returns the
 * terminal status; a non-success still exits non-zero, as it always has.
 *
 * `quiet` follows without printing — JSON mode, where the log stream would
 * corrupt the one object the caller is parsing.
 */
async function streamBuildLogs(
    client: CloudClient,
    deploymentId: string,
    opts: { quiet?: boolean } = {}
): Promise<string> {
    const quiet = opts.quiet === true;
    let printed = 0;
    const started = Date.now();

    for (;;) {
        let dep: Deployment | undefined;
        try {
            dep = (await client.data.collection("deployments").findById(deploymentId)) as unknown as Deployment | undefined;
        } catch (e) {
            reportError(e, "Failed to read deployment status");
        }
        if (!dep) fail(`Deployment ${deploymentId} disappeared.`, undefined, "not_found");

        const logs = dep.logs ?? "";
        if (!quiet && logs.length > printed) {
            process.stdout.write(logs.slice(printed));
        }
        printed = logs.length;

        if (dep.status && dep.status !== "deploying") {
            if (dep.status !== "success") {
                if (quiet) {
                    // The failure still has to be reportable, and in JSON mode
                    // the build log is the only place that says why.
                    printJson({
                        error: {
                            message: `Deployment ${deploymentId} ${dep.status}.`,
                            code: "deploy_failed",
                            status: null,
                            deploymentId,
                            logs
                        }
                    });
                    process.exit(1);
                }
                console.log("");
                console.log(chalk.bold.red(`  ✗ Deployment ${dep.status}`));
                console.log("");
                process.exit(1);
            }
            if (!quiet) {
                console.log("");
                console.log(chalk.bold.green("  ✓ Deployment succeeded"));
                console.log("");
            }
            return dep.status;
        }

        if (Date.now() - started > POLL_TIMEOUT_MS) {
            if (!quiet) console.log("");
            fail(
                "Timed out waiting for the build to finish.",
                "The deployment may still be running — check `rebase cloud logs`.",
                "timeout"
            );
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

export async function logsCommand(rawArgs: string[], projectRef: string): Promise<void> {
    const args = arg(
        { "--runtime": Boolean,
"--follow": Boolean,
"-f": "--follow" },
        { argv: rawArgs.slice(2),
permissive: true }
    );
    const { client } = await requireClient(rawArgs);
    const projectId = await resolveProjectRef(projectRef, client);

    if (args["--runtime"]) {
        try {
            const res = await client.functions.invoke<{ logs?: string; error?: string }>(
                "runtime-logs",
                undefined,
                { method: "GET",
path: projectId }
            );
            console.log("");
            console.log(chalk.bold(`  📄 Runtime logs — project ${projectRef}`));
            console.log("");
            console.log(res.logs ?? chalk.gray("  (no logs)"));
            console.log("");
        } catch (e) {
            reportError(e, "Failed to fetch runtime logs");
        }
        return;
    }

    // Build logs: latest deployment, optionally follow if still running.
    try {
        const dep = (await latestDeployment(client, projectId)) as unknown as Deployment | undefined;
        if (!dep) {
            console.log("");
            console.log(chalk.gray("  No deployments yet for this project."));
            console.log("");
            return;
        }

        console.log("");
        console.log(chalk.bold(`  📄 Build logs — deployment ${dep.id}`) + `  ${colorStatus(dep.status)}`);
        console.log("");

        if (args["--follow"] && dep.status === "deploying") {
            // Hand off to the streamer, which prints from the top and tails live.
            await streamBuildLogs(client, String(dep.id));
        } else {
            console.log(dep.logs ?? chalk.gray("  (no logs)"));
            console.log("");
        }
    } catch (e) {
        reportError(e, "Failed to fetch build logs");
    }
}
