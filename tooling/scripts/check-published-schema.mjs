#!/usr/bin/env node
/**
 * The JSON Schema a `rebase.json` points at is a published artifact, and the
 * repository is not where a developer's editor reads it.
 *
 * Every manifest this project ships — `app/rebase.json`, the `rebase init`
 * template, the headless overlay — opens with
 * `"$schema": "https://rebase.pro/schemas/rebase.json"`. That URL is served by
 * Firebase Hosting from `website/public/schemas/`, which reaches the live site
 * only when someone deploys the website. So a field can be added to the type,
 * to the CLI validator, to the schema file, pass every gate in this repository,
 * and still be a red squiggle in VS Code for every user until an unrelated
 * marketing deploy happens to run.
 *
 * That is not hypothetical. `cms` — where a static app mounts the CMS — landed
 * on 2026-09-10 in all three in-repo places at once. `staticApp` is closed
 * (`additionalProperties: false`), so against the *published* schema the demo's
 * `"cms": "/"` knocked out the static branch of what `apps.*` was then — a
 * bare `oneOf` — no branch matched, and editors surfaced the backend branch's
 * complaint instead:
 *
 *     Value should be one of: "backend"
 *
 * — an error naming a key the file does not have, on a file the CLI accepts.
 * The site publishes on a weekly timer, so the demo manifest everyone is told
 * to read was going to stay wrong for four more days with nothing failing.
 *
 * `apps.*` dispatches on `type` through `if`/`then` now, so a future mismatch
 * lands on the offending property instead of on the wrong branch. That makes
 * the message legible; it does not make it go away. Only a deploy does.
 *
 * Two modes, because there are two distinct failures:
 *
 *   default   Hermetic. Every shipped manifest names a `$schema` this
 *             repository actually publishes. A renamed or moved schema file is
 *             worse than a stale one: a 404 makes an editor say nothing at all,
 *             so the contract silently stops being checked.
 *
 *   --live    Network. Asks rebase.pro what it is serving and compares it to
 *             the file in this repository. This can only pass after a website
 *             deploy, so it belongs with the release gates, not on every
 *             commit. `scheduled-publish.sh` runs it on the way out, which is
 *             the one moment the answer is both knowable and actionable.
 *
 * Run:  node tooling/scripts/check-published-schema.mjs [--live] [--wait 60]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

/**
 * Manifests a developer receives from this project, rather than writes.
 *
 * These are the files whose `$schema` is a promise we make: the demo everyone
 * is pointed at, what `rebase init` scaffolds, and the overlay it applies for a
 * headless project.
 */
const SHIPPED_MANIFESTS = [
    "app/rebase.json",
    "packages/cli/templates/template/rebase.json",
    "packages/cli/templates/overlays/baas/rebase.json"
];

/** Where Firebase Hosting serves the site's static files from. */
const PUBLIC_DIR = "website/public";

/** The origin `firebase.json` deploys to. */
const SITE_ORIGIN = "https://rebase.pro";

const live = process.argv.includes("--live");

/**
 * Seconds to keep asking before calling it stale. Default 0 — one attempt.
 *
 * Only for the post-deploy caller. Hosting can answer from an edge that has not
 * caught up yet, and a check that cries wolf on the morning of a scheduled
 * publish is a check somebody switches off.
 */
const waitFlag = process.argv.indexOf("--wait");
const waitSeconds = waitFlag === -1 ? 0 : Number(process.argv[waitFlag + 1] ?? 0);
if (Number.isNaN(waitSeconds) || waitSeconds < 0) {
    console.error(`${RED}✗${NC} --wait takes a number of seconds.`);
    process.exit(2);
}

const failures = [];

/** Flatten to JSON-pointer-ish paths so a diff can name what moved. */
function flatten(value, prefix = "", out = new Map()) {
    if (value !== null && typeof value === "object") {
        const entries = Array.isArray(value)
            ? value.map((v, i) => [String(i), v])
            : Object.entries(value);
        // Record the container itself, so an empty object/array is not invisible.
        if (entries.length === 0) out.set(prefix || "/", Array.isArray(value) ? "[]" : "{}");
        for (const [key, child] of entries) flatten(child, `${prefix}/${key}`, out);
        return out;
    }
    out.set(prefix || "/", JSON.stringify(value));
    return out;
}

/**
 * What differs between two parsed schemas, as paths.
 *
 * Parsed rather than byte-compared on purpose: whitespace is not the contract,
 * the schema is, and an editor only ever sees the parse.
 */
function describeDifferences(repo, served) {
    const a = flatten(repo);
    const b = flatten(served);
    const missing = [...a.keys()].filter(k => !b.has(k));
    const extra = [...b.keys()].filter(k => !a.has(k));
    const changed = [...a.keys()].filter(k => b.has(k) && b.get(k) !== a.get(k));
    return { missing, extra, changed };
}

// ── Hermetic: every shipped manifest names a schema this repo publishes ──
const declaredUrls = new Set();

for (const relative of SHIPPED_MANIFESTS) {
    const file = path.join(ROOT, relative);
    if (!fs.existsSync(file)) {
        failures.push(`${relative} — listed here but not in the repository. Update SHIPPED_MANIFESTS.`);
        continue;
    }
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    const url = manifest.$schema;
    if (typeof url !== "string" || url === "") {
        failures.push(
            `${relative} — no "$schema". A manifest we hand somebody gets no completion and no ` +
            `validation without it, which is the whole reason the schema is published.`
        );
        continue;
    }
    if (!url.startsWith(`${SITE_ORIGIN}/`)) {
        failures.push(
            `${relative} — "$schema" is ${url}, which this project does not serve. ` +
            `It must be under ${SITE_ORIGIN}/, or nothing here can keep it true.`
        );
        continue;
    }
    const servedPath = url.slice(SITE_ORIGIN.length);
    const source = path.join(ROOT, PUBLIC_DIR, servedPath);
    if (!fs.existsSync(source)) {
        failures.push(
            `${relative} — "$schema" is ${url}, but ${PUBLIC_DIR}${servedPath} does not exist, ` +
            `so that URL 404s. An editor given a 404 reports nothing at all: the file stops being ` +
            `checked and looks fine.`
        );
        continue;
    }
    declaredUrls.add(url);
}

if (!live) {
    if (failures.length > 0) {
        console.error(`${RED}✗${NC} The published schema contract is broken:\n`);
        for (const failure of failures) console.error(`  ${failure}\n`);
        process.exit(1);
    }
    console.log(
        `${GREEN}✓${NC} ${SHIPPED_MANIFESTS.length} shipped manifests point at a schema this repo publishes.`
    );
    console.log(`${DIM}  Whether the live site is serving that file is --live.${NC}`);
    process.exit(0);
}

// ── Live: what rebase.pro serves is what this repository has ────────────
if (failures.length > 0) {
    console.error(`${RED}✗${NC} Not asking the network — the hermetic check already fails:\n`);
    for (const failure of failures) console.error(`  ${failure}\n`);
    process.exit(1);
}

/** One attempt. Returns null when the site agrees, or a printable reason. */
async function compareOnce(url, relative) {
    const repo = JSON.parse(fs.readFileSync(path.join(ROOT, relative), "utf8"));
    let served;
    try {
        const response = await fetch(url, { headers: { "cache-control": "no-cache" } });
        if (!response.ok) return () => console.error(`${RED}✗${NC} ${url} answered ${response.status}.`);
        served = JSON.parse(await response.text());
    } catch (error) {
        return () => console.error(`${RED}✗${NC} ${url} could not be fetched: ${error.message}`);
    }

    const { missing, extra, changed } = describeDifferences(repo, served);
    if (missing.length === 0 && extra.length === 0 && changed.length === 0) return null;

    return () => {
        console.error(`${RED}✗${NC} ${url} is not serving ${relative}.\n`);
        const show = (label, paths) => {
            if (paths.length === 0) return;
            console.error(`    ${label}`);
            for (const p of paths.slice(0, 12)) console.error(`      ${p}`);
            if (paths.length > 12) console.error(`      ${DIM}… ${paths.length - 12} more${NC}`);
        };
        show("in this repo, NOT on the live site:", missing);
        show("on the live site, NOT in this repo:", extra);
        show("different value:", changed);
        console.error("");
    };
}

const RETRY_GAP_MS = 3000;
let stale = false;

for (const url of declaredUrls) {
    const relative = `${PUBLIC_DIR}${url.slice(SITE_ORIGIN.length)}`;
    const deadline = Date.now() + waitSeconds * 1000;

    let report = await compareOnce(url, relative);
    while (report && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, RETRY_GAP_MS));
        console.log(`${DIM}  ${url} has not caught up — asking again…${NC}`);
        report = await compareOnce(url, relative);
    }

    if (report) {
        stale = true;
        report();
        continue;
    }
    console.log(`${GREEN}✓${NC} ${url} is serving ${relative}.`);
}

if (stale) {
    console.error(
        `${DIM}Every editor opening a rebase.json reads the live URL, not this repo. Until the\n` +
        `site is deployed they are validating against the older schema — which reports a\n` +
        `field the CLI accepts as an error, on a line that need not be the one at fault.\n\n` +
        `  website/scripts/scheduled-publish.sh   ${DIM}# publishes committed origin/main${NC}${DIM}\n` +
        `  pnpm -C website deploy                 # publishes the WORKING TREE${NC}\n`
    );
    process.exit(1);
}

console.log(`${DIM}  The live site and this repository agree.${NC}`);
