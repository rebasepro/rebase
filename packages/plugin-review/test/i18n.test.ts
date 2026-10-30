import { describe, expect, it } from "@jest/globals";
import { en } from "../src/i18n/en";
import { interpolate, REVIEW_TRANSLATIONS, reviewBundleFor } from "../src/i18n";

/** Keys whose English reads the same in some of the other languages ("Record {{id}}" is Italian too). */
const SAME_EVERYWHERE = new Set(["review_field", "review_record"]);

describe("the plugin's own bundles", () => {
    it("ships the six panel languages", () => {
        expect(Object.keys(REVIEW_TRANSLATIONS).sort()).toEqual(["de", "en", "es", "fr", "it", "pt"]);
    });

    for (const [language, bundle] of Object.entries(REVIEW_TRANSLATIONS)) {
        if (language === "en") continue;
        it(`${language} has every key, translated, with the same placeholders`, () => {
            expect(Object.keys(bundle).sort()).toEqual(Object.keys(en).sort());
            for (const [key, english] of Object.entries(en)) {
                const translated = bundle[key as keyof typeof en];
                const placeholders = (text: string) => (text.match(/\{\{\s*\w+\s*\}\}/g) ?? []).sort();
                expect({ key,
placeholders: placeholders(translated) }).toEqual({ key,
placeholders: placeholders(english) });
                if (!SAME_EVERYWHERE.has(key) && english.includes(" ")) {
                    expect({ key,
same: translated === english }).toEqual({ key,
same: false });
                }
            }
        });
    }

    it("reads a regional tag as its language and an unknown one as English", () => {
        expect(reviewBundleFor("pt-BR")).toBe(REVIEW_TRANSLATIONS.pt);
        expect(reviewBundleFor("ja")).toBe(en);
        expect(reviewBundleFor(undefined)).toBe(en);
    });

    it("fills placeholders and leaves unknown ones as written", () => {
        expect(interpolate("Review queue ({{count}}) {{other}}", { count: 3 })).toBe("Review queue (3) {{other}}");
    });
});
