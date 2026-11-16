import { FRAMES_PER_WORD, type Script, type ScriptLine, type SpokenLine, type Timing } from "./narration";

/**
 * A PRODUCTION — a film recorded once, in as many takes as it takes, and
 * released as one or more CUTS.
 *
 *   the SCRIPT    every line anyone will read, in reading order: the long
 *                 film's lines and any line only a short says (its own hook
 *                 or sign-off). One script, so one prompter and one set of
 *                 takes serve every cut.
 *   CHAPTERS      the script in pieces you record one at a time — a hook,
 *                 a setup, the turn, the fix. A take is any run of lines:
 *                 a chapter, part of one, or the whole film.
 *   CUTS          the films released from it: each picks its lines from the
 *                 script (by id) and has its own scenes. The long film is
 *                 16:9 and three to five minutes; a short is 9:16 and under
 *                 a minute, made of the long film's best lines.
 *
 * Nothing here knows about React or Remotion: the recording page, the
 * render's props and the command line (scripts/assemble.ts) all assemble a
 * cut the same way, with `assemble()` below.
 */

export interface Chapter {
    id: string;
    title: string;
    /** Its lines, by id, in script order. */
    lines: readonly string[];
}

/** A stretch of one recording, placed in a film. `from`/`to` are film
 *  frames; `startFrom` is the recording's frame at `from`. */
export interface Clip {
    src: string;
    take: string;
    from: number;
    to: number;
    startFrom: number;
}

/** The chapters a production without its own has: the whole script. */
export function wholeScript(script: Script): Chapter[] {
    return [{ id: "all", title: "The whole film", lines: script.map((l) => l.id) }];
}

/** Lines of a script by id, re-spaced at the authored read so a cut that
 *  leaves lines out has no holes in its authored timing. */
export function cutScript(script: Script, ids: readonly string[], start = 15, gap = 30): Script {
    const byId = new Map(script.map((l) => [l.id, l]));
    let at = start;
    return ids.map((id, i) => {
        const line = byId.get(id);
        if (!line) throw new Error(`cut: the script has no line "${id}"`);
        const placed: ScriptLine = { ...line, at };
        at += line.words.length * FRAMES_PER_WORD + (i === 0 ? gap + 6 : gap);
        return placed;
    });
}

/** Fails at import when chapters do not cover the script exactly once, in
 *  order — a line in no chapter could never be recorded on its own. */
export function checkChapters(script: Script, chapters: readonly Chapter[]): readonly Chapter[] {
    const flat = chapters.flatMap((c) => c.lines);
    const ids = script.map((l) => l.id);
    if (flat.join("\n") !== ids.join("\n")) {
        throw new Error(`chapters must list every line of the script once, in order.\n  script:   ${ids.join(", ")}\n  chapters: ${flat.join(", ")}`);
    }
    return chapters;
}

/* ── takes ───────────────────────────────────────────────────────────── */

/** One line as a take recorded it, in the RECORDING's frames. */
export interface TakeLine {
    id: string;
    words: string[];
    /** The frame each word started. */
    at: number[];
    /** The frame the last word ended. */
    end: number;
}

/** A processed take, as the server lists it. */
export interface TakeInfo {
    id: string;
    film: string;
    recordedAt: string;
    /** The take under public/. */
    src: string;
    /** The recording's length, in frames. */
    frames: number;
    /** The lines it covers, in the order they were read. */
    lines: TakeLine[];
    simulated?: boolean;
    /** What the processor said about it. */
    summary?: string;
}

/** Which take serves each line: the presenter's choice, by line id. */
export interface Edit {
    picks: Record<string, string>;
}

/** Whether a take's reading of a line still matches the script's words. A
 *  take read from older words is kept, but cannot serve the line. */
export function serves(take: TakeInfo, line: ScriptLine): boolean {
    const l = take.lines.find((x) => x.id === line.id);
    return !!l && l.words.join(" ") === line.words.join(" ");
}

/** The take that serves a line: the pick if it still can, else the newest
 *  take that can. Null if no take can. */
export function takeFor(line: ScriptLine, takes: readonly TakeInfo[], edit: Edit | null): TakeInfo | null {
    const picked = edit?.picks[line.id];
    const usable = takes.filter((t) => serves(t, line));
    if (picked) {
        const t = usable.find((x) => x.id === picked);
        if (t) return t;
    }
    return usable.reduce<TakeInfo | null>((best, t) => (!best || t.id > best.id ? t : best), null);
}

/**
 * The take serving each line of a cut. A pick wins. Otherwise the newest
 * take that reads the line serves it — except that a line stays with the
 * take serving the line before it, if that take reads it too, unless a newer
 * take STARTS at this line (a retake "from here"). So a film cuts between
 * takes where you re-recorded, and nowhere else.
 */
export function chooseTakes(cut: Script, takes: readonly TakeInfo[], edit: Edit | null): (TakeInfo | null)[] {
    const out: (TakeInfo | null)[] = [];
    cut.forEach((line, k) => {
        const picked = edit?.picks[line.id];
        const usable = takes.filter((t) => serves(t, line));
        const pick = picked ? usable.find((t) => t.id === picked) : undefined;
        if (pick) return out.push(pick);
        const prev = out[k - 1];
        if (prev && usable.includes(prev)) {
            const restarted = usable.some((t) => t.id > prev.id && t.lines[0]?.id === line.id);
            if (!restarted) return out.push(prev);
        }
        out.push(takeFor(line, takes, null));
    });
    return out;
}

/* ── assembly ────────────────────────────────────────────────────────── */

/** The first word lands here, as in an authored film. */
export const LEAD_IN = 15;
/** Room kept before a run's first word and after its last, at most: the
 *  breath on either side of a cut. Two of them make the pause between runs. */
export const HEAD = 10;
export const TAIL = 10;
/** After the film's last word: the end card's tail and a little more. */
export const LAST_TAIL = 60;
/** Frames two runs overlap, the later fading in over the earlier: a cut
 *  that never jumps. */
export const DISSOLVE = 4;
/** A line nobody has recorded yet is held at a read's pace, so the cut can
 *  be watched before it is finished: ten frames a word, 180 a minute. */
const MISSING_FRAMES_PER_WORD = 10;

export interface Assembly {
    /** The cut's timing, in film frames, for the cut's own script. */
    timing: Timing;
    /** What the presenter's window plays. Gaps show the placeholder. */
    clips: Clip[];
    /** For each line of the cut, the take serving it, or null. */
    sources: (string | null)[];
    /** Lines nobody has recorded (held at a read's pace). */
    missing: string[];
    /** The cut's length, in frames: its last word, then the end card. */
    frames: number;
}

/**
 * A cut, from the takes that serve it.
 *
 * Its lines are walked in order and grouped into RUNS: consecutive lines
 * served by one take, read one after the other in it. Each run becomes one
 * clip: from a little before its first word to a little after its last,
 * never reaching into the lines the take read either side. The runs are laid
 * end to end, so the pause between two is the breath kept after the one and
 * before the other — the presenter's own, cut in the silence. Within a run
 * nothing is cut at all: its timing is the take's.
 */
export function assemble(cut: Script, takes: readonly TakeInfo[], edit: Edit | null, endTail = 50): Assembly {
    const sources = chooseTakes(cut, takes, edit);
    const lines: (SpokenLine | null)[] = cut.map(() => null);
    const clips: Clip[] = [];
    const missing: string[] = [];
    let cursor = 0;
    let k = 0;
    while (k < cut.length) {
        const take = sources[k];
        const first = k === 0;
        if (!take) {
            /* Not recorded: a read's pace, no clip — the placeholder shows. */
            const line = cut[k];
            missing.push(line.id);
            const start = cursor + (first ? LEAD_IN : HEAD);
            const words = line.words.map((_, i) => start + i * MISSING_FRAMES_PER_WORD);
            const end = start + line.words.length * MISSING_FRAMES_PER_WORD;
            lines[k] = { words, end };
            cursor = end + TAIL;
            k++;
            continue;
        }
        /* The run: as long as the next line is the take's next line. */
        const index = (id: string) => take.lines.findIndex((l) => l.id === id);
        let last = k;
        while (last + 1 < cut.length && sources[last + 1]?.id === take.id && index(cut[last + 1].id) === index(cut[last].id) + 1) last++;
        const a = take.lines[index(cut[k].id)];
        const b = take.lines[index(cut[last].id)];
        const before = take.lines[index(cut[k].id) - 1];
        const after = take.lines[index(cut[last].id) + 1];
        const start = a.at[0];
        const end = b.end;
        const roomBefore = before ? Math.floor((start - before.end) / 2) : start;
        const roomAfter = after ? Math.floor((after.at[0] - end) / 2) : take.frames - end;
        const isLast = last === cut.length - 1;
        const head = Math.max(0, Math.min(first ? LEAD_IN : HEAD, roomBefore));
        const tail = Math.max(0, Math.min(isLast ? LAST_TAIL : TAIL, roomAfter));
        /* film = recording + offset, through the whole run */
        const offset = cursor + (first ? LEAD_IN - head : 0) - (start - head);
        const from = start - head + offset;
        const to = end + tail + offset;
        clips.push({ src: take.src, take: take.id, from, to, startFrom: start - head });
        for (let j = k; j <= last; j++) {
            const l = take.lines[index(cut[j].id)];
            lines[j] = { words: l.at.map((f) => f + offset), end: l.end + offset };
        }
        cursor = to;
        k = last + 1;
    }
    const lastLine = lines[lines.length - 1];
    const frames = (lastLine?.end ?? cursor) + endTail;
    return {
        timing: { lines, script: cut.map((l) => l.words) },
        clips,
        sources: sources.map((t) => t?.id ?? null),
        missing,
        frames,
    };
}
