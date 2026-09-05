/**
 * The self-host recipe, run the way a stranger runs it.
 *
 * `verify-selfhost.mts` covers the bundle → fold → mount → response chain and
 * says so in its own header: "What that adds over this script is a container and
 * an image tag." Those two words are the gap. That script imports the runtime
 * **by path** — deliberately, so a worktree cannot silently verify the primary
 * checkout — which means nothing in CI has ever executed
 * `infra/docker/docker-compose.selfhost.yml`, and nothing has ever booted the
 * published image.
 *
 * It is the same shape of hole that let the `.d.ts` files ship as `any` for the
 * entire life of the packages: every gate looked at something other than the
 * artifact a stranger installs. `check-runtime-image.mjs` already names it —
 * "the one component of the self-host story that is an *artifact* rather than
 * code was the one component nothing asserted" — and checks that the image has
 * a publisher. This checks that it runs.
 *
 *     node --import tsx tooling/scripts/verify-selfhost-docker.mts
 *
 * By default it builds the runtime image from this commit, so a change that
 * breaks the boot fails here rather than after a release. Point it at a
 * published tag instead when that is what you want to test:
 *
 *     REBASE_IMAGE=rebasepro/server:0.17.3 node --import tsx tooling/scripts/verify-selfhost-docker.mts
 *
 * Needs Docker, and takes minutes rather than seconds — it belongs in the `e2e`
 * job, not in the sequential `checks` job where a slow step delays every gate
 * after it.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMPOSE_FILE = path.join(ROOT, "infra", "docker", "docker-compose.selfhost.yml");
const PROJECT = "rebase-selfhost-verify";
const TEMPLATE_DIR = path.join(ROOT, "packages", "cli", "templates", "template");
const SCAFFOLD_PROJECT = "rebase-scaffold-verify";

/** Host ports, chosen away from the defaults so a running dev stack is untouched. */
const HTTP_PORT = Number(process.env.VERIFY_HTTP_PORT ?? 18080);
const PG_PORT = Number(process.env.VERIFY_PG_PORT ?? 15432);
/** The scaffold stack runs after the first one is torn down, on its own port. */
const SCAFFOLD_HTTP_PORT = Number(process.env.VERIFY_SCAFFOLD_HTTP_PORT ?? 18081);

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
    console.log(`${ok ? "  [32m✓[0m" : "  [31m✗[0m"} ${label}${detail ? ` [2m— ${detail}[0m` : ""}`);
    if (!ok) failures++;
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; quiet?: boolean } = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? ROOT,
        env: options.env ?? process.env,
        encoding: "utf8",
        stdio: options.quiet ? "pipe" : ["ignore", "inherit", "inherit"],
        maxBuffer: 64 * 1024 * 1024
    });
    return result;
}

const envFile = path.join(os.tmpdir(), `rebase-selfhost-verify-${process.pid}.env`);
const secret = (): string => crypto.randomBytes(32).toString("hex");
let composeUp = false;
let scaffoldUp = false;
// The scaffold's compose file is copied *into* `app/` rather than run from a
// temporary directory: it mounts `./dist-bundle`, which Compose resolves
// against the compose file's own directory, and that is where the bundle this
// script built already sits. Both files are removed by `teardown`.
const scaffoldComposeFile = path.join(ROOT, "app", `docker-compose.scaffold-verify-${process.pid}.yml`);
const scaffoldOverrideFile = path.join(ROOT, "app", `docker-compose.scaffold-verify-${process.pid}.override.yml`);
const scaffoldDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-scaffold-verify-"));
// Created up front rather than at its point of use: `teardown` is registered
// as an exit handler below and removes it, and an early exit (no Docker
// Compose, a failed image build) fires that handler before the stub tree
// would otherwise exist. Declaring it here keeps that reference valid on
// every path — a `const` at the point of use is a TDZ error in the handler.
const stubs = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-docker-verify-"));

function compose(args: string[], quiet = false) {
    return run("docker", ["compose", "-p", PROJECT, "-f", COMPOSE_FILE, "--env-file", envFile, ...args], { quiet });
}

function scaffoldCompose(args: string[], quiet = false) {
    return run("docker", [
        "compose", "-p", SCAFFOLD_PROJECT,
        "-f", scaffoldComposeFile,
        "-f", scaffoldOverrideFile,
        "--env-file", path.join(scaffoldDir, ".env"),
        ...args
    ], { quiet });
}

function teardown(): void {
    if (composeUp) {
        console.log("\n[1m▸ Tearing down[0m");
        // `-v` because the point of the next run is a first boot against an
        // empty database. A retained volume would let a broken provisioning
        // step pass on the strength of the previous run's tables.
        compose(["down", "-v", "--remove-orphans"], true);
        composeUp = false;
    }
    if (scaffoldUp) {
        console.log("\n\x1b[1m▸ Tearing down the scaffold stack\x1b[0m");
        scaffoldCompose(["down", "-v", "--remove-orphans"], true);
        scaffoldUp = false;
    }
    fs.rmSync(envFile, { force: true });
    fs.rmSync(stubs, { recursive: true, force: true });
    fs.rmSync(scaffoldDir, { recursive: true, force: true });
    // These two live inside the repository, so leaving them behind would dirty
    // the working tree of whoever ran the script.
    fs.rmSync(scaffoldComposeFile, { force: true });
    fs.rmSync(scaffoldOverrideFile, { force: true });
}

process.on("exit", teardown);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => { teardown(); process.exit(130); });
}

// ── Docker ───────────────────────────────────────────────────────────────────
if (run("docker", ["compose", "version"], { quiet: true }).status !== 0) {
    console.error("Docker Compose v2 is required and was not found.");
    process.exit(1);
}

// ── The image under test ─────────────────────────────────────────────────────
console.log("[1m▸ The runtime image[0m");
let image = process.env.REBASE_IMAGE;
if (image) {
    check(`using ${image}`, true, "REBASE_IMAGE was set, so nothing is built");
} else {
    image = `rebasepro/server:verify-${process.pid}`;
    console.log("  building from infra/docker/server.Dockerfile (set REBASE_IMAGE to skip)…");
    const built = run("docker", ["build", "-f", "infra/docker/server.Dockerfile", "-t", image, "."]);
    check("image builds from this commit", built.status === 0);
    if (built.status !== 0) process.exit(1);
}

// ── The bundle ───────────────────────────────────────────────────────────────
//
// The reference app in `app/`, built through the CLI's own bundler — the same
// call `rebase build` makes. The compose file mounts `../dist-bundle`, so it
// goes exactly where a user's would.
console.log("\n[1m▸ Building the bundle[0m");
// Inside `app/`, because `buildBundle` refuses to write outside the project it
// is building — a guard worth keeping. The compose file's mount is pointed here
// with REBASE_BUNDLE_DIR rather than the bundle being copied to the repository
// root, so what runs is the tree the builder just produced.
const outDir = path.join(ROOT, "app", "dist-bundle");
const { buildBundle } = await import(`${ROOT}/packages/cli/src/bundle.ts`);
const { loadManifest, findBackendApp } = await import(`${ROOT}/packages/cli/src/manifest.ts`);

const loaded = loadManifest(path.join(ROOT, "app"));
const backend = findBackendApp(loaded.manifest);
if (!backend) {
    console.error("app/ declares no backend app");
    process.exit(1);
}
const built = await buildBundle({
    projectRoot: path.join(ROOT, "app"),
    appName: backend.name,
    app: backend.app,
    outDir,
    runtimeRange: loaded.manifest.rebase,
    skipTypeCheck: true,
    log: () => {}
});
check("bundle built", fs.existsSync(path.join(outDir, "manifest.json")));
check("collections compiled in", (built.collectionCount ?? 0) > 0, `${built.collectionCount} collection(s)`);
if (failures > 0) process.exit(1);

// ── A static app, folded in ──────────────────────────────────────────────────
//
// A stub rather than the reference app's Vite build: what is under test here is
// that the container serves a folded SPA at all, and a real frontend build would
// only add minutes and unrelated ways to fail. It emits an asset reference
// rooted at its declared path, which is what a blank-page bug would break.
//
// Without this the bundle is backend-only and `GET /` correctly answers 404 —
// so asserting a 200 against it would have been asserting the wrong thing.
const { foldFrontendIntoBundle } = await import(`${ROOT}/packages/cli/src/fold-static.ts`);
fs.mkdirSync(path.join(stubs, "site", "assets"), { recursive: true });
fs.writeFileSync(
    path.join(stubs, "site", "index.html"),
    `<!doctype html><html><head><script type="module" src="/assets/app.js"></script>`
    + `</head><body>SELFHOST_DOCKER_INDEX</body></html>`
);
fs.writeFileSync(path.join(stubs, "site", "assets", "app.js"), `console.log("SELFHOST_DOCKER_ASSET");`);

await foldFrontendIntoBundle({
    projectRoot: path.join(ROOT, "app"),
    bundleDir: outDir,
    skipBuild: true,
    log: () => {},
    manifest: {
        apps: {
            backend: { type: "backend" },
            // Relative to the project root, which is what the manifest schema
            // means by `output` — an absolute path is rejected as "does not
            // exist after building".
            site: {
                type: "static",
                output: path.relative(path.join(ROOT, "app"), path.join(stubs, "site")),
                path: "/",
                spa: true
            }
        }
    }
});
check("static app folded in", Array.isArray(
    JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8")).entry.static
));

// ── The env the recipe asks for ──────────────────────────────────────────────
//
// Written the way `infra/docker/quickstart.sh` writes it, so this exercises the
// documented shape rather than a private one.
const SERVICE_KEY = secret();
// The first administrator, named rather than raced for. The compose file makes
// both of these required — `${VAR:?…}` — so omitting them does not produce a
// deployment without an admin, it produces a compose file that refuses to
// interpolate, and this harness failed there rather than at any check.
// Not `admin@localhost`: the login route parses with `z.string().email()`,
// which rejects a dotless domain. That was quickstart.sh's default, and this
// check is what found it.
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = secret(); // 64 hex chars, well past the 12-char floor
fs.writeFileSync(envFile, [
    `POSTGRES_PASSWORD=${secret()}`,
    `JWT_SECRET=${secret()}`,
    `REBASE_SERVICE_KEY=${SERVICE_KEY}`,
    `REBASE_ADMIN_EMAIL=${ADMIN_EMAIL}`,
    `REBASE_ADMIN_PASSWORD=${ADMIN_PASSWORD}`,
    `CORS_ORIGINS=http://localhost:${HTTP_PORT}`,
    `REBASE_VERSION=${image.split(":").slice(1).join(":") || "latest"}`,
    `PORT=${HTTP_PORT}`,
    `POSTGRES_PORT=${PG_PORT}`,
    `REBASE_BUNDLE_DIR=${outDir}`,
    ""
].join("\n"), { mode: 0o600 });

// The compose file names `rebasepro/server:${REBASE_VERSION}`; a locally built
// tag with a different repository would not be reachable that way, so the
// image is retagged rather than the compose file being parameterised further.
if (!process.env.REBASE_IMAGE && !image.startsWith("rebasepro/server:")) {
    run("docker", ["tag", image, `rebasepro/server:${image.split(":").pop()}`], { quiet: true });
}

// ── Up ───────────────────────────────────────────────────────────────────────
console.log("\n[1m▸ docker compose up[0m");
const up = compose(["up", "-d"]);
check("compose starts both services", up.status === 0);
composeUp = true;
if (up.status !== 0) process.exit(1);

// ── Wait for the API ─────────────────────────────────────────────────────────
const base = `http://localhost:${HTTP_PORT}`;
const deadline = Date.now() + 180_000;
let ready = false;
while (Date.now() < deadline) {
    try {
        const res = await fetch(`${base}/health`);
        if (res.ok) { ready = true; break; }
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
}
check("GET /health answers 200 within 180s", ready);
if (!ready) {
    console.log("\n[2m--- api logs ---[0m");
    console.log(compose(["logs", "--tail", "60", "api"], true).stdout ?? "");
    process.exit(1);
}

// ── What a stranger's browser and curl actually get ──────────────────────────
console.log("\n[1m▸ Fetching from outside the container[0m");

const get = async (pathname: string, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${pathname}`, { headers, redirect: "manual" });
    return { status: res.status, body: await res.text() };
};

const root = await get("/");
check("GET / serves the folded SPA", root.body.includes("SELFHOST_DOCKER_INDEX"), `${root.status}, ${root.body.length} bytes`);
const asset = await get("/assets/app.js");
check("GET /assets/app.js serves the asset, not the SPA fallback",
    asset.body.includes("SELFHOST_DOCKER_ASSET"), `${asset.status}`);
const deep = await get("/some/client/route");
check("a client-side route falls back to index.html", deep.body.includes("SELFHOST_DOCKER_INDEX"), `${deep.status}`);

// The assertion that matters most, and the one only a container run can make:
// an unauthenticated caller must not read a collection. If provisioning or RLS
// did not happen, this is where it shows.
const anon = await get("/api/data/posts?limit=1");
check("GET /api/data/posts unauthenticated is refused", anon.status === 401, `${anon.status}`);

// Collection tables exist because the runtime provisioned them at boot — the
// step the compose file used to tell people to perform by hand.
const asService = await get("/api/data/posts?limit=1", { authorization: `Bearer ${SERVICE_KEY}` });
let rows: unknown;
try { rows = JSON.parse(asService.body).data; } catch { /* reported below */ }
check(
    "boot provisioned the collection tables",
    asService.status === 200 && Array.isArray(rows),
    `${asService.status} ${asService.body.slice(0, 70)}`
);

// ── Custom functions and crons ───────────────────────────────────────────────
//
// The reference app ships one function file and two cron files, all of which
// open `import { defineFunction } from "@rebasepro/server"` — a package the
// bundle deliberately does not declare, because the image supplies it. When the
// entrypoint fails to link it in, every one of them fails to load, their routes
// 404, and the container still reports itself healthy: the runtime is fine, and
// only a WARNING in the boot log says that half the application is missing.
//
// So this is asserted over HTTP and over the log, because each catches
// something the other does not. 401 rather than 404 is the tell: the route
// exists and its `requireAuth` ran.
const fn = await get("/api/functions/insights/home");
check(
    "a custom function is mounted (401, not 404)",
    fn.status === 401,
    `${fn.status} ${fn.body.slice(0, 60)}`
);

// The precise property, rather than "nothing was skipped": no file may fail to
// load because of a package the IMAGE promised to supply. A bundle that fails on
// its own undeclared dependency is a different problem and the project's own.
//
// It matters here because this repository's reference app declares
// `@rebasepro/server-postgres` as `workspace:*`, which the bundler correctly
// drops (a registry cannot serve it) — so one cron legitimately cannot load in
// THIS build and would in any real project. Asserting "nothing skipped" would
// bake that local artifact in as a requirement.
const bootLog = compose(["logs", "api"], true).stdout ?? "";
const providedMisses = [...bootLog.matchAll(
    /Cannot find package '(@rebasepro\/(?:server|types|client|common|utils))'/g
)].map(m => m[1]);
check(
    "nothing failed to load on a package the image supplies",
    providedMisses.length === 0,
    providedMisses.length ? [...new Set(providedMisses)].join(", ") : "no misses"
);

const authConfig = await get("/api/auth/config");
check("GET /api/auth/config answers", authConfig.status === 200, `${authConfig.status}`);

// A seeded deployment is set up, and this assertion used to say the opposite.
//
// `needsSetup` is `users.total === 0`, and it was true because a fresh
// deployment had no way in except to let the first stranger who found it
// register and become admin. Naming the admin in the environment closed that,
// which also means the old expectation now describes a deployment where the
// seed did NOT run — the seeder is deliberately quiet about most of its refusals
// (no user store, half a credential), so the visible symptom of a broken seed is
// exactly this flag staying true.
check(
    "a seeded deployment does not need setup",
    /"needsSetup"\s*:\s*false/.test(authConfig.body),
    authConfig.body.slice(0, 90)
);

// And the account it seeded is one somebody can actually sign in to. Worth
// asserting rather than inferring from `needsSetup`: a row in `users` with a
// hash nothing can verify would satisfy the count and leave the operator
// locked out, which is the failure the seeding exists to prevent.
const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
});
const loginBody = await login.text();
check(
    "the seeded admin can sign in",
    login.status === 200 && /"(access_?[Tt]oken|token)"\s*:/.test(loginBody),
    `${login.status}`
);

// ── A restart must be uneventful ─────────────────────────────────────────────
//
// Boot provisioning runs every start, so the second one is where an
// accidentally non-idempotent step surfaces — as a crash loop on somebody's
// server, days after they deployed.
console.log("\n[1m▸ Restarting, to prove provisioning is idempotent[0m");
compose(["restart", "api"], true);
const restartDeadline = Date.now() + 120_000;
let backUp = false;
while (Date.now() < restartDeadline) {
    try {
        const res = await fetch(`${base}/health`);
        if (res.ok) { backUp = true; break; }
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 2000));
}
check("the runtime comes back after a restart", backUp);
if (backUp) {
    const again = await get("/api/data/posts?limit=1", { authorization: `Bearer ${SERVICE_KEY}` });
    check("and still serves the collections", again.status === 200, `${again.status}`);
}

// The logs belong to the stack that produced them, so they are printed before
// it is torn down rather than at the end of the run.
if (failures > 0) {
    console.log("\n\x1b[2m--- api logs (self-host stack) ---\x1b[0m");
    console.log(compose(["logs", "--tail", "60", "api"], true).stdout ?? "");
}
const failuresBeforeScaffold = failures;

// ── The scaffold's own compose ───────────────────────────────────────────────
//
// `rebase init` generates a docker-compose.yml of its own, and nothing had ever
// booted it. It is a different file from the one above with a different
// environment contract: its own set of `${VAR:?…}` requirements, answered by the
// `.env` that `rebase init` writes rather than by `quickstart.sh`. Both halves
// have shipped broken independently — a compose file that could not interpolate
// at all, and a `.env` missing the value it asked for — and each looks like the
// other's fault from the terminal.
//
// The part that most needs a container to observe is the first admin. The api
// service runs with NODE_ENV=production, where the first-registration-becomes-
// admin window is closed, so a stack that comes up without a seeded account is
// not "waiting for setup", it is a deployment nobody can ever sign in to.
//
// The `.env` is produced by calling `configureEnvFile` — the function `rebase
// init` calls, not a transcription of it — so what boots here is the project
// that command would have written.
console.log("\n\x1b[1m▸ Tearing down the self-host stack\x1b[0m");
compose(["down", "-v", "--remove-orphans"], true);
composeUp = false;

console.log("\n\x1b[1m▸ The scaffold's own compose\x1b[0m");

fs.copyFileSync(path.join(TEMPLATE_DIR, ".env.example"), path.join(scaffoldDir, ".env.example"));
fs.writeFileSync(
    path.join(scaffoldDir, "docker-compose.yml"),
    fs.readFileSync(path.join(TEMPLATE_DIR, "docker-compose.yml"), "utf8")
        .replace(/\{\{PROJECT_NAME\}\}/g, SCAFFOLD_PROJECT)
);
// Set before generating, not after: `configureEnvFile` reads PORT back out of
// the file to derive CORS_ORIGINS, so editing it afterwards would leave the two
// disagreeing — which is exactly the bug that pairing exists to prevent.
fs.writeFileSync(
    path.join(scaffoldDir, ".env.example"),
    fs.readFileSync(path.join(scaffoldDir, ".env.example"), "utf8")
        .replace(/^PORT=.*$/m, `PORT=${SCAFFOLD_HTTP_PORT}`)
);

const { configureEnvFile } = await import(`${ROOT}/packages/cli/src/commands/init.ts`);
await configureEnvFile(scaffoldDir);

const scaffoldEnvPath = path.join(scaffoldDir, ".env");
let scaffoldEnv = fs.readFileSync(scaffoldEnvPath, "utf8");
const readEnv = (key: string): string =>
    scaffoldEnv.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? "";

check("init wrote REBASE_ADMIN_EMAIL", readEnv("REBASE_ADMIN_EMAIL").length > 0);
check(
    "init wrote a REBASE_ADMIN_PASSWORD the runtime will accept",
    readEnv("REBASE_ADMIN_PASSWORD").length >= 12,
    `${readEnv("REBASE_ADMIN_PASSWORD").length} chars`
);

// The generated .env pins whatever runtime version the CLI resolves; this run
// is about the image under test.
scaffoldEnv = scaffoldEnv.replace(
    /^REBASE_VERSION=.*$/m,
    `REBASE_VERSION=${image.split(":").slice(1).join(":") || "latest"}`
);
fs.writeFileSync(scaffoldEnvPath, scaffoldEnv, { mode: 0o600 });

const SCAFFOLD_ADMIN_EMAIL = readEnv("REBASE_ADMIN_EMAIL");
const SCAFFOLD_ADMIN_PASSWORD = readEnv("REBASE_ADMIN_PASSWORD");
const SCAFFOLD_SERVICE_KEY = readEnv("REBASE_SERVICE_KEY");

fs.copyFileSync(path.join(scaffoldDir, "docker-compose.yml"), scaffoldComposeFile);
// The one difference between this repository's reference app and a scaffolded
// project, patched over rather than papered over: the scaffold ships
// `config/storage.ts` exporting a `storageAuthorize` hook, and `app/` does not.
// The scaffold's compose sets FORCE_LOCAL_STORAGE, so a storage controller
// survives into production — and the boot guard then refuses a deployment with
// no access-control model at all, correctly. An override file states the
// missing intent without editing the shipped compose, whose interpolation is
// the thing under test.
fs.writeFileSync(scaffoldOverrideFile, [
    "services:",
    "  api:",
    "    environment:",
    "      STORAGE_ALLOW_ANY_AUTHENTICATED: \"true\"",
    ""
].join("\n"));

// Every `${VAR:?…}` in the generated file must be answerable from the generated
// `.env`. Asserted on its own because the failure is total — Compose
// interpolates the whole file before selecting services, so an unanswered
// variable stops `docker compose up -d db` too.
const scaffoldConfig = scaffoldCompose(["config"], true);
check(
    "the generated .env answers every required variable in the generated compose",
    scaffoldConfig.status === 0,
    (scaffoldConfig.stderr ?? "").trim().split("\n")[0] ?? ""
);

const scaffoldUpResult = scaffoldCompose(["up", "-d"]);
check("the scaffold's compose starts both services", scaffoldUpResult.status === 0);
scaffoldUp = true;

if (scaffoldUpResult.status === 0) {
    const scaffoldBase = `http://localhost:${SCAFFOLD_HTTP_PORT}`;
    const scaffoldDeadline = Date.now() + 180_000;
    let scaffoldReady = false;
    while (Date.now() < scaffoldDeadline) {
        try {
            const res = await fetch(`${scaffoldBase}/health`);
            if (res.ok) { scaffoldReady = true; break; }
        } catch { /* not up yet */ }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    check("GET /health answers 200 within 180s", scaffoldReady);

    if (scaffoldReady) {
        const authConfigRes = await fetch(`${scaffoldBase}/api/auth/config`);
        const authConfigBody = await authConfigRes.text();
        check(
            "the scaffold's stack does not need setup",
            /"needsSetup"\s*:\s*false/.test(authConfigBody),
            authConfigBody.slice(0, 90)
        );

        const scaffoldLogin = await fetch(`${scaffoldBase}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: SCAFFOLD_ADMIN_EMAIL, password: SCAFFOLD_ADMIN_PASSWORD })
        });
        const scaffoldLoginBody = await scaffoldLogin.text();
        check(
            "the credentials `rebase init` generated sign in",
            scaffoldLogin.status === 200 && /"(access_?[Tt]oken|token)"\s*:/.test(scaffoldLoginBody),
            `${scaffoldLogin.status}`
        );

        // And nobody else can claim it. `DISABLE_SELF_REGISTRATION` defaults to
        // true in the generated compose, which is the half of the fix that
        // makes the seeded account exclusive rather than merely first.
        const claim = await fetch(`${scaffoldBase}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "stranger@example.com", password: crypto.randomBytes(16).toString("hex") })
        });
        check(
            "a stranger cannot register into the deployment",
            claim.status >= 400,
            `${claim.status}`
        );

        const scaffoldAnon = await fetch(`${scaffoldBase}/api/data/posts?limit=1`);
        check("GET /api/data/posts unauthenticated is refused", scaffoldAnon.status === 401, `${scaffoldAnon.status}`);

        const scaffoldService = await fetch(`${scaffoldBase}/api/data/posts?limit=1`, {
            headers: { authorization: `Bearer ${SCAFFOLD_SERVICE_KEY}` }
        });
        check(
            "boot provisioned the collection tables",
            scaffoldService.status === 200,
            `${scaffoldService.status}`
        );
    }
}

if (failures > failuresBeforeScaffold) {
    console.log("\n\x1b[2m--- api logs (scaffold stack) ---\x1b[0m");
    console.log(scaffoldCompose(["logs", "--tail", "60", "api"], true).stdout ?? "");
}

console.log(failures === 0
    ? "\n[32m✓ Self-host container acceptance passed.[0m\n"
    : `\n[31m✗ ${failures} check(s) failed.[0m\n`);
process.exit(failures === 0 ? 0 : 1);
