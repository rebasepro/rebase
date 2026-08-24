#!/usr/bin/env node
/**
 * Boot the runtime image. Both ways a bundle can arrive.
 *
 * Every other gate in this repo asserts on something *rendered*: `check-chart`
 * on helm output, `managed/deployment.test.ts` on a container object,
 * `check-runtime-image` on tags and publishers. Nothing had ever executed
 * `infra/docker/entrypoint.mjs`, and nothing had ever started the image.
 *
 * That gap is not academic — it is why `bundle.mode=url` shipped dead and
 * stayed dead. Three independent things blocked it: the entrypoint required
 * `<bundle>/manifest.json` to exist before the runtime was even imported, it
 * passed `bundleDir` unconditionally (which tells `bootFromBundle` a bundle is
 * already located, skipping the download), and the Dockerfile baked
 * `REBASE_BUNDLE=/bundle` (which makes `shouldFetchBundle()` false). Each of the
 * three is invisible to a gate that reads a manifest, because in the manifest
 * everything is correct — `REBASE_BUNDLE_URL` is set, the volume is mounted, the
 * env is right. The image simply refused it.
 *
 * So this gate does the one thing the others cannot: it runs the container.
 *
 *   mode=image  a bundle is mounted at /bundle
 *   mode=url    a bundle is served over HTTP and the runtime fetches it
 *
 * Both must reach a *serving* runtime against a real Postgres. Reaching the
 * database is the assertion that matters: it is the first thing that happens
 * after the bundle is loaded, so a boot that gets there is a boot whose bundle
 * arrived, unpacked, installed and parsed.
 *
 * Run:  node scripts/check-runtime-image-boots.mjs [--image <tag>] [--keep]
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

const args = process.argv.slice(2);
const IMAGE = args.includes("--image") ? args[args.indexOf("--image") + 1] : "rebase-runtime:boot-check";
const KEEP = args.includes("--keep");
const BUILD = !args.includes("--no-build");

const problems = [];
const cleanup = [];

function sh(cmd, cmdArgs, opts = {}) {
    return spawnSync(cmd, cmdArgs, { encoding: "utf-8", ...opts });
}

function docker(cmdArgs, opts = {}) {
    return sh("docker", cmdArgs, opts);
}

function check(label, condition, detail) {
    if (!condition) problems.push(`${label}: ${detail}`);
}

/** Poll until `fn()` is truthy, or give up. Never a bare sleep as the assertion. */
function waitFor(what, fn, timeoutMs = 120_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = fn();
        if (value) return value;
        execFileSync("sleep", ["1"]);
    }
    return null;
}

// ── 0. Docker must exist ─────────────────────────────────────────────────────
if (docker(["version", "--format", "{{.Server.Version}}"]).status !== 0) {
    console.error(`${RED}docker is not available — this gate needs it.${NC}`);
    process.exit(2);
}

// ── 1. A bundle to serve ─────────────────────────────────────────────────────
//
// Deliberately minimal and hand-written rather than produced by `rebase build`:
// this gate is about the image's handling of a bundle, and a build step here
// would make a CLI failure look like an image failure. The shape is the
// contract — `manifest.json` is what both `loadBundle` and `bundleRootIn` look
// for, and getting THAT wrong is the bug this exists to catch.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-boot-check-"));
if (!KEEP) cleanup.push(() => fs.rmSync(scratch, { recursive: true, force: true }));

const bundleDir = path.join(scratch, "dist-bundle");
fs.mkdirSync(bundleDir, { recursive: true });
fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify({
    bundleFormat: 2,
    kind: "backend",
    app: "backend",
    entry: { server: "index.js" },
    schemaVersion: "boot-check"
}, null, 2));
// A bundle with no dependencies: the install path is covered by
// fetch-bundle.test.ts against real npm, and pulling from the registry here
// would make this gate fail when npm is slow rather than when the image is
// broken.
fs.writeFileSync(path.join(bundleDir, "package.json"), JSON.stringify({
    name: "boot-check-bundle", private: true, type: "module"
}, null, 2));
fs.writeFileSync(path.join(bundleDir, "index.js"),
    "export default {};\nconsole.log('[bundle] entry evaluated');\n");

const tarball = path.join(scratch, "bundle.tar.gz");
execFileSync("tar", ["-czf", tarball, "-C", bundleDir, "."]);

// ── 2. Build ─────────────────────────────────────────────────────────────────
if (BUILD) {
    console.log(`${DIM}building ${IMAGE}…${NC}`);
    const build = docker(["build", "-f", "infra/docker/server.Dockerfile", "-t", IMAGE, ROOT],
        { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    if (build.status !== 0) {
        console.error(`${RED}the runtime image does not build:${NC}\n${build.stderr?.slice(-3000)}`);
        process.exit(1);
    }
}

// ── 3. A network, a database, and a static file server ───────────────────────
const NET = "rebase-boot-check-net";
docker(["network", "rm", NET], { stdio: "ignore" });
docker(["network", "create", NET], { stdio: "ignore" });
cleanup.push(() => docker(["network", "rm", NET], { stdio: "ignore" }));

function runDetached(name, dockerArgs) {
    docker(["rm", "-f", name], { stdio: "ignore" });
    const result = docker(["run", "-d", "--name", name, "--network", NET, ...dockerArgs]);
    cleanup.push(() => docker(["rm", "-f", name], { stdio: "ignore" }));
    if (result.status !== 0) {
        problems.push(`could not start ${name}: ${result.stderr?.trim()}`);
        return false;
    }
    return true;
}

runDetached("rebase-boot-db", [
    "-e", "POSTGRES_PASSWORD=boot", "-e", "POSTGRES_USER=boot", "-e", "POSTGRES_DB=boot",
    "postgres:18-alpine"
]);

const dbReady = waitFor("postgres", () =>
    docker(["exec", "rebase-boot-db", "pg_isready", "-U", "boot"]).status === 0, 90_000);
check("setup", dbReady, "postgres never became ready — the gate cannot say anything about the image");

// Serve the tarball from a container on the same network, so the runtime
// fetches over a real network hop rather than from a mount.
runDetached("rebase-boot-files", [
    "-v", `${scratch}:/srv:ro`,
    "-w", "/srv",
    "node:22-slim",
    "node", "-e",
    "require('http').createServer((q,s)=>{const f='/srv/bundle.tar.gz';" +
    "if(q.url!=='/bundle.tar.gz'){s.writeHead(404);return s.end()}" +
    "s.writeHead(200,{'content-type':'application/gzip'});" +
    "require('fs').createReadStream(f).pipe(s)}).listen(8000)"
]);

const DB_URL = "postgres://boot:boot@rebase-boot-db:5432/boot";

// ── 4. The two modes ─────────────────────────────────────────────────────────
/**
 * A boot is "reached the database" when the runtime has logged that it is
 * listening, or has failed for a reason that is about the database rather than
 * about the bundle. Both mean the bundle arrived and parsed, which is what this
 * gate is for.
 */
function bootLogs(name, extraArgs) {
    docker(["rm", "-f", name], { stdio: "ignore" });
    const result = docker(["run", "-d", "--name", name, "--network", NET,
        "-e", `DATABASE_URL=${DB_URL}`,
        "-e", "JWT_SECRET=0123456789abcdef0123456789abcdef",
        "-e", "REBASE_SERVICE_KEY=0123456789abcdef0123456789abcdef",
        "-e", "REBASE_MIGRATE_ON_BOOT=ensure",
        // Required in production, and correctly refused when absent — supplying
        // it here keeps this gate about the bundle rather than about env rules.
        "-e", "CORS_ORIGINS=https://boot-check.example",
        ...extraArgs, IMAGE]);
    cleanup.push(() => docker(["rm", "-f", name], { stdio: "ignore" }));
    if (result.status !== 0) return `could not start: ${result.stderr}`;

    // Settled = listening, or exited. Either ends the wait; which one it is is
    // the assertion, not the waiting.
    waitFor(name, () => {
        const logs = docker(["logs", name]).stdout + docker(["logs", name]).stderr;
        if (/listening on port/i.test(logs)) return true;
        const state = docker(["inspect", "-f", "{{.State.Running}}", name]).stdout.trim();
        return state === "false";
    }, 150_000);

    const out = docker(["logs", name]);
    return `${out.stdout}\n${out.stderr}`;
}

console.log(`${DIM}booting mode=image (bundle mounted at /bundle)…${NC}`);
const mounted = bootLogs("rebase-boot-mounted", ["-v", `${bundleDir}:/bundle`]);

check("mode=image", !/No bundle found at/.test(mounted),
    `the entrypoint refused a bundle that IS mounted at /bundle:\n${mounted.slice(-1200)}`);
check("mode=image", /listening on port/i.test(mounted),
    `never started serving:\n${mounted.slice(-1500)}`);

console.log(`${DIM}booting mode=url (runtime fetches its own bundle)…${NC}`);
const fetched = bootLogs("rebase-boot-fetched", [
    "-e", "REBASE_BUNDLE_URL=http://rebase-boot-files:8000/bundle.tar.gz",
    "-e", "REBASE_BUNDLE_FETCH_DIR=/bundle"
]);

// The three original blockers, each asserted by its own symptom, so a
// regression names which one came back rather than just "url mode broke".
check("mode=url", !/No bundle found at/.test(fetched),
    "the entrypoint refused to start because nothing was on disk yet — it must stand aside " +
    `when REBASE_BUNDLE_URL is set:\n${fetched.slice(-1200)}`);
check("mode=url", !/dist-bundle|No manifest\.json found/.test(fetched),
    "the runtime looked for a bundle on disk instead of fetching — either REBASE_BUNDLE is " +
    `still set in the image, or the entrypoint passed bundleDir:\n${fetched.slice(-1200)}`);
check("mode=url", !/not a Rebase bundle|unpacked without a/.test(fetched),
    `the bundle downloaded but was not recognised — the marker filename disagrees:\n${fetched.slice(-1200)}`);
check("mode=url", /listening on port/i.test(fetched),
    `never started serving:\n${fetched.slice(-1500)}`);

// ── 5. And the failure that should still fail ────────────────────────────────
//
// A gate that only proves things start can be satisfied by an entrypoint that
// never refuses anything. The refusal is load-bearing: without a bundle and
// without a URL there is nothing to serve, and starting anyway would produce a
// pod that answers 404 to everything and reports itself healthy.
console.log(`${DIM}booting with neither a bundle nor a URL (must refuse)…${NC}`);
const neither = bootLogs("rebase-boot-neither", []);
check("no bundle", /No bundle found at/.test(neither),
    `started with no bundle and no URL — it must refuse:\n${neither.slice(-1200)}`);

// ── Report ───────────────────────────────────────────────────────────────────
for (const fn of cleanup) { try { fn(); } catch { /* best effort */ } }

if (problems.length > 0) {
    console.error(`\n${RED}✗ ${problems.length} problem(s):${NC}\n`);
    for (const p of problems) console.error(`  ${RED}•${NC} ${p}\n`);
    process.exit(1);
}
console.log(`\n${DIM}Booted the built image with a mounted bundle and with a fetched one, ` +
    `against a real Postgres, and confirmed it still refuses when given neither.${NC}`);
console.log(`${GREEN}✓ the runtime image boots both ways a bundle can arrive.${NC}`);
