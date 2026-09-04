/**
 * Browser guard — proves an app that installs the SDK gets no server framework.
 *
 * The mirror of `check:headless`. That one asks "does the backend reach React?".
 * This one asks the other half, which nothing checked: **does the browser reach
 * the server's dependencies?**
 *
 * It did. `@rebasepro/types` carried `"peerDependencies": { "hono": "^4.12.27" }`
 * because of one line — `import type { Hono } from "hono"` in `auth_adapter.ts`,
 * used by two optional adapter methods a browser can never call. npm ≥7 and
 * pnpm ≥8 auto-install peers, so every browser app that ran
 * `npm install @rebasepro/client` got a 2.8 MB server framework in its
 * node_modules, its lockfile and its security scanners:
 *
 *     $ npm explain hono
 *     hono@4.13.5 peer
 *       peer hono@"^4.12.27" from @rebasepro/types@0.17.3
 *         @rebasepro/types@"0.17.3" from @rebasepro/client@0.17.3
 *
 * `docs/MODULAR-ARCHITECTURE.md` promises "@rebasepro/client is isomorphic with
 * zero UI dependencies" and that types is "the BaaS contract". The contract had
 * a hono hole one package over from where every existing guard looked.
 *
 * This is a static check on manifests rather than an install, so it is fast
 * enough to run on every PR. It walks the workspace dependency closure of each
 * browser-facing entry package and fails on a declared dependency — runtime or
 * peer — that has no business in a browser.
 *
 * Run: pnpm run check:browser-deps
 */
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const repoRoot = path.resolve(here, "..", "..", "..");
const packagesDir = path.join(repoRoot, "packages");

/**
 * The packages an app installs to talk to a Rebase backend from a browser or an
 * isomorphic runtime. Everything they pull in transitively is in scope.
 */
const BROWSER_ENTRY_POINTS = ["@rebasepro/client"];

/**
 * Things a browser bundle must never be made to install.
 *
 * Server frameworks and Node-only drivers. Deliberately NOT a general "is this
 * heavy" list: React is legitimate for the admin packages, and this guard does
 * not walk those.
 */
const SERVER_ONLY = new Set([
    "hono", "@hono/node-server",
    "express", "fastify", "koa",
    "pg", "postgres", "mysql2", "mongodb", "drizzle-orm",
    "ws", "jsonwebtoken", "bcrypt", "bcryptjs",
    "nodemailer", "@aws-sdk/client-s3", "@google-cloud/storage",
    "ts-morph", "typescript"
]);

const manifests = new Map();
for (const dir of fs.readdirSync(packagesDir)) {
    const file = path.join(packagesDir, dir, "package.json");
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    if (pkg.name) manifests.set(pkg.name, { pkg, dir: `packages/${dir}` });
}

const findings = [];
const visited = new Set();

/** Walk one package, then every workspace package it depends on. */
function walk(name, trail) {
    if (visited.has(name)) return;
    visited.add(name);

    const entry = manifests.get(name);
    if (!entry) return;                      // third-party leaf; its own deps are its business
    const { pkg, dir } = entry;

    // `peerDependencies` matter as much as `dependencies`: a modern npm or pnpm
    // installs them automatically, which is exactly how hono arrived.
    for (const field of ["dependencies", "peerDependencies"]) {
        for (const dep of Object.keys(pkg[field] ?? {})) {
            const optional = pkg.peerDependenciesMeta?.[dep]?.optional === true;
            if (SERVER_ONLY.has(dep) && !(field === "peerDependencies" && optional)) {
                findings.push(
                    `${name} declares ${field.replace("Dependencies", "")} dependency on "${dep}"\n      `
                    + `${dir} — reached from ${trail.join(" -> ")}.\n      `
                    + (field === "peerDependencies"
                        ? "A peer is auto-installed by npm >=7 and pnpm >=8, so it lands in the app's\n      "
                          + "node_modules and lockfile. If it exists only for a type, make the type\n      "
                          + "structural; if it is genuinely optional, mark it so in peerDependenciesMeta."
                        : "A browser app installing the SDK would install this.")
                );
            }
            if (manifests.has(dep)) walk(dep, [...trail, dep]);
        }
    }
}

for (const entryPoint of BROWSER_ENTRY_POINTS) {
    if (!manifests.has(entryPoint)) {
        console.error(`✗ ${entryPoint} is not a workspace package — this guard is checking nothing.`);
        process.exit(2);
    }
    walk(entryPoint, [entryPoint]);
}

if (findings.length > 0) {
    console.error("\n✗ Server-only packages reachable from the browser SDK:\n");
    for (const f of findings) console.error(`  ✗ ${f}\n`);
    process.exit(1);
}

console.log(`✓ Browser guard passed — ${visited.size} package(s) in the SDK's install closure, `
    + "none declaring a server framework or driver.");
