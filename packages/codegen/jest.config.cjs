/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
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
