/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    testMatch: [
        "**/__tests__/**/*.test.ts",
        "**/src/**/*.test.ts",
        "**/test/**/*.test.ts"
    ],
    moduleNameMapper: {
        "^@rebasepro/client$": "<rootDir>/../client/src/index.ts",
        "^@rebasepro/common$": "<rootDir>/../common/src/index.ts",
        "^@rebasepro/types$": "<rootDir>/../types/src/index.ts",
        "^@rebasepro/utils$": "<rootDir>/../utils/src/index.ts",
        "^@rebasepro/server-core$": "<rootDir>/../server-core/src/index.ts",
        "^(\\.{1,2}/.*)\\.js$": "$1"
    },
    // mongodb-memory-server needs more time to start
    testTimeout: 30000
};
