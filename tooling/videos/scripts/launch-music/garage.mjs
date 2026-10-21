/**
 * GARAGE — UK garage two-step, the register of a current dance record:
 * a skipping kick, swung hats, a sub that slides between notes, warm chord
 * stabs, and vocal chops — sung syllables cut short and played as the hook.
 *
 * Harmony descends Fmaj9 – Em7 – Dm9 – Cmaj9 (IV–iii–ii–I in C), the
 * stepwise fall that gives the genre its wistful lift; the claim is a ii–V
 * (Dm9, G11) that lands on C under the logo.
 */
import { boom, chord, clap, crash, downlifter, hat, kick, rim, riser, shaker, snare, sub, swell, voice } from "./instruments.mjs";
import { BAR_LIST } from "./form.mjs";

export const name = "garage";
export const swing = 0.6;
export const mix = { reverb: { rt60: 1.9, damp: 0.45, predelay: 0.018, size: 0.9 }, delay: { time: 0.75, feedback: 0.34 }, lufs: -11.5, air: 1.5 };

const CH = {
    Fmaj9: { root: 41, v: [57, 60, 64, 67] },
    Em7: { root: 40, v: [55, 59, 62, 64] },
    Dm9: { root: 38, v: [53, 57, 60, 64] },
    Cmaj9: { root: 36, v: [55, 59, 62, 64] },
    G11: { root: 43, v: [53, 57, 60, 64] },
    FC: { root: 36, v: [57, 60, 64, 67] },
};
const LOOP = [CH.Fmaj9, CH.Em7, CH.Dm9, CH.Cmaj9];

function chordAt(b) {
    if (b.kind === "claim") return [CH.Dm9, CH.G11][b.inner];
    if (b.kind === "end") return [CH.Cmaj9, CH.FC, CH.Cmaj9][b.inner];
    return LOOP[b.n % 4];
}

/** The chop melody: [16th, midi, length in 16ths, vowel], a bar at a time. */
const CHOPS = [
    [[2, 76, 1.5, "o"], [4, 79, 1, "a"], [6, 81, 2, "a"], [10, 79, 1, "e"], [12, 76, 2, "o"], [15, 74, 1, "u"]],
    [[0, 76, 3, "a"], [4, 72, 1, "o"], [6, 74, 1, "e"], [8, 76, 4, "a"], [13, 79, 1, "i"], [14, 81, 2, "a"]],
    [[2, 81, 1.5, "o"], [4, 79, 1, "a"], [6, 76, 2, "a"], [10, 74, 1, "e"], [12, 76, 2, "o"], [15, 79, 1, "u"]],
    [[0, 76, 3, "a"], [4, 74, 1, "o"], [6, 72, 1, "e"], [8, 74, 6, "a"], [14, 76, 2, "i"]],
];

/** Garage stabs: the one, then pushed off the beat. */
const STABS = [[0, 2, 0.8], [3, 1, 0.55], [6, 2, 0.7], [10, 2, 0.7], [13, 1, 0.5]];

export function compose(s) {
    const kickStem = s.stem("kick", { level: 1.35, eq: [{ type: "hp", f: 32 }] });
    const snareStem = s.stem("snare", { level: 1.74, eq: [{ type: "hp", f: 200 }], room: 0.3, reverb: 0.12 });
    const hats = s.stem("hats", { level: 2.0, width: 1.35, room: 0.1 });
    const perc = s.stem("perc", { level: 0.66, eq: [{ type: "hp", f: 350 }], room: 0.2, delay: 0.12 });
    const bass = s.stem("bass", { level: 0.55, eq: [{ type: "lp", f: 800 }], duck: 0.5, drive: 0.35 });
    const keys = s.stem("chords", {
        level: 0.93,
        eq: [{ type: "hp", f: 170 }, { type: "peak", f: 400, q: 1, gain: -3 }],
        chorus: { rate: 0.5, depth: 0.0025, mix: 0.5 },
        duck: 0.45,
        reverb: 0.2,
        width: 1.3,
    });
    // The hook, held a little back from the front (Francesco, 2026-10-13:
    // "a little more subtle"): -2.5 dB and a softer presence lift than at first.
    const vox = s.stem("vox", {
        level: 0.82,
        eq: [{ type: "hp", f: 220 }, { type: "peak", f: 3000, q: 1, gain: 1 }],
        comp: { threshold: -20, ratio: 3, attack: 0.004, release: 0.08 },
        reverb: 0.28,
        delay: 0.24,
    });
    const choir = s.stem("choir", { level: 0.64, eq: [{ type: "hp", f: 200 }], chorus: { rate: 0.3 }, reverb: 0.5, width: 1.5, duck: 0.4 });
    const fx = s.stem("fx", { level: 0.5, eq: [{ type: "hp", f: 35 }], reverb: 0.22 });

    let lastBass = null;
    for (const b of BAR_LIST) {
        const c = chordAt(b);
        const t = (x) => s.at(b.n, x);
        const loose = () => s.loose(4);
        const s16 = s.beat / 4;

        // ── chords ──
        if (b.kind === "premise" || b.kind === "claim" || (b.kind === "end" && b.last)) {
            chord(keys, t(0), c.v, s.beat * (b.last && b.kind === "end" ? 3.6 : 3.8), { vel: 0.55, cutoff: 900, env: 900, decay: 0.6, release: 0.5 });
        } else {
            for (const [x, d, v] of STABS) chord(keys, t(x) + loose(), c.v, d * s16 * 0.9, { vel: v * s.vary(0.06), cutoff: 650, env: 2900, decay: 0.12 });
        }
        if (b.groove === "C" || b.kind === "claim" || b.kind === "end") {
            // A wordless choir, "ooh", holding the chord's top three notes.
            for (const m of c.v.slice(1)) voice(choir, t(0), m + 12, s.beat * 3.9, "u", { vel: 0.35, scoop: 0, vibrato: 14, pan: (m - 62) / 10 });
        }

        // ── bass: syncopated, sliding ──
        if (b.kind === "claim") {
            lastBass = null;
        } else if (b.kind === "premise" || (b.kind === "end" && b.last)) {
            sub(bass, t(0), c.root, s.beat * 3.7, { vel: 0.8, from: lastBass, glide: 0.12 });
            lastBass = c.root;
        } else {
            const line = b.groove === "B" ? [[0, 0, 3], [3, 0, 2], [6, 12, 1], [8, 0, 2], [10, 7, 3], [14, 10, 2]] : [[0, 0, 3], [6, 0, 2], [10, 7, 3], [14, 12, 2]];
            for (const [x, iv, d] of line) {
                const m = c.root + iv;
                sub(bass, t(x), m, d * s16 - 0.015, { vel: x === 0 ? 0.9 : 0.75, from: lastBass !== null && x > 0 ? lastBass : null, glide: 0.05 });
                lastBass = m;
            }
        }

        // ── the chops ──
        const chops = b.kind === "hook" || b.groove === "A" || b.groove === "C" || (b.kind === "end" && !b.last) || (b.groove === "B" && b.n % 2 === 0);
        if (chops) {
            for (const [x, m, d, vw] of CHOPS[b.n % 4]) {
                voice(vox, t(x) + loose(), m, d * s16 * 0.85, vw, { vel: 0.75 * s.vary(0.08), pan: 0.08 });
                if (b.groove === "C" || b.kind === "end") voice(vox, t(x) + loose(), m + 12, d * s16 * 0.85, vw, { vel: 0.3, pan: -0.25 });
            }
        } else if (b.kind === "claim") {
            // A chop on each claim word, the way the words land on the beat.
            voice(vox, t(0), 76, s16 * 3, "a", { vel: 0.8 });
            voice(vox, t(8), b.inner ? 79 : 74, s16 * 3, "o", { vel: 0.8 });
        } else if (b.kind === "end" && b.last) {
            voice(vox, t(0), 79, s.beat * 2, "a", { vel: 0.7, vibrato: 30 });
            voice(vox, t(0), 76, s.beat * 2, "a", { vel: 0.45, vibrato: 30, pan: -0.3 });
        }

        // ── drums: two-step ──
        const groove = b.kind === "hook" || b.kind === "verb" || (b.kind === "end" && !b.last);
        if (groove) {
            kick(s, kickStem, t(0), { vel: 1, pitch: 50, decay: 0.22, punch: 140 });
            kick(s, kickStem, t(10), { vel: 0.9, pitch: 50, decay: 0.2, punch: 140 });
            if (b.groove === "B" || b.groove === "C") kick(s, kickStem, t(7), { vel: 0.55, pitch: 50, decay: 0.16, duck: false });
            for (const x of [4, 12]) {
                snare(snareStem, t(x) + loose(), { vel: 0.75 * s.vary(0.05), tone: 200, decay: 0.13 });
                clap(snareStem, t(x) + loose(), { vel: 0.6 * s.vary(0.05), tail: 0.12 });
            }
            for (let x = 0; x < 16; x++) {
                if (x === 14) hat(hats, t(x) + loose(), { vel: 0.5, open: true, decay: 0.12 });
                else hat(hats, t(x) + loose(), { vel: [0.7, 0.3, 0.55, 0.38][x % 4] * s.vary(0.12) });
            }
            if (b.groove !== "A") for (const x of [7, 15]) rim(perc, t(x) + loose(), { vel: 0.45 * s.vary(0.1) });
            for (let x = 2; x < 16; x += 4) shaker(perc, t(x) + loose(), { vel: 0.3 * s.vary(0.2), pan: 0.45 });
        } else if (b.kind === "premise") {
            kick(s, kickStem, t(0), { vel: 0.85, pitch: 50, decay: 0.22 });
            for (let x = 2; x < 16; x += 4) hat(hats, t(x) + loose(), { vel: 0.35 });
            if (!b.last) snare(snareStem, t(12) + loose(), { vel: 0.4, tone: 200, decay: 0.12 });
        } else if (b.kind === "claim") {
            boom(fx, t(0), { vel: 0.7 });
            boom(fx, t(8), { vel: 0.7 });
        } else if (b.kind === "end" && b.last) {
            kick(s, kickStem, t(0), { vel: 1, pitch: 48, decay: 0.4 });
        }

        // ── transitions ──
        if (b.first && b.n > 0) {
            crash(fx, t(0), { vel: b.kind === "end" || b.n === 4 ? 0.6 : 0.35 });
            if (b.kind === "verb" || b.kind === "end") boom(fx, t(0), { vel: b.kind === "end" ? 0.9 : 0.5 });
            downlifter(fx, t(0), s.beat * 3, { vel: 0.22 });
        }
        if (b.next && b.next.kind !== "premise") swell(fx, t(8), s.beat * 2, { vel: 0.35 });
        if (b.intoFirstVerb) riser(fx, t(0), s.beat * 4, { vel: 0.7 });
        if (b.kind === "claim" && b.last) {
            riser(fx, t(0), s.beat * 4, { vel: 0.9 });
            const roll = [0, 2, 4, 6, 8, 9, 10, 11, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5];
            roll.forEach((x, k) => snare(snareStem, t(x), { vel: 0.2 + 0.55 * (k / roll.length), tone: 200, decay: 0.1 }));
        }
    }
    crash(fx, s.at(0, 0), { vel: 0.6 });
    boom(fx, s.at(0, 0), { vel: 0.75 });
}
