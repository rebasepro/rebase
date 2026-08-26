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
 *
 * ## Three ways to be missing, not one
 *
 * The first version of this check looked only at `dependencies`, and presence
 * only. Two more shapes fail identically at runtime:
 *
 *  - **A required `peerDependency`.** For a library, a peer says "my consumer
 *    supplies this". Inside the image, the image IS the consumer. `hono` is one
 *    today and happens to be installed; nothing was checking that.
 *  - **A version range that does not overlap.** The image installed
 *    `nodemailer@^6.9.0` while `@rebasepro/server` declares `^9.0.0` — present,
 *    so the presence check passed, and three majors behind the API the code is
 *    written against. `nodemailer` is imported lazily, so it does not fail at
 *    boot: it fails the first time a tenant sends an email, which is the worst
 *    place for it to fail and the last place anyone looks.
 *
 * Optional peers (`peerDependenciesMeta.optional`) are a deliberate choice —
 * S3, GCS, sharp — and are reported as a note, not a failure: not installing
 * them means the feature is absent, which is a product decision, not drift.
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

/** Third-party packages the Dockerfile installs, mapped to the range it installs. */
function installedInImage() {
    const df = read("infra/docker/server.Dockerfile");
    return new Map([...df.matchAll(/"([@\w/.-]+)@([^"]+)"/g)].map((m) => [m[1], m[2]]));
}

/**
 * A range as the half-open interval `[floor, ceiling)` it admits.
 *
 * Deliberately not a semver library: this runs in CI with no install step, and
 * the ranges here are the four npm actually writes — `^x`, `~x`, `>=x`, and a
 * bare pin. Anything it cannot read returns null and is skipped rather than
 * guessed at, because a wrong guess here fails a build for no reason.
 */
function rangeOf(spec) {
    const text = String(spec).trim();
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
    if (!m) return null;
    const [major, minor, patch] = m.slice(1).map(Number);
    const floor = [major, minor, patch];
    if (text.startsWith("^")) return { floor, ceiling: [major + 1, 0, 0] };
    if (text.startsWith("~")) return { floor, ceiling: [major, minor + 1, 0] };
    if (text.startsWith(">")) return { floor, ceiling: [Infinity, 0, 0] };
    return { floor, ceiling: [major, minor, patch + 1] };   // a bare pin
}

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Whether what the image installs can satisfy what the package asks for.
 *
 * Intersection, NOT "is the image's floor high enough" — that was this
 * function's first shape and it reported three false failures immediately.
 * `^4.12.25` resolves to the newest 4.x at build time, so it satisfies a
 * declared `^4.12.27` perfectly well; a floor comparison calls that drift and
 * trains everyone to ignore the gate. What is actually broken is two ranges
 * with no version in common: the image's `^6.9.0` against a declared `^9.0.0`.
 */
function overlaps(installedRange, declaredRange) {
    const a = rangeOf(installedRange), b = rangeOf(declaredRange);
    if (!a || !b) return true;           // unreadable on either side — do not guess
    return cmp(a.floor, b.ceiling) < 0 && cmp(b.floor, a.ceiling) < 0;
}

const installed = installedInImage();
const missing = [];
const mismatched = [];
const optionalAbsent = [];

/** Every third-party requirement a provided package places on the image. */
function* requirements(pkg, owner) {
    for (const [dep, version] of Object.entries(pkg.dependencies ?? {})) {
        yield { dep, version, owner, optional: false };
    }
    // A peer says "my consumer supplies this". In the image, the image is the
    // consumer, so a required peer is as load-bearing as a dependency.
    const meta = pkg.peerDependenciesMeta ?? {};
    for (const [dep, version] of Object.entries(pkg.peerDependencies ?? {})) {
        yield { dep, version, owner, optional: Boolean(meta[dep]?.optional) };
    }
    // npm installs these when it can and shrugs when it cannot; so do we.
    for (const [dep, version] of Object.entries(pkg.optionalDependencies ?? {})) {
        yield { dep, version, owner, optional: true };
    }
}

for (const name of runtimeProvided()) {
    let pkg;
    try {
        pkg = JSON.parse(read(`packages/${name}/package.json`));
    } catch {
        continue;   // a provided name with no package here (hono, tsx) is third-party already
    }
    const owner = `@rebasepro/${name}`;
    for (const req of requirements(pkg, owner)) {
        // A workspace dependency is another @rebasepro package, copied in wholesale.
        if (String(req.version).startsWith("workspace:")) continue;
        const have = installed.get(req.dep);
        if (have === undefined) {
            (req.optional ? optionalAbsent : missing).push(req);
        } else if (!overlaps(have, req.version)) {
            mismatched.push({ ...req, have });
        }
    }
}

if (optionalAbsent.length) {
    console.log("  note — optional, absent by choice (the feature is simply unavailable):");
    for (const m of optionalAbsent) console.log(`    ${m.dep}@${m.version}  (${m.owner})`);
    console.log("");
}

if (missing.length === 0 && mismatched.length === 0) {
    console.log("✓ every runtime-provided package's dependencies are installed in the image, at a compatible version.");
    process.exit(0);
}

if (missing.length) {
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
}

if (mismatched.length) {
    console.error("✗ the image installs a version the package cannot use:\n");
    for (const m of mismatched) {
        console.error(`    ${m.dep}: image has ${m.have}, ${m.owner} declares ${m.version}`);
    }
    console.error(`
  Present, so nothing reports it missing, and a different API than the one the
  code was written and tested against. For a lazily imported package this does
  not fail at boot — it fails the first time that feature is used, in a tenant,
  weeks later.

  Match the range in infra/docker/server.Dockerfile.
`);
}
process.exit(1);
