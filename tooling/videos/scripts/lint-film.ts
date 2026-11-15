// Lints one film's script — an explainer's in full, a series film's for the
// checks that apply to it — and fails (exit 1) with a line per problem.
//
//   pnpm lint:film <id>          e.g. pnpm lint:film view-side-door
//   pnpm lint:film --all         every explainer and series film
//
// What it checks:
//   banned       phrases the owner never wants said ("this one", slogans,
//                and, in an explainer, the products it must not mention)
//   repeat-word  a content word said twice within 12 words (not the film's
//                declared `terms`, not stop words)
//   repeat-run   the same three-word run said twice anywhere in the script
//   same-start   two sentences opening on the same two words
//   words        explainers: 200-280 words in all (90-120 s read aloud)
//   rebase-last  explainers: "Rebase" in no line but the last, and in that one
//   proof        explainers that declare a proof: every statement and result
//                the film shows appears in the proof's expected output,
//                whitespace aside
//
// What it does NOT check, and a human still must: that every sentence has a
// subject and a verb, that the tone is friendly and present tense, that a
// claim is true (the proof check only shows the film quotes the proof file
// faithfully — the proof script is what tests the claim), and repetition of
// an idea in different words.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPLAINERS, type ExplainerSpec } from "../src/explainers/index";
import { SERIES } from "../src/series/index";
import type { FilmSpec } from "../src/series/kit";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const STOP = new Set(
    "a an the and or of to in on is it its it's you your for with as at by be are that this from so no not one into their there's they them who what when then here's here now".split(
        " ",
    ),
);

const BANNED_ALWAYS = ["this one", "game changer", "game-changer", "seamless", "seamlessly", "supercharge", "blazing", "revolutionary", "next-level", "unlock the power", "magic"];
const BANNED_EXPLAINER = ["rls-check", "studio", "rebase cloud"];

interface Problem {
    rule: string;
    message: string;
}

const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9'-]/g, "").replace(/^'+|'+$/g, "");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function lintFilm(film: FilmSpec, explainer: ExplainerSpec | null): Problem[] {
    const problems: Problem[] = [];
    const add = (rule: string, message: string) => problems.push({ rule, message });
    /* A series film names Rebase by design; an explainer declares its own. */
    const terms = new Set((explainer ? explainer.terms ?? [] : ["rebase"]).map((t) => t.toLowerCase()));
    const lineTexts = film.script.map((l) => l.words.join(" "));
    const full = lineTexts.join(" ");

    /* banned */
    const banned = explainer ? [...BANNED_ALWAYS, ...BANNED_EXPLAINER] : BANNED_ALWAYS;
    film.script.forEach((l, i) => {
        const text = lineTexts[i].toLowerCase();
        for (const b of banned) {
            if (new RegExp(`(^|[^a-z])${b.replace(/[-]/g, "\\-")}([^a-z]|$)`).test(text)) add("banned", `[${l.id}] says "${b}"`);
        }
    });

    /* repeat-word */
    const all = film.script.flatMap((l) => l.words.map((w) => ({ w: bare(w), line: l.id })));
    for (let i = 0; i < all.length; i++) {
        const w = all[i].w;
        if (STOP.has(w) || w.length < 4 || terms.has(w)) continue;
        for (let j = i + 1; j < Math.min(all.length, i + 12); j++) {
            if (all[j].w === w) add("repeat-word", `"${w}" twice within ${j - i} words ([${all[i].line}] → [${all[j].line}])`);
        }
    }

    /* repeat-run: three words, at least one not a stop word or a term */
    const seen = new Map<string, string>();
    for (let i = 0; i + 2 < all.length; i++) {
        const run = [all[i].w, all[i + 1].w, all[i + 2].w];
        if (run.every((w) => STOP.has(w) || terms.has(w))) continue;
        const key = run.join(" ");
        const where = all[i].line;
        const first = seen.get(key);
        if (first !== undefined) add("repeat-run", `"${key}" said twice ([${first}] and [${where}])`);
        else seen.set(key, where);
    }

    /* same-start */
    const sentences = full.split(/(?<=[.?!])\s+/).filter(Boolean);
    const starts = new Map<string, string>();
    for (const s of sentences) {
        const key = s.split(" ").slice(0, 2).map(bare).join(" ");
        const before = starts.get(key);
        if (before !== undefined) add("same-start", `two sentences open on "${key}": "${before}" / "${s}"`);
        else starts.set(key, s);
    }

    if (explainer) {
        /* words */
        const count = all.length;
        if (count < 200 || count > 280) add("words", `${count} words; an explainer runs 200-280`);

        /* rebase-last */
        const last = film.script.length - 1;
        film.script.forEach((l, i) => {
            const named = /\brebase\b/i.test(lineTexts[i]);
            if (named && i !== last) add("rebase-last", `[${l.id}] names Rebase before the last line`);
            if (!named && i === last) add("rebase-last", `the last line [${l.id}] does not say who made the film`);
        });

        /* proof */
        if (explainer.proof) {
            const file = path.join(ROOT, explainer.proof.expected);
            let expected = "";
            try {
                expected = squash(readFileSync(file, "utf8"));
            } catch {
                add("proof", `cannot read ${explainer.proof.expected}`);
            }
            if (expected) {
                for (const block of explainer.proof.shown) {
                    if (!expected.includes(squash(block))) {
                        add("proof", `on screen but not in ${explainer.proof.expected}:\n        ${block.split("\n").join("\n        ")}`);
                    }
                }
            }
        }
    }
    return problems;
}

function main() {
    const arg = process.argv[2];
    if (!arg) {
        console.error("usage: pnpm lint:film <film id> | --all");
        process.exit(2);
    }
    const targets: { film: FilmSpec; explainer: ExplainerSpec | null }[] = [
        ...EXPLAINERS.map((e) => ({ film: e.film, explainer: e })),
        ...SERIES.map((film) => ({ film, explainer: null })),
    ].filter((t) => arg === "--all" || t.film.id === arg);
    if (targets.length === 0) {
        console.error(`lint:film: no film "${arg}". Films: ${[...EXPLAINERS.map((e) => e.film.id), ...SERIES.map((f) => f.id)].join(", ")}`);
        process.exit(2);
    }
    let failed = 0;
    for (const { film, explainer } of targets) {
        const problems = lintFilm(film, explainer);
        const words = film.script.reduce((n, l) => n + l.words.length, 0);
        console.log(`${problems.length ? "FAIL" : "ok  "} ${film.id} (${explainer ? "explainer" : "series"}, ${words} words)`);
        for (const p of problems) console.log(`     ${p.rule.padEnd(11)} ${p.message}`);
        if (problems.length) failed++;
    }
    if (failed) {
        console.error(`\nlint:film: ${failed} film(s) failed.`);
        process.exit(1);
    }
}

main();
