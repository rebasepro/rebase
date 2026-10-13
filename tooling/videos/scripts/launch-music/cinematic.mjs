/**
 * CINEMATIC — a piano ostinato over modal minor harmony, strings that swell
 * at every section, half-time drums with a big room snare, and a lift to the
 * major on the logo (a Picardy third: E minor all film, E major at the end).
 *
 * Harmony: Cmaj7#11 – Em9 – Am11 – B7sus4→B7 (VI–i–iv–V, the V borrowed
 * from harmonic minor for its pull), all voiced with the 9ths and 11ths that
 * make it sound scored rather than strummed.
 */
import { bell, boom, crash, downlifter, hat, kick, pad, piano, riser, shaker, snare, sub, swell, tom } from "./instruments.mjs";
import { BAR_LIST } from "./form.mjs";

export const name = "cinematic";
export const swing = 0.5;
export const mix = { reverb: { rt60: 3.4, damp: 0.38, predelay: 0.03, size: 1.15 }, delay: { time: 0.75, feedback: 0.3 }, lufs: -13, air: 2 };

const CH = {
    C: { root: 36, v: [52, 59, 66, 67] },
    Em9: { root: 40, v: [55, 62, 66, 71] },
    Am11: { root: 33, v: [55, 60, 62, 64] },
    B7sus: { root: 35, v: [57, 64, 66, 71], then: [57, 63, 66, 71] },
    Emaj9: { root: 40, v: [56, 63, 66, 71] },
    Eadd9: { root: 40, v: [56, 59, 66, 68] },
};
const LOOP = [CH.C, CH.Em9, CH.Am11, CH.B7sus];

function chordAt(b) {
    if (b.kind === "claim") return [CH.Am11, CH.B7sus][b.inner];
    if (b.kind === "end") return [CH.Emaj9, CH.C, CH.Eadd9][b.inner];
    return LOOP[b.n % 4];
}

/** The ostinato walks the voicing in eighths: up, back, up past the top. */
const WALK = [0, 2, 1, 3, 4, 3, 2, 1];

/** A lyrical line over the loop, one or two notes a bar, in whole beats. */
const LINE = [
    [[0, 83, 3], [3, 79, 1]],
    [[0, 78, 4]],
    [[0, 76, 2], [2, 74, 2]],
    [[0, 75, 2], [2, 78, 2]],
];

export function compose(s) {
    const kickStem = s.stem("kick", { level: 0.9, eq: [{ type: "hp", f: 28 }], room: 0.15 });
    const snareStem = s.stem("snare", { level: 0.98, eq: [{ type: "hp", f: 160 }, { type: "peak", f: 4000, q: 1, gain: 2 }], reverb: 0.5, room: 0.3 });
    const hats = s.stem("hats", { level: 1.2, width: 1.4, room: 0.2 });
    const perc = s.stem("perc", { level: 0.32, eq: [{ type: "hp", f: 60 }], reverb: 0.3, room: 0.2 });
    const low = s.stem("sub", { level: 0.55, eq: [{ type: "lp", f: 700 }], duck: 0.35 });
    const keys = s.stem("piano", {
        level: 1.42,
        eq: [{ type: "hp", f: 90 }, { type: "peak", f: 300, q: 1, gain: -2.5 }, { type: "highshelf", f: 6000, q: 0.7, gain: 2 }],
        comp: { threshold: -22, ratio: 2, attack: 0.01, release: 0.2 },
        reverb: 0.32,
        delay: 0.05,
    });
    const strings = s.stem("strings", { level: 0.42, eq: [{ type: "hp", f: 160 }, { type: "peak", f: 500, q: 0.8, gain: -3 }], chorus: { rate: 0.22, depth: 0.004 }, reverb: 0.45, width: 1.5, duck: 0.15 });
    const lead = s.stem("lead", { level: 0.71, eq: [{ type: "hp", f: 500 }], reverb: 0.5, delay: 0.22 });
    const fx = s.stem("fx", { level: 0.37, eq: [{ type: "hp", f: 30 }], reverb: 0.3 });

    for (const b of BAR_LIST) {
        const c = chordAt(b);
        const t = (x) => s.at(b.n, x);
        const loose = () => s.loose(5);
        const voicing = (x) => (c.then && x >= 8 ? c.then : c.v);

        // ── piano ──
        const soft = b.kind === "premise" || b.kind === "claim";
        piano(keys, t(0), c.root + 12, s.beat * 4, { vel: soft ? 0.55 : 0.68 });
        if (b.kind === "end" && b.last) {
            // The last chord, rolled from the bottom, and a high E to finish.
            [...c.v, c.v[0] + 12].forEach((m, k) => piano(keys, t(0) + k * 0.045, m, s.beat * 4, { vel: 0.62 }));
            piano(keys, t(8), 88, s.beat * 2, { vel: 0.45 });
        } else {
            for (let e = 0; e < 8; e++) {
                const v = voicing(e * 2);
                const notes = [...v, v[0] + 12];
                const m = notes[WALK[e] % notes.length];
                const accent = e === 0 ? 0.62 : e % 2 ? 0.4 : 0.5;
                piano(keys, t(e * 2) + loose(), m, s.beat / 2, { vel: accent * (soft ? 0.82 : 1) * s.vary(0.07) });
            }
        }

        // ── strings ──
        if (b.kind !== "hook" || b.n === 1) {
            const swellIn = b.first ? 0.9 : 0.35;
            const open = b.kind === "end" ? 3800 : b.groove === "C" ? 3000 : b.groove === "B" ? 2400 : 1900;
            pad(strings, t(0), voicing(0), c.then ? s.beat * 2 : s.beat * 4, { vel: b.kind === "end" ? 0.9 : 0.6, cutoff: open, attack: swellIn, release: 0.7, voices: 6, detune: 12 });
            if (c.then) pad(strings, t(8), c.then, s.beat * 2, { vel: 0.6, cutoff: open, attack: 0.2, voices: 6, detune: 12 });
            // Cellos an octave under the root on the bigger sections.
            if (b.groove === "C" || b.kind === "end" || b.kind === "claim") pad(strings, t(0), [c.root + 12], s.beat * 4, { vel: 0.5, cutoff: 900, attack: 0.4, voices: 4, detune: 8 });
        }

        // ── the line ──
        if (b.groove === "C" || b.kind === "end" || (b.groove === "B" && b.n % 2 === 1)) {
            const phrase = b.kind === "end" ? [[0, b.last ? 80 : 83, 4]] : LINE[b.n % 4];
            for (const [x, m, d] of phrase) {
                const lift = b.kind === "end" && b.inner === 0 ? 80 : m;
                bell(lead, t(x * 4) + loose(), lift, d * s.beat, { vel: 0.6, ratio: 2, index: 0.9, decay: 1.8 });
            }
        }

        // ── low end: a heartbeat under the verbs ──
        if (b.kind === "verb" || (b.kind === "end" && !b.last)) {
            for (const x of [0, 3, 8, 11]) sub(low, t(x), c.root, (s.beat / 4) * 2.2, { vel: x % 8 === 0 ? 0.85 : 0.6 });
        } else if (b.kind === "premise" || b.kind === "claim" || (b.kind === "end" && b.last)) {
            sub(low, t(0), c.root, s.beat * 3.8, { vel: 0.7 });
        }

        // ── drums ──
        if (b.kind === "hook") {
            // Booms on the beat while the wall is dealt, toms answering.
            for (let q = 0; q < 4; q++) kick(s, kickStem, t(q * 4), { vel: 0.95, pitch: 40, decay: 0.42, click: 0.25 });
            if (b.n === 1) for (const [x, p] of [[10, 110], [11, 95], [14, 82], [15, 70]]) tom(perc, t(x), { vel: 0.7, pitch: p });
        } else if (b.kind === "verb" || (b.kind === "end" && !b.last)) {
            kick(s, kickStem, t(0), { vel: 1, pitch: 42, decay: 0.38, click: 0.3 });
            kick(s, kickStem, t(10), { vel: 0.8, pitch: 42, decay: 0.32, click: 0.25 });
            if (b.groove !== "A") kick(s, kickStem, t(7), { vel: 0.55, pitch: 42, decay: 0.25, click: 0.2, duck: false });
            snare(snareStem, t(8) + loose(), { vel: 0.95, tone: 175, decay: 0.24, body: 0.8 });
            for (let x = 0; x < 16; x += b.groove === "C" ? 1 : 2) hat(hats, t(x) + loose(), { vel: (x % 4 === 0 ? 0.45 : 0.25) * s.vary(0.15), decay: 0.03 });
            if (b.groove !== "A") for (let x = 1; x < 16; x += 2) shaker(perc, t(x) + loose(), { vel: 0.22 * s.vary(0.2), pan: -0.4 });
        } else if (b.kind === "claim") {
            boom(fx, t(0), { vel: 0.75, pitch: 40, decay: 0.8 });
            boom(fx, t(8), { vel: 0.75, pitch: 40, decay: 0.8 });
        } else if (b.kind === "end" && b.last) {
            kick(s, kickStem, t(0), { vel: 1, pitch: 40, decay: 0.6 });
        }

        // ── transitions ──
        if (b.first && b.n > 0) {
            crash(fx, t(0), { vel: b.kind === "end" || b.n === 4 ? 0.6 : 0.3, decay: 2.4 });
            if (b.kind !== "premise") boom(fx, t(0), { vel: b.kind === "end" ? 1 : 0.65, pitch: 38, decay: 0.9 });
            downlifter(fx, t(0), s.beat * 4, { vel: 0.2 });
        }
        if (b.next && b.next.kind !== "premise") {
            swell(fx, t(8), s.beat * 2, { vel: 0.4 });
            if (b.kind === "verb") for (const [x, p] of [[12, 120], [13, 105], [14, 92], [15, 78]]) tom(perc, t(x) + loose(), { vel: 0.55, pitch: p });
        }
        if (b.kind === "premise" && b.last) riser(fx, t(0), s.beat * 4, { vel: 0.6, to: 6000 });
        if (b.kind === "claim" && b.last) {
            riser(fx, t(0), s.beat * 4, { vel: 0.8, to: 7000 });
            const roll = [0, 2, 4, 6, 8, 9, 10, 11, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5];
            roll.forEach((x, k) => tom(perc, t(x), { vel: 0.3 + 0.5 * (k / roll.length), pitch: 75 + 50 * (k / roll.length) }));
        }
    }
    boom(fx, s.at(0, 0), { vel: 0.9, pitch: 38, decay: 1 });
    crash(fx, s.at(0, 0), { vel: 0.45, decay: 2.4 });
}
