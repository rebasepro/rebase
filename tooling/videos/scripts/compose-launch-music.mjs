#!/usr/bin/env node
/**
 * Composes the launch film's soundtracks: `public/launch/music-<track>.wav`.
 *
 *   node scripts/compose-launch-music.mjs            every track
 *   node scripts/compose-launch-music.mjs keynote    one
 *
 * Each track is an arrangement (scripts/launch-music/<track>.mjs) of the same
 * form — the film's sections, from src/launch/score.ts — so every cut lands
 * on a downbeat whichever track plays. Synthesis, mixing and mastering are in
 * scripts/launch-music/engine.mjs; nothing is sampled and every random choice
 * is seeded, so a track renders the same bytes every time.
 *
 * Each render prints what it measured — integrated loudness (BS.1770), peak,
 * stereo correlation and the energy per octave — because these tracks are
 * judged by numbers as well as by ear.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRACKS } from "../src/launch/score.ts";
import { Session, correlation, loudness, octaveBands, resetSeeds, toDb, wav } from "./launch-music/engine.mjs";
import { BPM, SECONDS } from "./launch-music/form.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "public", "launch");

const args = process.argv.slice(2);
const showStems = args.includes("--stems");
const wanted = args.filter((a) => a !== "--stems");
for (const w of wanted) if (!TRACKS.includes(w)) throw new Error(`unknown track "${w}" — one of ${TRACKS.join(", ")}`);

mkdirSync(OUT, { recursive: true });
for (const track of wanted.length ? wanted : TRACKS) {
    const started = Date.now();
    const style = await import(`./launch-music/${track}.mjs`);
    resetSeeds();
    const session = new Session(SECONDS, { bpm: BPM, swing: style.swing });
    style.compose(session);
    const { L, R } = session.master(style.mix);

    let peak = 0;
    for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    writeFileSync(join(OUT, `music-${track}.wav`), wav(L, R));
    const bands = octaveBands(L, R)
        .map(([f, d]) => `${f >= 1000 ? `${f / 1000}k` : f}:${d.toFixed(0)}`)
        .join(" ");
    if (showStems) {
        const loud = Math.max(...session.report.map(([, d]) => d));
        console.log(session.report.map(([n, d]) => `${n} ${(d - loud).toFixed(1)}`).join("  "));
    }
    console.log(
        `${track.padEnd(10)} ${loudness(L, R).toFixed(1)} LUFS  peak ${toDb(peak).toFixed(1)} dBFS  corr ${correlation(L, R).toFixed(2)}  ${((Date.now() - started) / 1000).toFixed(0)}s\n           ${bands}`,
    );
}
