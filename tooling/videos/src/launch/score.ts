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

/** The film's sections, in bars. Each one starts on a downbeat. */
export const SECTIONS = {
    hook: { bar: 0, bars: 2 },
    premise: { bar: 2, bars: 2 },
    build: { bar: 4, bars: 2 },
    manage: { bar: 6, bars: 2 },
    shape: { bar: 8, bars: 2 },
    claim: { bar: 10, bars: 2 },
    end: { bar: 12, bars: 3 },
} as const;

export type Section = keyof typeof SECTIONS;

export const BARS = 15;
export const DURATION = BAR * BARS;

/** The frame a bar (and optionally a beat inside it) starts on. */
export const at = (bar: number, beat = 0) => bar * BAR + beat * BEAT;

/** First frame of a section. */
export const sectionStart = (s: Section) => at(SECTIONS[s].bar);

/** Length of a section in frames. */
export const sectionLength = (s: Section) => SECTIONS[s].bars * BAR;

/**
 * One chord per bar, as MIDI notes: the bass root, then the pad voicing.
 * vi–IV–I–V in C through the body, lifting to the IV and resolving IV–I on
 * the logo so the film ends at rest rather than on a loop point.
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
const Gsus: Chord = { name: "Gsus4", root: 43, pad: [55, 60, 62, 67] };
const Cmaj9: Chord = { name: "Cmaj9", root: 48, pad: [52, 55, 59, 62] };
const Cadd9: Chord = { name: "Cadd9", root: 48, pad: [55, 60, 62, 64] };

export const CHORDS: Chord[] = [
    Am7, Fmaj7, Cmaj7, G6, // hook, premise
    Am7, Fmaj7, Cmaj7, G6, // build, manage
    Am7, Fmaj7, // shape
    Fmaj7, Gsus, // claim — the breakdown hangs on the IV and the suspended V
    Cmaj9, Fmaj7, Cadd9, // end — lands on I, plagal close
];
