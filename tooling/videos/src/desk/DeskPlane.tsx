import React from "react";
import { Easing, getInputProps, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { NeatTravel } from "../gradient/NeatCanvas";
import { DraftingGrid, GlowField, isChromaGround, seatForRoll } from "../gradient/GlowField";
import { useDeskTimeline, type DeskTimeline } from "./timeline";
import { GROUND } from "../theme";

/**
 * The ground under the desk: the site's drafted-instrument backdrop (the
 * glow field masked into the ground, the drafting grid on its rails — see
 * gradient/GlowField.tsx), on the schedule the ribbon ran on until
 * 2026-11-09. The same real @firecms/neat as the slide film's Plane.tsx, with
 * its schedule read from BEATS instead of SCENES: the field flows to each
 * beat's seat while the camera moves and holds while it holds,
 * the ground colour cross-fades over the same window, and the clock is
 * warped so the art is nearly still under a held shot and quick across a
 * move. See Plane.tsx for why each of those is the way it is; nothing about
 * the ribbon itself changes here, only what drives it.
 */

/** Measured (RebaseDesk-Plane, scripts in the session's scratchpad): at
 *  y -12 the ribbon covered 10-12% of the frame as a band across the whole
 *  top, its fringe down to half the frame and across every headline; at
 *  -16 it was 3-5%, a cluster the user found too small. -14 is between —
 *  6-8%, a shape across the top strip — and the static fade below takes the
 *  fringe off the type. The camera never travels; the ribbon turns with
 *  each beat's roll, as it always did. */
const DEFAULT_STATION = { x: 0, y: -14, zoom: 2.05 };
/** The open stands at the old height: the presenter is centred on the art
 *  and there is no headline yet, so the ribbon can show more than a sliver.
 *  It settles to the station above in the same window the presenter flies
 *  to the corner — one move, once. */
const OPEN_Y = -12;
/** Overridable through input props, so a measurement sweep can render the
 *  plane alone at candidate stations without editing this file. Only a
 *  render has input props: the Player — the recording page — throws on
 *  asking, and a plain page has none. */
function stationOverride(): Partial<typeof DEFAULT_STATION> {
    try {
        return (getInputProps() as { station?: Partial<typeof DEFAULT_STATION> }).station ?? {};
    } catch {
        return {};
    }
}
const STATION = { ...DEFAULT_STATION, ...stationOverride() };

/* Keyframes: [hold-end, move-end] per beat, so odd indices close a hold and
   even ones close a move — the alternation the time warp is built on. They
   are the camera's own move windows (timeline.ts), so the ribbon turns
   exactly while the camera moves; live, only the beats placed so far. */
interface RibbonKeys {
    at: number[];
    roll: number[];
    side: number[];
    r: number[];
    g: number[];
    b: number[];
    reveal: number[];
    warped: number[];
}

/* The last frames are ground and the wordmark, nothing else. The fade is the
   timeline's `fadeOut` cue: seventy frames before the end. */
const rgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
];

const HOLD_RATE = 0.2;
const MOVE_RATE = 2.0;

const keysByTimeline = new WeakMap<DeskTimeline, RibbonKeys>();

function ribbonKeys(tl: DeskTimeline): RibbonKeys {
    const cached = keysByTimeline.get(tl);
    if (cached) return cached;
    const at: number[] = [0];
    const roll: number[] = [0.1];
    const side: number[] = [0];
    const ground: string[] = [GROUND.base];
    const reveal: number[] = [0];
    const last = <T,>(xs: T[]) => xs[xs.length - 1];
    for (const b of tl.beats) {
        at.push(b.moveAt, b.landAt);
        roll.push(last(roll), b.roll);
        side.push(last(side), b.x ?? 0);
        ground.push(last(ground), GROUND[b.ground]);
        reveal.push(last(reveal), b.reveal);
    }
    const { fadeOut } = tl.cues;
    if (fadeOut !== null && tl.duration !== null && tl.beats.length) {
        const from = Math.max(fadeOut, last(at) + 1);
        at.push(from, Math.max(tl.duration, from + 1));
        roll.push(last(roll), last(roll));
        side.push(last(side), last(side));
        ground.push(last(ground), last(ground));
        reveal.push(last(reveal), 0);
    }
    const warped = at.reduce<number[]>((acc, t, i) => {
        if (i === 0) return [0];
        acc.push(acc[i - 1] + (t - at[i - 1]) * (i % 2 === 1 ? HOLD_RATE : MOVE_RATE));
        return acc;
    }, []);
    const keys: RibbonKeys = {
        at,
        roll,
        side,
        r: ground.map((h) => rgb(h)[0]),
        g: ground.map((h) => rgb(h)[1]),
        b: ground.map((h) => rgb(h)[2]),
        reveal,
        warped,
    };
    keysByTimeline.set(tl, keys);
    return keys;
}

const EASE = Easing.inOut(Easing.cubic);
const OPTS = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE } as const;
const LINEAR = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Eased between keyframes and held past the last — live, the last is the
 *  latest beat placed, and the ribbon holds its roll until the next. */
function keyed(frame: number, at: number[], values: number[]): number {
    return at.length < 2 ? values[0] : interpolate(frame, at, values, OPTS);
}

export function ribbonAt(frame: number, tl: DeskTimeline): NeatTravel {
    const k = ribbonKeys(tl);
    const fly = tl.cues.flyToCorner;
    return {
        cameraX: STATION.x + keyed(frame, k.at, k.side),
        cameraY: fly === null ? OPEN_Y : interpolate(frame, [fly, fly + 36], [OPEN_Y, STATION.y], OPTS),
        cameraZoom: STATION.zoom,
        cameraRotationZ: keyed(frame, k.at, k.roll),
    };
}

/**
 * THE LOUD REGISTER. The site's home hero went loud on 2026-09-10 — colour
 * at 0.85, saturation past 1 — and the film draws the same register at a
 * steady exposure. What keeps it off the type is not a mask and not a dim:
 * it is where the camera stands (DEFAULT_STATION above), which leaves the
 * ribbon a cluster in the top strip of every held slide. Nothing about the
 * light animates across a move; a first version pumped the exposure and an
 * animated mask on every transition, and that was worse than the problem.
 */
export function groundAt(frame: number, tl: DeskTimeline) {
    const k = ribbonKeys(tl);
    const r = Math.round(keyed(frame, k.at, k.r));
    const g = Math.round(keyed(frame, k.at, k.g));
    const b = Math.round(keyed(frame, k.at, k.b));
    return { color: `rgb(${r}, ${g}, ${b})`, reveal: keyed(frame, k.at, k.reveal) };
}

/** The ribbon's own clock: slow under a hold, quick across a move. Past the
 *  last keyframe it runs on at the rate of the segment that would follow —
 *  live, a hold of unknown length, so the ribbon keeps breathing while the
 *  presenter speaks rather than freezing until the next beat is placed. */
export function timeAt(frame: number, fps: number, tl: DeskTimeline) {
    const { at, warped } = ribbonKeys(tl);
    const lastAt = at[at.length - 1];
    if (frame <= lastAt && at.length > 1) return interpolate(frame, at, warped, LINEAR) / fps;
    const rate = at.length % 2 === 1 ? HOLD_RATE : MOVE_RATE;
    return (warped[warped.length - 1] + Math.max(0, frame - lastAt) * rate) / fps;
}

/**
 * The field's seat at this frame: each beat's roll, read as a place along the
 * glow's travel, plus its sideways station — on the same eased keys the
 * ribbon turned on.
 */
export function seatAt(frame: number, tl: DeskTimeline): number {
    const k = ribbonKeys(tl);
    return seatForRoll(keyed(frame, k.at, k.roll) + keyed(frame, k.at, k.side) / 100);
}

/**
 * MASKED INTO THE GROUND, as the site's hero is. The desk's headlines sit
 * low and its windows are opaque sheets, so the field holds the top of the
 * frame at full strength and is gone by two thirds of the way down — a touch
 * earlier than the hero's 78%, because the presenter's window and the desk's
 * captions live in that bottom band. It never moves: the only motion in the
 * field is its own flow and its seat.
 */
const MASK = "linear-gradient(to bottom, #000 0%, #000 24%, transparent 68%)";

export const DeskPlane: React.FC = () => {
    const { fps } = useVideoConfig();
    const frame = useCurrentFrame();
    const tl = useDeskTimeline();
    const ground = groundAt(frame, tl);
    return (
        <>
            <GlowField ground={ground.color} reveal={ground.reveal} seat={seatAt(frame, tl)} time={timeAt(frame, fps, tl)} mask={MASK} />
            <DraftingGrid chroma={isChromaGround(ground.color)} />
        </>
    );
};
