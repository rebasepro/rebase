// Prints every series script and flags a content word said twice within
// twelve words — the check behind "no doubled words close together".
// pnpm exec tsx scripts/lint-series.ts

import { SERIES } from "../src/series/index";
const STOP = new Set("a an the and or of to in on is it its it's you your for with as at by be are that this from so no not one into their there's they them who what when then".split(" "));
for (const f of SERIES) {
    console.log(`\n${String(f.number).padStart(2, "0")} ${f.title}`);
    const all: string[] = [];
    f.script.forEach((l) => {
        const text = l.words.join(" ");
        console.log(`  [${l.id}] ${text}`);
        if (/this one/i.test(text)) console.log("    !! THIS ONE");
        all.push(...l.words.map((w) => w.toLowerCase().replace(/[^a-z0-9'-]/g, "")));
    });
    // a content word repeated within 12 words
    for (let i = 0; i < all.length; i++) {
        if (STOP.has(all[i]) || all[i].length < 4) continue;
        for (let j = i + 1; j < Math.min(all.length, i + 12); j++) if (all[j] === all[i]) console.log(`    ~ "${all[i]}" twice within ${j - i} words`);
    }
}
