/**
 * Every `@ts-expect-error` is in a tsc program, or it asserts nothing.
 *
 * A `@ts-expect-error` is a test written in the type system: it says "the next
 * line does not compile, and if it ever starts compiling, fail". Both halves of
 * that are enforced by `tsc` and by nothing else. Jest and vitest strip types
 * without checking them, so in a file no program reads, the directive is a
 * comment — and worse than a comment, because the file's own docblock usually
 * says "the real value is that tsc validates the @ts-expect-error annotations".
 *
 * `packages/server/test/auth-config-types.test.ts` said exactly that, and was in
 * neither `tsconfig.typecheck.json` (which excludes test files) nor
 * `tsconfig.tests.json` (which lists directories one at a time). Its three
 * directives — the guard against a `[key: string]: unknown` catch-all landing on
 * `RebaseAuthConfig` — had never been evaluated. Eight files were in that state,
 * ten directives between them, and adding them to a program found four that had
 * gone stale (the code they asserted would not compile now compiles), one that
 * was written a line above the error it meant to suppress, and three assertions
 * that were tuple-index errors rather than checks.
 *
 * The include list in `tsconfig.tests.json` is otherwise a hand-maintained
 * ratchet with nothing stopping a line from being deleted to make `pnpm
 * typecheck` green. This is the part of it that cannot be quietly dropped.
 *
 *     pnpm check:ts-expect-error-coverage
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * The tsc programs a gate in this pipeline actually runs.
 *
 * `tsconfig.core.json` (`check:core-types`) is deliberately absent: it is a
 * strict subset of `tsconfig.typecheck.json`, so a file it reads is already
 * covered. A config that no gate runs must not be listed here — that would let
 * a directive count as checked because some file describes a compilation
 * nothing performs, which is the exact failure this gate exists for.
 */
const PROGRAMS = [
    { config: "tsconfig.typecheck.json", gate: "pnpm typecheck" },
    { config: "tsconfig.tests.json", gate: "pnpm typecheck" },
    { config: "tests/e2e/baas-typecheck/tsconfig.json", gate: "pnpm check:baas-types" }
];

const SOURCE_EXTENSIONS = /\.(?:ts|tsx|mts|cts)$/;
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".astro", "build", "coverage"]);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

/** Every TypeScript file in the repository that carries at least one directive. */
function filesWithDirectives() {
    const found = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (SKIP_DIRECTORIES.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!SOURCE_EXTENSIONS.test(entry.name)) continue;
            const source = fs.readFileSync(full, "utf8");
            const count = source.split("@ts-expect-error").length - 1;
            if (count > 0) found.push({ file: full, count });
        }
    };
    walk(ROOT);
    return found.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * The files one program reads, from tsc itself.
 *
 * `--listFilesOnly` resolves the program and stops before checking, which is
 * seconds rather than the minute a full check costs. Nothing short of asking
 * tsc is correct here: a file reaches a program through its `include` globs OR
 * through an import from a file that is included, and only the compiler knows
 * which.
 */
function programFiles({ config, gate }) {
    const result = spawnSync(
        "pnpm",
        ["exec", "tsc", "-p", config, "--noEmit", "--listFilesOnly"],
        { cwd: ROOT, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--max_old_space_size=4096" } }
    );
    if (result.status !== 0) {
        console.error(red(`✗ \`tsc -p ${config} --listFilesOnly\` failed (exit ${result.status}).`));
        console.error(dim(`  ${gate} runs that program; this gate cannot report on it until it loads.\n`));
        console.error(result.stdout ?? "");
        console.error(result.stderr ?? "");
        process.exit(1);
    }
    return (result.stdout ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

const carriers = filesWithDirectives();
const covered = new Set();
for (const program of PROGRAMS) {
    for (const file of programFiles(program)) covered.add(path.resolve(ROOT, file));
}

const inert = carriers.filter(({ file }) => !covered.has(path.resolve(file)));

if (inert.length === 0) {
    const total = carriers.reduce((sum, { count }) => sum + count, 0);
    console.log(green(
        `✓ ${total} @ts-expect-error directive(s) in ${carriers.length} file(s), every file in one of ` +
        `${PROGRAMS.length} tsc programs.`
    ));
    process.exit(0);
}

const inertDirectives = inert.reduce((sum, { count }) => sum + count, 0);
console.error(red(
    `\n✗ ${inertDirectives} @ts-expect-error directive(s) in ${inert.length} file(s) that no tsc program reads.\n`
));
for (const { file, count } of inert) {
    console.error(`  ${bold(path.relative(ROOT, file))} ${dim(`— ${count} directive(s)`)}`);
}
console.error(dim(
    "\n  A directive in a file no program reads is a comment. Jest and vitest strip\n" +
    "  types without checking them, so nothing evaluates it, nothing fails when the\n" +
    "  code it guards starts compiling, and the file usually claims in its own\n" +
    "  docblock that tsc validates it.\n\n" +
    "  Either add the file to `tsconfig.tests.json`'s include list — a line each,\n" +
    "  with the drift it exposes written beside it, the way every line there is —\n" +
    "  or delete the directive and the claim with it.\n\n" +
    `  Programs consulted: ${PROGRAMS.map((p) => p.config).join(", ")}.\n`
));
process.exit(1);
