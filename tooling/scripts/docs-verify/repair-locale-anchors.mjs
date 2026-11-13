#!/usr/bin/env node
/**
 * Repair the anchors of translated docs pages.
 *
 * A translation translates its headings, and a heading's anchor is its text —
 * so `[x](#changing-an-email-address)` above `### E-Mail-Adresse ändern` is a
 * dead link the moment the page is translated. The translator is asked to
 * follow its own headings and mostly does; when it keeps the English anchor
 * (or drops a diacritic from the translated one) the link graph check reports
 * the page, and there is nothing to fix by hand that this cannot fix exactly:
 *
 *   - an anchor that is the slug of the English page's n-th heading becomes the
 *     slug of the translated page's n-th heading (only when both pages have the
 *     same number of headings — a translation that lost one is not guessed at);
 *   - an anchor that differs from one of the page's own slugs only by
 *     diacritics becomes that slug.
 *
 * Same-page links (`](#x)`) and links to another translated page
 * (`](/de/docs/y#x)`) are both repaired. Fenced code is left alone.
 *
 * Usage: node tooling/scripts/docs-verify/repair-locale-anchors.mjs [--check]
 *   --check   report what would change and exit 1 if anything would.
 */
import { globSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { headingSlug, withoutFences } from "./check-docs-links.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DOCS = "website/src/content/docs";
const LOCALES = ["de", "es", "fr", "it", "pt"];
const check = process.argv.includes("--check");

/** The slugs of a page's headings, in document order. */
function slugsOf(file) {
    let text;
    try {
        text = withoutFences(readFileSync(path.join(ROOT, file), "utf8"));
    } catch {
        return null;
    }
    return [...text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)].map(m => headingSlug(m[1]));
}

const cache = new Map();
const slugs = file => {
    if (!cache.has(file)) cache.set(file, slugsOf(file));
    return cache.get(file);
};

const plain = s => s.normalize("NFD").replace(/\p{M}/gu, "");

/** The file a `/de/docs/x` (or `/docs/x`) route is written in, or null. */
function fileOfRoute(route) {
    const clean = route.replace(/\/$/, "").toLowerCase();
    const rel = clean.replace(/^\//, "");
    for (const candidate of [`${rel}.md`, `${rel}.mdx`, `${rel}/index.md`, `${rel}/index.mdx`]) {
        const hit = globSync(candidate, { cwd: path.join(ROOT, DOCS), nocase: true })[0];
        if (hit) return path.join(DOCS, hit);
    }
    return null;
}

/** The anchor a translated page should use in place of `anchor`, or null to leave it. */
function repaired(anchor, targetFile, englishFile) {
    const own = slugs(targetFile);
    if (!own) return null;
    let wanted;
    try {
        wanted = decodeURIComponent(anchor).toLowerCase();
    } catch {
        wanted = anchor.toLowerCase();
    }
    if (own.includes(wanted)) return null;
    const english = englishFile ? slugs(englishFile) : null;
    if (english && english.length === own.length) {
        const index = english.indexOf(wanted);
        if (index !== -1) return own[index];
    }
    const close = own.filter(slug => plain(slug) === plain(wanted));
    return close.length === 1 ? close[0] : null;
}

let changedFiles = 0;
let changedLinks = 0;
const left = [];

for (const lang of LOCALES) {
    for (const rel of globSync(`${DOCS}/${lang}/docs/**/*.{md,mdx}`, { cwd: ROOT }).sort()) {
        const englishOfPage = rel.replace(`${DOCS}/${lang}/`, `${DOCS}/`);
        const raw = readFileSync(path.join(ROOT, rel), "utf8");
        let fenced = false;
        let touched = 0;
        const lines = raw.split("\n").map(line => {
            if (/^\s*(```|~~~)/.test(line)) {
                fenced = !fenced;
                return line;
            }
            if (fenced) return line;
            // Same-page anchors.
            let next = line.replace(/\]\(#([^)\s]+)\)/g, (whole, anchor) => {
                const fix = repaired(anchor, rel, englishOfPage);
                if (fix === null) {
                    const own = slugs(rel) ?? [];
                    let wanted = anchor;
                    try { wanted = decodeURIComponent(anchor); } catch { /* keep */ }
                    if (!own.includes(wanted.toLowerCase())) left.push(`${rel}: #${anchor}`);
                    return whole;
                }
                touched++;
                return `](#${fix})`;
            });
            // Anchors on another translated page.
            next = next.replace(/\]\((\/(?:de|es|fr|it|pt)\/docs[^)\s#]*)#([^)\s]+)\)/g, (whole, route, anchor) => {
                const targetFile = fileOfRoute(route);
                if (!targetFile) return whole;
                const targetLang = route.split("/")[1];
                const fix = repaired(anchor, targetFile, targetFile.replace(`${DOCS}/${targetLang}/`, `${DOCS}/`));
                if (fix === null) return whole;
                touched++;
                return `](${route}#${fix})`;
            });
            return next;
        });
        if (touched > 0) {
            changedFiles++;
            changedLinks += touched;
            if (!check) writeFileSync(path.join(ROOT, rel), lines.join("\n"));
        }
    }
}

console.log(`${check ? "Would repair" : "Repaired"} ${changedLinks} anchor(s) in ${changedFiles} translated page(s).`);
if (left.length > 0) {
    console.log(`${left.length} same-page anchor(s) could not be matched to a heading:`);
    for (const entry of left.slice(0, 40)) console.log(`  ${entry}`);
}
if (check && changedLinks > 0) process.exit(1);
