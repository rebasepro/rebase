/**
 * Tests for `docs-verify/check-endpoint-index.mjs`.
 *
 * Its completeness rule compared paths only, and never looked at the routes it
 * lists by hand because the scan cannot see them. Both passed vacuously, so each
 * test feeds the gate a fixture tree with a real gap in exactly that shape.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkEndpointIndex } from "../docs-verify/check-endpoint-index.mjs";

/** Write `files` (relative path → contents) under a fresh temporary root. */
function fixtureRoot(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-gates-"));
    for (const [file, contents] of Object.entries(files)) {
        fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), contents);
    }
    return root;
}

const ENDPOINT_PAGE = "website/src/content/docs/docs/backend/endpoints.md";

function endpointFixture(rows) {
    return fixtureRoot({
        "packages/server/src/auth/routes.ts":
            "const router = new Hono();\n" +
            "router.get(\"/session\", handler);\n" +
            "router.delete(\"/session\", handler);\n",
        "packages/server/src/api/rest/api-generator.ts":
            "this.router = new Hono();\n" +
            "this.router.get(`${basePath}/count`, handler);\n",
        "packages/server/src/api/rest/query-parser.ts": "const reservedQueryKeys = [\"limit\"];\n",
        [ENDPOINT_PAGE]:
            "| Method | Path | Gate |\n|---|---|---|\n" +
            rows.map(([method, route]) => `| \`${method}\` | \`${route}\` | none |`).join("\n") + "\n"
    });
}

const missingIn = (root) =>
    checkEndpointIndex(root).findings.filter(f => f.kind === "missing").map(f => f.message);

const EVERY_ROW = [
    ["GET", "/api/auth/session"],
    ["DELETE", "/api/auth/session"],
    ["GET", "/api/data/:slug/count"],
    ["GET", "/api/docs"],
    ["GET", "/api/swagger"],
    ["GET", "/api/auth/config"]
];

test("endpoint index: a fully documented surface has nothing missing", () => {
    assert.deepEqual(missingIn(endpointFixture(EVERY_ROW)), []);
});

test("endpoint index: a second method on a documented path is still an endpoint of its own", () => {
    // The path is in the table, under GET. The DELETE on it is not — and the
    // completeness rule compared paths only, so it passed.
    const rows = EVERY_ROW.filter(([method]) => method !== "DELETE");
    assert.deepEqual(missingIn(endpointFixture(rows)), ["DELETE /api/auth/session is mounted and not in the index"]);
});

test("endpoint index: a route the scan cannot see is still required in the table", () => {
    // `EXTRA_ROUTES` were only used to resolve documented rows, never checked for
    // completeness, so `GET /api/auth/config` was undocumented with the gate green.
    const rows = EVERY_ROW.filter(([, route]) => route !== "/api/auth/config");
    assert.deepEqual(missingIn(endpointFixture(rows)), ["GET /api/auth/config is mounted and not in the index"]);
});
