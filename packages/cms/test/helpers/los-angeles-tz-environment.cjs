/**
 * jsdom, with the host zone set to America/Los_Angeles — west of Greenwich, the
 * side where a stored date-only 15th used to show as the 14th.
 *
 * See tooling/scripts/jest/zone-environment.cjs for why a test file cannot set
 * `TZ` itself. Opt a file in with a docblock at its top:
 *
 *     /** @jest-environment ./test/helpers/los-angeles-tz-environment.cjs *\/
 */
const fs = require("node:fs");
const path = require("node:path");
const { pinZone } = require("../../../../tooling/scripts/jest/zone-environment.cjs");

// From Jest's own install, which is where `testEnvironment: "jsdom"` resolves
// for this package: it declares `jest` and not the environment, so the two
// must not be allowed to become different copies.
const jestDir = fs.realpathSync(path.dirname(require.resolve("jest/package.json")));
const { TestEnvironment } = require(require.resolve("jest-environment-jsdom", { paths: [jestDir] }));

module.exports = pinZone(TestEnvironment, "America/Los_Angeles");
