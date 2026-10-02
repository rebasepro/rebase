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
 * ## Optional peers: installed, or declined in writing
 *
 * An optional peer (`peerDependenciesMeta.optional`) is a driver the server
 * loads only when a project turns the feature on — S3, SMTP, Google sign-in,
 * the schema editor. Leaving one out of the image can be right: GCS is reached
 * over its S3 API, and `sharp` is native. So this used to report every absent
 * optional peer as "absent by choice" and pass.
 *
 * Nobody had chosen two of them. `google-auth-library` was missing, so Google
 * sign-in failed on every managed tenant ("Invalid google credentials"), and
 * `ts-morph` was missing, so live schema editing did not work on the one
 * deployment the docs say it works on. The gate printed both by name, under a
 * heading that called them a decision, and passed.
 *
 * Now a choice has to be written down. The Dockerfile names each optional peer
 * it leaves out on a `not-in-image: <package> — <reason>` comment line, and
 * this fails on any optional peer that is neither installed nor declined there.
 * It also fails on a declined package the image installs anyway, or that no
 * provided package asks for any more, so the list cannot rot into a list of
 * things that were once true.
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

/** Third-party packages a Dockerfile installs, mapped to the range it installs. */
export function installedInImage(dockerfile) {
    return new Map([...dockerfile.matchAll(/"([@\w/.-]+)@([^"]+)"/g)].map((m) => [m[1], m[2]]));
}

/**
 * The optional peers a Dockerfile declines, mapped to the reason it gives.
 *
 * One `#   not-in-image: <package> — <reason>` comment line each. A line with
 * no reason does not count: the point of the list is the reason.
 */
export function declinedInImage(dockerfile) {
    return new Map(
        [...dockerfile.matchAll(/^#\s+not-in-image:\s+(\S+)\s+[—-]+\s+(\S.*)$/gm)]
            .map((m) => [m[1], m[2].trim()])
    );
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

/** Every third-party requirement a provided package places on the image. */
function* requirements(pkg, owner) {
    for (const [dep, version] of Object.entries(pkg.dependencies ?? {})) {
        yield { dep, version, owner, optional: false };
    }
    // A peer says "my consumer supplies this". In the image, the image is the
    // consumer, so a required peer is as load-bearing as a dependency.
    const meta = pkg.peerDependenciesMeta ?? {};
    for (const [dep, version] of Object.entries(pkg.peerDependencies ?? {})) {
        yield { dep, version, owner, optional: Boolean(meta[dep]?.optional), peer: true };
    }
    // npm installs these when it can and shrugs when it cannot; so do we.
    for (const [dep, version] of Object.entries(pkg.optionalDependencies ?? {})) {
        yield { dep, version, owner, optional: true };
    }
}

/**
 * Hold a Dockerfile to what the provided packages ask of it.
 *
 * `packages` is `[{ owner, pkg }]`: each provided package's name and parsed
 * package.json. Returns one list per way to be wrong, and `declined` — the
 * absences the Dockerfile accounts for — which are fine.
 */
export function audit(dockerfile, packages) {
    const installed = installedInImage(dockerfile);
    const declinedReasons = declinedInImage(dockerfile);
    const missing = [];
    const mismatched = [];
    const declined = [];
    const undecided = [];
    const optionalPeers = new Set();

    for (const { owner, pkg } of packages) {
        for (const req of requirements(pkg, owner)) {
            // A workspace dependency is another @rebasepro package, copied in wholesale.
            if (String(req.version).startsWith("workspace:")) continue;
            if (req.optional && req.peer) optionalPeers.add(req.dep);
            const have = installed.get(req.dep);
            if (have !== undefined) {
                if (!overlaps(have, req.version)) mismatched.push({ ...req, have });
            } else if (!req.optional) {
                missing.push(req);
            } else if (declinedReasons.has(req.dep)) {
                declined.push({ ...req, reason: declinedReasons.get(req.dep) });
            } else if (req.peer) {
                undecided.push(req);
            }
            // An absent optionalDependency is npm's own shrug, not a feature.
        }
    }

    // A declined package the image installs anyway, or that nothing asks for
    // any more: either way the line has stopped being true.
    const staleDeclines = [...declinedReasons.keys()]
        .filter((dep) => installed.has(dep) || !optionalPeers.has(dep))
        .map((dep) => ({ dep, installed: installed.has(dep) }));

    return { missing, mismatched, declined, undecided, staleDeclines };
}

/** This repository's runtime-provided packages, as `audit` takes them. */
export function providedPackages() {
    const packages = [];
    for (const name of runtimeProvided()) {
        try {
            packages.push({ owner: `@rebasepro/${name}`, pkg: JSON.parse(read(`packages/${name}/package.json`)) });
        } catch {
            // a provided name with no package here (hono, tsx) is third-party already
        }
    }
    return packages;
}

/** This repository's image definition. */
export const imageDockerfile = () => read("infra/docker/server.Dockerfile");

function main() {
    const { missing, mismatched, declined, undecided, staleDeclines } =
        audit(imageDockerfile(), providedPackages());

    if (declined.length) {
        console.log("  note — optional peers the image declines (the feature is unavailable on the managed runtime):");
        for (const d of declined) console.log(`    ${d.dep}@${d.version}  (${d.owner}) — ${d.reason}`);
        console.log("");
    }

    if (!missing.length && !mismatched.length && !undecided.length && !staleDeclines.length) {
        console.log("✓ every runtime-provided package's dependencies are installed in the image, at a compatible version,");
        console.log("  and every optional peer it leaves out is declined with a reason.");
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

    if (undecided.length) {
        console.error("✗ optional peers the image neither installs nor declines:\n");
        for (const u of undecided) {
            console.error(`    ${u.dep}@${u.version}  — optional peer of ${u.owner}`);
        }
        console.error(`
  The server loads these with \`await import()\` when a project turns the feature
  on, and it resolves them from the image — a project adding one to its own
  dependencies does not reach the server. Absent, the feature fails on every
  managed tenant, and only when someone uses it. That is how Google sign-in
  and live schema editing were broken while this gate passed.

  Either install it in infra/docker/server.Dockerfile, or decline it there with
  a line saying why:
      #   not-in-image: <package> — <why the managed runtime goes without it>
`);
    }

    if (staleDeclines.length) {
        console.error("✗ not-in-image lines that are no longer true:\n");
        for (const s of staleDeclines) {
            console.error(s.installed
                ? `    ${s.dep}  — declined, but the image installs it`
                : `    ${s.dep}  — declined, but no runtime-provided package has it as an optional peer`);
        }
        console.error(`
  Remove the line from infra/docker/server.Dockerfile, so the list of things the
  managed runtime goes without stays a list of things it actually goes without.
`);
    }
    process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
