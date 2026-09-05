import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { NeatCanvas, NeatTravel } from "../gradient/NeatCanvas";
import { BEATS, DESK_DURATION, MOVE_LEAD, moveFrames, OPENING } from "./beats";
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

const STATION = { x: 0, y: -12, zoom: 2.05 };

/* Keyframes: [hold-end, move-end] per beat, so odd indices close a hold and
   even ones close a move — the alternation the time warp is built on. */
const AT: number[] = [0];
const ROLL: number[] = [0.1];
const GROUND_KEY: string[] = [GROUND.base];
const REVEAL: number[] = [0];

let prev = OPENING;
BEATS.forEach((b) => {
    const a = b.start - MOVE_LEAD;
    const z = a + moveFrames(prev, b.view);
    AT.push(a, z);
    ROLL.push(ROLL[ROLL.length - 1], b.roll);
    GROUND_KEY.push(GROUND_KEY[GROUND_KEY.length - 1], GROUND[b.ground]);
    REVEAL.push(REVEAL[REVEAL.length - 1], b.reveal);
    prev = b.view;
});

/* The last frame is ground and the wordmark, nothing else. */
const OUTRO_FADE = 70;
AT.push(DESK_DURATION - OUTRO_FADE, DESK_DURATION);
ROLL.push(ROLL[ROLL.length - 1], ROLL[ROLL.length - 1]);
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
        cameraX: STATION.x,
        cameraY: STATION.y,
        cameraZoom: STATION.zoom,
        cameraRotationZ: interpolate(frame, AT, ROLL, OPTS),
    };
}

export function groundAt(frame: number) {
    const r = Math.round(interpolate(frame, AT, R, OPTS));
    const g = Math.round(interpolate(frame, AT, G, OPTS));
    const b = Math.round(interpolate(frame, AT, B, OPTS));
    return { color: `rgb(${r}, ${g}, ${b})`, reveal: interpolate(frame, AT, REVEAL, OPTS) };
}

export function timeAt(frame: number, fps: number) {
    return interpolate(frame, AT, WARPED, LINEAR) / fps;
}

export const DeskPlane: React.FC = () => {
    const { fps } = useVideoConfig();
    const frame = useCurrentFrame();
    const ground = groundAt(frame);
    return (
        <>
            <AbsoluteFill style={{ background: ground.color }} />
            <NeatCanvas
                framing="hero"
                opacity={ground.reveal}
                camera={ribbonAt(frame)}
                time={timeAt(frame, fps)}
                style={{ mixBlendMode: "screen" }}
            />
        </>
    );
};
