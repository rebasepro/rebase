/**
 * Tests for `docs-verify/check-error-codes.mjs`.
 *
 * The status check kept the FIRST status it saw for each code and compared the
 * row against that one. A code raised with two statuses — `INVALID_CODE` is 400
 * from the OTP routes and 401 elsewhere — agreed with the table whenever the
 * first call site scanned happened to match it, so both documented statuses of
 * `INVALID_CODE` and `INVALID_TOKEN` were wrong with the gate green.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkErrorCodes } from "../docs-verify/check-error-codes.mjs";

const REFERENCE = "website/src/content/docs/docs/backend/errors.md";

function fixture(rowStatus) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "error-codes-"));
    const files = {
        // Scanned in name order: the 401 call site comes first.
        "packages/server/src/a-mfa.ts": "throw ApiError.unauthorized(\"Wrong code\", \"INVALID_CODE\");\n",
        "packages/server/src/b-otp.ts": "throw new ApiError(400, \"INVALID_CODE\", \"Wrong code\");\n",
        [REFERENCE]: `| Code | Status | Meaning |\n|---|---|---|\n| \`INVALID_CODE\` | ${rowStatus} | The code is wrong. |\n`
    };
    for (const [file, contents] of Object.entries(files)) {
        fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), contents);
    }
    return root;
}

const statusFindings = (root) =>
    checkErrorCodes(root).findings.filter(f => f.code === "INVALID_CODE").map(f => f.message);

test("a code raised with two statuses fails a row that names only the first one scanned", () => {
    const messages = statusFindings(fixture("401"));
    assert.equal(messages.length, 1, `expected one status finding, got ${JSON.stringify(messages)}`);
    assert.match(messages[0], /says 401, the source also raises 400 \(packages\/server\/src\/b-otp\.ts\)/);
});

test("a row naming every status the code is raised with passes", () => {
    assert.deepEqual(statusFindings(fixture("400 / 401")), []);
});

test("a row with a status the source never raises still fails", () => {
    const messages = statusFindings(fixture("400 / 401 / 403"));
    assert.equal(messages.length, 1);
    assert.match(messages[0], /403/);
});
