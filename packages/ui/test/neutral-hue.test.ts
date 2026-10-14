import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every neutral is on one hue.
 *
 * The system's neutrals used to sit on five hues — a hue-less surface ladder,
 * zinc text greys at 286° (violet), grounds at 246°, a slate scale at 264° —
 * and the clash read as "a grey box on black". Since 2026-10-14 every text
 * and surface neutral is `oklch(L c 258)`, the brand blue's hue, at a chroma
 * low enough that nothing reads as blue (see the GRAPHITE note in theme.css).
 *
 * This keeps it that way: a pure grey (#131313), a Tailwind zinc (#a0a0a9) or
 * a hand-picked off-hue value pasted into a token fails here.
 *
 * Hue is measured from hex, so it carries 8-bit rounding: at chroma 0.002 a
 * one-unit step in a channel moves the measured hue by more than ten degrees.
 * The tolerance therefore widens as chroma falls; a value with no chroma at
 * all is only allowed at the two ends (pure white, pure black).
 */

const HUE = 258;
const css = readFileSync(join(__dirname, "../src/theme.css"), "utf8");

/** Text, surface, field and graphite tokens, plus the role ladders: every
 *  opaque hex. Tailwind's grey palettes are aliases of graphite, so they are
 *  covered through it. */
const NEUTRAL = /--((?:color-)?(?:text|surface|field|graphite)[a-z0-9-]*):\s*(#[0-9a-fA-F]{6})\b/g;

function oklch(hex: string) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => lin(x / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const h = (Math.atan2(B, A) * 180) / Math.PI;
    return { L, C: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

const tokens = [...css.matchAll(NEUTRAL)].map(([, name, hex]) => ({ name, hex: hex.toLowerCase() }));

describe("neutral hue", () => {
    it("finds the whole system, so a moved block cannot slip past this file", () => {
        // 6 text, 2 field, 11 numbered, 11 accent, 11 graphite, both role ladders.
        expect(tokens.length).toBeGreaterThanOrEqual(57);
    });

    it.each(tokens.map((t) => [t.name, t.hex]))("%s %s is on the brand hue", (_name, hex) => {
        const { L, C, h } = oklch(hex);
        if (L < 0.02 || L > 0.995) return; // black and white carry no hue to match
        expect(C).toBeGreaterThanOrEqual(0.0015); // no hue-less grey
        expect(C).toBeLessThanOrEqual(0.045); // a neutral, not a colour
        const off = Math.abs(((h - HUE + 540) % 360) - 180);
        expect(off).toBeLessThanOrEqual(C >= 0.006 ? 8 : 16);
    });
});
