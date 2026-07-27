/**
 * Retired product vocabulary must not survive in user-facing text.
 *
 * This exists because of a specific mistake. When the product stopped calling
 * the admin panel a "CMS", I audited the code, found the exported symbols, and
 * reported that no user-visible string said it — having grepped only for console
 * output. Seven locale files said it: `"CMS Users"`, `"CMS View"`, and full
 * translated sentences in Spanish, Portuguese, German, French, Italian and
 * Hindi. Those are the surface that matters most, and they were the one surface
 * nothing checked.
 *
 * Translations are the easiest place for a rename to rot: they are edited rarely,
 * read by nobody who is working on the code, and a stale one is invisible until
 * a user in that language sees it.
 *
 * Keys are checked too, not just values — `cms_users` is part of the public
 * `RebaseTranslations` type, so a consumer supplying their own translations has
 * to spell it.
 */
import fs from "fs";
import path from "path";

const localesDir = path.resolve(__dirname, "../src/locales");

/**
 * Words the product has retired, and what they became.
 *
 * Add to this when a rename lands. The point is that the *next* rename cannot
 * quietly skip the translations.
 */
const RETIRED: { word: RegExp; became: string }[] = [
    { word: /\bCMS\b/, became: "admin / admin panel" },
    { word: /\bBaaS mode\b/i, became: "derived collections (there is no mode)" }
];

const localeFiles = fs.existsSync(localesDir)
    ? fs.readdirSync(localesDir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    : [];

describe("locale files", () => {
    it("there are locale files to check", () => {
        // Guards the guard: a moved directory would otherwise make every test
        // below vacuously pass.
        expect(localeFiles.length).toBeGreaterThan(0);
    });

    describe.each(localeFiles)("%s", (file) => {
        const source = fs.readFileSync(path.join(localesDir, file), "utf8");

        it.each(RETIRED)("does not say $word", ({ word, became }) => {
            const offenders = source
                .split("\n")
                .map((line, i) => ({ line: line.trim(),
n: i + 1 }))
                .filter(({ line }) => word.test(line));

            // The replacement rides along in the expected value, so a failure
            // reads as "here is the line, here is the word to use instead".
            expect({
                use: became,
                offenders: offenders.map(o => `${file}:${o.n}  ${o.line}`)
            }).toEqual({ use: became,
offenders: [] });
        });
    });
});
