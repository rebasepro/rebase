/**
 * The launch film's clock, shared by the picture and the music.
 *
 * The film is cut to the beat, so tempo is the one number everything else is
 * derived from. `scripts/compose-launch-music.mjs` imports this file to write
 * the soundtrack and the composition imports it to place every cut, so the
 * two cannot drift: change BPM here and both move.
 *
 * Erasable TypeScript only (no enums, no namespaces): Node runs this file
 * directly with type stripping when the music script imports it.
 */

export const FPS = 60;
export const BPM = 120;

/** Frames per beat and per bar. At 120 BPM and 60 fps a beat is 30 frames. */
export const BEAT = (FPS * 60) / BPM;
export const BAR = BEAT * 4;

/**
 * The film's sections, in bars, in order. Each one starts on a downbeat.
 *
 * `kind` is what the music arranges by: the hook and the verbs get the full
 * groove, the premise a lighter one, the claim is the breakdown and the end
 * is the drop. The verbs follow docs/PRODUCT.md's ranked claims — one
 * definition, security in the database, the backend, agents, then the panel
 * and Studio — so the two claims the product rests on get three bars each.
 */
export const SECTIONS = {
    hook: { bar: 0, bars: 2, kind: "hook" },
    premise: { bar: 2, bars: 2, kind: "premise" },
    define: { bar: 4, bars: 3, kind: "verb" },
    secure: { bar: 7, bars: 3, kind: "verb" },
    build: { bar: 10, bars: 2, kind: "verb" },
    agents: { bar: 12, bars: 2, kind: "verb" },
    manage: { bar: 14, bars: 2, kind: "verb" },
    shape: { bar: 16, bars: 2, kind: "verb" },
    claim: { bar: 18, bars: 2, kind: "claim" },
    end: { bar: 20, bars: 3, kind: "end" },
} as const;

export type Section = keyof typeof SECTIONS;

export const BARS = 23;
export const DURATION = BAR * BARS;

/** The frame a bar (and optionally a beat inside it) starts on. */
export const at = (bar: number, beat = 0) => bar * BAR + beat * BEAT;

/** First frame of a section. */
export const sectionStart = (s: Section) => at(SECTIONS[s].bar);

/** Length of a section in frames. */
export const sectionLength = (s: Section) => SECTIONS[s].bars * BAR;

/**
 * One chord per bar, as MIDI notes: the bass root, then the pad voicing.
 * vi–IV–I–V in C through the body; the claim is a ii–V (Dm7, Gsus) that
 * resolves to I on the logo, then IV–I, so the film ends at rest rather than
 * on a loop point.
 */
export interface Chord {
    name: string;
    root: number;
    pad: number[];
}

const Am7: Chord = { name: "Am7", root: 45, pad: [57, 60, 64, 67] };
const Fmaj7: Chord = { name: "Fmaj7", root: 41, pad: [53, 57, 60, 64] };
const Cmaj7: Chord = { name: "Cmaj7", root: 48, pad: [55, 59, 60, 64] };
const G6: Chord = { name: "G6", root: 43, pad: [55, 59, 62, 64] };
const Dm7: Chord = { name: "Dm7", root: 38, pad: [53, 57, 60, 62] };
const Gsus: Chord = { name: "Gsus4", root: 43, pad: [55, 60, 62, 67] };
const Cmaj9: Chord = { name: "Cmaj9", root: 48, pad: [52, 55, 59, 62] };
const Cadd9: Chord = { name: "Cadd9", root: 48, pad: [55, 60, 62, 64] };

const LOOP = [Am7, Fmaj7, Cmaj7, G6];

export const CHORDS: Chord[] = Array.from({ length: BARS }, (_, bar) => {
    if (bar >= SECTIONS.end.bar) return [Cmaj9, Fmaj7, Cadd9][bar - SECTIONS.end.bar];
    if (bar >= SECTIONS.claim.bar) return [Dm7, Gsus][bar - SECTIONS.claim.bar];
    return LOOP[bar % LOOP.length];
});
