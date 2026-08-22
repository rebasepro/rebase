/**
 * Container entrypoint for the Rebase runtime image.
 *
 * Three steps, each of which can be skipped: make the bundle's dependencies
 * available, optionally reconcile the database schema, then hand off to the
 * runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const BUNDLE = process.env.REBASE_BUNDLE || "/bundle";

/**
 * Two ways a bundle arrives, and this file must not assume the first.
 *
 * Mounted (or baked into a derived image): the files are at BUNDLE before this
 * process starts, and everything below applies.
 *
 * Fetched: `REBASE_BUNDLE_URL` is set and the runtime downloads, unpacks and
 * installs the bundle itself as the first thing it does. Nothing is on disk yet
 * when this file runs, so every step below has to stand aside — the existence
 * check would fail the container, the dependency install would find no
 * package.json, and passing `bundleDir` to `runFromBundle` would tell it a
 * bundle is already present and skip the fetch entirely.
 *
 * Those three were independent blockers, so removing any one of them changed
 * nothing and the mode stayed dead. It had never worked: `helm install --set
 * bundle.mode=url` and the Cloud Run substrate both set the URL and both got
 * `No bundle found at /bundle.` before `@rebasepro/server` was even imported.
 */
const FETCH_MODE =
    Boolean(process.env.REBASE_BUNDLE_URL) &&
    !fs.existsSync(path.join(BUNDLE, "manifest.json"));

if (FETCH_MODE) {
    // `shouldFetchBundle` treats REBASE_BUNDLE as "a bundle is already on disk"
    // and lets it win over a URL. Reaching here means it is not on disk, so an
    // inherited value would only stop the fetch that is about to be the whole
    // point of this container.

    log(`no bundle on disk; the runtime will fetch one from REBASE_BUNDLE_URL`);
}

function log(message) {
    console.log(`[entrypoint] ${message}`);
}

function fail(message, hint) {
    console.error(`[entrypoint] ${message}`);
    if (hint) console.error(`[entrypoint] ${hint}`);
    process.exit(1);
}

// ── 1. The bundle must exist, unless one is being fetched ────────────────────
if (!FETCH_MODE && !fs.existsSync(path.join(BUNDLE, "manifest.json"))) {
    fail(
        `No bundle found at ${BUNDLE}.`,
        "Mount one built with `rebase build` (`docker run -v ./dist-bundle:/bundle …`), " +
        "or set REBASE_BUNDLE_URL and the runtime will fetch one at boot."
    );
}

// ── 2. Dependencies the project declared ─────────────────────────────────────
//
// The image ships the engine; a project's own dependencies travel with its
// bundle. Installing them here — rather than baking them into the image — is
// what keeps one image able to run every project.
const bundlePackageJson = path.join(BUNDLE, "package.json");
const bundleModules = path.join(BUNDLE, "node_modules");

// Skipped entirely in fetch mode: there is nothing here yet, and the runtime
// runs the same install — same flags, same dedupe — once it has unpacked.
if (!FETCH_MODE && fs.existsSync(bundlePackageJson) && !fs.existsSync(bundleModules)) {
    let declared = {};
    try {
        declared = JSON.parse(fs.readFileSync(bundlePackageJson, "utf8")).dependencies ?? {};
    } catch {
        declared = {};
    }

    if (Object.keys(declared).length > 0) {
        log(`installing ${Object.keys(declared).length} bundle dependencies…`);
        // `--ignore-scripts` is deliberate. A managed bundle has already passed
        // intake, which REJECTS native dependencies — so nothing here legitimately
        // needs a compile or install step. What install scripts remain are
        // third-party binary downloaders (e.g. `@ariga/atlas`, pulled in only by
        // the driver's *CLI*, never used by the runtime) and the occasional
        // postinstall — both pure liability at boot: they make a tenant start
        // depend on some external binary host being up and having a build for this
        // arch, and they are exactly where a malicious transitive dep would run.
        // Skipping them makes the boot hermetic, and is safe precisely because the
        // no-native-deps rule guarantees nothing needs them.
        const result = spawnSync(
            "npm",
            ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"],
            { cwd: BUNDLE, stdio: "inherit" }
        );
        if (result.status !== 0) {
            fail(
                "Installing the bundle's dependencies failed.",
                "Pre-install them into the bundle at build time, or bake them into a derived image."
            );
        }
    }
}

// ── 2b. One copy of the framework, not two ───────────────────────────────────
//
// The install above can leave a SECOND copy of a package this image already
// ships inside `/bundle/node_modules` — `@rebasepro/server` arrives that way as
// a transitive dependency of `@rebasepro/admin` and `@rebasepro/server-postgres`,
// which nearly every project declares.
//
// That is not merely wasteful, it is a silent, total breakage of custom
// functions. Every function imports `defineFunction` from `@rebasepro/server`,
// so it resolves the BUNDLE's copy — a different module instance from the one
// `runFromBundle` boots below. The framework singleton initialized down there is
// invisible up here, so `rebase.data`, `rebase.dataAsAdmin` and `rebase.storage`
// throw "server not initialized yet" on every request, in a process that is
// otherwise perfectly healthy and reports itself ready. (Seen in production as
// every `doc-content` route 500ing while `/api/data/*` served fine.)
//
// Replacing the duplicate with a symlink to the image's copy collapses the two
// back into one module instance, because Node resolves a module's identity by
// its real path. It is also the honest version of what was already true: the
// image's copy is the one that boots and owns the process, so a bundle pinning a
// different version was never actually running that version — it just got a
// second, dead one alongside it.
//
// ONLY `@rebasepro/server`, deliberately — not every package the image happens
// to ship. The image installs the narrow set of dependencies the runtime itself
// needs, while the bundle's `npm install` resolved each package's FULL
// dependency tree; redirecting a package to the image's copy therefore risks
// pointing it at a tree that is missing something. `@rebasepro/server-postgres`
// is the proof: the image's copy has no `chokidar`, so redirecting it took the
// database driver down and the pod crash-looped.
//
// `@rebasepro/server` is the one package where the redirect is both necessary
// and provably safe — necessary because it holds the singleton, and safe
// because this very file imports it from the image below. If the image's copy
// could not load, the runtime would not be running at all.
// The list and the reasoning now live in the runtime, beside the install that
// creates the duplicate, so the fetch path gets this too — it runs after this
// file has finished, and would otherwise have deduped an empty directory.
const RUNTIME_PROVIDED = ["@rebasepro/server"];

const imageModules = path.join(path.dirname(fileURLToPath(import.meta.url)), "node_modules");

for (const pkg of FETCH_MODE ? [] : RUNTIME_PROVIDED) {
    const provided = path.join(imageModules, pkg);
    const inBundle = path.join(BUNDLE, "node_modules", pkg);

    // Nothing to dedupe unless the image provides it AND the bundle installed
    // its own real copy (an existing symlink is already this fix, re-applied).
    if (!fs.existsSync(provided)) continue;
    let stat;
    try {
        stat = fs.lstatSync(inBundle);
    } catch {
        continue;
    }
    if (stat.isSymbolicLink()) continue;

    try {
        fs.rmSync(inBundle, { recursive: true, force: true });
        fs.symlinkSync(provided, inBundle, "dir");
        log(`deduped ${pkg} → the runtime's own copy`);
    } catch (err) {
        // Non-fatal on purpose: a project with no custom functions is unaffected
        // by the duplicate, and refusing to boot over it would turn a degraded
        // deploy into an outage. Loud, because the degradation is subtle.
        console.error(
            `[entrypoint] WARNING: could not dedupe ${pkg} (${err.message}). ` +
            "Custom functions using the `rebase` singleton may fail with " +
            "\"server not initialized yet\"."
        );
    }
}

// ── 3. Schema ────────────────────────────────────────────────────────────────
//
// The runtime creates its auth tables at boot and, on `ensure`, additively
// creates any collection tables, columns and enum types the database is missing.
// Additive means additive: it never drops, narrows or rewrites anything, so it
// is safe to run unattended on every start and re-running it is a no-op.
//
// `push` remains unsupported here, deliberately. It once shelled out to the
// driver's schema CLI — TypeScript, not exported as a subpath, so it was never
// reachable and the container crash-looped forever behind a restart policy. But
// the real objection outlived the bug: a full push computes a diff and will
// happily `DROP COLUMN`, and a container restart must never be able to destroy a
// production column as a side effect of rescheduling.
//
// So destructive schema changes stay where they can be reviewed: `rebase db
// push` from a checkout or CI, with the destructive-change gate and a backup in
// reach. `none` opts out of even the additive step.
const migrateMode = process.env.REBASE_MIGRATE_ON_BOOT || "ensure";

if (!["none", "ensure"].includes(migrateMode)) {
    if (migrateMode === "push") {
        fail(
            "REBASE_MIGRATE_ON_BOOT=push is not supported by the runtime image.",
            "The default, `ensure`, already creates missing tables, columns and enum types " +
            "additively. For a change that DROPS or rewrites something, run `rebase db push` from " +
            "a checkout or CI — it dry-runs the change, refuses destructive ones without " +
            "confirmation, and can take a backup first. Set REBASE_MIGRATE_ON_BOOT=ensure to boot."
        );
    }
    fail(`REBASE_MIGRATE_ON_BOOT must be "none" or "ensure" (got "${migrateMode}").`);
}

// ── 4. Run ───────────────────────────────────────────────────────────────────
// Imported rather than spawned so this process *is* the server: signals arrive
// directly and graceful shutdown works without forwarding anything.
const { runFromBundle } = await import("@rebasepro/server");
// No `bundleDir` in fetch mode: `bootFromBundle` reads it as "a bundle is
// already located" and skips the download that has not happened yet.
await runFromBundle(FETCH_MODE ? {} : { bundleDir: BUNDLE });
