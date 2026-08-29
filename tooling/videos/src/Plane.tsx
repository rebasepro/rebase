import React, { createContext, useContext } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { NeatCanvas, NeatTravel } from "./gradient/NeatCanvas";
import { GLIDE, SCENES, STARTS } from "./film";
import { slideMotion, TRANSITION_FRAMES } from "./transitions";
import { GROUND, TONE } from "./theme";

/**
 * The plane, the route through it, and the ground painted over it.
 *
 * One Neat instance for the whole film. Its camera is a pure function of the
 * ABSOLUTE frame, so the ribbon never restarts, never jumps, and a shape that
 * leaves one slide is the same shape that arrives in the next.
 *
 * THE GROUND LIVES HERE TOO, and that is not where you would first put it. A
 * scene that painted its own ground would be correct for every frame except
 * the ones that matter: `Series` swaps scenes instantly, so the colour would
 * SNAP at the cut — while the outgoing slide is still visibly leaving. On the
 * eight cuts where the colour does not change nobody would notice. On the two
 * where it does, the whole frame would jump to blue underneath a slide that is
 * halfway out, which is exactly the transition that has to be handled most
 * carefully. Owning it here means the colour and the exposure cross-fade on
 * the same schedule as the slides move.
 */

/**
 * The camera's schedule: hold at a station for the body of a scene, cover the
 * distance across the cut. Symmetric — it moves for GLIDE frames either side.
 */
const CAMERA_AT = SCENES.flatMap((scene, i) => {
    const start = STARTS[i];
    const end = start + scene.durationInFrames;
    return [
        i === 0 ? start : start + GLIDE,
        i === SCENES.length - 1 ? end : end - GLIDE,
    ];
});

/** Twice per scene, so every value pairs with the hold/move schedule. */
const twice = <T,>(fn: (s: (typeof SCENES)[number]) => T): T[] =>
    SCENES.flatMap((s) => [fn(s), fn(s)]);

const PATH = {
    x: twice((s) => s.station.x),
    y: twice((s) => s.station.y),
    zoom: twice((s) => s.station.zoom),
    // Roll is how a station gets its own look without changing how much
    // ribbon it holds — the one lever that varies the view and leaves the
    // coverage measurement intact.
    roll: twice((s) => s.station.roll ?? 0),
};

/**
 * The ground's schedule, and it is NOT the camera's.
 *
 * A scene brings its own world WITH it: the blend runs from the cut to
 * TRANSITION_FRAMES after it, never before. Centring it on the cut instead —
 * which is what this did first — means the next scene's ground starts arriving
 * while the previous slide is still on screen. Mostly that is invisible, and
 * on the film's first cut it was not: the cold open is specified to have no
 * plane at all, and a symmetric blend had the ribbon fading up behind the mark
 * twenty-two frames before the mark had left.
 *
 * Still a cross-fade, so a colour change never snaps — it just belongs to the
 * scene arriving rather than to the one leaving.
 */
const GROUND_AT: number[] = [];
const GROUND_KEY: (typeof SCENES)[number][] = [];
SCENES.forEach((scene, i) => {
    const start = STARTS[i];
    if (i === 0) {
        GROUND_AT.push(start);
        GROUND_KEY.push(scene);
        return;
    }
    GROUND_AT.push(start, start + TRANSITION_FRAMES);
    GROUND_KEY.push(SCENES[i - 1], scene);
});

/* The film opens on bare ground and closes on it too. The cold open gets there
   by its own station (reveal 0); the close needs a keyframe of its own, because
   a station describes a scene's whole duration and this fade happens inside the
   last one. Two extra keys, both on the final scene's ground so only exposure
   moves — the last frame is ground and the wordmark, nothing else. */
const OUTRO_FADE = 80;
const LAST = SCENES[SCENES.length - 1];
const TOTAL = STARTS[SCENES.length - 1] + LAST.durationInFrames;
GROUND_AT.push(TOTAL - OUTRO_FADE, TOTAL);
GROUND_KEY.push(LAST, LAST);

const rgb = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
];

const GROUND_RGB = {
    r: GROUND_KEY.map((s) => rgb(GROUND[s.ground])[0]),
    g: GROUND_KEY.map((s) => rgb(GROUND[s.ground])[1]),
    b: GROUND_KEY.map((s) => rgb(GROUND[s.ground])[2]),
};
const REVEAL = GROUND_KEY.map((s) => s.station.reveal);
REVEAL[REVEAL.length - 1] = 0;

/**
 * THE RIBBON'S OWN CLOCK RUNS AT TWO SPEEDS.
 *
 * Neat animates continuously, which means that while a viewer is reading a
 * slide the art behind it is quietly churning — and a moving thing behind
 * still type is a thing the eye keeps going back to. The fix is not to slow it
 * down everywhere (that makes the whole film inert) but to spend the movement
 * where movement is already happening: nearly still during a hold, quick
 * across a cut.
 *
 * This is a TIME WARP, not a speed change, and the difference matters.
 * Neat accumulates `tick += dt * speed`, so varying `speed` would make the
 * animation depend on the history of speed values and every seek would land
 * somewhere different. Warping the clock instead keeps time an absolute
 * function of the frame — monotonic, piecewise-linear, and reproducible.
 *
 * Net effect is about 0.47x the old motion overall, concentrated in the cuts.
 */
const HOLD_RATE = 0.2;
const MOVE_RATE = 2.0;

/** Cumulative warped frames at each camera keyframe. Odd indices close a hold,
 *  even ones close a move — the same alternation CAMERA_AT is built on. */
const WARPED = CAMERA_AT.reduce<number[]>((acc, at, i) => {
    if (i === 0) return [0];
    const real = at - CAMERA_AT[i - 1];
    acc.push(acc[i - 1] + real * (i % 2 === 1 ? HOLD_RATE : MOVE_RATE));
    return acc;
}, []);

/** Seconds on the ribbon's clock at this frame of the film. */
export function timeAt(frame: number, fps: number) {
    return interpolate(frame, CAMERA_AT, WARPED, {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    }) / fps;
}

/* Eased per segment, so each move accelerates away from one station and
   settles into the next. A linear route reads as a machine panning; this reads
   as someone moving their attention. */
const EASE = Easing.inOut(Easing.cubic);
const OPTS = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE } as const;

export function cameraAt(frame: number): NeatTravel {
    return {
        cameraX: interpolate(frame, CAMERA_AT, PATH.x, OPTS),
        cameraY: interpolate(frame, CAMERA_AT, PATH.y, OPTS),
        cameraZoom: interpolate(frame, CAMERA_AT, PATH.zoom, OPTS),
        cameraRotationZ: interpolate(frame, CAMERA_AT, PATH.roll, OPTS),
    };
}

/** The ground colour and how opaque it is, both continuous across every cut.
 *  Channels are interpolated separately; the grounds are opaque, so a straight
 *  RGB blend is the right one and needs no colour-space ceremony. */
export function groundAt(frame: number) {
    const r = Math.round(interpolate(frame, GROUND_AT, GROUND_RGB.r, OPTS));
    const g = Math.round(interpolate(frame, GROUND_AT, GROUND_RGB.g, OPTS));
    const b = Math.round(interpolate(frame, GROUND_AT, GROUND_RGB.b, OPTS));
    return { color: `rgb(${r}, ${g}, ${b})`, reveal: interpolate(frame, GROUND_AT, REVEAL, OPTS) };
}

/**
 * Which scene is on screen, and where it started.
 *
 * A scene inside a <Series.Sequence> only knows its own frame counter, and the
 * plane is addressed in absolute frames — so the offset has to be handed down.
 */
export const StationContext = createContext<{ index: number; start: number }>({
    index: 0,
    start: 0,
});

/** The ink set for whatever ground the current scene sits on. */
export function useTone() {
    const { index } = useContext(StationContext);
    return TONE[SCENES[index].ground];
}

/** The slide's own motion: authored per cut, not inherited from the camera. */
export function useSlideMotion() {
    const local = useCurrentFrame();
    const { index } = useContext(StationContext);
    const scene = SCENES[index];
    const next = SCENES[index + 1];
    return slideMotion(local, scene.durationInFrames, scene.enter, next?.enter ?? null);
}

/**
 * The ground, then the art ON TOP OF IT, screen-blended.
 *
 * This used to be the other way round: plane first, then the ground painted
 * OVER it at `1 - reveal`. Two things were wrong with that, and they compound.
 *
 * 1. Every change in reveal was a full-frame background opacity animation.
 *    Not the ribbon fading — the entire ground fading, at every cut.
 * 2. Under that order the ribbon is seen THROUGH the ground, so it darkens
 *    whatever is behind it. On #08090A that reads as art. On a bright chroma
 *    field the ribbon is darker than the ground, so it subtracts and reads as
 *    smudges — which is why the chroma scenes had been given their own lower
 *    reveal values, and why there were five different values in play at all.
 *
 * Screen blending always LIGHTENS: a near-black facet contributes nothing and
 * a bright one adds. It therefore behaves the same on every ground, which is
 * what lets a single reveal value work everywhere — and a single value is a
 * value that never animates.
 */
export const Plane: React.FC<{ offset?: number }> = ({ offset = 0 }) => {
    const { fps } = useVideoConfig();
    const frame = useCurrentFrame() + offset;
    const ground = groundAt(frame);
    return (
        <>
            <AbsoluteFill style={{ background: ground.color }} />
            <NeatCanvas
                framing="hero"
                opacity={ground.reveal}
                camera={cameraAt(frame)}
                time={timeAt(frame, fps)}
                style={{ mixBlendMode: "screen" }}
            />
        </>
    );
};
