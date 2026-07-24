/**
 * Container entrypoint for the Rebase runtime image.
 *
 * Three steps, each of which can be skipped: make the bundle's dependencies
 * available, optionally reconcile the database schema, then hand off to the
 * runtime.
 */
import fs from "node:fs";
import path from "node:path";
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
