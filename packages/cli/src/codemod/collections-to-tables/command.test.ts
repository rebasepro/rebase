/**
 * How the output groups what says the same thing several times: one printed
 * step for N fields, one note for N keys. `--json` keeps each.
 */
import { describe, expect, it } from "vitest";

import { groupNotes, groupSteps } from "./command";

describe("the printed output", () => {
    it("prints steps that say the same once, listing what each was about", () => {
        const detail = "`dynamicProps` returns a field customization now. Check what it returns.";
        const grouped = groupSteps([
            { title: "Check fields.slug.dynamicProps of posts", detail, file: "frontend/src/cms/posts.tsx" },
            { title: "Mount the table customizations", detail: "Replace the collections prop.", snippet: "<RebaseCMS />" },
            { title: "Check fields.locale.dynamicProps of pages", detail, file: "frontend/src/cms/pages.tsx" }
        ]);
        expect(grouped.map(step => step.title)).toEqual(["2 steps that say the same", "Mount the table customizations"]);
        expect(grouped[0].detail).toBe(`${detail} — Check fields.slug.dynamicProps of posts (frontend/src/cms/posts.tsx); Check fields.locale.dynamicProps of pages (frontend/src/cms/pages.tsx)`);
    });

    it("prints the same remark about several keys once, with the keys", () => {
        const remark = "is not carried: `\"manual\"` and `true` are the same key to the server.";
        expect(groupNotes([
            { file: "config/collections/players.ts", message: `properties.id.isId ${remark}` },
            { file: "config/collections/reports.ts", message: `properties.who.isId ${remark}` },
            { file: "config", message: "keeps 1 module(s) of the project's own." }
        ])).toEqual([
            `2× ${remark} — config/collections/players.ts properties.id.isId, config/collections/reports.ts properties.who.isId`,
            "config keeps 1 module(s) of the project's own."
        ]);
    });
});
