/**
 * Unit-test runner for this package.
 *
 * This package deliberately runs TWO test runners, split by directory:
 *
 *   test/*.ts      → jest    (this config)          `pnpm test`
 *   test/e2e/**    → vitest  (vitest.e2e.config.ts) `pnpm test:e2e`
 *
 * The unit tests use jest's injected globals (`describe`/`it`/`expect`) and
 * `jest.mock`, so they only run under jest — pointing vitest at one yields a
 * bare `ReferenceError: describe is not defined`. `vitest.config.ts` exists to
 * keep that from happening; see the comment there.
 *
 * This lives in a real file rather than a "jest" key in package.json so the
 * split is visible from `ls` alongside the vitest configs.
 *
 * `pnpm test` runs jest with `NODE_OPTIONS=--experimental-vm-modules`, which the
 * PGlite-backed tests need: PGlite reaches for `await import("fs")` while it
 * boots, and jest's VM refuses a dynamic import without that flag
 * (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG`). A bare `npx jest` fails on
 * those suites and on nothing else.
 *
 * CommonJS (.cjs) because the package is "type": "module".
 *
 * @type {import("jest").Config}
 */
module.exports = {
    transform: {
        "^.+\\.tsx?$": "ts-jest"
    },
    testRegex: "(/__tests__/.*|(\\.|/)(test|spec))\\.tsx?$",
    // test/e2e is vitest's half of the split — jest must not collect it.
    testPathIgnorePatterns: [
        "/node_modules/",
        "test/e2e/"
    ],
    moduleFileExtensions: [
        "ts",
        "tsx",
        "js",
        "jsx",
        "json",
        "node"
    ],
    moduleNameMapper: {
        "^chalk$": "<rootDir>/test/mocks/chalk.cjs",
        "^\\.{1,2}/module-dir$": "<rootDir>/test/mocks/module-dir.cjs",
        // Resolve sibling workspace packages to source, not built dist.
        "^@rebasepro/([a-z0-9-]+)$": "<rootDir>/../$1/src/index.ts",
        // Strip the ESM ".js" suffix from relative TS imports.
        "^(\\.{1,2}/.*)\\.js$": "$1"
    }
};
