/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
    // At most four workers, whatever the core count. Jest's default is one
    // per core minus one — ten on a laptop, each holding its own module
    // graph — and several suites run at once took a 32 GB machine down.
    // A CI runner has four cores, so its default (three) is under this cap
    // and unchanged; an explicit --maxWorkers still wins.
    maxWorkers: 4,
    preset: "ts-jest",
    testEnvironment: "jsdom",
    setupFilesAfterEnv: ["<rootDir>/test/setupTests.ts"],
    testPathIgnorePatterns: ["/node_modules/", "src/scripts/"],
    moduleNameMapper: {
        // "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
        //     "<rootDir>/__mocks__/fileMock.js",
        "^.+\\.(css|less)$": "<rootDir>/test/__mocks__/styleMock.js"
    }
};
