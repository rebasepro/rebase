#!/usr/bin/env node
/**
 * A ratchet over type errors in test files, per package.
 *
 * `pnpm typecheck` reads the test directories listed in `tsconfig.tests.json`,
 * and only those: a package earns its line by having no errors. The rest carry
 * debt — measured on 2026-08-08 and written into that file's `//scope` — and
 * nothing counted it after that. Two months later server's tests had gone from
 * 165 errors to 275 and cli's from 11 to 23, and among them were fixtures
 * describing shapes the types do not have: 83 `relationName`s on a relation
 * property (it lives on the relation) and 42 `idField`s on a collection (no
 * such field). A test that agrees with the code on a fiction proves nothing.
 *
 * So every package's tests (`test/`, `__tests__/`, and `*.test.ts(x)` beside
 * the source) are typechecked in one program built on `tsconfig.tests.json`,
 * the errors are counted per package, and the counts are pinned in
 * tooling/scripts/test-types-baseline.json. A count that grows fails. A count
 * that shrinks also fails until it is banked, so the room a cleanup made is not
 * spent by the next fixture.
 *
 *     pnpm check:test-types            # verify
 *     pnpm check:test-types --update   # bank the current counts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE = path.join(ROOT, "tooling", "scripts", "test-types-baseline.json");

/** The program: every package's tests, on the settings the gated half uses. */
export function programConfig(root) {
    return {
        extends: path.join(root, "tsconfig.tests.json"),
        compilerOptions: { noEmit: true },
        include: [
            "packages/*/test",
            "packages/*/__tests__",
            "packages/*/src/**/*.test.ts",
            "packages/*/src/**/*.test.tsx",
            "packages/*/src/**/__tests__"
        ].map((glob) => path.join(root, glob)),
        exclude: [
            "**/node_modules",
            "**/dist"
        ].map((glob) => (glob.startsWith("**") ? glob : path.join(root, glob)))
    };
}

/** `{ "<package>": n }` from tsc's output; errors outside `packages/` go under "(other)". */
export function countErrors(output, root) {
    const counts = {};
    for (const line of output.split("\n")) {
        const match = line.match(/^(.+?)\(\d+,\d+\): error TS\d+:/);
        if (!match) continue;
        const rel = path.relative(root, path.resolve(root, match[1])).split(path.sep).join("/");
        const pkg = rel.match(/^packages\/([^/]+)\//)?.[1] ?? "(other)";
        counts[pkg] = (counts[pkg] ?? 0) + 1;
    }
    return Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]));
}

/** Packages whose count grew, and whose count shrank, against the baseline. */
export function compare(found, baseline) {
    const grown = [];
    const shrunk = [];
    for (const pkg of [...new Set([...Object.keys(found), ...Object.keys(baseline)])].sort()) {
        const was = baseline[pkg] ?? 0;
        const now = found[pkg] ?? 0;
        if (now > was) grown.push({ pkg, was, now });
        if (now < was) shrunk.push({ pkg, was, now });
    }
    return { grown, shrunk };
}

function main() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-test-types-"));
    const config = path.join(dir, "tsconfig.json");
    fs.writeFileSync(config, JSON.stringify(programConfig(ROOT), null, 2));
    const tsc = path.join(ROOT, "node_modules", ".bin", "tsc");
    const run = spawnSync(tsc, ["-p", config, "--pretty", "false"], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=8192`.trim() }
    });
    fs.rmSync(dir, { recursive: true, force: true });

    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    // 0: no errors. 2: errors, and output was produced. Anything else (1 is a
    // config or command-line error, null a crash) means the count is not real.
    if (run.status !== 0 && run.status !== 2) {
        console.error(`✗ tsc did not run (status ${run.status}):\n${output.slice(0, 4000)}`);
        process.exit(1);
    }
    const found = countErrors(output, ROOT);

    if (process.argv.includes("--update")) {
        fs.writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
        const total = Object.values(found).reduce((a, b) => a + b, 0);
        console.log(`✓ Banked ${total} test type error(s) across ${Object.keys(found).length} package(s).`);
        return;
    }
    if (!fs.existsSync(BASELINE)) {
        console.error(`✗ No baseline at ${path.relative(ROOT, BASELINE)}. Create it with: pnpm check:test-types --update`);
        process.exit(1);
    }
    const { grown, shrunk } = compare(found, JSON.parse(fs.readFileSync(BASELINE, "utf8")));
    if (grown.length === 0 && shrunk.length === 0) {
        const total = Object.values(found).reduce((a, b) => a + b, 0);
        console.log(`✓ Test type errors unchanged from the baseline (${total}).`);
        return;
    }
    for (const { pkg, was, now } of grown) console.error(`✗ ${pkg}: ${was} → ${now} type error(s) in tests`);
    if (grown.length > 0) {
        const grownPackages = new Set(grown.map((g) => g.pkg));
        const lines = output.split("\n").filter((line) => {
            const pkg = line.match(/^packages\/([^/]+)\//)?.[1];
            return pkg && grownPackages.has(pkg) && /error TS\d+/.test(line);
        });
        console.error(`\n  The errors in ${[...grownPackages].join(", ")} (the new ones are among them):\n`);
        for (const line of lines.slice(0, 60)) console.error(`    ${line}`);
        if (lines.length > 60) console.error(`    …and ${lines.length - 60} more`);
        console.error(`
  A test fixture that does not typecheck often describes a shape the code does
  not have, and then the test and the code agree on a fiction. Fix the types.`);
    }
    for (const { pkg, was, now } of shrunk) console.error(`✓ ${pkg}: ${was} → ${now} type error(s) in tests`);
    if (shrunk.length > 0) {
        console.error("\n  Fewer errors — bank them so the room is not spent again: pnpm check:test-types --update");
    }
    process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
