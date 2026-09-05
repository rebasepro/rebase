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
 * ## No tarball ships its tests
 *
 * Most packages here declare `files: ["dist", "src"]` and ship their sources
 * alongside the build, which is deliberate — it makes stack traces and
 * go-to-definition work for anyone who installs them. What was not deliberate
 * is what rides along: seven packages co-locate their tests beside the code as
 * `src/**\/*.test.ts`, so `src` swept them into the tarball. `@rebasepro/client`
 * shipped twenty-seven test files to npm, more than half of what it published.
 *
 * The reason this is a check and not a note is that it is invisible from the
 * repository. Nothing in the working tree looks wrong; the difference between a
 * package that ships its tests and one that does not is where the author
 * happened to put them — `packages/app` was clean only because its tests live
 * in `test/` rather than `src/`. Two packages with identical intent, different
 * output, and no signal either way until someone unpacks a tarball.
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

if (licenceProblems.length > 0) {
    console.error("");
    console.error(`✗ ${licenceProblems.length} package(s) would publish without the project's licence:`);
    for (const p of licenceProblems) console.error(`    ${p}`);
    console.error("");
    console.error("  `\"license\": \"MIT\"` in a manifest is a claim; the LICENSE file is the grant.");
    console.error("  Fix: cp LICENSE <package>/LICENSE");
    console.error("");
}

if (shippingTests.length > 0 || licenceProblems.length > 0) process.exit(1);

console.log(`✓ ${checked} publishable package(s): none shipping tests, all carrying the project licence.`);
