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
    delete process.env.REBASE_BUNDLE;
    log(`no bundle on disk; the runtime will fetch one from REBASE_BUNDLE_URL`);
}

function log(message) {
    console.log(`[entrypoint] ${message}`);
}

/**
 * The bundle directory this process will actually work in.
 *
 * Reassigned below when the mount cannot be written to. Everything after that
 * point — the dependency install, the framework stitch, the handoff to the
 * runtime — reads this rather than `BUNDLE`, so there is one answer to "where
 * is the bundle" instead of three that can disagree.
 */
let bundleDir = BUNDLE;

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

// ── 1b. A bundle this process can write to ───────────────────────────────────
//
// Two steps below write *into* the bundle: the dependency install, and the
// symlink stitch that makes `@rebasepro/server` resolvable from a function
// file. A bind mount keeps its host ownership on Linux, and this image runs as
// `node` (uid 1000) — so on any host whose uid is not 1000, both writes are
// denied. The compose file says the mount is writable "because the container
// installs the bundle's declared dependencies into it on first start", and that
// promise was true only by the coincidence of matching uids.
//
// The failure was uid-dependent and therefore invisible to whoever wrote it: it
// works on macOS, where Docker Desktop maps ownership away, and on the many
// Linux desktops whose first user is 1000. It fails on a CI runner (uid 1001)
// and on any hardened host that runs deploys as a service account — as
// `EACCES: mkdir '/bundle/node_modules'` for the install, and as functions that
// silently fail to load for the stitch.
//
// So: if the mount cannot be written, work from a copy the container owns. A
// bundle is compiled output — small, and read-only as far as the project is
// concerned — so copying it costs a moment at boot and nothing after.
//
// Deliberately not the alternatives:
//   - `chown`/`chmod` on the mount would need root, which this image gives up
//     on purpose, and would rewrite the ownership of the operator's own files;
//   - `NODE_PATH` does not apply to ESM, and a bundle is ESM;
//   - installing to `/node_modules` (which Node's upward walk from `/bundle`
//     does reach) leaves the stitch in step 2b still writing to the mount.
if (!FETCH_MODE) {
    // A real write, not `fs.accessSync(BUNDLE, W_OK)`.
    //
    // `access` is advisory, and here it is simply wrong: over a Docker Desktop
    // bind mount a directory with mode 555 owned by this very uid still answers
    // "writable", and the truth only arrives later as npm's `EACCES`. Node's own
    // documentation says not to check with `access` before writing, for exactly
    // this reason. So the probe is the thing itself.
    let writable = true;
    const probe = path.join(BUNDLE, ".rebase-write-probe");
    try {
        fs.mkdirSync(probe);
        fs.rmdirSync(probe);
    } catch {
        writable = false;
    }

    if (!writable) {
        // Beside the runtime, which is already owned by `node`.
        const workingCopy = path.join(path.dirname(fileURLToPath(import.meta.url)), "bundle");
        log(`${BUNDLE} is not writable by this container; working from a copy at ${workingCopy}`);
        try {
            // `force: false` on a re-run would throw on the existing tree; a
            // restarted container should get a fresh copy of what is mounted
            // now, not last boot's.
            fs.rmSync(workingCopy, { recursive: true, force: true });
            fs.cpSync(BUNDLE, workingCopy, { recursive: true, dereference: false });
            bundleDir = workingCopy;
        } catch (err) {
            fail(
                `${BUNDLE} is not writable by this container, and copying it to ${workingCopy} failed: ${err.message}`,
                "Mount the bundle with ownership this container can write (it runs as uid 1000), " +
                "or pre-install its dependencies on the host and mount it read-only."
            );
        }
    }
}

// ── 2. Dependencies the project declared ─────────────────────────────────────
//
// The image ships the engine; a project's own dependencies travel with its
// bundle. Installing them here — rather than baking them into the image — is
// what keeps one image able to run every project.
const bundlePackageJson = path.join(bundleDir, "package.json");
const bundleModules = path.join(bundleDir, "node_modules");

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
            { cwd: bundleDir, stdio: "inherit" }
        );
        if (result.status !== 0) {
            fail(
                "Installing the bundle's dependencies failed.",
                "Pre-install them into the bundle at build time, or bake them into a derived image."
            );
        }
    }
}

// ── 2b. Exactly one copy of the framework, and never zero ────────────────────
//
// `@rebasepro/server` has to be resolvable from inside `/bundle`, because every
// custom function and cron file begins `import { defineFunction } from
// "@rebasepro/server"`. Node resolves that by walking up from the importing
// file — `/bundle/backend/functions/node_modules`, `/bundle/backend/node_modules`,
// `/bundle/node_modules` — and never reaches this image's `/app/node_modules`.
//
// There are two ways for that to be wrong, and this step handles both. It used
// to handle only the first.
//
// TOO MANY: the install above can leave a SECOND copy inside
// `/bundle/node_modules` — `@rebasepro/server` arrives that way as a transitive
// dependency of `@rebasepro/admin` and `@rebasepro/server-postgres`, which many
// projects declare.
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
// NONE AT ALL: and this is the common case, not the exotic one. `rebase build`
// does not declare `@rebasepro/server` in the bundle's package.json — correctly,
// since declaring it is what produces the duplicate above — so a bundle whose
// dependencies do not happen to drag it in transitively has no copy anywhere
// under `/bundle`. The reference app is exactly that: four declared
// dependencies, none of them the framework.
//
// The old code read `lstatSync(inBundle)` and `continue`d when it threw, so
// "absent" was silently treated as "nothing to do". The result was that EVERY
// function and cron file failed to load with `Cannot find package
// "@rebasepro/server"`, the routes 404'd, and the container reported itself
// healthy — the runtime itself was fine, and only a WARNING in the boot log
// distinguished a project whose functions worked from one where none did.
//
// So the link is created when it is missing, not merely repaired when it is
// duplicated. That is what makes the contract in this file true: the image
// supplies `@rebasepro/server` to the bundle.
//
// This list must match `RUNTIME_PROVIDED` in `packages/cli/src/bundle.ts`, and
// `tooling/scripts/test/runtime-provided.test.mjs` fails if it drifts. The bundler
// STRIPS these from the bundle's declared dependencies on the promise that the
// image supplies them; if the two lists disagree, the bundler removes something
// nothing then provides, and every file importing it fails to load. That is not
// hypothetical — the lists disagreed by four packages, and the bundle's own
// package.json is the evidence: it declares four dependencies, none of them
// `@rebasepro/*`, while its function and cron files import them by name.
//
// NOT every package the image happens to ship, though. The image installs the
// narrow set of dependencies the runtime itself needs, while a bundle's `npm
// install` resolves each package's FULL dependency tree — so pointing a package
// at the image's copy risks pointing it at a tree that is missing something.
// `@rebasepro/server-postgres` is the proof and stays off both lists: the
// image's copy long had no `chokidar`, and redirecting it took the database
// driver down and crash-looped the pod. A project declares its own driver, and
// the bundle installs it.
//
// In FETCH_MODE this loop is skipped and the same stitch happens in
// `packages/server/src/boot/fetch-bundle.ts`, after the bundle has been
// downloaded and installed — running it here would dedupe an empty directory.
// That file must carry this same list, and `runtime-provided.test.mjs` checks
// it does.
const RUNTIME_PROVIDED = [
    "@rebasepro/server",
    "@rebasepro/types",
    "@rebasepro/client",
    "@rebasepro/common",
    "@rebasepro/utils"
];

const imageModules = path.join(path.dirname(fileURLToPath(import.meta.url)), "node_modules");

for (const pkg of FETCH_MODE ? [] : RUNTIME_PROVIDED) {
    const provided = path.join(imageModules, pkg);
    const inBundle = path.join(bundleDir, "node_modules", pkg);

    // Nothing to do unless the image actually provides it.
    if (!fs.existsSync(provided)) continue;

    let stat = null;
    try {
        stat = fs.lstatSync(inBundle);
    } catch {
        // Absent. Not "nothing to do" — this is the case that breaks functions.
    }

    // Already a symlink: this fix, re-applied on a restart.
    if (stat?.isSymbolicLink()) continue;

    try {
        if (stat) {
            fs.rmSync(inBundle, { recursive: true, force: true });
        } else {
            // `@rebasepro` may not exist either, on a bundle that installed
            // nothing scoped.
            fs.mkdirSync(path.dirname(inBundle), { recursive: true });
        }
        fs.symlinkSync(provided, inBundle, "dir");
        log(stat
            ? `deduped ${pkg} → the runtime's own copy`
            : `linked ${pkg} → the runtime's own copy, so functions can import it`);
    } catch (err) {
        // Non-fatal on purpose: a project with no custom functions and no crons
        // is unaffected, and refusing to boot over it would turn a degraded
        // deploy into an outage. Loud, because the degradation is subtle — the
        // process is healthy either way, and only the boot log says which.
        console.error(
            `[entrypoint] WARNING: could not link ${pkg} into the bundle (${err.message}). ` +
            "Custom functions and cron jobs will fail to load with \"Cannot find package\", " +
            "or — if the bundle carries its own copy — with \"server not initialized yet\"."
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
await runFromBundle(FETCH_MODE ? {} : { bundleDir });
