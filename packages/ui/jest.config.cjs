/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "jsdom",
    setupFilesAfterEnv: ["<rootDir>/test/setupTests.ts"],
    testPathIgnorePatterns: ["/node_modules/", "src/scripts/"],
    moduleNameMapper: {
        // "\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$":
        //     "<rootDir>/__mocks__/fileMock.js",
        "^.+\\.(css|less)$": "<rootDir>/test/__mocks__/styleMock.js",
        // lucide ships its per-icon import table as ESM only.
        "^lucide-react/dynamicIconImports\\.mjs$": "<rootDir>/test/__mocks__/lucideDynamicIconImports.cjs"
    }
};
