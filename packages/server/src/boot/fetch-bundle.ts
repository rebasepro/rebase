/**
 * Fetching a bundle at boot.
 *
 * A bundle arrives one of two ways: already on disk (`rebase build` wrote one,
 * or a container image carries one at `/bundle`), or over HTTP from a stable
 * URL. This is the second, and it is now the *only* mechanism for fetching one
 * — Kubernetes deployments used to run a separate init container that did the
 * same three jobs into a shared volume, and it was deleted in favour of this.
 *
 * ## Why there was a second implementation, and why it is gone
 *
 * The init container existed because this path could not actually be used: it
 * looked for a marker file called `rebase-bundle.json` that nothing has ever
 * written — the CLI writes `manifest.json` — so every real bundle was rejected
 * as "not a Rebase bundle". The only thing that ever produced the file it
 * wanted was its own test. So `REBASE_BUNDLE_URL` had never worked against a
 * bundle from `rebase build`, on Cloud Run or under the Helm chart's
 * `bundle.mode: url`, and Kubernetes grew an init container instead.
 *
 * That init container is where the worst failure in the managed path lived. It
 * held three copies of the dependency tree at once (archive, npm cache,
 * extracted `node_modules`), and above its ephemeral-storage grant `npm
 * install` neither errored nor got evicted — it went to sleep in `epoll_wait`
 * and stayed there, with no log line, no event and no exit code anywhere. The
 * only symptom was the control plane reporting that the deploy did not become
 * ready.
 *
 * Doing the work here instead does not make dependency installation need less
 * disk. What it changes is that the work happens inside a process that has a
 * logger, so running out of room is reported as running out of room.
 *
 * ## Every start, not just the first
 *
 * The fetch has to be cheap and repeatable because it runs on *every* start: a
 * scale-from-zero, an instance recycled after an hour idle, a node drain, an
 * eviction, a new revision. That is also why the platform's bundle URL is
 * deliberately a stable endpoint rather than a signed expiring one — a pod
 * rescheduled at 3am needs the same URL to work, and a URL that had expired
 * would mean a tenant stays down until a human triggers a fresh deploy.
 *
 * ## It refuses rather than half-unpacking
 *
 * Every failure here — a URL that 403s, a truncated download, a tarball that
 * unpacks to something without a manifest — exits non-zero before the runtime
 * boots. A partially-unpacked bundle would boot into a confusing failure much
 * later: missing collections read as an empty schema, and
 * `REBASE_MIGRATE_ON_BOOT=ensure` would then happily create nothing and report
 * success. Failing at the fetch is the only place the error still says what is
 * actually wrong.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../utils/logger";
import { MANIFEST_FILENAME } from "./bundle";

const run = promisify(execFile);

/** Where the runtime is told to fetch its bundle from. */
export const BUNDLE_URL_ENV = "REBASE_BUNDLE_URL";
/** Bearer token for that fetch. Does not expire — see the module note. */
export const BUNDLE_TOKEN_ENV = "REBASE_BUNDLE_TOKEN";
/**
 * Where a fetched bundle is unpacked. Defaults to a fresh temp directory.
 *
 * A platform sets this to a volume it sized on purpose, because the unpack and
 * the dependency install are the two things in a pod's life that need real
 * disk. Left unset the bundle lands under the OS temp directory, which on a
 * container is the writable layer and on Cloud Run is a tmpfs — fine for a
 * small bundle, and the thing to change first when one is not.
 *
 * It is deliberately a *fixed* directory when set, not a fresh one per boot: a
 * container that restarts inside a live pod finds the tree it already unpacked
 * and installed, so a restart costs a manifest check rather than a download and
 * an `npm ci`. `REBASE_BUNDLE` is still the one that means "a bundle is already
 * here, do not fetch at all" — this only says where to put one.
 */
export const BUNDLE_FETCH_DIR_ENV = "REBASE_BUNDLE_FETCH_DIR";

export interface FetchBundleOptions {
    url: string;
    token?: string;
    /** Where to unpack. Defaults to a fresh directory under the OS temp dir. */
    destination?: string;
    /** Injected for tests. */
    fetchImpl?: typeof fetch;
    /** Injected for tests. */
    extract?: (tarball: string, destination: string) => Promise<void>;
    /** How long a single download attempt may take before it is abandoned. */
    timeoutMs?: number;
    /**
     * How many times to try the download.
     *
     * A pod starting during a control-plane rollout, or racing its own DNS, gets
     * one transient failure and would otherwise CrashLoop on it — and a
     * CrashLoop re-runs the whole boot, so the retry is cheaper than the restart
     * it replaces.
     */
    attempts?: number;
    /** Delay between attempts. */
    retryDelayMs?: number;
    /**
     * Install the bundle's declared dependencies after unpacking.
     *
     * On by default: a bundle that declares dependencies and has none installed
     * cannot boot, and this is the only step between the two. Turned off for a
     * bundle that was vendored at build time, and by tests.
     */
    installDependencies?: boolean;
    /** Injected for tests. */
    installImpl?: (bundleRoot: string) => Promise<void>;
}

/**
 * Whether this process should fetch its bundle rather than read one from disk.
 *
 * An explicit `REBASE_BUNDLE` — a path — always wins. A platform that mounted a
 * bundle AND set a URL means somebody is mid-migration between the two, and the
 * local copy is the one that is definitely there.
 */
export function shouldFetchBundle(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env[BUNDLE_URL_ENV]) && !env.REBASE_BUNDLE;
}

/** Untar with the system `tar`, which every base image has. */
async function extractWithTar(tarball: string, destination: string): Promise<void> {
    // `-m` (do not restore mtimes) because some sandboxes reject utimes on
    // extracted files and the failure looks like a corrupt archive.
    await run("tar", ["-xzmf", tarball, "-C", destination]);
}

/**
 * Download and unpack a bundle, returning the directory it landed in.
 *
 * Downloads to a file rather than streaming into `tar`, deliberately. A stream
 * that dies mid-transfer leaves `tar` having successfully extracted a prefix of
 * the archive and exiting 0 — the half-unpacked bundle this module exists to
 * refuse. Writing the whole tarball first means a truncated download is caught
 * by `tar` as a corrupt archive, which is an error.
 */
/**
 * Install the bundle's declared dependencies, in place.
 *
 * `npm ci` when a lockfile is present and `npm install` otherwise — a bundle
 * that shipped a lockfile gets a reproducible install, one that did not still
 * boots.
 *
 * `--ignore-scripts` is not optional. The runtime image's entrypoint refuses to
 * run lifecycle scripts, and an install that ran them here would void that
 * guarantee at every pod start, executing arbitrary code from the dependency
 * tree before the process this is meant to be booting exists.
 *
 * The npm cache is dropped afterwards because it is, at that point, a
 * byte-for-byte duplicate of the tree beside it and nothing reads it again —
 * the runtime never installs twice in one process. Keeping it doubles the
 * high-water mark on a disk that is usually the binding constraint.
 */
export async function installBundleDependencies(
    bundleRoot: string,
    exec: (cmd: string, args: string[], opts: object) => Promise<unknown> = run
): Promise<void> {
    if (!fs.existsSync(path.join(bundleRoot, "package.json"))) return;
    if (fs.existsSync(path.join(bundleRoot, "node_modules"))) {
        // Vendored at build time, or already installed by an earlier start of
        // this same pod. Either way installing over it is slower and no safer.
        //
        // This is only sound because a failed install deletes what it wrote
        // (below). Measured 2026-08-22: an install OOMKilled partway leaves a
        // node_modules holding 124 of 156 packages — indistinguishable from a
        // complete one to a directory check. Without the cleanup, the restart
        // that follows skips the install, the runtime boots on a tree missing a
        // third of its dependencies, and the failure surfaces as an import
        // error deep inside a request.
        logger.debug("Bundle already carries node_modules; skipping install");
        return;
    }

    const hasLockfile = fs.existsSync(path.join(bundleRoot, "package-lock.json"));
    const args = hasLockfile
        ? ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]
        : ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"];

    logger.info("Installing bundle dependencies", { command: `npm ${args[0]}`, cwd: bundleRoot });
    const started = Date.now();
    try {
        await exec("npm", args, { cwd: bundleRoot, maxBuffer: 32 * 1024 * 1024 });
    } catch (error: unknown) {
        // Leave nothing behind that a later boot would mistake for a finished
        // install. npm writes packages as it goes, so anything that stops it —
        // an OOMKill, a full disk, a registry 500 — leaves a partial tree, and
        // the check at the top of this function cannot tell one from a vendored
        // one. Deleting it is what makes that check safe.
        fs.rmSync(path.join(bundleRoot, "node_modules"), { recursive: true, force: true });

        // The one failure worth naming. Out of disk, npm does not reliably
        // error — in an init container it used to hang in `epoll_wait` with no
        // output at all, which is why this ran there and could not be
        // diagnosed. Here there is a process with a logger, so say it.
        const detail = error instanceof Error ? error.message : String(error);
        const outOfSpace = /ENOSPC|no space left/i.test(detail);
        throw new Error(
            `Installing the bundle's dependencies failed: ${detail}` +
            (outOfSpace
                ? " — the volume ran out of space. An install needs room for the archive, npm's " +
                  "cache and the extracted tree at once; raise the pod's ephemeral-storage " +
                  "request, or vendor node_modules into the bundle at build time."
                : "")
        );
    }
    logger.info("Bundle dependencies installed", { ms: Date.now() - started });

    // The install is what creates the duplicate, so the dedupe belongs to it.
    // In a container this used to happen in the entrypoint, which runs BEFORE
    // the runtime and therefore before this install exists — so on the fetch
    // path it would have run against an empty directory and every custom
    // function would have 500ed.
    dedupeRuntimePackages(bundleRoot, imageModulesDir());

    // Cosmetic — a pod that cannot clean its cache still boots.
    await exec("npm", ["cache", "clean", "--force"], { cwd: bundleRoot }).catch(() => undefined);
}

/**
 * Packages the runtime image provides and a bundle must not carry its own copy of.
 *
 * Exactly one, deliberately. `@rebasepro/server` holds the framework singleton,
 * and a second copy is not merely wasteful — it is a total, silent breakage of
 * custom functions. Every function imports `defineFunction` from
 * `@rebasepro/server`, so it resolves the BUNDLE's copy, which is a different
 * module instance from the one `runFromBundle` booted. The singleton
 * initialised by the boot is invisible to it, so `rebase.data`,
 * `rebase.dataAsAdmin` and `rebase.storage` throw "server not initialized yet"
 * on every request, in a process that is otherwise healthy and reports itself
 * ready. Seen in production as every custom-function route 500ing while
 * `/api/data/*` served fine.
 *
 * It arrives transitively: `@rebasepro/admin` and `@rebasepro/server-postgres`
 * both depend on it, and nearly every project declares one of them.
 *
 * NOT every package the image ships. The image installs the narrow set of
 * dependencies the runtime itself needs, while the bundle's install resolved
 * each package's FULL tree — so redirecting a package at the image's copy can
 * point it at a tree missing something. `@rebasepro/server-postgres` is the
 * proof: the image's copy has no `chokidar`, and redirecting it took the
 * database driver down and crash-looped the pod. `@rebasepro/server` is the one
 * package where the redirect is both necessary (it holds the singleton) and
 * provably safe (the process is already running from the image's copy).
 */
/**
 * Where the runtime image keeps its own `node_modules`, when there is an image.
 *
 * An environment variable, set by the image, rather than something derived from
 * this module's own location. Deriving it is the obvious approach and it does
 * not survive the build: `__filename` is undefined in the ESM bundle vite emits,
 * and `import.meta.url` is a syntax error under the CJS transform the jest
 * suites use — so any version of this that reads its own path works in exactly
 * one of the two places it has to.
 *
 * Found by booting the built image (`scripts/check-runtime-image-boots.mjs`),
 * which is the only thing that runs the artifact this ships as. The unit tests
 * were green.
 *
 * Absent outside a container, where there is no second copy to collapse and
 * nothing to do.
 */
export const RUNTIME_MODULES_ENV = "REBASE_RUNTIME_MODULES";

function imageModulesDir(): string | undefined {
    return process.env[RUNTIME_MODULES_ENV] || undefined;
}

/**
 * The packages the runtime image supplies to a fetched bundle.
 *
 * Must match `RUNTIME_PROVIDED` in `packages/cli/src/bundle.ts` and in
 * `infra/docker/entrypoint.mjs`; `scripts/test/runtime-provided.test.mjs` fails if any
 * of the three drift. The bundler STRIPS these from a bundle's declared
 * dependencies on the promise that the image supplies them, so a shorter list
 * here means the builder removed a dependency that nothing then provides, and
 * every function and cron importing it fails to load with `Cannot find package`
 * behind a container that reports itself healthy.
 *
 * This list carried only `@rebasepro/server` while the bundler stripped five —
 * the same four-package gap that broke the non-fetch path, reproduced on the
 * fetch path because this list was written before that fix and no gate watched
 * this file.
 */
export const RUNTIME_PROVIDED_PACKAGES = [
    "@rebasepro/server",
    "@rebasepro/types",
    "@rebasepro/client",
    "@rebasepro/common",
    "@rebasepro/utils"
] as const;

/**
 * Collapse a duplicate framework copy in the bundle onto the image's.
 *
 * Node resolves a module's identity by its real path, so replacing the
 * duplicate with a symlink makes the two one instance again. It is also the
 * honest version of what was already true: the image's copy is the one that
 * booted and owns the process, so a bundle pinning a different version was
 * never running that version — it just carried a second, dead one alongside it.
 *
 * Non-fatal by design. A project with no custom functions is unaffected by the
 * duplicate, and refusing to boot over it would turn a degraded start into no
 * start at all.
 *
 * @param imageModules the runtime image's own `node_modules`. Absent, there is
 *   nothing to dedupe against and this is a no-op — which is the case in every
 *   context except a container built from the runtime image.
 */
export function dedupeRuntimePackages(bundleRoot: string, imageModules: string | undefined): string[] {
    if (!imageModules || !fs.existsSync(imageModules)) return [];

    const deduped: string[] = [];
    for (const pkg of RUNTIME_PROVIDED_PACKAGES) {
        const provided = path.join(imageModules, pkg);
        const inBundle = path.join(bundleRoot, "node_modules", pkg);
        if (!fs.existsSync(provided)) continue;

        let stat: fs.Stats | null = null;
        try {
            stat = fs.lstatSync(inBundle);
        } catch {
            // ABSENT, which is the common case and not the exotic one.
            //
            // An earlier version treated this as "nothing to do" and returned.
            // But `rebase build` correctly does NOT declare `@rebasepro/server`
            // in a bundle's package.json — declaring it is what produces the
            // duplicate this exists to collapse — so most bundles have no copy
            // at all. Node then resolves a function's
            // `import { defineFunction } from "@rebasepro/server"` by walking up
            // from the importing file, never reaching the image's own
            // node_modules, and every custom function and cron fails to load
            // while the container reports itself healthy.
            //
            // So the link is CREATED when it is missing, not only repaired when
            // it is duplicated. Same one-instance outcome, both ways in.
        }
        // An existing symlink is this fix, already applied.
        if (stat?.isSymbolicLink()) continue;

        try {
            fs.mkdirSync(path.dirname(inBundle), { recursive: true });
            if (stat) fs.rmSync(inBundle, { recursive: true, force: true });
            fs.symlinkSync(provided, inBundle, "dir");
            deduped.push(pkg);
            logger.info(stat
                ? "Deduped a bundle package onto the runtime's own copy"
                : "Linked the runtime's own copy into the bundle", { package: pkg });
        } catch (error: unknown) {
            logger.warn("Could not link a bundle package; custom functions may not see the runtime", {
                package: pkg,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    return deduped;
}

/** One download attempt, streamed to `destination`. */
async function downloadTo(
    tarball: string,
    options: FetchBundleOptions,
    fetchImpl: typeof fetch
): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

    let response: Response;
    try {
        response = await fetchImpl(options.url, {
            headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        // The status is the diagnosis: 401/403 is a bad or missing token, 404 is
        // a bundle that was garbage-collected out from under a running service.
        throw new Error(`${response.status} ${response.statusText}`);
    }
    if (!response.body) throw new Error("empty response body");

    // Streamed, not buffered. A bundle may be ~100 MB and the process's memory
    // limit is sized for serving requests, not for holding its own artifact —
    // `await response.arrayBuffer()` put the whole archive in RSS at the moment
    // of boot, which is the worst moment to need it.
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tarball));

    const { size } = fs.statSync(tarball);
    if (size === 0) throw new Error("the bundle is empty");
}

/**
 * Download, unpack and prepare a bundle, returning the directory it landed in.
 *
 * Downloads to a file rather than streaming into `tar`, deliberately. A stream
 * that dies mid-transfer leaves `tar` having successfully extracted a prefix of
 * the archive and exiting 0 — the half-unpacked bundle this module exists to
 * refuse. Writing the whole tarball first means a truncated download is caught
 * by `tar` as a corrupt archive, which is an error.
 */
export async function fetchBundle(options: FetchBundleOptions): Promise<string> {
    const fetchImpl = options.fetchImpl ?? fetch;
    const extract = options.extract ?? extractWithTar;
    const attempts = Math.max(1, options.attempts ?? 6);
    const retryDelayMs = options.retryDelayMs ?? 3000;

    const destination = options.destination
        ?? fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-"));
    fs.mkdirSync(destination, { recursive: true });

    const tarball = path.join(destination, "bundle.tar.gz");

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await downloadTo(tarball, options, fetchImpl);
            lastError = undefined;
            break;
        } catch (error: unknown) {
            lastError = error;
            const detail = error instanceof Error ? error.message : String(error);
            // A 401/403/404 will not become a 200 by waiting. Retrying them
            // turns a clear failure into a slow one, and the pod spends its
            // startup budget confirming a credential is still wrong.
            const permanent = /^4\d\d /.test(detail);
            if (permanent || attempt === attempts) break;
            logger.warn("Bundle download failed; retrying", {
                attempt, of: attempts, error: detail
            });
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
    }

    if (lastError) {
        fs.rmSync(tarball, { force: true });
        throw new Error(
            `Could not download the bundle from ${options.url}: ` +
                (lastError instanceof Error ? lastError.message : String(lastError))
        );
    }

    const { size } = fs.statSync(tarball);
    try {
        await extract(tarball, destination);
    } catch (error: unknown) {
        throw new Error(
            `The bundle downloaded from ${options.url} could not be unpacked ` +
                `(${size} bytes): ` + (error instanceof Error ? error.message : String(error))
        );
    } finally {
        // The archive is dead weight in an instance whose temp directory counts
        // against a limit — a Cloud Run instance's /tmp is a tmpfs, and a pod's
        // emptyDir counts against its ephemeral-storage grant. Leaving it there
        // costs the size of the bundle for the life of the instance, and it is
        // the first of the three copies an install has to fit beside.
        fs.rmSync(tarball, { force: true });
    }

    const root = bundleRootIn(destination);
    if (!root) {
        throw new Error(
            `The bundle downloaded from ${options.url} unpacked without a ${MANIFEST_FILENAME}. ` +
                `It is not a Rebase bundle, or it was truncated.`
        );
    }

    if (options.installDependencies ?? true) {
        await (options.installImpl ?? installBundleDependencies)(root);
    }

    return root;
}

/**
 * Find the bundle root inside an unpacked directory.
 *
 * Tolerates one level of nesting, because whether a tarball has a top-level
 * directory depends on how it was created — `tar czf x.tgz dist-bundle` and
 * `tar czf x.tgz -C dist-bundle .` produce different shapes from the same
 * files, and both are things a build script does.
 */
export function bundleRootIn(directory: string): string | null {
    if (fs.existsSync(path.join(directory, MANIFEST_FILENAME))) return directory;

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(directory, entry.name);
        if (fs.existsSync(path.join(nested, MANIFEST_FILENAME))) return nested;
    }
    return null;
}
