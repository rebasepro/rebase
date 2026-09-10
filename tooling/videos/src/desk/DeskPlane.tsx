import React from "react";
import { AbsoluteFill, Easing, getInputProps, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { NeatCanvas, NeatTravel } from "../gradient/NeatCanvas";
import { BEATS, DESK_DURATION, MOVE_LEAD, moveFrames, OPENING } from "./beats";
import { HERO_TONES } from "../data/neat-config";
import { FLY_TO_CORNER } from "./Presenter";
import { GROUND } from "../theme";

/**
 * The ribbon under the desk. The same real @firecms/neat instance as the
 * slide film's Plane.tsx, with its schedule read from BEATS instead of
 * SCENES: the ribbon turns while the camera moves and holds while it holds,
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
 *  plane alone at candidate stations without editing this file. */
const STATION = { ...DEFAULT_STATION, ...((getInputProps() as { station?: Partial<typeof DEFAULT_STATION> }).station ?? {}) };

/* Keyframes: [hold-end, move-end] per beat, so odd indices close a hold and
   even ones close a move — the alternation the time warp is built on. */
const AT: number[] = [0];
const ROLL: number[] = [0.1];
const SIDE: number[] = [0];
const GROUND_KEY: string[] = [GROUND.base];
const REVEAL: number[] = [0];

let prev = OPENING;
BEATS.forEach((b) => {
    const a = b.start - MOVE_LEAD;
    const z = a + moveFrames(prev, b.view);
    AT.push(a, z);
    ROLL.push(ROLL[ROLL.length - 1], b.roll);
    SIDE.push(SIDE[SIDE.length - 1], b.x ?? 0);
    GROUND_KEY.push(GROUND_KEY[GROUND_KEY.length - 1], GROUND[b.ground]);
    REVEAL.push(REVEAL[REVEAL.length - 1], b.reveal);
    prev = b.view;
});

/* The last frame is ground and the wordmark, nothing else. */
const OUTRO_FADE = 70;
AT.push(DESK_DURATION - OUTRO_FADE, DESK_DURATION);
ROLL.push(ROLL[ROLL.length - 1], ROLL[ROLL.length - 1]);
SIDE.push(SIDE[SIDE.length - 1], SIDE[SIDE.length - 1]);
GROUND_KEY.push(GROUND_KEY[GROUND_KEY.length - 1], GROUND_KEY[GROUND_KEY.length - 1]);
REVEAL.push(REVEAL[REVEAL.length - 1], 0);

const rgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
];
const R = GROUND_KEY.map((h) => rgb(h)[0]);
const G = GROUND_KEY.map((h) => rgb(h)[1]);
const B = GROUND_KEY.map((h) => rgb(h)[2]);

const HOLD_RATE = 0.2;
const MOVE_RATE = 2.0;
const WARPED = AT.reduce<number[]>((acc, at, i) => {
    if (i === 0) return [0];
    const real = at - AT[i - 1];
    acc.push(acc[i - 1] + real * (i % 2 === 1 ? HOLD_RATE : MOVE_RATE));
    return acc;
}, []);

const EASE = Easing.inOut(Easing.cubic);
const OPTS = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE } as const;
const LINEAR = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function ribbonAt(frame: number): NeatTravel {
    return {
        cameraX: STATION.x + interpolate(frame, AT, SIDE, OPTS),
        cameraY: interpolate(frame, [FLY_TO_CORNER, FLY_TO_CORNER + 36], [OPEN_Y, STATION.y], OPTS),
        cameraZoom: STATION.zoom,
        cameraRotationZ: interpolate(frame, AT, ROLL, OPTS),
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
export function groundAt(frame: number) {
    const r = Math.round(interpolate(frame, AT, R, OPTS));
    const g = Math.round(interpolate(frame, AT, G, OPTS));
    const b = Math.round(interpolate(frame, AT, B, OPTS));
    return { color: `rgb(${r}, ${g}, ${b})`, reveal: interpolate(frame, AT, REVEAL, OPTS) };
}

export function timeAt(frame: number, fps: number) {
    return interpolate(frame, AT, WARPED, LINEAR) / fps;
}

/**
 * FADED INTO THE GROUND. The ribbon's facets have hard geometric edges, and
 * against a flat black ground they read as pasted on. A STATIC fade — solid
 * across the top of the frame, gone by a third of the way down — dissolves
 * them into the ground on the way to the headline zone, so a larger shape
 * can sit at the top (the camera one step lower than the corner-cluster
 * station) without a hard edge anywhere near the type. It never moves: the
 * only motion in the ribbon is its turn on each beat's roll.
 */
const FADE = "linear-gradient(to bottom, #000 0%, #000 9%, rgba(0,0,0,0.55) 20%, transparent 34%)";

export const DeskPlane: React.FC = () => {
    const { fps } = useVideoConfig();
    const frame = useCurrentFrame();
    const ground = groundAt(frame);
    return (
        <>
            <AbsoluteFill style={{ background: ground.color }} />
            <NeatCanvas
                framing="hero"
                tone={HERO_TONES.loud}
                opacity={ground.reveal}
                camera={ribbonAt(frame)}
                time={timeAt(frame, fps)}
                style={{ mixBlendMode: "screen", WebkitMaskImage: FADE, maskImage: FADE }}
            />
        </>
    );
};
