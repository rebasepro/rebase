/**
 * Mirror repository-root documents into the docs site.
 *
 * These files are authored at the repo root because that is where they are
 * referenced from — `CONTRIBUTING.md` links `docs/compatibility.md`,
 * `contracts/derived-names.txt` cites "contract 6" in it, and several audits
 * cite it by line number. Copying rather than moving keeps those references
 * working while still publishing the content, and `pnpm run check:generated`
 * diffs the copies so the two cannot drift.
 *
 * Adding a document here means adding its destination to `check:generated` in
 * the root `package.json`, or the mirror is generated but never gated.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOCUMENTS = [
    {
        source: "../../CHANGELOG.md",
        dest: "../src/content/docs/docs/CHANGELOG.md",
        // Starlight renders the frontmatter title as the page heading. The
        // changelog keeps its own `# Changelog` for historical reasons; a new
        // mirror should drop the H1 rather than render two.
        stripH1: false,
        frontmatter: `---
slug: docs/changelog
title: Changelog
description: Every released change to Rebase — new features, fixes, and the breaking changes each version asks you to migrate.
---
`
    },
    {
        source: "../../docs/compatibility.md",
        dest: "../src/content/docs/docs/compatibility.md",
        stripH1: true,
        frontmatter: `---
slug: docs/compatibility
title: Compatibility
description: What Rebase promises across versions and what it does not — the six versioned contracts, how each one fails, and what may still change in a minor.
---

`
    }
];

let failed = false;

for (const doc of DOCUMENTS) {
    const sourceFile = path.resolve(__dirname, doc.source);
    const destFile = path.resolve(__dirname, doc.dest);

    if (!fs.existsSync(sourceFile)) {
        console.error(`Source file not found: ${sourceFile}`);
        failed = true;
        continue;
    }

    let content = fs.readFileSync(sourceFile, "utf-8");
    if (doc.stripH1 && content.startsWith("# ")) {
        content = content.slice(content.indexOf("\n") + 1).replace(/^\n+/, "");
    }

    fs.writeFileSync(destFile, doc.frontmatter + content, "utf-8");
    console.log(`✓ Mirrored ${path.basename(sourceFile)} → ${path.relative(process.cwd(), destFile)}`);
}

if (failed) process.exit(1);
