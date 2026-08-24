#!/usr/bin/env node
// ============================================================
// prepare-changelog.mjs — stamp the release version into the changelog
//
//   node tooling/scripts/prepare-changelog.mjs <version>
//
// Single source of truth for changelog version handling, called by both
// tooling/scripts/release.sh and .github/workflows/publish.yml so the two
// release paths never diverge. It:
//
//   1. Promotes the "## [Unreleased]" section to "## [<version>] - <date>"
//      (the normal path — developers only ever maintain [Unreleased]).
//   2. Falls back to date-stamping a pre-written bare "## [<version>]".
//   3. Is a no-op if "## [<version>] - <date>" is already present (safe reruns).
//   4. Always leaves a fresh empty "## [Unreleased]" at the top for the next cycle.
//   5. Mirrors the result into the docs site changelog (kept in sync automatically).
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
    console.error("Usage: node tooling/scripts/prepare-changelog.mjs <version>  (e.g. 0.9.0)");
    process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT_CHANGELOG = path.join(ROOT, "CHANGELOG.md");
const DOCS_CHANGELOG = path.join(ROOT, "website/src/content/docs/docs/CHANGELOG.md");
const DOCS_FRONTMATTER = "---\nslug: docs/changelog\ntitle: Changelog\n---\n";

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const unreleasedRe = /^## \[Unreleased\][ \t]*$/m;
const datedVersionRe = new RegExp(`^## \\[${esc(version)}\\] - \\d{4}-\\d{2}-\\d{2}[ \\t]*$`, "m");
const bareVersionRe = new RegExp(`^## \\[${esc(version)}\\][ \\t]*$`, "m");

let text = fs.readFileSync(ROOT_CHANGELOG, "utf8");

if (datedVersionRe.test(text)) {
    console.log(`✓ CHANGELOG already has a dated [${version}] section — leaving as-is.`);
} else if (unreleasedRe.test(text)) {
    text = text.replace(unreleasedRe, `## [Unreleased]\n\n## [${version}] - ${today}`);
    console.log(`✓ Promoted [Unreleased] → [${version}] - ${today}.`);
} else if (bareVersionRe.test(text)) {
    text = text.replace(bareVersionRe, `## [${version}] - ${today}`);
    console.log(`✓ Dated existing [${version}] section → ${today}.`);
} else {
    console.error(
        `✗ No "## [Unreleased]" or "## [${version}]" section found in CHANGELOG.md.\n` +
        `  Add your release notes under "## [Unreleased]" before releasing.`
    );
    process.exit(1);
}

// Always ensure a fresh [Unreleased] exists at the top for the next cycle.
if (!unreleasedRe.test(text)) {
    text = text.replace(/^# Changelog\n+/, "# Changelog\n\n## [Unreleased]\n\n");
    console.log("✓ Opened a fresh [Unreleased] section.");
}

fs.writeFileSync(ROOT_CHANGELOG, text);

// Keep the docs-site changelog in lockstep (frontmatter + root body).
fs.writeFileSync(DOCS_CHANGELOG, DOCS_FRONTMATTER + text);
console.log("✓ Synced docs changelog mirror.");
