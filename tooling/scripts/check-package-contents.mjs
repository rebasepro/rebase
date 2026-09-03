#!/usr/bin/env node
/**
 * Fail if a published tarball carries a test file.
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
const packagesDir = path.join(root, "packages");

/** A path in a tarball that should not be in a tarball. */
const TEST_PATH = /(^|\/)(__tests__|tests)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

const offenders = [];
let checked = 0;

for (const entry of fs.readdirSync(packagesDir).sort()) {
    const dir = path.join(packagesDir, entry);
    const manifestPath = path.join(dir, "package.json");
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.private === true) continue;

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
    if (bad.length > 0) offenders.push({ name: manifest.name, entry, bad });
}

if (offenders.length > 0) {
    console.error("");
    console.error(`✗ ${offenders.length} package(s) would publish test files:`);
    for (const { name, entry, bad } of offenders) {
        console.error(`\n  ${name}  (${bad.length} file(s))`);
        for (const f of bad.slice(0, 5)) console.error(`    ${f}`);
        if (bad.length > 5) console.error(`    … and ${bad.length - 5} more`);
        console.error(`    Fix: add the negations to "files" in packages/${entry}/package.json:`);
        console.error(`      "!src/**/*.test.ts", "!src/**/*.test.tsx", "!src/**/__tests__/**", "!src/tests/**"`);
    }
    console.error("");
    process.exit(1);
}

console.log(`✓ ${checked} publishable package(s), none shipping tests.`);
