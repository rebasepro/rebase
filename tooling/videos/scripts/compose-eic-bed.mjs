#!/usr/bin/env node
/**
 * Composes the EIC film's music bed: `public/eic/bed.wav`.
 *
 *   node scripts/compose-eic-bed.mjs
 *
 * A bed, not a score: it sits far under two people talking for two minutes,
 * so no drums, no risers, nothing that lands on a beat the picture would have
 * to answer. Soft piano walking the chords, slow string pads, a low note under
 * each bar and a bell now and then, in D major (I–vi–IV–V, voiced with 9ths so
 * it floats). Same engine and instruments as the launch tracks
 * (scripts/launch-music); nothing is sampled and every random choice is
 * seeded, so it renders the same bytes every time.
 *
 * It is mixed under the voice by ffmpeg, ducked while anyone speaks (see
 * VOICEOVER-EIC.md), so the level here is only a starting point.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Session, loudness, resetSeeds, toDb, wav } from "./launch-music/engine.mjs";
import { bell, pad, piano, sub } from "./launch-music/instruments.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "public", "eic");

const BPM = 84;
const BARS = 48;
/** The last chord rings out past the final bar. */
const SECONDS = (BARS * 4 * 60) / BPM + 4;

const CH = {
    Dmaj9: { root: 38, v: [54, 57, 61, 64] },
    Bm9: { root: 35, v: [50, 54, 57, 61] },
    Gmaj9: { root: 31, v: [54, 57, 59, 62] },
    Asus: { root: 33, v: [52, 57, 59, 62], then: [52, 57, 61, 64] },
};
const LOOP = [CH.Dmaj9, CH.Bm9, CH.Gmaj9, CH.Asus];

/** The piano walks the voicing in quarters, then a softer eighth pickup. */
const WALK = [0, 2, 1, 3];
/** A bell over every fourth bar of the loop's first chord: four notes, one phrase. */
const BELLS = [81, 78, 76, 73];

resetSeeds();
const s = new Session(SECONDS, { bpm: BPM, swing: 0.5 });
const keys = s.stem("piano", {
    level: 1,
    eq: [{ type: "hp", f: 110 }, { type: "peak", f: 320, q: 1, gain: -3 }, { type: "highshelf", f: 6000, q: 0.7, gain: 1 }],
    comp: { threshold: -24, ratio: 2, attack: 0.01, release: 0.25 },
    reverb: 0.45,
    delay: 0.06,
});
const strings = s.stem("strings", { level: 0.5, eq: [{ type: "hp", f: 150 }, { type: "peak", f: 500, q: 0.8, gain: -3 }], chorus: { rate: 0.18, depth: 0.004 }, reverb: 0.5, width: 1.5 });
const low = s.stem("sub", { level: 0.4, eq: [{ type: "lp", f: 500 }] });
const lead = s.stem("bell", { level: 0.45, eq: [{ type: "hp", f: 600 }], reverb: 0.6, delay: 0.25 });

for (let n = 0; n < BARS; n++) {
    const c = n === BARS - 1 ? CH.Dmaj9 : LOOP[n % 4];
    const t = (x) => s.at(n, x);
    const loose = () => s.loose(6);
    const intro = n < 2;
    const last = n === BARS - 1;
    /* In from nothing over the first two bars; the last four thin out. */
    const lift = intro ? 0.6 + 0.2 * n : n >= BARS - 4 ? 0.85 : 1;

    pad(strings, t(0), c.v, s.beat * 4, { vel: 0.5 * lift, cutoff: 1500, attack: intro ? 2.2 : 1.1, release: 1.4, voices: 6, detune: 10 });
    if (!intro) sub(low, t(0), c.root, s.beat * 3.8, { vel: 0.5 * lift });

    if (last) {
        [...c.v, c.v[0] + 12].forEach((m, k) => piano(keys, t(0) + k * 0.06, m, s.beat * 8, { vel: 0.42 }));
        bell(lead, t(4), 81, s.beat * 4, { vel: 0.4, ratio: 2, index: 0.8, decay: 2.4 });
        continue;
    }
    if (n === 0) continue;
    for (let q = 0; q < 4; q++) {
        const v = c.then && q >= 2 ? c.then : c.v;
        const notes = [...v, v[0] + 12];
        piano(keys, t(q * 4) + loose(), notes[WALK[q] % notes.length], s.beat, { vel: (q === 0 ? 0.42 : 0.32) * lift * s.vary(0.08), bright: 0.8 });
    }
    if (n % 2 === 1) piano(keys, t(14) + loose(), c.v[3] + 12, s.beat / 2, { vel: 0.22 * lift, bright: 0.7 });
    if (n >= 4 && n % 8 === 4) BELLS.forEach((m, k) => bell(lead, t(k * 4) + loose(), m, s.beat * 1.5, { vel: 0.32, ratio: 2, index: 0.8, decay: 1.8 }));
}

const { L, R } = s.master({ reverb: { rt60: 3.2, damp: 0.42, predelay: 0.03, size: 1.1 }, delay: { time: 0.75, feedback: 0.28 }, lufs: -18, air: 1 });
let peak = 0;
for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "bed.wav"), wav(L, R));
console.log(`bed  ${SECONDS.toFixed(1)}s  ${loudness(L, R).toFixed(1)} LUFS  peak ${toDb(peak).toFixed(1)} dBFS`);
