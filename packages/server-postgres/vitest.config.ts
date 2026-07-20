/**
 * Default vitest config — a guard, not a second test suite.
 *
 * This package splits its tests across two runners by directory:
 *
 *   test/*.ts      → jest    (jest.config.cjs)      `pnpm test`
 *   test/e2e/**    → vitest  (vitest.e2e.config.ts) `pnpm test:e2e`
 *
 * Without this file, a bare `npx vitest` falls back to `vite.config.ts` (which
 * has no `test` key) and therefore globs the *whole* package with vitest's
 * default include — hoovering up the jest unit tests and failing them with a
 * bare `ReferenceError: describe is not defined` / `jest is not defined`. That
 * reads like the tests are broken or dead when they are neither: they pass, and
 * they run in CI via `pnpm test`.
 *
 * So this config does two things:
 *   1. Scopes vitest to its actual half of the split, by reusing the e2e config
 *      — which stays the single source of truth for e2e settings.
 *   2. Fails loudly with a pointer when someone aims vitest at a jest file.
 */
import { readdirSync } from "fs";
import { join } from "path";

import e2eConfig from "./vitest.e2e.config";

// Vitest treats positional args as *substring* filters on the file path, so
// `vitest run auth-services` is as likely as a full path. Match both against
// the real unit-test filenames rather than guessing at a path shape.
const unitTests = readdirSync(join(__dirname, "test"), { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.test\.tsx?$/.test(entry.name))
    .map(entry => `test/${entry.name}`);

// `related` is both a vitest subcommand and a substring of an actual unit test
// (related-rows-identity.test.ts), so the subcommand slot must be skipped
// before any matching — otherwise `vitest related` would trip its own guard.
const SUBCOMMANDS = new Set(["run", "watch", "dev", "related", "bench", "typecheck", "list", "init"]);
const argv = process.argv.slice(2);
const filters = (SUBCOMMANDS.has(argv[0]) ? argv.slice(1) : argv).filter(arg => !arg.startsWith("-"));

const misdirected = filters.flatMap(filter => unitTests.filter(unitTest => unitTest.includes(filter)));

if (misdirected.length > 0) {
    const unique = [...new Set(misdirected)];
    throw new Error(
        `\n\n  ${unique.join(", ")} ${unique.length > 1 ? "are jest unit tests" : "is a jest unit test"}, not a vitest test.\n\n` +
        "  This package runs two test runners:\n" +
        "    test/*.ts    → jest    — run with `pnpm test`\n" +
        "    test/e2e/**  → vitest  — run with `pnpm test:e2e`\n\n" +
        `  To run just this file:  npx jest ${unique[0]}\n`
    );
}

export default e2eConfig;
