/**
 * Tests for the edits a release makes to its own docs, and for the gate that
 * judges them.
 *
 * The 0.21.0 cut committed 57 `verify:docs --strict` findings, all of them the
 * cut's own: 50 stale translations, 5 "Since 0.21" badges, a dead `NOT_NEW`
 * exemption and an upgrade guide that never named 0.21. The bump now makes the
 * mechanical edits itself (`release-docs.mjs`) and runs `verify:docs:strict`
 * before it publishes. So each case builds a small tree shaped like a release
 * about to commit, runs the writer, and asks the same checks the gate runs.
 *
 * Run: node --test tooling/scripts/test/release-docs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { releaseDocs } from "../release-docs.mjs";
import {
    checkUnreleasedBadges, dropReleasedBadges, pruneNotNew, removeBadges
} from "../docs-verify/check-unreleased-badges.mjs";
import {
    checkTranslationFreshness, sourceHash, CONTENT, LOCALES
} from "../docs-verify/check-translation-freshness.mjs";
import { checkVersionPins } from "../docs-verify/check-version-pins.mjs";
import { checkUpgradeCoverage } from "../docs-verify/check-upgrade-coverage.mjs";

const PAGE = "docs/cli/index.md";
const at = (locale) => (locale === "en" ? `${CONTENT}/${PAGE}` : `${CONTENT}/${locale}/${PAGE}`);
const badge = (v) => `<span class="since-badge" data-since="${v}">Since ${v}</span>`;

/** A changelog as `prepare-changelog.mjs` leaves it: the release stamped, `[Unreleased]` empty. */
const STAMPED = `# Changelog

## [Unreleased]

## [0.21.0] - 2026-09-14

### Added

- **\`rebase cloud db connect\` opens a tunnel to a managed database.**

## [0.20.0] - 2026-09-01

### Fixed

- **A fix.**
`;

/** The English page: a badge on its own line, one opening a line, one mid-line. */
const english = (v = "0.21") => `---
title: CLI
---

## Database

${badge(v)}

Opens a tunnel.
${badge(v)} \`--reveal\` adds the password.

## Cloud

The host resolves to nothing. ${badge(v)} \`rebase cloud db connect\` opens a local port.
`;

/** A translation of `en`, stamped fresh against it, with its badges as given. */
const translation = (en, body) => `---\nsourceHash: ${sourceHash(en)}\ntitle: CLI\n---\n${body}`;
const german = (v = "0.21") => `
## Datenbank

${badge(v)}

Öffnet einen Tunnel.
${badge(v)} \`--reveal\` fügt das Passwort hinzu.

## Cloud

Der Host löst sich nicht auf. ${badge(v)} \`rebase cloud db connect\` öffnet einen lokalen Port.
`;

/** A tree of `files` (repo-relative path → text), removed when test `t` ends. */
function tree(t, files) {
    const root = mkdtempSync(path.join(os.tmpdir(), "release-docs-"));
    t.after(() => rmSync(root, { recursive: true,
force: true }));
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
    }
    return {
        root,
        read: (rel) => readFileSync(path.join(root, rel), "utf8"),
        stale: () => checkTranslationFreshness(root).findings.map(f => f.file).sort()
    };
}

/** The 0.21.0 cut, one page of it: English and five translations, all fresh. */
function cut(t, { en = english(), locales = {}, extra = {} } = {}) {
    const files = { "CHANGELOG.md": STAMPED,
[at("en")]: en,
...extra };
    for (const locale of LOCALES) files[at(locale)] = locales[locale] ?? translation(en, german());
    return tree(t, files);
}

test("a badge naming the release that just shipped goes, in English and every translation", (t) => {
    const d = cut(t);
    assert.ok(checkUnreleasedBadges(d.root).findings.some(f => /already released/.test(f.message)),
        "the stamped changelog makes the badges stale");

    const { dropped, restamped, leftStale } = dropReleasedBadges(d.root);

    assert.equal(d.read(at("en")), `---
title: CLI
---

## Database

Opens a tunnel.
\`--reveal\` adds the password.

## Cloud

The host resolves to nothing. \`rebase cloud db connect\` opens a local port.
`);
    assert.equal(dropped.length, 6);
    assert.ok(dropped.every(f => f.count === 3));
    for (const locale of LOCALES) assert.doesNotMatch(d.read(at(locale)), /since-badge/);
    assert.deepEqual(restamped.sort(), LOCALES.map(at).sort());
    assert.deepEqual(leftStale, []);
    assert.deepEqual(d.stale(), []);
    assert.deepEqual(checkUnreleasedBadges(d.root).findings, []);
});

test("a badge for a version nobody has released stays", (t) => {
    const en = english("0.22");
    const d = cut(t, { en,
locales: Object.fromEntries(LOCALES.map(l => [l, translation(en, german("0.22"))])) });

    const { dropped } = dropReleasedBadges(d.root);

    assert.deepEqual(dropped, []);
    assert.equal(d.read(at("en")), en);
});

test("a translation that loses a different number of badges stays a finding", (t) => {
    // `de` never had the inline badge. It was fresh, and it is not now a
    // faithful copy of the new English page.
    const en = english();
    const d = cut(t, { en,
locales: { de: translation(en, german().replace(`${badge("0.21")} `, "")) } });

    const { restamped, leftStale } = dropReleasedBadges(d.root);

    assert.deepEqual(leftStale, [at("de")]);
    assert.equal(restamped.includes(at("de")), false);
    assert.deepEqual(d.stale(), [at("de")]);
});

test("a badge inside a code fence is an example of the markup, and stays", (t) => {
    const en = `---\ntitle: Writing docs\n---\n\n## Badges\n\n\`\`\`md\n${badge("0.21")}\n\`\`\`\n`;
    const d = tree(t, { "CHANGELOG.md": STAMPED,
[`${CONTENT}/docs/contributing.md`]: en });

    dropReleasedBadges(d.root);

    assert.equal(d.read(`${CONTENT}/docs/contributing.md`), en);
});

test("a badge that starts its sentence is refused before the cut, and leaves its words after it", (t) => {
    // The 0.24.0 cut turned "Since 0.24 for the SDK types: on 0.23, …" into
    // "for the SDK types: on 0.23, …" on ten pages: the badge's words were the
    // sentence's first words, and removing the badge took them along.
    const page = (v) => `---
title: CLI
---

## Generating

Save the file.

${badge(v)} for the SDK types: on 0.20, run it yourself.

Each table gets an \`id\`, and ${badge(v)} the database fills it.
`;
    const mdxPage = (v) => `---\ntitle: Backups\n---\n\nThe panel lists them.\n<Since v="${v}" /> above the list it reports the job.\n`;
    const files = {
        [at("en")]: page("0.21"),
        [`${CONTENT}/docs/deployment/backups.mdx`]: mdxPage("0.21")
    };

    // Before the cut, 0.21 is the coming release: the badge is right, and the
    // sentence it heads is the finding.
    const before = tree(t, {
        ...files,
        "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n## [0.20.0] - 2026-09-01\n\n### Fixed\n\n- **A fix.**\n"
    });
    const refused = checkUnreleasedBadges(before.root).findings.filter(f => /start of its sentence/.test(f.message));
    assert.deepEqual(refused.map(f => `${f.file}:${f.line}`).sort(), [`${at("en")}:9`, `${CONTENT}/docs/deployment/backups.mdx:6`].sort());
    assert.match(refused.find(f => f.file === at("en")).message, /"Since 0\.21 for the SDK types: on 0\.20, run it yourself\.…"/);

    // After it, the badge goes and its words stay, so the sentence still has a
    // head. The badge in the middle of a sentence goes as before.
    const after = tree(t, { ...files, "CHANGELOG.md": STAMPED });
    const { dropped } = dropReleasedBadges(after.root);

    assert.equal(after.read(at("en")), `---
title: CLI
---

## Generating

Save the file.

Since 0.21 for the SDK types: on 0.20, run it yourself.

Each table gets an \`id\`, and the database fills it.
`);
    assert.match(after.read(`${CONTENT}/docs/deployment/backups.mdx`), /\nSince 0\.21 above the list it reports the job\.\n/);
    assert.deepEqual(dropped.find(d => d.file === at("en")), { file: at("en"), count: 1, asText: 1 });
    assert.deepEqual(checkUnreleasedBadges(after.root).findings, []);
});

test("an exemption the release retired is deleted; one still exempting [Unreleased] stays", (t) => {
    const changelog = STAMPED.replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n\n- **`formView` builders could write.**\n");
    const d = tree(t, {
        "CHANGELOG.md": changelog,
        "tooling/scripts/docs-verify/not-new.json": JSON.stringify({
            formView: "the builder API is older than its first release note",
            selectedEntities: "retired by 0.21.0"
        })
    });
    assert.deepEqual(checkUnreleasedBadges(d.root).deadNotNew, ["selectedEntities"]);

    const { pruned } = pruneNotNew(d.root);

    assert.deepEqual(pruned, ["selectedEntities"]);
    assert.deepEqual(Object.keys(JSON.parse(d.read("tooling/scripts/docs-verify/not-new.json"))), ["formView"]);
    assert.deepEqual(checkUnreleasedBadges(d.root).findings, []);
});

test("one release pass leaves pins, badges, NOT_NEW and translations clean", (t) => {
    // The page carries a pin and a badge, so the pin edit and the badge edit
    // re-stamp the same translations one after the other.
    const pinned = (body) => `${body}\n\`\`\`dockerfile\nFROM rebasepro/server:0.20.0\n\`\`\`\n`;
    const en = pinned(english());
    const d = cut(t, {
        en,
        locales: Object.fromEntries(LOCALES.map(l => [l, translation(en, pinned(german()))])),
        extra: {
            "packages/server/package.json": JSON.stringify({ version: "0.21.0" }),
            "tooling/scripts/docs-verify/not-new.json": JSON.stringify({ formView: "retired by 0.21.0" })
        }
    });

    const { pins, badges, notNew } = releaseDocs(d.root);

    assert.equal(pins.total, 6);
    assert.equal(badges.dropped.length, 6);
    assert.deepEqual(notNew.pruned, ["formView"]);
    assert.deepEqual(checkVersionPins(d.root).findings, []);
    assert.deepEqual(checkUnreleasedBadges(d.root).findings, []);
    assert.deepEqual(d.stale(), []);
});

// ── The upgrade guide: the one flip that is written, not made ─────────────

const GUIDE = `${CONTENT}/docs/upgrading.mdx`;
const hop = (from, to, sections) =>
    `---\ntitle: Upgrading ${from} to ${to}\n---\n\n${Array.from({ length: sections }, (_, i) => `## Change ${i + 1}\n`).join("\n")}`;
const breaking = (heading) => `## [${heading}]${heading === "Unreleased" ? "" : " - 2026-09-14"}

### Breaking

- **\`context.client.data\` no longer compiles in a callback.**
- **\`selectedEntities\` is gone.**
`;
const released018 = `## [0.18.0] - 2026-08-01

### Breaking

- **Peer ranges narrowed.**
`;

test("before the cut, a hop page already named for the coming release is where [Unreleased] goes", (t) => {
    const changelog = `# Changelog\n\n${breaking("Unreleased")}\n## [0.20.0] - 2026-09-01\n\n${released018}`;
    const pages = {
        [GUIDE]: "---\ntitle: Upgrading\n---\n",
        [`${CONTENT}/docs/upgrading/0-17-to-0-18.mdx`]: hop("0.17", "0.18", 1)
    };
    const d = tree(t, { "CHANGELOG.md": changelog,
...pages,
[`${CONTENT}/docs/upgrading/0-18-to-0-21.mdx`]: hop("0.18", "0.21", 2) });
    assert.deepEqual(checkUpgradeCoverage(d.root).findings, []);

    // And it is held to [Unreleased]'s rule: one section per Breaking bullet.
    const thin = tree(t, { "CHANGELOG.md": changelog,
...pages,
[`${CONTENT}/docs/upgrading/0-18-to-0-21.mdx`]: hop("0.18", "0.21", 1) });
    const [finding] = checkUpgradeCoverage(thin.root).findings;
    assert.equal(finding.version, "Unreleased");
    assert.match(finding.reason, /0-18-to-0-21\.mdx has 1 `## ` section\(s\) for 2/);
});

test("after the cut, the same page covers the release; left as -to-next, the release is refused and told why", (t) => {
    const changelog = `# Changelog\n\n## [Unreleased]\n\n${breaking("0.21.0")}\n${released018}`;
    const base = { "CHANGELOG.md": changelog,
[GUIDE]: "---\ntitle: Upgrading\n---\n",
[`${CONTENT}/docs/upgrading/0-17-to-0-18.mdx`]: hop("0.17", "0.18", 1) };

    const renamed = tree(t, { ...base,
[`${CONTENT}/docs/upgrading/0-18-to-0-21.mdx`]: hop("0.18", "0.21", 2) });
    assert.deepEqual(checkUpgradeCoverage(renamed.root).findings, []);

    const leftBehind = tree(t, { ...base,
[`${CONTENT}/docs/upgrading/0-18-to-next.mdx`]: hop("0.18", "the next release", 2) });
    const [finding] = checkUpgradeCoverage(leftBehind.root).findings;
    assert.equal(finding.version, "0.21.0");
    assert.match(finding.reason, /0-18-to-next\.mdx, rename that page and its translations to …-to-0-21\.mdx/);
});

test("after the cut, a page left as -to-next is refused even when its prose names the release, and said once", (t) => {
    const changelog = `# Changelog\n\n## [Unreleased]\n\n${breaking("0.21.0")}\n${released018}`;
    const base = { "CHANGELOG.md": changelog,
[GUIDE]: "---\ntitle: Upgrading\n---\n",
[`${CONTENT}/docs/upgrading/0-17-to-0-18.mdx`]: hop("0.17", "0.18", 1) };
    const page = `${CONTENT}/docs/upgrading/0-18-to-next.mdx`;

    // "Names the version" is satisfied by one sentence of prose, so it is the
    // empty [Unreleased] that refuses the page.
    const namesIt = tree(t, { ...base,
[page]: `${hop("0.18", "the next release", 2)}\nThis ships as 0.21.\n` });
    const findings = checkUpgradeCoverage(namesIt.root).findings;
    assert.equal(findings.length, 1);
    assert.equal(findings[0].version, "Unreleased");
    assert.match(findings[0].reason, /0-18-to-next\.mdx has 2 `## ` section\(s\), and \[Unreleased\] declares no/);
    assert.match(findings[0].reason, /0\.21\.0 shipped them.*…-to-0-21\.mdx/);

    // Without the prose, the coverage finding already says to rename it; the
    // zero-count rule does not repeat it.
    const silent = tree(t, { ...base,
[page]: hop("0.18", "the next release", 2) });
    assert.deepEqual(checkUpgradeCoverage(silent.root).findings.map(f => f.version), ["0.21.0"]);

    // An empty [Unreleased] with no -to-next page is the ordinary state between releases.
    const between = tree(t, { ...base,
[`${CONTENT}/docs/upgrading/0-18-to-0-21.mdx`]: hop("0.18", "0.21", 2) });
    assert.deepEqual(checkUpgradeCoverage(between.root).findings, []);
});

test("a -to-next page beside the page [Unreleased] goes to is what a rename by copy leaves, and is refused", (t) => {
    const changelog = `# Changelog\n\n${breaking("Unreleased")}\n## [0.20.0] - 2026-09-01\n\n${released018}`;
    const d = tree(t, { "CHANGELOG.md": changelog,
[GUIDE]: "---\ntitle: Upgrading\n---\n",
[`${CONTENT}/docs/upgrading/0-17-to-0-18.mdx`]: hop("0.17", "0.18", 1),
[`${CONTENT}/docs/upgrading/0-18-to-0-21.mdx`]: hop("0.18", "0.21", 2),
[`${CONTENT}/docs/upgrading/0-18-to-next.mdx`]: hop("0.18", "the next release", 2) });
    const [finding, ...rest] = checkUpgradeCoverage(d.root).findings;
    assert.deepEqual(rest, []);
    assert.match(finding.reason, /0-18-to-next\.mdx is named -to-next, but \[Unreleased\] goes to .*0-18-to-0-21\.mdx/);
});

test("a released badge set off by punctuation takes the punctuation with it", () => {
    // 0.25.0's cut left "does not change them (, [details](…))" on storage.md
    // in English, and German did not take the edit the same way.
    const badge = '<span class="since-badge" data-since="0.25">Since 0.25</span>';
    const released = (v) => v === "0.25";
    const leading = removeBadges(`does not change them (${badge}, [details](/docs/x/)):`, released).text;
    assert.equal(leading, "does not change them ([details](/docs/x/)):");
    const trailing = removeBadges(`one more case ([details](/docs/x/), ${badge}).`, released).text;
    assert.equal(trailing, "one more case ([details](/docs/x/)).");
    const alone = removeBadges(`the default (${badge}) is kept.`, released).text;
    assert.equal(alone, "the default is kept.");
    // And the badge that opens a parenthesis whose clause follows a semicolon
    // or a colon: 0.25.0's cut left "(; on 0.24 the data API …)" on errors.md
    // and five other pages, in every locale.
    const semicolon = removeBadges(`at every door (${badge}; on 0.24 the data API answers it).`, released).text;
    assert.equal(semicolon, "at every door (on 0.24 the data API answers it).");
    const colon = removeBadges(`two edits (${badge}: 0.24 reports both).`, released).text;
    assert.equal(colon, "two edits (0.24 reports both).");
});

test("a page copy_repo_docs.js writes loses its released badge in its source too", (t) => {
    // Only the website copy used to be edited, and the release's own
    // `generate-all` copied docs/compatibility.md — badge and all — back over
    // it, leaving "Since 0.21" on a released page and the translations stale.
    const body = `## Promises\n\n${badge("0.21")} A canary is \`main\` after the last release.\n`;
    const d = tree(t, { "CHANGELOG.md": STAMPED,
        "docs/compatibility.md": `# Compatibility\n\n${body}`,
        [`${CONTENT}/docs/compatibility.md`]: `---\nslug: docs/compatibility\ntitle: Compatibility\n---\n\n${body}` });
    dropReleasedBadges(d.root);
    assert.doesNotMatch(d.read(`${CONTENT}/docs/compatibility.md`), /since-badge/);
    assert.doesNotMatch(d.read("docs/compatibility.md"), /since-badge/);
    assert.match(d.read("docs/compatibility.md"), /A canary is `main` after the last release\./);
});
