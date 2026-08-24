/**
 * The self-hosting acceptance test: one process, an API and two SPAs.
 *
 * `infra/docker/docker-compose.selfhost.yml` is the shipped form of this — Postgres,
 * plus the published runtime image with `dist-bundle` mounted at `/bundle`. What
 * that adds over this script is a container and an image tag. Everything the
 * change is actually about happens below: a real bundle built from real
 * collections, two static apps folded in at different paths, and a real boot
 * against a real database, answering real requests.
 *
 * Run it when you touch the manifest, the bundle format, folding, or serveSPA:
 *
 *     createdb rebase_acceptance
 *     node --import tsx tooling/scripts/verify-selfhost.mts
 *
 * Override the database with ACCEPTANCE_DATABASE_URL. The script pushes the
 * schema itself, up front — that is the self-host recipe, and it exercises the
 * full `db push` path (including junction-table RLS this script's boot does not
 * create). The runtime would otherwise create the collection tables and their
 * RLS at boot (REBASE_MIGRATE_ON_BOOT defaults to "ensure"); pushing first just
 * means that boot step finds nothing left to do. The managed equivalent — a
 * fresh database served purely by boot-time provisioning, no push — is pinned
 * in `packages/server-postgres/test/e2e/managed-boot-acceptance.test.ts`.
 *
 * Why it imports source by path rather than by package name: in a git worktree,
 * `@rebasepro/*` resolves through node_modules into the PRIMARY checkout, so a
 * package-name import would quietly verify the wrong code.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = path.join(ROOT, "app");
const outDir = path.join(projectRoot, "dist-bundle-acceptance");

const DATABASE_URL = process.env.ACCEPTANCE_DATABASE_URL
    ?? `postgres://${os.userInfo().username}@localhost:5432/rebase_acceptance`;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
    console.log(`${ok ? "  [32m✓[0m" : "  [31m✗[0m"} ${label}${detail ? ` [2m— ${detail}[0m` : ""}`);
    if (!ok) failures++;
}

const { buildBundle } = await import(`${ROOT}/packages/cli/src/bundle.ts`);
const { foldFrontendIntoBundle } = await import(`${ROOT}/packages/cli/src/fold-static.ts`);
const { loadManifest, findBackendApp } = await import(`${ROOT}/packages/cli/src/manifest.ts`);

// ── Two static apps, each built for the path it will be served at ────────────
//
// Stubs rather than the reference app's Vite build: what is under test is the
// manifest → fold → mount → response chain, and a real SPA build would only add
// ways for this to fail for reasons unrelated to it. Each stub does emit an
// asset reference rooted at its declared path — which is what `rebase build`
// asserts about a real one, and what a blank-page bug would violate.
const stubs = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-acceptance-"));
const appDir = (name: string): string => path.join(stubs, name);
for (const [name, label, base] of [["site", "SITE", "/"], ["admin", "ADMIN", "/admin/"]] as const) {
    fs.mkdirSync(path.join(appDir(name), "assets"), { recursive: true });
    fs.writeFileSync(
        path.join(appDir(name), "index.html"),
        `<!doctype html><html><head><script type="module" src="${base}assets/app.js"></script>` +
        `</head><body>${label}_INDEX</body></html>`
    );
    fs.writeFileSync(path.join(appDir(name), "assets", "app.js"), `console.log("${label}_ASSET");`);
}

// ── Build the backend bundle from the reference app's collections ────────────
console.log("\n[1m▸ Building the backend bundle[0m");
const loaded = loadManifest(projectRoot);
const backend = findBackendApp(loaded.manifest);
if (!backend) throw new Error("app/ declares no backend app");

const built = await buildBundle({
    projectRoot,
    appName: backend.name,
    app: backend.app,
    outDir,
    runtimeRange: loaded.manifest.rebase,
    skipTypeCheck: true,
    log: () => {}
});
check("bundle built", fs.existsSync(path.join(outDir, "manifest.json")));
check("kind is backend", built.manifest.kind === "backend", String(built.manifest.kind));
check("collections compiled in", (built.collectionCount ?? 0) > 0, `${built.collectionCount} collection(s)`);

// ── Fold both static apps in, each at its own path ───────────────────────────
console.log("\n[1m▸ Folding two static apps in[0m");
const folded = await foldFrontendIntoBundle({
    projectRoot,
    bundleDir: outDir,
    skipBuild: true,
    log: () => {},
    manifest: {
        apps: {
            backend: { type: "backend" },
            site: { type: "static", output: path.relative(projectRoot, appDir("site")), path: "/", spa: true },
            admin: { type: "static", output: path.relative(projectRoot, appDir("admin")), path: "/admin", spa: true }
        }
    }
});
check("both apps folded", folded.length === 2, folded.map((f: { appName: string; path: string }) => `${f.appName}@${f.path}`).join(", "));

const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"));
check("entry.static lists both", Array.isArray(manifest.entry.static) && manifest.entry.static.length === 2,
    JSON.stringify(manifest.entry.static));
check("folding did not drop entry.config", Boolean(manifest.entry.config), manifest.entry.config);

// ── The schema. Its own step, exactly as the compose recipe has it ───────────
console.log("\n[1m▸ Pushing the schema[0m");
const pluginCli = path.join(projectRoot, "backend", "node_modules", "@rebasepro", "server-postgres", "src", "cli.ts");
if (!fs.existsSync(pluginCli)) throw new Error(`No server-postgres CLI at ${pluginCli} — run an install first.`);
// Atlas connects over SSL by default, which a plain local database refuses.
const pushUrl = DATABASE_URL.includes("sslmode=") ? DATABASE_URL : `${DATABASE_URL}?sslmode=disable`;
// spawnSync rather than execa: this script runs from `tooling/scripts/`, which has no
// package.json of its own, so a pnpm-isolated dependency would not resolve.
const push = spawnSync(
    "npx",
    ["tsx", pluginCli, "db", "push", "--collections", "../config/collections", "--yes"],
    {
        cwd: path.join(projectRoot, "backend"),
        env: { ...process.env, DATABASE_URL: pushUrl },
        encoding: "utf8"
    }
);
check("rebase db push completed", push.status === 0,
    push.status === 0
        ? DATABASE_URL.replace(/:[^:@/]*@/, ":***@")
        : (push.stderr || push.stdout || "").split("\n").filter(Boolean).slice(-3).join(" / "));
if (push.status !== 0) process.exit(1);

// ── Boot the runtime on the bundle, as the container does ────────────────────
console.log("\n[1m▸ Booting the runtime on the bundle[0m");
// A bundle ships a package.json and no node_modules; the container installs them
// into /bundle on first start and `rebase start` links installed ones in.
const bundleModules = path.join(outDir, "node_modules");
if (!fs.existsSync(bundleModules)) {
    fs.symlinkSync(path.join(projectRoot, "backend", "node_modules"), bundleModules);
}

process.env.DATABASE_URL = DATABASE_URL;
process.env.JWT_SECRET ??= "acceptance-test-jwt-secret-at-least-32-chars";
process.env.REBASE_SERVICE_KEY ??= "acceptance-test-service-key-at-least-32-ch";
process.env.NODE_ENV = "development";
process.env.REBASE_SERVE_STATIC = "true";
process.env.PORT = "0";

const { bootFromBundle } = await import(`${ROOT}/packages/server/src/boot/boot.ts`);
const booted = await bootFromBundle({ bundleDir: outDir, listen: false, handleSignals: false });

check("runtime loaded both static apps", booted.bundle.staticApps.length === 2,
    booted.bundle.staticApps.map((a: { path: string }) => a.path).join(", "));
check("mount order is longest-path-first", booted.bundle.staticApps[0].path === "/admin");

const get = async (url: string, headers: Record<string, string> = {}) => {
    const res = await booted.app.fetch(new Request(`http://localhost${url}`, { headers }));
    return { status: res.status,
body: await res.text() };
};
const asService = { authorization: `Bearer ${process.env.REBASE_SERVICE_KEY}` };

// ── What a browser would actually receive ────────────────────────────────────
console.log("\n[1m▸ Fetching, as a browser would[0m");
check("GET /", (await get("/")).body.includes("SITE_INDEX"), "the site");
check("GET /admin", (await get("/admin")).body.includes("ADMIN_INDEX"), "the admin");
check("GET /admin/assets/app.js", (await get("/admin/assets/app.js")).body.includes("ADMIN_ASSET"),
    "the ADMIN build, not the site's");
check("GET /assets/app.js", (await get("/assets/app.js")).body.includes("SITE_ASSET"), "the SITE build");

// The one that fails quietly if mount order OR sibling exclusion is wrong.
const deep = await get("/admin/collections/posts");
check("GET /admin/collections/posts", deep.body.includes("ADMIN_INDEX") && !deep.body.includes("SITE_INDEX"),
    "the admin's index — NOT the site's under the admin's URL");

check("GET /health", (await get("/health")).status === 200, "not swallowed by the SPA fallback");
check("GET /api/data/posts unauthenticated", (await get("/api/data/posts?limit=1")).status === 401);

// "The admin lists collections": the data API reading the tables push created,
// out of the same process that just served the SPA.
const posts = await get("/api/data/posts?limit=1", asService);
let rows: unknown;
try { rows = JSON.parse(posts.body).data; } catch { /* reported by the check */ }
check("GET /api/data/posts as a service", posts.status === 200 && Array.isArray(rows),
    `${posts.status} ${posts.body.slice(0, 70)}`);
check("GET /api/data/authors as a service", (await get("/api/data/authors?limit=1", asService)).status === 200,
    "so it is not one lucky table");

await booted.shutdown().catch(() => {});
fs.rmSync(stubs, { recursive: true, force: true });

console.log(failures === 0
    ? "\n[32m✓ Self-host acceptance passed.[0m\n"
    : `\n[31m✗ ${failures} check(s) failed.[0m\n`);
process.exit(failures === 0 ? 0 : 1);
