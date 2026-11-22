/**
 * Build the stock bundle: what a new Rebase Cloud project runs before anyone
 * has deployed code to it.
 *
 *     pnpm build:stock-bundle                      # → infra/stock-bundle/out/
 *     pnpm build:stock-bundle --out /some/dir
 *     pnpm build:stock-bundle --no-vendor          # no npm, for an offline build
 *     pnpm build:stock-bundle --write-contract     # after changing its shape on purpose
 *
 * It is the project at `infra/stock-bundle`, built with the real `rebase build`,
 * so it is a bundle in every sense the control plane and the runtime check:
 *
 *  - **No `backend/schema`.** The runtime introspects the project's database
 *    and serves every table with row-level security on, so a table created in
 *    the console's SQL editor is an API (and an admin view) once it has RLS.
 *  - **The admin panel**, folded in at `/` like the scaffold's, built from
 *    `infra/stock-bundle/admin`: no customizations, every table from
 *    `GET /api/schema/tables`.
 *  - **No storage code.** A console-created project has a bucket, and its
 *    access model is the project's `STORAGE_POLICIES` — rules as data, which
 *    the control plane seeds with `RECOMMENDED_STORAGE_RULES` on the stock
 *    deploy and the console edits. A `storageAuthorize` here would be asked
 *    about every key no rule covers, so the rules the console shows would not
 *    be the whole answer; this script refuses to build one in.
 *
 * Two things `rebase build` cannot do here, done after it:
 *
 *  1. **Pin the driver.** Inside this repository every `@rebasepro/*` is
 *     `workspace:*`, which the CLI rightly leaves out of `deps.declared` (it
 *     means nothing on the registry the pod installs from). The bundle still
 *     needs `@rebasepro/server-postgres` — the image supplies the server, not
 *     the driver — so it is declared here at exactly this checkout's version.
 *     The release flow bumps that version only once it is on npm.
 *  2. **Mark it stock** (`manifest.stock.version`), so the control plane and
 *     the console can tell "no code deployed yet" from "code that declares no
 *     tables".
 *
 * Output, in `--out`:
 *
 *  - `stock-bundle.tar.gz` — the archive, packed exactly as `rebase cloud
 *    deploy` packs one (so `node_modules` travels when it was vendored).
 *  - `stock-bundle.json` — `{ version, sha256, bytes, manifest }`. The control
 *    plane reads this rather than unpacking the archive: the manifest is what
 *    intake judges.
 *
 * And `tooling/contracts/stock-bundle-manifest.json`: the manifest with every
 * volatile field held still (versions, dates, vendoring). The control plane's
 * tests drive it through intake, so the two repositories agree on what a stock
 * bundle is. This script fails when the built manifest no longer matches it;
 * `--write-contract` rewrites it, for a change made on purpose.
 *
 * The control-plane image runs this (saas/Dockerfile) and ships the result, so
 * every control-plane release deploys the stock bundle of the framework it was
 * built from; CI runs it on every change so a release cannot be cut with a
 * stock bundle that does not build.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectRoot = path.join(repoRoot, "infra/stock-bundle");
const bundleDir = path.join(projectRoot, "dist-bundle");

/** The driver the image does not supply, which the bundle therefore declares. */
export const STOCK_DRIVER_PACKAGE = "@rebasepro/server-postgres";

function argValue(flag: string): string | undefined {
    const index = process.argv.indexOf(flag);
    return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
    console.error(`✗ build-stock-bundle: ${message}`);
    process.exit(1);
}

function readJson<T>(file: string): T {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): void {
    console.log(`  $ ${[command, ...args].join(" ")}`);
    const result = spawnSync(command, args, { cwd,
stdio: "inherit",
env: { ...process.env,
...env } });
    if (result.status !== 0) fail(`\`${command} ${args.join(" ")}\` exited ${result.status ?? result.signal}`);
}

const outDir = path.resolve(argValue("--out") ?? path.join(projectRoot, "out"));
const vendor = !process.argv.includes("--no-vendor");
const writeContract = process.argv.includes("--write-contract");
const contractPath = path.join(repoRoot, "tooling/contracts/stock-bundle-manifest.json");

// ── The versions ─────────────────────────────────────────────────────────────
//
// Server and driver are released together, at one version. A checkout where
// they disagree is mid-release, and a bundle pinning one against an image of
// the other is the skew that has already caused a production login outage.
const serverVersion = readJson<{ version: string }>(path.join(repoRoot, "packages/server/package.json")).version;
const driverVersion = readJson<{ version: string }>(path.join(repoRoot, "packages/server-postgres/package.json")).version;
if (serverVersion !== driverVersion) {
    fail(`@rebasepro/server is ${serverVersion} and ${STOCK_DRIVER_PACKAGE} is ${driverVersion}; they ship together.`);
}
const version = serverVersion;

// ── No storage code: the project's STORAGE_POLICIES are the whole model ──────
const stockStorage = path.join(projectRoot, "backend/storage.ts");
if (fs.existsSync(stockStorage)) {
    fail(
        `${path.relative(repoRoot, stockStorage)} exists. The stock bundle carries no storage code: a stock ` +
        "project's access model is its STORAGE_POLICIES, and a storageAuthorize would widen them for every key no rule covers."
    );
}

// ── The runtime range is the one every project's bundle declares ─────────────
//
// So the stock bundle resolves onto exactly the releases a customer's bundle
// does — whatever the platform does with `"rebase"` for them, it does here.
const { CURRENT_RUNTIME_RANGE } = await import(path.join(repoRoot, "packages/cli/src/manifest.ts")) as { CURRENT_RUNTIME_RANGE: string };
const declaredRange = readJson<{ rebase: string }>(path.join(projectRoot, "rebase.json")).rebase;
if (declaredRange !== CURRENT_RUNTIME_RANGE) {
    fail(
        `infra/stock-bundle/rebase.json targets "${declaredRange}", and the CLI scaffolds "${CURRENT_RUNTIME_RANGE}" ` +
        "(CURRENT_RUNTIME_RANGE). The stock bundle has to resolve where every project's bundle does."
    );
}

console.log(`Building the stock bundle for @rebasepro ${version}`);

// ── 1. The admin panel ───────────────────────────────────────────────────────
run("pnpm", ["--filter", "rebase-stock-bundle-admin", "run", "build"], repoRoot, { REBASE_APP_BASE: "/" });

// ── 2. The bundle, with the real CLI ─────────────────────────────────────────
//
// `--no-vendor`: there is nothing it could install yet (see the module note),
// and vendoring is done below once the driver is declared.
fs.rmSync(bundleDir, { recursive: true,
force: true });
run("pnpm", ["exec", "rebase", "build", "backend", "--skip-static-build", "--no-vendor", "--output", "dist-bundle"], projectRoot);

// ── 3. Pin the driver and mark it stock ──────────────────────────────────────
type Manifest = import("@rebasepro/types").RebaseBundleManifest;
const manifestPath = path.join(bundleDir, "manifest.json");
const manifest = readJson<Manifest>(manifestPath);
manifest.deps.declared = { ...manifest.deps.declared,
[STOCK_DRIVER_PACKAGE]: version };
manifest.stock = { version };
fs.writeFileSync(
    path.join(bundleDir, "package.json"),
    `${JSON.stringify({ name: "rebase-bundle",
private: true,
type: "module",
dependencies: manifest.deps.declared }, null, 2)}\n`
);

if (vendor) {
    const { vendorDependencies } = await import(path.join(repoRoot, "packages/cli/src/bundle.ts"));
    const result = vendorDependencies({
        outDir: bundleDir,
        declared: manifest.deps.declared,
        nativeModules: [],
        required: [STOCK_DRIVER_PACKAGE],
        requested: true
    }) as { vendored: boolean; target?: Manifest["deps"]["vendorTarget"]; skipped?: string };
    if (!result.vendored) fail(`the driver could not be installed into the bundle: ${result.skipped}`);
    manifest.deps.vendored = true;
    manifest.deps.vendorTarget = result.target;
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// ── 4. It is what the control plane and the runtime will take ────────────────
//
// The runtime's own reader, so a field this script got wrong fails here rather
// than as a tenant that will not boot. The control plane's intake is pinned
// against `stock-bundle.json` by its own tests.
const { readBundleManifest } = await import(path.join(repoRoot, "packages/server/src/boot/bundle.ts"));
readBundleManifest(bundleDir);
const problems: string[] = [];
if (manifest.entry.tables) problems.push("it declares tables (entry.tables); a stock backend introspects");
if (manifest.kind !== "backend") problems.push(`its kind is ${manifest.kind}, not backend`);
if (manifest.storage?.authorize) problems.push("it ships a storageAuthorize, which would answer for every key the project's STORAGE_POLICIES do not cover");
if (manifest.hooks.native) problems.push("its dependencies contain native code, which the managed runtime refuses");
const statics = Array.isArray(manifest.entry.static) ? manifest.entry.static : [];
if (!statics.some(app => (app.path ?? "/") === "/" && app.cms === "/")) problems.push("it carries no admin panel at /");
if (problems.length > 0) fail(`the bundle is not a stock bundle: ${problems.join("; ")}.`);

// ── 5. The contract the control plane's tests read ───────────────────────────
//
// Everything that changes from one build to the next is held still, so the
// file changes only when the SHAPE does.
const HELD = "0.0.0-contract";
const contract = structuredClone(manifest);
contract.runtime.builtAgainst = HELD;
contract.stock = { version: HELD };
contract.deps = { declared: Object.fromEntries(Object.keys(contract.deps.declared).map(name => [name, HELD])) };
contract.build = { cli: HELD,
node: "22",
createdAt: "2026-01-01T00:00:00.000Z" };
const contractText = `${JSON.stringify(contract, null, 2)}\n`;
if (writeContract) {
    fs.writeFileSync(contractPath, contractText);
    console.log(`  wrote ${path.relative(repoRoot, contractPath)}`);
} else if (!fs.existsSync(contractPath) || fs.readFileSync(contractPath, "utf8") !== contractText) {
    fail(
        `the stock manifest no longer matches ${path.relative(repoRoot, contractPath)}, which the control plane's ` +
        "intake tests read. If the change is on purpose, run `pnpm build:stock-bundle --write-contract`, commit the " +
        "file, and run the saas backend suite against it."
    );
}

// ── 6. Pack, and say what was packed ─────────────────────────────────────────
fs.mkdirSync(outDir, { recursive: true });
const archive = path.join(outDir, "stock-bundle.tar.gz");
fs.rmSync(archive, { force: true });
const { packBundleForUpload } = await import(path.join(repoRoot, "packages/cli/src/commands/cloud/bundle-deploy.ts"));
const packed = await packBundleForUpload(bundleDir, archive, manifest) as { bytes: number; modulesLeftOut: boolean };
if (packed.modulesLeftOut) fail("the vendored tree did not fit the upload limit");

const sha256 = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
fs.writeFileSync(
    path.join(outDir, "stock-bundle.json"),
    `${JSON.stringify({ version,
sha256,
bytes: packed.bytes,
manifest }, null, 2)}\n`
);

console.log(`✓ stock bundle ${version} → ${path.relative(repoRoot, archive)} (${(packed.bytes / 1024 / 1024).toFixed(1)} MB, sha256 ${sha256.slice(0, 12)}…)`);
