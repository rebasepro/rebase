#!/usr/bin/env node
/**
 * Every dependency of a runtime-provided package is installed in the image.
 *
 * ## What this catches
 *
 * `packages/cli/src/bundle.ts` keeps a `RUNTIME_PROVIDED` set — packages a
 * project's bundle deliberately does NOT vendor, because the image supplies
 * them. `infra/docker/entrypoint.mjs` carries the same list and stitches the
 * image's copies over the bundle's, and `runtime-provided.test.mjs` already
 * checks those two lists agree.
 *
 * Nothing checked the thing the lists actually promise: that the image's copies
 * WORK. The image builds its `node_modules` from a hand-written `npm install`
 * line, and a hand-written mirror of somebody else's `dependencies` drifts the
 * moment that package gains one.
 *
 * It had drifted three times. `@rebasepro/common` declares `json-logic-js` and
 * `fast-equals`; `@rebasepro/utils` declares `object-hash`; none was installed.
 * On 2026-08-26 that took down a project being promoted to the managed runtime:
 *
 *     Could not load 12 collection file(s) from /bundle/config/collections:
 *       • leads.js: Cannot find package 'json-logic-js'
 *                   imported from /app/node_modules/@rebasepro/common/dist/index.es.js
 *
 * ## Why it stayed hidden
 *
 * Older bundles vendored `@rebasepro/common` themselves — it joined
 * `RUNTIME_PROVIDED` later — so their `/bundle/node_modules` carried a complete
 * copy and resolution never reached the image's broken one. Every tenant built
 * before that change is immune; every bundle built after it is not. The fleet
 * looked healthy because none of it had been rebuilt.
 *
 * That is why this reads both package.json files and the Dockerfile rather than
 * asserting a list: the failure is drift, and only a derived check sees drift.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(path.join(root, p), "utf8");

/** The `@rebasepro/*` packages the image promises to supply, from the source of truth. */
function runtimeProvided() {
    const src = read("packages/cli/src/bundle.ts");
    const block = /const RUNTIME_PROVIDED = new Set\(\[([\s\S]*?)\]\)/.exec(src);
    if (!block) throw new Error("could not find RUNTIME_PROVIDED in packages/cli/src/bundle.ts");
    return [...block[1].matchAll(/"(@rebasepro\/[^"]+)"/g)].map((m) => m[1].replace("@rebasepro/", ""));
}

/** Third-party packages the Dockerfile installs into the runtime's node_modules. */
function installedInImage() {
    const df = read("infra/docker/server.Dockerfile");
    return new Set([...df.matchAll(/"([@\w/.-]+)@[^"]+"/g)].map((m) => m[1]));
}

const installed = installedInImage();
const missing = [];

for (const name of runtimeProvided()) {
    let pkg;
    try {
        pkg = JSON.parse(read(`packages/${name}/package.json`));
    } catch {
        continue;   // a provided name with no package here (hono, tsx) is third-party already
    }
    for (const [dep, version] of Object.entries(pkg.dependencies ?? {})) {
        // A workspace dependency is another @rebasepro package, copied in wholesale.
        if (String(version).startsWith("workspace:")) continue;
        if (!installed.has(dep)) missing.push({ dep, version, owner: `@rebasepro/${name}` });
    }
}

if (missing.length === 0) {
    console.log("✓ every runtime-provided package's dependencies are installed in the image.");
    process.exit(0);
}

console.error("✗ the image promises these packages but cannot load them:\n");
for (const m of missing) {
    console.error(`    ${m.dep}@${m.version}  — required by ${m.owner}`);
}
console.error(`
  These are declared by packages listed in RUNTIME_PROVIDED, so a bundle does not
  vendor them: the image is the only supplier. Missing, the tenant fails at the
  moment the importing code path first runs — at boot for a top-level import, and
  much later for a lazy one.

  Add them to the npm install in infra/docker/server.Dockerfile.
`);
process.exit(1);
