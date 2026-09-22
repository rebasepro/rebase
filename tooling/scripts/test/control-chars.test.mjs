/**
 * Tests for `check-control-chars.mjs`.
 *
 * The gate exists because grep skips a file containing a NUL in silence. It
 * read a fixed list of extensions, and the list left out `.mts` (the gate
 * scripts themselves, `rls-scan.mts` among them), `.sh`, Terraform (`.tf`,
 * `.tpl`), `.txt` — the committed API-surface contracts — and `.svg`. A NUL in
 * any of those was the exact failure the gate was written for, unchecked.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isScanned } from "../check-control-chars.mjs";

test("every text source a human writes and greps is scanned", () => {
    for (const rel of [
        "tooling/scripts/rls-scan.mts",
        "tooling/scripts/release.sh",
        "infra/terraform/main.tf",
        "infra/terraform/templates/startup.tpl",
        "contracts/server.api.txt",
        "website/public/logo.svg",
        "packages/cli/templates/template/.env.example",
        "packages/server/src/index.ts",
        "docs/gates.md"
    ]) {
        assert.ok(isScanned(rel), rel);
    }
});

test("binary assets are not", () => {
    for (const rel of ["website/public/hero.png", "website/public/intro.mp4", "website/public/font.woff2"]) {
        assert.ok(!isScanned(rel), rel);
    }
});
