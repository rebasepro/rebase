import { Easing, interpolate, spring } from "remotion";

/**
 * One motion vocabulary for the whole film.
 *
 * The point of putting it here rather than at each call site is that a video
 * gives itself away when two things that should feel the same are eased
 * differently — a card that settles like a spring next to a card that settles
 * like a ramp reads as sloppy long before anyone can say why.
 *
 * Two curves, and they mean different things:
 *   ENTER  — an expo-out. Almost all of the distance is covered immediately
 *            and the last 10% takes half the time. Things ARRIVE.
 *   SHIFT  — symmetric, for something already on screen moving somewhere else.
 */
export const ENTER = Easing.bezier(0.16, 1, 0.3, 1);
export const SHIFT = Easing.bezier(0.65, 0, 0.35, 1);

/** Springs, by weight. Damping over ~0.9 never overshoots — which is what you
 *  want for type (an overshooting headline looks like a bug) and not what you
 *  want for an object (which should have some mass). */
export const SPRING = {
    type: { damping: 200, stiffness: 120, mass: 0.8 },
    card: { damping: 26, stiffness: 140, mass: 0.9 },
    pop: { damping: 15, stiffness: 210, mass: 0.7 },
} as const;

/** 0 → 1 over `duration` frames, starting at `delay`. The unit of everything
 *  below; keeping it in one place means no scene reinvents a ramp. */
export function ramp(frame: number, delay: number, duration: number, easing = ENTER) {
    return interpolate(frame, [delay, delay + duration], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing,
    });
}

/** 1 while inside the window, ramping in and out at the edges. For anything
 *  that has to leave again before the scene does. */
export function window_(
    frame: number,
    inAt: number,
    outAt: number,
    inDur = 12,
    outDur = 10,
) {
    return Math.min(ramp(frame, inAt, inDur), 1 - ramp(frame, outAt, outDur, SHIFT));
}

/** The masked line reveal: type rises into a fixed clip box rather than fading
 *  in place. Fading alone reads as a slide transition; the mask reads as
 *  typesetting, which is the register this film is in.
 *
 *  18 frames, down from 26. The slide's own transition is now the entrance —
 *  a 26-frame line reveal on top of a 22-frame arrival meant a headline was
 *  still assembling more than a second after its cut. */
export function lineReveal(frame: number, delay: number, duration = 18) {
    const t = ramp(frame, delay, duration);
    return {
        transform: `translateY(${(1 - t) * 105}%)`,
        opacity: interpolate(t, [0, 0.12, 1], [0, 0.4, 1]),
    };
}

/** Rise-and-fade, for anything that is not a line of display type. */
export function rise(frame: number, delay: number, distance = 18, duration = 26) {
    const t = ramp(frame, delay, duration);
    return {
        transform: `translateY(${(1 - t) * distance}px)`,
        opacity: t,
    };
}

/** A spring in [0,1]. `spring()` needs fps, so this just tidies the call. */
export function pop(
    frame: number,
    fps: number,
    delay: number,
    config: (typeof SPRING)[keyof typeof SPRING] = SPRING.card,
) {
    return spring({ frame: frame - delay, fps, config, durationInFrames: 40 });
}

/** Successive delays. `stagger(i)` reads better at the call site than
 *  `delay + i * 4` repeated eleven times. */
export const stagger = (index: number, step = 4, base = 0) => base + index * step;
