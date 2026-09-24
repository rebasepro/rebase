import { DESK_NARRATION } from "../desk/script";

/**
 * A SIMULATED PRESENTER — the script read aloud as the page would hear it,
 * without a microphone: the voice starting and stopping, and recognition
 * returning the words late, in growing interim transcripts, sometimes
 * wrong. It exists so the follower and the live film can be exercised
 * end to end (in Node, and in the page with `?simulate`) before anyone
 * records anything, and it knows the truth, so how far off the follower
 * is can be measured rather than eyeballed.
 */

export type SimEvent =
    | { atMs: number; kind: "voice"; speaking: boolean; voiceAtMs: number }
    | { atMs: number; kind: "session" }
    | { atMs: number; kind: "transcript"; text: string; final: boolean };

export interface SimOptions {
    /** Words a minute. The authored read is 200; people read at 140-170. */
    wpm: number;
    /** When the first word is said. */
    startMs: number;
    /** Silence between lines, ms: [shortest, longest]. */
    pause: [number, number];
    /** Recognition's delay after a word ends. */
    latencyMs: number;
    /** Share of words recognised as something else, and not at all. */
    mishear: number;
    drop: number;
    seed: number;
}

export const SIM_DEFAULTS: SimOptions = {
    wpm: 155,
    startMs: 1600,
    pause: [700, 1500],
    latencyMs: 420,
    mishear: 0.08,
    drop: 0.03,
    seed: 7,
};

export interface SimRead {
    events: SimEvent[];
    /** When each word really started, and each line really ended, in ms. */
    words: number[][];
    ends: number[];
}

/** A small deterministic PRNG, so a simulated read is repeatable. */
function random(seed: number) {
    let s = seed >>> 0 || 1;
    return () => {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return ((s >>> 0) % 100000) / 100000;
    };
}

const WRONG = ["the", "and", "a", "to", "fine", "okay", "table", "same", "there", "four"];

export function simulateRead(options: Partial<SimOptions> = {}): SimRead {
    const o = { ...SIM_DEFAULTS, ...options };
    const rnd = random(o.seed);
    const events: SimEvent[] = [];
    const words: number[][] = [];
    const ends: number[] = [];
    const beat = 60000 / o.wpm;

    /* The recogniser's view: a session transcript growing word by word. */
    let session: string[] = [];
    let sessionStartedMs = 0;
    const heardAt: { atMs: number; text: string | null; final: boolean }[] = [];

    let t = o.startMs;
    DESK_NARRATION.forEach((line) => {
        const said: number[] = [];
        events.push({ atMs: t + 120, kind: "voice", speaking: true, voiceAtMs: t });
        line.words.forEach((word, i) => {
            said.push(t);
            const letters = word.replace(/[^A-Za-z0-9]/g, "").length;
            const d = beat * (0.55 + 0.09 * Math.min(letters, 10)) * (0.85 + 0.3 * rnd());
            t += d;
            const r = rnd();
            const text = r < o.drop ? null : r < o.drop + o.mishear ? WRONG[Math.floor(rnd() * WRONG.length)] : word;
            const sentenceEnd = /[.?!:]$/.test(word) || i === line.words.length - 1;
            heardAt.push({ atMs: t + o.latencyMs * (0.8 + 0.4 * rnd()), text, final: sentenceEnd });
            if (i < line.words.length - 1) {
                if (/[,]$/.test(word)) t += 160 + 80 * rnd();
                if (/[.?!:]$/.test(word)) {
                    const gap = 320 + 240 * rnd();
                    /* A pause long enough for the voice detector to call it
                       silence (it waits 400 ms) is a voice off and on. */
                    if (gap > 420) {
                        events.push({ atMs: t + 400, kind: "voice", speaking: false, voiceAtMs: t });
                        events.push({ atMs: t + gap + 120, kind: "voice", speaking: true, voiceAtMs: t + gap });
                    }
                    t += gap;
                }
            }
        });
        words.push(said);
        ends.push(t);
        events.push({ atMs: t + 400, kind: "voice", speaking: false, voiceAtMs: t });
        t += o.pause[0] + (o.pause[1] - o.pause[0]) * rnd();
    });

    /* Recognition events, in time order: each word extends the interim
       transcript; a sentence end finalises it; a long session restarts. */
    heardAt.sort((a, b) => a.atMs - b.atMs);
    for (const h of heardAt) {
        if (h.atMs - sessionStartedMs > 45000 && h.final) {
            /* Restarts happen at a pause, between results. */
            events.push({ atMs: h.atMs - 1, kind: "session" });
            session = [];
            sessionStartedMs = h.atMs;
        }
        if (h.text !== null) session.push(h.text);
        events.push({ atMs: h.atMs, kind: "transcript", text: session.join(" "), final: h.final });
    }
    events.unshift({ atMs: 0, kind: "session" });
    events.sort((a, b) => a.atMs - b.atMs);
    return { events, words, ends };
}
