#!/usr/bin/env node
/**
 * The edits a release makes to its own documentation.
 *
 * Stamping `## [Unreleased]` as a version changes what is true about the docs,
 * and `verify:docs` knows it. A pin naming the old runtime is now stale. A
 * "Since 0.21" badge that was required yesterday is now wrong. A `NOT_NEW`
 * exemption now exempts a token no longer under `[Unreleased]`. And every
 * translation of a page that changed reads as stale against the English hash it
 * was stamped with. 0.21.0 committed all of that: 57 `verify:docs --strict`
 * findings, none of them from a code change. The bump commit is `[skip ci]`,
 * so the first run to see them was an unrelated push.
 *
 * Every one of those edits is mechanical, so this makes them:
 *
 *   1. pins        `check-version-pins.mjs`, every copyable version → this one
 *   2. badges      `dropReleasedBadges`, every badge naming a released version
 *   3. NOT_NEW     `pruneNotNew`, every exemption that exempts nothing now
 *
 * Steps 1 and 2 reach the translations too, and a translation that received
 * exactly the English page's edit keeps its freshness stamp.
 *
 * The one flip that is not mechanical is the upgrade guide: a release that
 * declares `### Breaking` needs a hop page naming it. That page is prose in six
 * languages, so it is written before the cut, under its release's name
 * (`check-upgrade-coverage.mjs` accepts that). The release's own
 * `verify:docs:strict`, which runs straight after this, stops the release if it
 * was not.
 *
 * Run after `prepare-changelog.mjs` and the version bump, by `publish.yml` and
 * `release.sh`:
 *
 *     node tooling/scripts/release-docs.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeVersionPins } from "./docs-verify/check-version-pins.mjs";
import { dropReleasedBadges, pruneNotNew } from "./docs-verify/check-unreleased-badges.mjs";

/** @param {string} root repo root */
export function releaseDocs(root) {
    const pins = writeVersionPins(root);
    const badges = dropReleasedBadges(root);
    const notNew = pruneNotNew(root);
    return { pins,
badges,
notNew };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const { pins, badges, notNew } = releaseDocs(root);

    console.log(pins.total
        ? `Rewrote ${pins.total} pin(s) to ${pins.expected} across ${pins.written.length} file(s).`
        : `Every version pin already names ${pins.expected}.`);
    const badgeCount = badges.dropped.reduce((n, d) => n + d.count, 0);
    console.log(badgeCount
        ? `Dropped ${badgeCount} badge(s) naming a released version, from ${badges.dropped.length} file(s).`
        : "No badge names a released version.");
    for (const d of badges.dropped) console.log(`  ${d.file} (${d.count})`);
    console.log(notNew.pruned.length
        ? `Deleted ${notNew.pruned.length} NOT_NEW exemption(s) the release retired: ${notNew.pruned.join(", ")}.`
        : "No NOT_NEW exemption was retired.");

    const restamped = new Set([...pins.restamped, ...badges.restamped]);
    if (restamped.size) console.log(`Kept ${restamped.size} translation(s) fresh: they received the English page's edit.`);

    // Named here and left for `verify:docs` to fail on: these were fresh, and
    // the edit did not reach them the way it reached English.
    const leftStale = [...new Set([...pins.leftStale, ...badges.leftStale])];
    if (leftStale.length) {
        console.log(
            `${leftStale.length} translation(s) did not receive the English page's edit the same way, ` +
            "so they now read as stale. Replay the edit by hand and run " +
            "`node scripts/backfill_source_hashes.mjs --only <page>` in website/:"
        );
        for (const f of leftStale) console.log(`  ${f}`);
    }
}
