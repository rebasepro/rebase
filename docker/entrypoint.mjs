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
import { createRequire } from "node:module";

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
        const result = spawnSync(
            "npm",
            ["install", "--omit=dev", "--no-audit", "--no-fund", "--prefer-offline"],
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

// ── 3. Schema reconciliation ─────────────────────────────────────────────────
//
// Defaults to `none` in production. A container restart must not be able to
// rewrite a production schema as a side effect — that is a deliberate,
// reviewable step, so it has to be asked for by name.
const DEFAULT_MODE = process.env.NODE_ENV === "production" ? "none" : "ensure";
const migrateMode = process.env.REBASE_MIGRATE_ON_BOOT || DEFAULT_MODE;

if (!["none", "ensure", "push"].includes(migrateMode)) {
    fail(`REBASE_MIGRATE_ON_BOOT must be none, ensure or push (got "${migrateMode}").`);
}

if (migrateMode === "push") {
    // `push` reconciles collection tables, which means DDL. With more than one
    // replica starting at once that is concurrent DDL against one database, so
    // it runs under a Postgres advisory lock: the first instance migrates, the
    // rest wait and then find nothing to do.
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) fail("REBASE_MIGRATE_ON_BOOT=push requires DATABASE_URL.");

    // Resolve from the bundle first (the project's own driver), then from the
    // image's own tree — the runtime image ships a driver too, and a bundle that
    // has not installed one should still find it.
    let driverCli;
    for (const base of [BUNDLE, "/app"]) {
        try {
            driverCli = createRequire(path.join(base, "package.json"))
                .resolve("@rebasepro/server-postgres/src/cli.ts");
            break;
        } catch {
            driverCli = undefined;
        }
    }

    if (!driverCli) {
        fail(
            "REBASE_MIGRATE_ON_BOOT=push needs the schema tooling, which is not in this image.",
            "Run `rebase db push` from a checkout or a CI job instead — that is the supported " +
            "path for production schema changes. Set REBASE_MIGRATE_ON_BOOT=ensure to boot without it."
        );
    }

    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: databaseUrl });
    // A constant, arbitrary key. Any value works as long as every instance of
    // this entrypoint uses the same one.
    const LOCK_KEY = 8_427_113;

    await client.connect();
    try {
        // Bounded, so a wedged migration in one replica fails the others fast
        // instead of blocking every boot in the deployment indefinitely.
        log("waiting for the schema lock…");
        await client.query("SET lock_timeout = '120s'");
        try {
            await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
        } catch (err) {
            fail(
                "Timed out waiting for the schema lock — another instance is still migrating.",
                `Detail: ${err instanceof Error ? err.message : String(err)}`
            );
        }

        log("pushing schema…");

        // The driver CLI is TypeScript, so it needs tsx — plain `node` cannot
        // execute it.
        let runner;
        try {
            runner = createRequire(path.join(BUNDLE, "package.json")).resolve("tsx/cli");
        } catch {
            runner = undefined;
        }

        // Deliberately no `--yes`. That flag is treated as
        // `--allow-destructive`, which would let a container restart run
        // `DROP COLUMN` / `DROP TABLE` with no dry run, no confirmation and no
        // backup. Without it a destructive plan refuses non-interactively and
        // says so; an additive one (creating tables on first boot) still applies,
        // which is the case this exists for.
        const result = runner
            ? spawnSync("node", [runner, driverCli, "db", "push"], {
                cwd: BUNDLE,
                stdio: "inherit",
                env: process.env
            })
            : spawnSync("node", [driverCli, "db", "push"], {
                cwd: BUNDLE,
                stdio: "inherit",
                env: process.env
            });
        if (result.status !== 0) {
            fail(
                "Schema push failed — refusing to start against an unknown schema.",
                "Destructive changes are refused here on purpose. Apply them deliberately with " +
                "`rebase db push` from a checkout or CI, after taking a backup."
            );
        }
    } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
        await client.end().catch(() => {});
    }
}

// ── 4. Run ───────────────────────────────────────────────────────────────────
// Imported rather than spawned so this process *is* the server: signals arrive
// directly and graceful shutdown works without forwarding anything.
const { runFromBundle } = await import("@rebasepro/server");
await runFromBundle({ bundleDir: BUNDLE });
