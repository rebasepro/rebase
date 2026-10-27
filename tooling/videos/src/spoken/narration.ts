/**
 * SPOKEN FILMS — the part every narrated film shares: a script, the frames
 * its words were said at, and cues that hang a picture off a word.
 *
 * A film never places anything at an absolute frame. It names a line of its
 * script, or a word in one, or a line's end, plus frames (a `Cue`), and a
 * `Timing` — the authored read, a recorded take, or the presenter speaking
 * live on the recording page — says which frame that is. The desk film
 * (src/desk) was the first; the series (src/series) are built the same way,
 * so one recording page and one take processor serve all of them.
 *
 * LIVE IS CAUSAL. The recording page plays a film at real speed and learns a
 * word a moment after it was said. A cue whose moment is already past when it
 * becomes known must not start in the past — that is a jump on screen. So a
 * live word carries the frame it was HEARD, and nothing hanging off it starts
 * earlier. A word not yet said is absent, and so is everything hanging off it.
 */

/** One line of a script: what the presenter says, and where it falls in the
 *  authored read (nine frames a word from `at`). */
export interface ScriptLine {
    id: string;
    at: number;
    words: string[];
}

export type Script = readonly ScriptLine[];

/** The authored read: nine frames a word, about 200 a minute. */
export const FRAMES_PER_WORD = 9;

/** How far a live film may run with no end in sight: ten minutes. */
export const LIVE_HORIZON = 30 * 60 * 10;

/** When one line was said, in film frames. */
export interface SpokenLine {
    /** The frame each word started. Live, only the words said so far. */
    words: number[];
    /** The frame the last word ended. Absent while the line is being said. */
    end?: number;
    /** LIVE ONLY: the frame each word became known. */
    heard?: number[];
    /** LIVE ONLY: the frame the end became known. */
    endHeard?: number;
}

export interface Timing {
    /** One entry per line of the script, in order; null until said. */
    lines: (SpokenLine | null)[];
    /** The timing is still being written — the recording page is listening. */
    live?: boolean;
    /** A TAKE's: the words of each line as they were when it was read. A
     *  take's frames belong to those words, so a take read from another
     *  script cannot be timed against this one, and says so. */
    script?: string[][];
}

/** A moment in the narration: a line, a word in it or its end, plus frames. */
export interface Cue {
    line: string;
    /** A word of the line by its text (first occurrence, case and
     *  punctuation ignored), or by index. The line's first word if omitted. */
    word?: string | number;
    /** The moment the line ends, instead of a word. */
    end?: true;
    /** Frames after (or, negative, before) that moment. */
    plus: number;
}

/** The read a film was authored at. */
export function authoredTiming(script: Script, framesPerWord = FRAMES_PER_WORD): Timing {
    return {
        lines: script.map((l) => ({
            words: l.words.map((_, i) => l.at + i * framesPerWord),
            end: l.at + l.words.length * framesPerWord,
        })),
    };
}

const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

export function lineIndex(script: Script, line: string): number {
    const i = script.findIndex((l) => l.id === line);
    if (i < 0) throw new Error(`script: no line "${line}"`);
    return i;
}

export function wordIndex(script: Script, line: string, word: string | number | undefined): number {
    if (word === undefined) return 0;
    const words = script[lineIndex(script, line)].words;
    const i = typeof word === "number" ? word : words.findIndex((w) => bare(w) === bare(word));
    if (i < 0 || i >= words.length) throw new Error(`script: no word "${word}" in line "${line}"`);
    return i;
}

/** Where a cue falls (`at`) and the earliest anything hanging off it may
 *  start (`floor`: the frame its word was heard, live; else -Infinity).
 *  Null if its word has not been said. */
export function cueMoment(script: Script, t: Timing, cue: Cue): { at: number; floor: number } | null {
    const line = t.lines[lineIndex(script, cue.line)];
    if (!line) return null;
    if (cue.end) {
        if (line.end === undefined) return null;
        return { at: line.end + cue.plus, floor: line.endHeard ?? -Infinity };
    }
    const w = wordIndex(script, cue.line, cue.word);
    if (w >= line.words.length) return null;
    return { at: line.words[w] + cue.plus, floor: line.heard?.[w] ?? -Infinity };
}

/** A cue's frame, never earlier than its word was heard; null if unsaid. */
export function cueFrame(script: Script, t: Timing, cue: Cue): number | null {
    const m = cueMoment(script, t, cue);
    return m && Math.round(Math.max(m.at, m.floor));
}

/** A take read from other words than the script has now cannot be timed
 *  against it: cues find their words by position, and positions moved. */
export function assertSameScript(script: Script, read: string[][]): void {
    script.forEach((line, i) => {
        const was = read[i];
        if (!was || was.join(" ") !== line.words.join(" ")) {
            throw new Error(
                `This take was read from a different script: line "${line.id}" was ` +
                    `"${(was ?? []).join(" ")}", and is now "${line.words.join(" ")}". ` +
                    "Its timing belongs to the words it was read from — record it again with the current script.",
            );
        }
    });
}

/** Fails at import if any cue names a word its script does not have. */
export function checkCues(script: Script, cues: readonly Cue[]): void {
    for (const c of cues) wordIndex(script, c.line, c.word);
}
