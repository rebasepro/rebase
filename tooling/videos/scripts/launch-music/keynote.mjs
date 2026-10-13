/**
 * KEYNOTE — clean, bright, modern electronic: the register of a product
 * keynote. A Rhodes comping on IV–I–ii–V in D (with the extensions that keep
 * it from sounding like the first four chords anyone learns), a glass-bell
 * hook in D major pentatonic, a tight swung four-on-the-floor with 808 metal
 * on top, and a sub that rolls under the kick.
 */
import { bell, boom, clap, crash, ep, hat, kick, pad, rim, riser, shaker, snare, sub, swell, downlifter } from "./instruments.mjs";
import { BAR_LIST } from "./form.mjs";

export const name = "keynote";
export const swing = 0.54;
export const mix = { reverb: { rt60: 2.2, damp: 0.42, predelay: 0.022, size: 1 }, delay: { time: 0.75, feedback: 0.32 }, lufs: -12 };

const CH = {
    Gmaj9: { root: 43, v: [59, 62, 66, 69] },
    DF: { root: 42, v: [57, 62, 64, 66] },
    Em11: { root: 40, v: [55, 59, 62, 69] },
    A11: { root: 45, v: [55, 59, 62, 64] },
    Em9: { root: 40, v: [55, 59, 62, 66] },
    A13s: { root: 45, v: [55, 59, 64, 66] },
    Dmaj9: { root: 38, v: [57, 61, 64, 66] },
    D69: { root: 38, v: [57, 59, 64, 66] },
};
const LOOP = [CH.Gmaj9, CH.DF, CH.Em11, CH.A11];

function chordAt(b) {
    if (b.kind === "claim") return [CH.Em9, CH.A13s][b.inner];
    if (b.kind === "end") return [CH.Dmaj9, CH.Gmaj9, CH.D69][b.inner];
    return LOOP[b.n % 4];
}

/** The hook: a call (two bars) and an answer (two bars), in 16ths. */
const CALL = [
    [0, 83, 3], [3, 81, 3], [6, 78, 2], [8, 81, 4], [13, 86, 3],
    [16, 81, 3], [19, 78, 3], [22, 76, 2], [24, 78, 6], [30, 74, 2],
];
const ANSWER = [
    [0, 83, 3], [3, 81, 3], [6, 78, 2], [8, 76, 4], [13, 74, 3],
    [16, 76, 3], [19, 78, 3], [22, 81, 2], [24, 83, 8],
];

export function compose(s) {
    const kickStem = s.stem("kick", { level: 0.85, eq: [{ type: "hp", f: 30 }] });
    const clapStem = s.stem("clap", { level: 1.55, eq: [{ type: "hp", f: 320 }], room: 0.3, reverb: 0.1 });
    const hats = s.stem("hats", { level: 1.1, width: 1.3, room: 0.08 });
    const perc = s.stem("perc", { level: 0.4, eq: [{ type: "hp", f: 400 }], room: 0.25, delay: 0.1 });
    const bass = s.stem("bass", { level: 0.4, eq: [{ type: "lp", f: 900, q: 0.7 }], duck: 0.55, drive: 0.25 });
    const keys = s.stem("keys", {
        level: 1.2,
        eq: [{ type: "hp", f: 150 }, { type: "peak", f: 380, q: 1, gain: -3 }, { type: "highshelf", f: 5500, q: 0.7, gain: 1.5 }],
        comp: { threshold: -20, ratio: 2.5, attack: 0.008, release: 0.12 },
        duck: 0.3,
        reverb: 0.22,
    });
    const padStem = s.stem("pad", { level: 0.32, eq: [{ type: "hp", f: 220 }, { type: "peak", f: 450, q: 0.9, gain: -3 }], chorus: { rate: 0.3 }, duck: 0.5, reverb: 0.35, width: 1.35 });
    const hook = s.stem("hook", { level: 0.78, eq: [{ type: "hp", f: 450 }], delay: 0.26, reverb: 0.28 });
    const fx = s.stem("fx", { level: 0.5, eq: [{ type: "hp", f: 35 }], reverb: 0.22 });

    for (const b of BAR_LIST) {
        const c = chordAt(b);
        const t = (x) => s.at(b.n, x);
        const loose = () => s.loose(3);

        // ── harmony ──
        if (b.kind === "premise" || b.kind === "claim") {
            for (const m of c.v) ep(keys, t(0) + loose(), m, s.beat * 3.8, { vel: 0.62 * s.vary(0.06) });
        } else if (b.kind === "end" && b.last) {
            for (const m of [...c.v, c.v[1] + 12]) ep(keys, t(0) + loose(), m, s.beat * 4, { vel: 0.75 });
        } else {
            // Syncopated comp: on the one, the "a" of two, and the "and" of three.
            for (const [x, d, v] of [[0, 5, 0.74], [6, 3, 0.6], [10, 6, 0.68]]) {
                for (const m of c.v) ep(keys, t(x) + loose(), m, (d * s.beat) / 4, { vel: v * s.vary(0.06) });
            }
        }
        if (b.groove === "C" || b.kind === "claim" || b.kind === "end") {
            pad(padStem, t(0), c.v.map((m) => m + 12), s.beat * 4, { vel: b.kind === "claim" ? 0.75 : 0.55, cutoff: 2600, attack: 0.35 });
        }

        // ── bass ──
        if (b.kind === "premise") {
            sub(bass, t(0), c.root, s.beat * 1.8, { vel: 0.7 });
            sub(bass, t(8), c.root, s.beat * 1.8, { vel: 0.6 });
        } else if (b.kind === "claim") {
            // breakdown: the bass leaves
        } else if (b.kind === "end" && b.last) {
            sub(bass, t(0), c.root, s.beat * 3.6, { vel: 0.85 });
        } else {
            const roll = b.groove === "B" ? [[0, 0, 2], [3, 0, 1], [6, 12, 1], [8, 0, 2], [11, 0, 1], [13, 7, 1], [14, 12, 2]] : [[0, 0, 2], [3, 0, 1], [6, 12, 1], [8, 0, 2], [11, 0, 1], [14, 7, 2]];
            for (const [x, iv, d] of roll) sub(bass, t(x), c.root + iv, (d * s.beat) / 4 - 0.02, { vel: x % 4 === 0 ? 0.85 : 0.7 });
        }

        // ── the hook ──
        const playHook = b.kind === "hook" || b.groove === "A" || b.groove === "C" || (b.kind === "end" && !b.last) || (b.groove === "B" && b.n % 2 === 0);
        if (playHook) {
            const phrase = b.n % 4 < 2 ? CALL : ANSWER;
            const off = (b.n % 2) * 16;
            for (const [x, m, d] of phrase) {
                if (x < off || x >= off + 16) continue;
                const lift = b.kind === "end" ? 12 : 0;
                bell(hook, t(x - off) + loose(), m + lift, (d * s.beat) / 4, { vel: 0.7 * s.vary(0.08), pan: 0.15 });
                if (b.groove === "C" || b.kind === "end") bell(hook, t(x - off) + loose(), m - 12 + lift, (d * s.beat) / 4, { vel: 0.4, pan: -0.2, ratio: 2 });
            }
        } else if (b.kind === "end" && b.last) {
            bell(hook, t(0), 86, s.beat * 3, { vel: 0.8 });
            bell(hook, t(0) + 0.01, 74, s.beat * 3, { vel: 0.5, ratio: 2 });
        }

        // ── drums ──
        const groove = b.kind === "hook" || b.kind === "verb" || (b.kind === "end" && !b.last);
        if (groove) {
            for (let q = 0; q < 4; q++) kick(s, kickStem, t(q * 4), { vel: 1, decay: 0.26 });
            if (!(b.kind === "hook" && b.n === 0)) {
                clap(clapStem, t(4) + loose(), { vel: 0.9 * s.vary(0.05) });
                clap(clapStem, t(12) + loose(), { vel: 0.95 * s.vary(0.05) });
            }
            const sixteenths = !(b.kind === "hook" && b.n === 0);
            for (let x = 0; x < 16; x++) {
                if (x % 4 === 2) hat(hats, t(x) + loose(), { vel: (b.groove === "C" ? 0.55 : 0.42) * s.vary(0.1), open: true });
                else if (sixteenths || x % 2 === 0) hat(hats, t(x) + loose(), { vel: [0.8, 0.28, 0.5, 0.3][x % 4] * s.vary(0.12) });
            }
            if (b.groove === "B") {
                for (const x of [3, 7, 11, 14]) rim(perc, t(x) + loose(), { vel: 0.4 * s.vary(0.1) });
                for (let x = 0; x < 16; x++) shaker(perc, t(x) + loose(), { vel: (x % 2 ? 0.25 : 0.4) * s.vary(0.15), pan: 0.4 });
            }
        } else if (b.kind === "premise") {
            kick(s, kickStem, t(0), { vel: 0.8, decay: 0.24 });
            if (!b.last) kick(s, kickStem, t(8), { vel: 0.7, decay: 0.24 });
            for (let x = 0; x < 16; x++) shaker(perc, t(x) + loose(), { vel: (x % 2 ? 0.2 : 0.32) * s.vary(0.15), pan: 0.35 });
            for (const x of [2, 6, 10, 14]) hat(hats, t(x) + loose(), { vel: 0.25 });
        } else if (b.kind === "claim") {
            // A low hit under each word.
            boom(fx, t(0), { vel: 0.65 });
            boom(fx, t(8), { vel: 0.65 });
        } else if (b.kind === "end" && b.last) {
            kick(s, kickStem, t(0), { vel: 1, decay: 0.4 });
        }

        // ── transitions ──
        if (b.first && b.n > 0) {
            crash(fx, t(0), { vel: b.kind === "end" || b.n === 4 ? 0.7 : 0.4 });
            if (b.kind === "verb" || b.kind === "end") boom(fx, t(0), { vel: b.kind === "end" ? 0.9 : 0.55 });
            downlifter(fx, t(0), s.beat * 3, { vel: 0.25 });
        }
        if (b.next && (b.next.kind === "verb" || b.next.kind === "end" || b.next.kind === "claim")) {
            swell(fx, t(8), s.beat * 2, { vel: 0.35 });
            if (b.kind === "verb") for (let k = 0; k < 4; k++) snare(perc, t(12 + k), { vel: 0.25 + k * 0.12 });
        }
        if (b.kind === "premise" && b.last) riser(fx, t(0), s.beat * 4, { vel: 0.7 });
        if (b.kind === "claim" && b.last) {
            riser(fx, t(0), s.beat * 4, { vel: 0.9 });
            const hits = [0, 2, 4, 6, 8, 9, 10, 11, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5];
            hits.forEach((x, k) => snare(perc, t(x), { vel: 0.2 + 0.6 * (k / hits.length) }));
        }
    }
    crash(fx, s.at(0, 0), { vel: 0.7 });
    boom(fx, s.at(0, 0), { vel: 0.8 });
}
