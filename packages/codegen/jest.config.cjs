/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
    // At most four workers, whatever the core count. Jest's default is one
    // per core minus one — ten on a laptop, each holding its own module
    // graph — and several suites run at once took a 32 GB machine down.
    // A CI runner has four cores, so its default (three) is under this cap
    // and unchanged; an explicit --maxWorkers still wins.
    maxWorkers: 4,
    preset: "ts-jest",
    testEnvironment: "node",
    testMatch: [
        "**/test/**/*.test.ts",
        "**/src/**/*.test.ts"
    ],
    moduleNameMapper: {
        "^@rebasepro/([a-z0-9-]+)$": "<rootDir>/../$1/src/index.ts"
    }
};
