import type { Ground } from "../theme";
import type { LineId } from "./script";

/**
 * THE DESK.
 *
 * One workspace, 5760 x 3240 — three by three frames of it — and a camera.
 * There are no cuts. The story is told by moving the camera from one part of
 * the desk to another, and the windows on it appear when the camera arrives.
 *
 * This replaces a seventeen-scene slideshow whose grammar never changed:
 * eyebrow, headline, one artefact, hold, cut. The film was a tour of claims.
 * This is one story: the backend from the opening — built by an agent in an
 * afternoon, three ways in — gets FIXED on screen. The rule is written, the
 * schema is pushed, and the same scan that found three ways in runs again and
 * finds none. Everything else the product does is shown as a consequence of
 * that, on the same desk, and the last shot pulls back to show all of it.
 *
 * Layout, by cell (each cell is one 1920 x 1080 frame of world):
 *
 *     (0,0) the hook       (1,0) the rule       (2,0) the agent
 *     (0,½) the terminal   (1,1) two people     (2,1) the panel
 *     (0,2) studio         (1,2) the schema     (2,2) every view
 *
 * The terminal view sits half a cell down from the hook on purpose: it
 * shares the scan window with it. The scan re-running in the SAME window,
 * next to the agent's own terminal, is the payoff of the opening, and a copy
 * of that window somewhere else would not be the same scan.
 *
 * The camera path: down to the terminal, right and up to the rule, back to
 * the terminal, right and down, right and up, down, down, left, left, out.
 * No two consecutive moves share a direction and no move crosses the whole
 * desk except the last.
 */

export const CELL = { w: 1920, h: 1080 } as const;
/** Three columns and FOUR rows: the wall of what the film leaves out sits
 *  under Studio, in the last cell before the pull-back. */
export const DESK = { w: CELL.w * 3, h: CELL.h * 4 } as const;

export interface View {
    /** World coordinate at the frame's top-left. */
    x: number;
    y: number;
    zoom: number;
}

/**
 * A moment in the narration: a line, or a word inside it, or the line's end,
 * plus a number of frames. Nothing on the desk is placed at an absolute frame
 * any more — every beat and every cue is one of these, and timeline.ts turns
 * them into frames from whatever says when the words were spoken: the
 * authored read at nine frames a word, a recorded take, or the presenter
 * speaking live.
 */
export interface Cue {
    line: LineId;
    /** A word of the line by its text (first occurrence, case and
     *  punctuation ignored), or by index. The line's first word if omitted. */
    word?: string | number;
    /** The moment the line ends, instead of a word. */
    end?: true;
    /** Frames after (or, negative, before) that moment. */
    plus: number;
}

export interface Beat {
    id: string;
    /** When the beat starts. The camera begins moving MOVE_LEAD frames
     *  before this and lands moveFrames() after. */
    at: Cue;
    view: View;
    /** The ribbon's rotation for this beat — see film.ts on why roll is the
     *  one lever that changes the view without changing coverage. */
    roll: number;
    /** Sideways camera offset for the ribbon, world units, default 0. A
     *  beat whose roll lands the cluster top-left — over its own eyebrow —
     *  pushes it right with this; measured, x 20 moves the cluster from the
     *  left quarter of the frame to the right half at a lower coverage. */
    x?: number;
    ground: Ground;
    reveal: number;
}

const cell = (col: number, row: number): View => ({ x: col * CELL.w, y: row * CELL.h, zoom: 1 });

/**
 * THE TEMPO of the AUTHORED read — the one the film falls back on when no
 * take exists: nine frames a word times this, and every move's length. It
 * was a stretch factor over a sheet of absolute frames (1.05 at one point);
 * there is no such sheet any more — beats hang off the words, so a slower
 * read is simply a later word — and it stays at 1. What it never touched is
 * anything inside a window: typing speed, a report streaming, a spring —
 * those are how fast the product is, not how fast anyone talks.
 */
export const TEMPO = 1;

/** The whole desk, framed on its content rather than its edges: the windows
 *  span roughly 200..5680 by 180..4200 now that the wall is a fourth row,
 *  and a 0.26 zoom from (-752, 113) puts that box on the frame, centred. */
const ALL: View = { x: -752, y: 113, zoom: 0.26 };

/** Where the camera is on the last frame: the same centre as ALL, a little
 *  further away. It never quite stops — the desk keeps receding under the
 *  address for the whole close, which is what makes the windows read as
 *  going rather than as a backdrop that happens to be dim. */
const FINAL: View = { x: -1145, y: -108, zoom: 0.235 };

/** The view that holds the terminal: half a cell below the hook, so the
 *  agent's own window and the scan stay in frame above it. Visited twice —
 *  once to point Rebase at the database, once to push and re-run the scan —
 *  and the return is the story: back to the terminal, next command. */
const TERMINAL: View = { x: 0, y: 420, zoom: 1 };

/**
 * THE ORDER IS CAUSAL. Each beat is what the previous one made happen:
 *
 *   hook    an agent's backend, three ways in
 *   init    so point Rebase at the same database — it writes a file per table
 *   rule    the rule goes in that file, and compiles to a policy
 *   push    push it; the same scan runs again and finds nothing; run it
 *   users   the API on :3001 answers two people differently
 *   agent   and answers an agent the same way
 *   panel   the panel on :5173 — then every view, the schema, Studio
 *   all     pull back; three commands; the address
 *
 * A first cut showed the rule BEFORE init (a file that did not exist yet),
 * and returned to "Init. Push. Run." as its own beat forty seconds after
 * both had already run. It was a tour with a story stapled to the front.
 */
export const BEATS: Beat[] = [
    /* No cold open. The film opens on the presenter, already talking; the
       ribbon fades up behind them over the first frames. A logo pre-roll
       here left a person on camera for over a second with nothing to say. */
    /* Each start is four frames after its line begins: the words lead the
       picture. Two exceptions: push starts ten frames BEFORE "You push
       it", so the command is typed as the word is said, and users starts
       inside the "run" line, on "answered", so the camera arrives at the
       two people as their names are said. How long a beat lasts is no
       longer a number here at all — it lasts until the next line begins,
       however long the presenter takes to say this one. */
    { id: "hook", at: { line: "question", plus: -3 }, view: cell(0, 0), roll: 0.58, ground: "base", reveal: 0.8 },
    { id: "init", at: { line: "init", plus: 4 }, view: TERMINAL, roll: 0.64, ground: "base", reveal: 0.8 },
    { id: "rule", at: { line: "rule", plus: 4 }, view: cell(1, 0), roll: 0.22, ground: "claim", reveal: 0.65 },
    { id: "push", at: { line: "push", plus: -10 }, view: TERMINAL, roll: 0.7, ground: "base", reveal: 0.8 },
    { id: "users", at: { line: "run", word: "answered", plus: 4 }, view: cell(1, 1), roll: 0.22, x: 20, ground: "base", reveal: 0.8 },
    { id: "agent", at: { line: "agent", plus: 4 }, view: cell(2, 0), roll: 0.34, x: 20, ground: "deep", reveal: 0.65 },
    { id: "panel", at: { line: "panel", plus: 4 }, view: cell(2, 1), roll: 0.64, ground: "base", reveal: 0.8 },
    { id: "views", at: { line: "views", plus: 4 }, view: cell(2, 2), roll: 0.16, ground: "base", reveal: 0.8 },
    { id: "schema", at: { line: "schema", plus: 4 }, view: cell(1, 2), roll: 0.74, ground: "base", reveal: 0.8 },
    { id: "studio", at: { line: "studio", plus: 4 }, view: cell(0, 2), roll: 0.46, ground: "base", reveal: 0.8 },
    /* The wall: 380 frames, enough for the line to name six of its
       twenty-four entries and for the cascade to finish under it. */
    { id: "more", at: { line: "wall", plus: 4 }, view: cell(0, 3), roll: 0.3, ground: "base", reveal: 0.8 },
    { id: "all", at: { line: "close", plus: 4 }, view: ALL, roll: 0.16, ground: "base", reveal: 0.7 },
];

/** Where the camera starts: on the hook, which is where it stays until the
 *  first move. */
export const OPENING: View = cell(0, 0);

/** Where the camera ends: see FINAL. Exported for the timeline, which
 *  places the recession under the close. */
export { FINAL };

/** How early a move begins, relative to the beat it moves into. The
 *  narration for a beat starts a few frames before it, so the picture is
 *  already on its way when the line begins. */
export const MOVE_LEAD = 8;

/** A move's length grows with its distance — a frame-wide pan at a fixed 26
 *  frames is a whip, and the one move that crosses the whole desk (the pull
 *  back at the end) gets its own, slower, number. */
export function moveFrames(from: View, to: View): number {
    if (to.zoom !== from.zoom) return Math.round(64 * TEMPO);
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    return Math.round((30 + d / 300) * TEMPO);
}

/**
 * WHAT A MOVE LOOKS LIKE, and why the windows fade.
 *
 * A pan to the next cell is a full frame of travel, and there is no way to
 * make it less: whatever the pitch of the grid, bringing the neighbour fully
 * into view displaces the screen by exactly one frame. The first cut let the
 * outgoing windows ride that whole sweep at full strength, and every
 * transition read as a whip — the complaint was "too much displacement".
 *
 * So the windows a beat is leaving behind fade over the first half of the
 * move, and are gone before the camera reaches speed; what crosses the
 * middle of the move is the ground and the ribbon turning, neither of which
 * travels. Windows the next beat shares with this one (the scan, the shell)
 * stay; windows it brings back (the hook's, on the way into push) fade in
 * over the second half. Measured on the eased curve, a window now travels
 * about a fifth of the distance before it is gone — the displacement a slide
 * used to have, not a pan's.
 *
 * The pull-back at the end is the one move that fades everything IN: the
 * desk reveals itself as the camera lifts off it.
 */
export const FADE_OUT_BY = 0.55;
export const FADE_IN_FROM = 0.45;
