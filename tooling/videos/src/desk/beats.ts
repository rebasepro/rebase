import { Easing, interpolate } from "remotion";
import type { Ground } from "../theme";

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
export const DESK = { w: CELL.w * 3, h: CELL.h * 3 } as const;

export interface View {
    /** World coordinate at the frame's top-left. */
    x: number;
    y: number;
    zoom: number;
}

export interface Beat {
    id: string;
    /** Absolute frame the beat starts. The camera begins moving 8 frames
     *  before this and lands MOVE frames after. */
    start: number;
    view: View;
    /** The ribbon's rotation for this beat — see film.ts on why roll is the
     *  one lever that changes the view without changing coverage. */
    roll: number;
    ground: Ground;
    reveal: number;
}

const cell = (col: number, row: number): View => ({ x: col * CELL.w, y: row * CELL.h, zoom: 1 });

/**
 * THE TEMPO. Every beat below was first timed at a 180-words-a-minute read
 * and the film came in at 78 seconds; it played a shade fast. Rather than
 * re-time eleven beats and eleven lines by hand, the sheet keeps its
 * original numbers and everything after the cold open is stretched by
 * this factor — beats, moves and the narration's frames alike, so no
 * relationship between them changes. 1.1 is 86 seconds and a 164-word
 * read. What is NOT stretched is anything inside a window: typing speed,
 * a report streaming, a spring — those are how fast the product is, and
 * the product did not get slower.
 */
export const TEMPO = 1.1;
const COLD_OPEN = 66;
/** A frame from the original sheet, on the stretched timeline. */
export const tempo = (raw: number): number => COLD_OPEN + Math.round((raw - COLD_OPEN) * TEMPO);

/** The whole desk, framed on its content rather than its edges: the windows
 *  span roughly 200..5680 by 180..3160, and a 0.34 zoom from (150, 120) puts
 *  that box on the frame. */
const ALL: View = { x: 150, y: 120, zoom: 0.34 };

/** Where the camera is on the last frame: the same centre as ALL, a little
 *  further away. It never quite stops — the desk keeps receding under the
 *  address for the whole close, which is what makes the windows read as
 *  going rather than as a backdrop that happens to be dim. */
const FINAL: View = { x: -226, y: -92, zoom: 0.3 };

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
    { id: "hook", start: tempo(66), view: cell(0, 0), roll: 0.58, ground: "base", reveal: 0.3 },
    { id: "init", start: tempo(460), view: TERMINAL, roll: 0.64, ground: "base", reveal: 0.3 },
    { id: "rule", start: tempo(680), view: cell(1, 0), roll: 0.22, ground: "claim", reveal: 0.3 },
    { id: "push", start: tempo(920), view: TERMINAL, roll: 0.7, ground: "base", reveal: 0.3 },
    { id: "users", start: tempo(1160), view: cell(1, 1), roll: 0.22, ground: "base", reveal: 0.3 },
    { id: "agent", start: tempo(1400), view: cell(2, 0), roll: 0.34, ground: "deep", reveal: 0.3 },
    { id: "panel", start: tempo(1600), view: cell(2, 1), roll: 0.64, ground: "base", reveal: 0.3 },
    { id: "views", start: tempo(1860), view: cell(2, 2), roll: 0.16, ground: "base", reveal: 0.3 },
    { id: "schema", start: tempo(1970), view: cell(1, 2), roll: 0.74, ground: "base", reveal: 0.3 },
    { id: "studio", start: tempo(2090), view: cell(0, 2), roll: 0.46, ground: "base", reveal: 0.3 },
    { id: "all", start: tempo(2200), view: ALL, roll: 0.16, ground: "base", reveal: 0.3 },
];

/** The cold open holds the camera on the hook before anything is on it. */
export const OPENING: View = cell(0, 0);

export const DESK_DURATION = tempo(2580);

export const beat = (id: string): Beat => {
    const b = BEATS.find((x) => x.id === id);
    if (!b) throw new Error(`no beat ${id}`);
    return b;
};

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
const FADE_OUT_BY = 0.55;
const FADE_IN_FROM = 0.45;

/** Which beat the camera is in or moving into, and how far along the move. */
export function deskPhase(frame: number): { beat: number; moving: boolean; t: number } {
    for (let i = 0; i < BEATS.length; i++) {
        const a = KEY_AT[2 * i + 1];
        const z = KEY_AT[2 * i + 2];
        if (frame < a) return { beat: i - 1, moving: false, t: 0 };
        if (frame < z) return { beat: i, moving: true, t: (frame - a) / (z - a) };
    }
    return { beat: BEATS.length - 1, moving: false, t: 0 };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Opacity of a window that is on camera during `shown` beats. */
export function windowOpacity(frame: number, shown: readonly string[]): number {
    const { beat, moving, t } = deskPhase(frame);
    const has = (i: number) => i >= 0 && shown.includes(BEATS[i].id);
    if (!moving) return has(beat) ? 1 : 0;
    const from = has(beat - 1);
    const to = has(beat);
    if (from && to) return 1;
    if (!from && !to) return 0;
    if (from) return 1 - clamp01(t / FADE_OUT_BY);
    return clamp01((t - FADE_IN_FROM) / (1 - FADE_IN_FROM));
}

/* Piecewise: hold at a view, ease to the next across its move window. Built
   as keyframe arrays so the camera is a pure function of the absolute frame —
   the same property the ribbon's own camera has, and for the same reason:
   the renderer seeks. */
const KEY_AT: number[] = [0];
const KEY_VIEW: View[] = [OPENING];
BEATS.forEach((b, i) => {
    const from = i === 0 ? OPENING : BEATS[i - 1].view;
    const a = b.start - MOVE_LEAD;
    const z = a + moveFrames(from, b.view);
    KEY_AT.push(a, z);
    KEY_VIEW.push(from, b.view);
});
KEY_AT.push(DESK_DURATION);
KEY_VIEW.push(FINAL);

const EASE = Easing.inOut(Easing.cubic);
const OPTS = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE } as const;

export function cameraAt(frame: number): View {
    return {
        x: interpolate(frame, KEY_AT, KEY_VIEW.map((v) => v.x), OPTS),
        y: interpolate(frame, KEY_AT, KEY_VIEW.map((v) => v.y), OPTS),
        zoom: interpolate(frame, KEY_AT, KEY_VIEW.map((v) => v.zoom), OPTS),
    };
}

/** True while the camera is at rest — used to drop the transform's
 *  fractional part so type rasterises on whole pixels. */
export function cameraStill(frame: number): boolean {
    for (let i = 1; i < KEY_AT.length; i += 2) {
        if (frame > KEY_AT[i] && frame < KEY_AT[i + 1]) return false;
    }
    return true;
}
