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
 *     (0,½) push + rescan  (1,1) two people     (2,1) the panel
 *     (0,2) studio         (1,2) the schema     (2,2) every view
 *
 * The push view sits half a cell down from the hook on purpose: it shares
 * the scan window with it. The scan re-running in the SAME window, next to
 * the agent's own terminal, is the payoff of the opening, and a copy of that
 * window somewhere else would not be the same scan.
 *
 * The camera path is a snake — right, back and down, right and down, right
 * and up, down, down, left, left, up, out — so no two consecutive moves are
 * the same direction and no move crosses the whole desk except the last.
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

/** The whole desk, framed on its content rather than its edges: the windows
 *  span roughly 240..5680 by 180..3160, and a 0.34 zoom from (150, 120) puts
 *  that box on the frame. */
const ALL: View = { x: 150, y: 120, zoom: 0.34 };

/** Where the camera is on the last frame: the same centre as ALL, a little
 *  further away. It never quite stops — the desk keeps receding under the
 *  address for the whole close, which is what makes the windows read as
 *  going rather than as a backdrop that happens to be dim. */
const FINAL: View = { x: -226, y: -92, zoom: 0.3 };

export const BEATS: Beat[] = [
    { id: "hook", start: 66, view: cell(0, 0), roll: 0.58, ground: "base", reveal: 0.3 },
    { id: "rule", start: 340, view: cell(1, 0), roll: 0.22, ground: "claim", reveal: 0.3 },
    { id: "push", start: 600, view: { x: 0, y: 420, zoom: 1 }, roll: 0.64, ground: "base", reveal: 0.3 },
    { id: "users", start: 860, view: cell(1, 1), roll: 0.22, ground: "base", reveal: 0.3 },
    { id: "agent", start: 1096, view: cell(2, 0), roll: 0.34, ground: "deep", reveal: 0.3 },
    { id: "panel", start: 1290, view: cell(2, 1), roll: 0.64, ground: "base", reveal: 0.3 },
    { id: "views", start: 1550, view: cell(2, 2), roll: 0.16, ground: "base", reveal: 0.3 },
    { id: "schema", start: 1650, view: cell(1, 2), roll: 0.74, ground: "base", reveal: 0.3 },
    { id: "studio", start: 1770, view: cell(0, 2), roll: 0.46, ground: "base", reveal: 0.3 },
    { id: "commands", start: 1870, view: { x: 0, y: 900, zoom: 1 }, roll: 0.7, ground: "base", reveal: 0.3 },
    { id: "all", start: 2050, view: ALL, roll: 0.16, ground: "base", reveal: 0.3 },
];

/** The cold open holds the camera on the hook before anything is on it. */
export const OPENING: View = cell(0, 0);

export const DESK_DURATION = 2350;

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
    if (to.zoom !== from.zoom) return 64;
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    return Math.round(24 + d / 240);
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
