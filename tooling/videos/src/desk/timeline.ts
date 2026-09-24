import { createContext, useContext } from "react";
import { Easing, interpolate } from "remotion";
import {
    BEATS,
    FADE_IN_FROM,
    FADE_OUT_BY,
    FINAL,
    MOVE_LEAD,
    moveFrames,
    OPENING,
    type Beat,
    type Cue,
    type View,
} from "./beats";
import { DESK_FRAMES_PER_WORD, DESK_NARRATION, type LineId } from "./script";

/**
 * THE TIMELINE — every frame on the desk, computed from when the words were
 * said.
 *
 * The film used to be a sheet of absolute frames laid out for a read at
 * exactly nine frames a word, and the presenter was asked to hit them.
 * Nobody reads at a fixed rate, and a read chasing a timer sounds like one.
 * So nothing is placed at a frame any more. A beat, a window, a line of a
 * report — each hangs off a word of the script (a `Cue`, beats.ts), and this
 * file turns cues into frames from a `Timing`: the frame each word started.
 *
 * Three things produce a Timing:
 *
 *   AUTHORED  nine frames a word from each line's `at` (script.ts). With it
 *             the film is frame-for-frame the one the sheet described — the
 *             fallback while no take exists, and what the regression check
 *             compares against.
 *   A TAKE    the frames the presenter actually said each word, measured
 *             from the recording (scripts/take.mjs). The render follows them.
 *   LIVE      the presenter speaking NOW, heard by the recording page
 *             (src/live). Words arrive as they are said, so the film is
 *             built one word at a time while it plays.
 *
 * LIVE IS CAUSAL. The page plays the film at real speed and learns a word
 * a moment after it was said (speech recognition runs a few hundred
 * milliseconds behind). A cue whose moment is already in the past when it
 * becomes known must not start in the past — a move that began 18 frames
 * ago would appear 18 frames in, a jump. So a live word carries the frame it
 * was HEARD, and nothing hanging off it starts earlier than that. A word not
 * yet said is simply absent, and so is everything that hangs off it: the
 * camera holds, the window waits. Nothing on screen depends on the future.
 */

/** When one line of the script was said, in film frames. */
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
    /** One entry per line of DESK_NARRATION, in order; null until said. */
    lines: (SpokenLine | null)[];
    /** The timing is still being written — the recording page is listening. */
    live?: boolean;
}

/** The read the film was authored at: nine frames a word from each line's
 *  `at`, and a line ends where its next word would have started. */
export const AUTHORED: Timing = {
    lines: DESK_NARRATION.map((l) => ({
        words: l.words.map((_, i) => l.at + i * DESK_FRAMES_PER_WORD),
        end: l.at + l.words.length * DESK_FRAMES_PER_WORD,
    })),
};

/** How far a live film may run with no end in sight: ten minutes. Anything
 *  that lasts "until the end of the film" lasts this long until the end is
 *  known. */
export const LIVE_HORIZON = 30 * 60 * 10;

/** How long the camera recedes under the close when the close's length is
 *  not known yet (live): what the authored close gives it. A take's close
 *  recedes for exactly as long as the line takes. */
const RECEDE = 367;

/** The least a view is held before the camera leaves it again. Only a read
 *  much faster than the authored one reaches it — every authored hold is
 *  over a hundred frames — and then the next move waits rather than
 *  starting before the last one has landed. */
const MIN_HOLD = 12;

/* ── cues → frames ───────────────────────────────────────────────────── */

const LINE_INDEX = new Map<LineId, number>(DESK_NARRATION.map((l, i) => [l.id, i]));

const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "");

function wordIndex(line: LineId, word: string | number | undefined): number {
    if (word === undefined) return 0;
    const words = DESK_NARRATION[LINE_INDEX.get(line) ?? -1]?.words;
    if (!words) throw new Error(`timeline: no line "${line}"`);
    const i = typeof word === "number" ? word : words.findIndex((w) => bare(w) === bare(word));
    if (i < 0 || i >= words.length) throw new Error(`timeline: no word "${word}" in line "${line}"`);
    return i;
}

/** Where a cue falls — `at` — and the earliest anything hanging off it may
 *  start — `floor`, the frame its word was heard (live), else -Infinity.
 *  Null if the word has not been said. */
function cueMoment(t: Timing, cue: Cue): { at: number; floor: number } | null {
    const line = t.lines[LINE_INDEX.get(cue.line) ?? -1];
    if (!line) return null;
    if (cue.end) {
        if (line.end === undefined) return null;
        return { at: line.end + cue.plus, floor: line.endHeard ?? -Infinity };
    }
    const w = wordIndex(cue.line, cue.word);
    if (w >= line.words.length) return null;
    return { at: line.words[w] + cue.plus, floor: line.heard?.[w] ?? -Infinity };
}

/** A cue's frame under this timing, or null if its word has not been said.
 *  Never earlier than the word was heard. */
export function cueFrame(t: Timing, cue: Cue): number | null {
    const m = cueMoment(t, cue);
    return m && Math.round(Math.max(m.at, m.floor));
}

/* ── the cues the desk hangs its windows on ──────────────────────────── */

/**
 * Every moment on the desk that is not a beat's start. Each is either a
 * fixed number of frames after a beat — how long the product takes to do
 * something is not how long anyone takes to say it — or pinned to a word,
 * where the picture has to land ON the word. Where both apply, the later
 * wins: the report waits for "critical", but never prints before the command
 * that produces it has been typed.
 *
 * Under the authored read every one of these is the frame the old sheet
 * had; the numbers after each are that frame.
 */
export interface DeskCues {
    /** The presenter leaves the middle of the frame for the corner. 137 */
    flyToCorner: number | null;
    /** The hook's headline, as the presenter goes. 149 */
    hookTitle: number | null;
    /** The agent's session, as "A coding agent built this one" begins —
     *  but never before the presenter has cleared the middle. 155 */
    agentSession: number | null;
    /** The scan window, on "And a ten-second scan". 353 */
    scan: number | null;
    /** The scan's report starts printing, timed so its tally ("critical 9")
     *  lands under "nine critical issues". 381 */
    scanReport: number | null;
    /** `rebase init` is typed as the camera lands on the terminal. 538 */
    shell: number | null;
    /** `rebase db push` is typed as "You push it" is said. 1194 */
    push: number | null;
    /** The same scan re-runs once push has printed, timed so its clean
     *  report is up before "clean". 1226 */
    rerun: number | null;
    /** `rebase dev` is typed as "Then you run it" begins. 1322 */
    dev: number | null;
    /** The query and its two answers, so the rows arrive on "Robert sees
     *  his own orders". 1416 */
    users: number | null;
    /** The agent's MCP console. 1656 */
    agentConsole: number | null;
    /** The delete call and its 403, on "and nothing more". 1730 */
    agentRefuse: number | null;
    /** The presenter lifts off the corner for the close. 3091 */
    flyToClose: number | null;
    /** The last frames go to black and the ribbon fades out. 3440 */
    fadeOut: number | null;
}

/* ── the placed film ─────────────────────────────────────────────────── */

export interface PlacedBeat extends Beat {
    /** Frame the beat starts: its cue, pushed later only if the previous
     *  move has not landed, or (live) if its word was heard late. */
    start: number;
    /** Frame the camera leaves the previous view. */
    moveAt: number;
    /** Frame it lands on this one. */
    landAt: number;
    /** The view it leaves. */
    from: View;
}

export interface DeskTimeline {
    timing: Timing;
    /** The beats whose moment has come, in order. Live, the film so far. */
    beats: PlacedBeat[];
    /** The film's length: the close's last word, and 49 frames of ground
     *  and address after it. Null until the close has been said. */
    duration: number | null;
    cues: DeskCues;
    beat(id: string): PlacedBeat | null;
    /** Which beat the camera is in or moving into, and how far along. */
    phase(frame: number): { beat: number; moving: boolean; t: number };
    /** Opacity of a window that is on camera during `shown` beats. */
    windowOpacity(frame: number, shown: readonly string[]): number;
    camera(frame: number): View;
    /** True while the camera is at rest — the desk drops its transform's
     *  fractional part then, so type rasterises on whole pixels. */
    cameraStill(frame: number): boolean;
    /** "Until the end of the film", as a frame: the end if known, else the
     *  live horizon. */
    until: number;
}

const EASE = Easing.inOut(Easing.cubic);
const OPTS = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE } as const;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function placeBeats(t: Timing): PlacedBeat[] {
    const placed: PlacedBeat[] = [];
    let from = OPENING;
    let landed = 0;
    for (const b of BEATS) {
        const m = cueMoment(t, b.at);
        /* A beat whose word has not been said is left out, and so is the
           camera's move into it. Live, that is the future; in a take it
           would be a line the presenter skipped. */
        if (!m) continue;
        /* The move leads the beat by MOVE_LEAD — but never starts before
           its word was heard, which live is usually after the word was
           said: the move then starts on hearing it, a few frames late,
           rather than a few frames in. */
        const moveAt = Math.round(Math.max(m.at - MOVE_LEAD, m.floor, placed.length ? landed + MIN_HOLD : 1));
        const landAt = moveAt + moveFrames(from, b.view);
        placed.push({ ...b, start: moveAt + MOVE_LEAD, moveAt, landAt, from });
        from = b.view;
        landed = landAt;
    }
    return placed;
}

const timelines = new WeakMap<Timing, DeskTimeline>();

/** The desk's timeline under a timing. Memoised on the timing object, so a
 *  component can call it every frame. */
export function buildDeskTimeline(t: Timing): DeskTimeline {
    const cached = timelines.get(t);
    if (cached) return cached;

    const beats = placeBeats(t);
    const byId = new Map(beats.map((b) => [b.id, b]));
    const startOf = (id: string) => byId.get(id)?.start ?? null;
    const at = (cue: Cue) => cueFrame(t, cue);
    const plus = (x: number | null, n: number) => (x === null ? null : x + n);
    /** The later of several moments — or null while any is still unsaid. */
    const latest = (...xs: (number | null)[]) => (xs.some((x) => x === null) ? null : Math.max(...(xs as number[])));

    const duration = at({ line: "close", end: true, plus: 49 });
    const flyToCorner = at({ line: "question", end: true, plus: 5 });
    const scan = at({ line: "evidence", word: "And", plus: 15 });
    const push = plus(startOf("push"), 14);
    const rerun = latest(plus(push, 32), at({ line: "push", word: "same", plus: -9 }));
    const agentConsole = plus(startOf("agent"), 26);

    const cues: DeskCues = {
        flyToCorner,
        hookTitle: plus(flyToCorner, 12),
        agentSession: latest(plus(flyToCorner, 18), at({ line: "evidence", plus: -12 })),
        scan,
        /* The command takes 28 frames to type and return; the tally is 33
           frames into the report. */
        scanReport: latest(plus(scan, 28), at({ line: "evidence", word: "critical", plus: -47 })),
        shell: plus(startOf("init"), 8),
        push,
        /* Push prints its last line 22 frames after it is typed. */
        rerun,
        /* The clean report has settled 45 frames after the re-run starts. */
        dev: latest(plus(rerun, 48), at({ line: "run", plus: 2 })),
        users: latest(plus(startOf("users"), 20), at({ line: "run", word: "Robert", plus: -21 })),
        agentConsole,
        /* The list call's answer is up 44 frames in; the refusal follows it. */
        agentRefuse: latest(plus(agentConsole, 60), at({ line: "agent", word: "nothing", plus: -13 })),
        flyToClose: plus(startOf("all"), 4),
        fadeOut: at({ line: "close", end: true, plus: -21 }),
    };

    /* The camera: hold at a view, ease to the next across its move window,
       as keyframe arrays, so it is a pure function of the frame — the
       renderer seeks. The recession under the close is the last key. */
    const keyAt = [0];
    const keyView: View[] = [OPENING];
    for (const b of beats) {
        keyAt.push(b.moveAt, b.landAt);
        keyView.push(b.from, b.view);
    }
    const last = beats[beats.length - 1];
    if (last?.id === "all") {
        const recedeTo = t.live || duration === null ? last.landAt + RECEDE : Math.max(last.landAt + 1, duration);
        keyAt.push(recedeTo);
        keyView.push(FINAL);
    }

    const phase = (frame: number) => {
        for (let i = 0; i < beats.length; i++) {
            const { moveAt, landAt } = beats[i];
            if (frame < moveAt) return { beat: i - 1, moving: false, t: 0 };
            if (frame < landAt) return { beat: i, moving: true, t: (frame - moveAt) / (landAt - moveAt) };
        }
        return { beat: beats.length - 1, moving: false, t: 0 };
    };

    const timeline: DeskTimeline = {
        timing: t,
        beats,
        duration,
        cues,
        until: duration ?? LIVE_HORIZON,
        beat: (id) => byId.get(id) ?? null,
        phase,
        windowOpacity(frame, shown) {
            const { beat, moving, t: k } = phase(frame);
            const has = (i: number) => i >= 0 && shown.includes(beats[i].id);
            if (!moving) return has(beat) ? 1 : 0;
            const from = has(beat - 1);
            const to = has(beat);
            if (from && to) return 1;
            if (!from && !to) return 0;
            if (from) return 1 - clamp01(k / FADE_OUT_BY);
            return clamp01((k - FADE_IN_FROM) / (1 - FADE_IN_FROM));
        },
        camera(frame) {
            if (keyAt.length < 2) return OPENING;
            return {
                x: interpolate(frame, keyAt, keyView.map((v) => v.x), OPTS),
                y: interpolate(frame, keyAt, keyView.map((v) => v.y), OPTS),
                zoom: interpolate(frame, keyAt, keyView.map((v) => v.zoom), OPTS),
            };
        },
        cameraStill(frame) {
            for (let i = 1; i < keyAt.length; i += 2) {
                if (frame > keyAt[i] && frame < keyAt[i + 1]) return false;
            }
            return true;
        },
    };
    timelines.set(t, timeline);
    return timeline;
}

/** Fails at import, not mid-render, if a cue names a word the script no
 *  longer has — the script is edited far more often than this file. */
for (const b of BEATS) wordIndex(b.at.line, b.at.word);

/* ── in React ────────────────────────────────────────────────────────── */

export const DeskTimelineContext = createContext<DeskTimeline>(buildDeskTimeline(AUTHORED));

export const useDeskTimeline = (): DeskTimeline => useContext(DeskTimelineContext);
