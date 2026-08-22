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

function log(message) {
    console.log(`[entrypoint] ${message}`);
}

function fail(message, hint) {
    console.error(`[entrypoint] ${message}`);
    if (hint) console.error(`[entrypoint] ${hint}`);
    process.exit(1);
}

// ── 1. The bundle must exist ─────────────────────────────────────────────────
if (!fs.existsSync(path.join(BUNDLE, "manifest.json"))) {
    fail(
        `No bundle found at ${BUNDLE}.`,
        "Mount one built with `rebase build`, e.g. `docker run -v ./dist-bundle:/bundle …`."
    );
}

// ── 2. Dependencies the project declared ─────────────────────────────────────
//
// The image ships the engine; a project's own dependencies travel with its
// bundle. Installing them here — rather than baking them into the image — is
// what keeps one image able to run every project.
const bundlePackageJson = path.join(BUNDLE, "package.json");
const bundleModules = path.join(BUNDLE, "node_modules");

if (fs.existsSync(bundlePackageJson) && !fs.existsSync(bundleModules)) {
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
// `scripts/test/runtime-provided.test.mjs` fails if it drifts. The bundler
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
const RUNTIME_PROVIDED = [
    "@rebasepro/server",
    "@rebasepro/types",
    "@rebasepro/client",
    "@rebasepro/common",
    "@rebasepro/utils"
];

const imageModules = path.join(path.dirname(fileURLToPath(import.meta.url)), "node_modules");

for (const pkg of RUNTIME_PROVIDED) {
    const provided = path.join(imageModules, pkg);
    const inBundle = path.join(BUNDLE, "node_modules", pkg);

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
await runFromBundle({ bundleDir: BUNDLE });
