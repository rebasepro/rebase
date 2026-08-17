import { CHIP_COLORS, CHIP_SEED_KEYS, contrastRatio, getColorSchemeForSeed } from "../src/util/chip_colors";

/**
 * Chips must be readable.
 *
 * This exists because an audit of all 120 hue/tone/mode pairs found **63 of
 * them below WCAG AA** — the ink had been written down per tone (`"#fff"` on
 * every `solid` background, the hue's `pale` on every `deep` one) rather than
 * measured against the background it landed on. White on `teal.solid` scored
 * **1.76:1**. Nothing caught it because nothing was looking.
 *
 * The ink is derived now, so these assertions are what keep it derived: add a
 * hue with an unlucky mid stop, or go back to a hardcoded ink, and this fails.
 */

/** WCAG AA for normal-sized text. Chip labels are 11–13px. */
const AA = 4.5;

/** The surfaces an outlined chip sits on: `bg-white` and `surface-950`. */
const PAGE_LIGHT = "#ffffff";
const PAGE_DARK = "#0a0a0a";

describe("chip contrast", () => {
    it("covers every scheme, so a new hue cannot slip past this file", () => {
        // 15 hues × 4 tones, plus the bare-hue aliases.
        expect(CHIP_SEED_KEYS.length).toBe(60);
        expect(Object.keys(CHIP_COLORS).length).toBe(75);
    });

    describe.each(CHIP_SEED_KEYS)("%s", (key) => {
        const scheme = CHIP_COLORS[key];

        it("filled: ink clears AA on its own background, in both modes", () => {
            const light = contrastRatio(scheme.text, scheme.color);
            const dark = contrastRatio(
                scheme.darkText ?? scheme.text,
                scheme.darkColor ?? scheme.color
            );
            expect(light).toBeGreaterThanOrEqual(AA);
            expect(dark).toBeGreaterThanOrEqual(AA);
        });

        it("outlined: ink clears AA on the PAGE, which is a different surface", () => {
            // The regression this guards: an outlined chip drops its fill, so
            // reusing the filled ink puts dark-on-a-bright-chip ink onto a
            // near-black page.
            expect(scheme.outlineText).toBeDefined();
            expect(scheme.darkOutlineText).toBeDefined();
            expect(contrastRatio(scheme.outlineText as string, PAGE_LIGHT)).toBeGreaterThanOrEqual(AA);
            expect(contrastRatio(scheme.darkOutlineText as string, PAGE_DARK)).toBeGreaterThanOrEqual(AA);
        });
    });

    it("keeps ink tinted rather than collapsing to flat black and white", () => {
        // Legibility alone would be satisfied by #000/#fff everywhere, and the
        // palette would stop looking like one family. Allow the neutral hue to
        // be neutral; require the rest to keep a tint.
        const flat = CHIP_SEED_KEYS
            .filter(k => !k.startsWith("gray"))
            .filter(k => {
                const s = CHIP_COLORS[k];
                return [s.text, s.darkText, s.outlineText, s.darkOutlineText]
                    .some(c => c === "#000000" || c === "#ffffff");
            });
        expect(flat).toEqual([]);
    });

    it("gives a seeded chip a real scheme rather than an undefined one", () => {
        const scheme = getColorSchemeForSeed("some-enum-value");
        expect(scheme.color).toBeDefined();
        expect(contrastRatio(scheme.text, scheme.color)).toBeGreaterThanOrEqual(AA);
    });
});
