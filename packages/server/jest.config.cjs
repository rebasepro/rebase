/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    // This pattern tells Jest to look for .test.ts files
    testMatch: [
        "**/__tests__/**/*.test.ts",
        "**/src/**/*.test.ts",
        "**/test/**/*.test.ts"
    ],
    // This helps Jest resolve monorepo packages
    moduleNameMapper: {
        "^@rebasepro/client$": "<rootDir>/../client/src/index.ts",
        "^@rebasepro/common$": "<rootDir>/../common/src/index.ts",
        "^@rebasepro/types$": "<rootDir>/../types/src/index.ts",
        "^@rebasepro/utils$": "<rootDir>/../utils/src/index.ts",
        // Only the shipped templates import this, and only for `defineCollection`
        // — see test/stubs/cms-types.ts. The server itself may not depend on it.
        "^@rebasepro/cms-types$": "<rootDir>/test/stubs/cms-types.ts",
        "^(\\.{1,2}/.*)\\.js$": "$1"
    },
    // Many suites here boot a whole backend per test — middlewares, boot-time
    // provisioning, function mounting — which is far more than jest's 5s
    // default was chosen for. Under `pnpm -r test` that budget is shared with
    // the other packages' workers, and files like runtime-surfaces.test.ts
    // failed on `Exceeded timeout of 5000 ms` while passing in ~1.5s alone.
    // A boot is slow work, not a hung test; 30s matches server-mongo, which
    // raised it for the same reason.
    testTimeout: 30000
};
