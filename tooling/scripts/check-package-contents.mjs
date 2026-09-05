#!/usr/bin/env node
/**
 * What a published tarball must carry, and what it must not.
 *
 * Two rules, one mechanism. Both ask npm what it *would* pack rather than
 * re-deriving it from `files`, because that field has enough shapes —
 * negations, directories, implicit includes — that a reimplementation would
 * drift from the packer it is supposed to police.
 *
 * ## Every tarball ships the licence
 *
 * Seven published packages had no LICENSE file: client, cms, codegen, mcp,
 * plugin-insights, rls-check and utils. The manifests all said `"license":
 * "MIT"`, and that string is a claim, not a grant — for anyone whose legal
 * review reads tarballs rather than registry metadata, and for every vendored
 * copy that arrives without a registry at all, the licence text is the licence.
 * Two more packages shipped a 2023 copyright line the root had moved past in
 * 2026.
 *
 * So the check is byte equality against the root LICENSE, not mere presence:
 * "a licence file exists" would have passed both of those. `@rebasepro/*` is
 * one project under one licence, and a divergent copy in one package is either
 * a mistake or a decision nobody recorded.
 *
 * `@rebasepro/agent-skills` is included. It lives under `tooling/` rather than
 * `packages/`, which is exactly why it kept falling out of things: this check
 * used to scan one directory, so the one publishable package outside it was
 * invisible here for the same reason it was invisible to four releases.
 *
 * ## No tarball ships `src/`
 *
 * Sixteen packages declared `files: ["dist", "src"]` on the reasoning that
 * shipping sources makes stack traces and go-to-definition work. They already
 * did: every `.map` in `dist` carries full `sourcesContent`, so the sources
 * were in the tarball twice. For `@rebasepro/cms` that second copy was 2.85 MB
 * of a 2.86 MB package — the build was a rounding error next to it.
 *
 * It also brought the tests with it. Seven packages co-locate tests beside the
 * code as `src/**\/*.test.ts`, so `src` swept them in; `@rebasepro/client`
 * published twenty-seven test files, more than half of what it shipped. Six
 * `!src/**` negations per manifest existed to police that, and they are gone
 * with the thing they were policing.
 *
 * The test rule stays, because `files` can grow a `src` again and because a
 * package can name a test path some other way. It is worth keeping for its own
 * sake: tests here are written to explain the defect they pin, at length and by
 * name — which policy shipped anonymous access and for how long, which guard
 * was silently doing nothing. That is the right way to write a regression test
 * and the wrong thing to publish to a registry.
 *
 * Both rules are invisible from the repository, which is why they are checks
 * rather than notes. Nothing in the working tree looks wrong; whether a package
 * publishes its tests depended only on where its author put them —
 * `packages/app` was clean because its tests live in `test/` rather than
 * `src/`. Two packages with identical intent, different output, and no signal
 * either way until someone unpacks a tarball.
 *
 * It matters beyond bloat. Tests in this repository are written to explain the
 * defect they pin, at length and by name: which policy shipped anonymous access
 * and for how long, which guard was silently doing nothing. That is the right
 * way to write a regression test and the wrong thing to publish to a registry.
 *
 * Asks npm what it would pack rather than re-deriving it, because the `files`
 * field has enough shapes — negations, directories, implicit includes — that a
 * reimplementation would drift from the packer it is supposed to police.
 *
 * Run: pnpm run check:package-contents
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

/** A path in a tarball that should not be in a tarball. */
const TEST_PATH = /(^|\/)(__tests__|tests)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

/** Sources, which every `dist/*.map` already carries as `sourcesContent`. */
const SRC_PATH = /^src\//;

/**
 * Every directory that can hold a publishable package.
 *
 * `tooling/` is here because `@rebasepro/agent-skills` lives there. Derived by
 * looking, not enumerated: a `packages/`-only scan is the shape of bug this
 * repository has already paid for twice.
 */
const CANDIDATE_DIRS = ["packages", "tooling"];

const licenceText = fs.readFileSync(path.join(root, "LICENSE"));

const shippingTests = [];
const shippingSources = [];
const licenceProblems = [];
let checked = 0;

for (const parent of CANDIDATE_DIRS) {
    const parentDir = path.join(root, parent);
    if (!fs.existsSync(parentDir)) continue;

    for (const entry of fs.readdirSync(parentDir).sort()) {
        const dir = path.join(parentDir, entry);
        const manifestPath = path.join(dir, "package.json");
        if (!fs.existsSync(manifestPath)) continue;

        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (manifest.private === true) continue;
        const rel = `${parent}/${entry}`;

        let packed;
        try {
            const raw = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
                cwd: dir,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"]
            });
            const parsed = JSON.parse(raw);
            packed = (Array.isArray(parsed) ? parsed : Object.values(parsed))[0].files.map((f) => f.path);
        } catch (err) {
            console.error(`✗ ${manifest.name}: could not ask npm what it would pack — ${err.message}`);
            process.exit(1);
        }

        checked++;

        const bad = packed.filter((f) => TEST_PATH.test(f));
        if (bad.length > 0) shippingTests.push({ name: manifest.name, rel, bad });

        const sources = packed.filter((f) => SRC_PATH.test(f));
        if (sources.length > 0) shippingSources.push({ name: manifest.name, rel, count: sources.length });

        // npm includes a LICENSE regardless of `files`, so a package missing it
        // from the tarball is a package missing it from disk.
        if (!packed.some((f) => /^LICEN[CS]E(\.\w+)?$/i.test(f))) {
            licenceProblems.push(`${manifest.name} (${rel}): no LICENSE in the tarball`);
            continue;
        }
        const own = path.join(dir, "LICENSE");
        if (!fs.existsSync(own) || !fs.readFileSync(own).equals(licenceText)) {
            licenceProblems.push(`${manifest.name} (${rel}): LICENSE differs from the root LICENSE`);
        }
    }
}

if (shippingTests.length > 0) {
    console.error("");
    console.error(`✗ ${shippingTests.length} package(s) would publish test files:`);
    for (const { name, rel, bad } of shippingTests) {
        console.error(`\n  ${name}  (${bad.length} file(s))`);
        for (const f of bad.slice(0, 5)) console.error(`    ${f}`);
        if (bad.length > 5) console.error(`    … and ${bad.length - 5} more`);
        console.error(`    Fix: add the negations to "files" in ${rel}/package.json:`);
        console.error(`      "!src/**/*.test.ts", "!src/**/*.test.tsx", "!src/**/__tests__/**", "!src/tests/**"`);
    }
    console.error("");
}

if (shippingSources.length > 0) {
    console.error("");
    console.error(`✗ ${shippingSources.length} package(s) would publish src/ a second time:`);
    for (const { name, rel, count } of shippingSources) {
        console.error(`    ${name} (${rel}): ${count} file(s) under src/`);
    }
    console.error("");
    console.error("  Every dist/*.map already embeds the full sources as `sourcesContent`, so");
    console.error("  this is a duplicate copy — for @rebasepro/cms it was 2.85 MB of a 2.86 MB");
    console.error("  package. Fix: drop \"src\" from \"files\".");
    console.error("");
}

if (licenceProblems.length > 0) {
    console.error("");
    console.error(`✗ ${licenceProblems.length} package(s) would publish without the project's licence:`);
    for (const p of licenceProblems) console.error(`    ${p}`);
    console.error("");
    console.error("  `\"license\": \"MIT\"` in a manifest is a claim; the LICENSE file is the grant.");
    console.error("  Fix: cp LICENSE <package>/LICENSE");
    console.error("");
}

if (shippingTests.length > 0 || shippingSources.length > 0 || licenceProblems.length > 0) process.exit(1);

console.log(
    `✓ ${checked} publishable package(s): no tests, no duplicated src/, all carrying the project licence.`
);
