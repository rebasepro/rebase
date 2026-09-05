import { Easing, interpolate } from "remotion";

/**
 * How one slide leaves and the next arrives.
 *
 * These used to be derived from the gradient's camera: content was offset by
 * `-(camera - station)`, so a slide left in whatever direction the Neat route
 * happened to take next. That route is a 2D meander chosen for the ribbon's
 * composition, and as a source of slide motion it is arbitrary — measured
 * across the eight cuts it produced eight unrelated directions (52°, -15°,
 * -41°, -135°, -165°, 165°, 127°, 55°) and distances from 479 to 843px. It
 * read as random because it was.
 *
 * So the two are decoupled. The camera still meanders; the slides no longer
 * follow it. Each cut is authored instead, and each kind means something —
 * variety that is motivated rather than decorative.
 */

export type TransitionKind = "hold" | "push" | "descend" | "rise" | "scale";

/** Fixed, so no two cuts differ in distance by accident. The frame is wider
 *  than it is tall, so a sideways move gets more room.
 *
 *  These are deliberately short of clearing the frame. The slide does not have
 *  to travel all the way out — the fade finishes the job — and asking it to
 *  cover 560px in half a second meant it was still barely moving by the time
 *  it had faded, so a push read as a crossfade. */
const H = 420;
const V = 300;

/** Frames a slide spends leaving, and frames the next one spends arriving.
 *
 *  These two windows are THE SAME FRAMES. The film mounts each scene
 *  `OVERLAP` frames before its cut (Intro.tsx), so an exit and the entrance
 *  that answers it run concurrently and the whole transition takes 12 frames
 *  — not 12 out, a gap, then 12 in. It was 22 when the halves ran back to
 *  back; a slide that has to read as a direction rather than a flicker needed
 *  the time. Crossing, it does not: the direction is carried by two slides
 *  moving the same way at once, which is legible in far fewer frames. */
export const TRANSITION_FRAMES = 12;

/** How early the next scene is mounted. Equal to TRANSITION_FRAMES so the
 *  entrance starts on the exit's first frame and both end on the cut. */
export const OVERLAP = TRANSITION_FRAMES;

interface Move {
    /** Where the incoming slide starts, relative to rest. */
    from: { x: number; y: number; scale: number };
    /** Where the outgoing slide ends. */
    to: { x: number; y: number; scale: number };
}

const AT_REST = { x: 0, y: 0, scale: 1 };

const MOVES: Record<TransitionKind, Move> = {
    /** The subject stays put; you simply look again. Fade only — this is what
     *  the film opens with, because a mark that slides away is a mark you were
     *  told to stop looking at. */
    hold: { from: AT_REST, to: AT_REST },
    /** The default forward step in an argument. */
    push: { from: { x: H, y: 0, scale: 1 }, to: { x: -H, y: 0, scale: 1 } },
    /** Going deeper into the thing just named. */
    descend: { from: { x: 0, y: V, scale: 1 }, to: { x: 0, y: -V, scale: 1 } },
    /** Coming back up out of it. */
    rise: { from: { x: 0, y: -V, scale: 1 }, to: { x: 0, y: V, scale: 1 } },
    /** Arrival. */
    scale: { from: { x: 0, y: 0, scale: 0.94 }, to: { x: 0, y: 0, scale: 0.96 } },
};

/* Leaving accelerates away; arriving decelerates in. That much is ordinary.
   What matters here is that NEITHER curve may be extreme, because both are
   racing a fade:

   - EXIT was `bezier(0.5, 0, 0.9, 0.25)`, which is nearly flat for its first
     third. The slide had covered 5% of its distance by the time it was a
     quarter faded, so it left by disappearing rather than by going anywhere.
   - ENTER (expo-out) is the opposite problem on the way in: it covers most of
     the distance immediately, so by the time the slide is visible it has
     already arrived. `out(cubic)` still has a quarter of the journey left when
     the fade completes, which is what makes the direction legible. */
const EXIT = Easing.bezier(0.35, 0, 0.75, 0.45);
const ARRIVE = Easing.out(Easing.cubic);

/* The two fades are a DISSOLVE now, because the two slides share the frame.
   When they ran back to back, opacity led the position on the way in and
   trailed it on the way out, so each slide was seen travelling on its own.
   Overlapping, that pairing put both slides at full strength on the same
   frames — a headline sliding through another headline. So the outgoing
   slide loses opacity across the whole window and the incoming one gains it
   across the whole window, offset by a couple of frames in the newcomer's
   favour so the slide you are about to read is the one that reads first.
   Linear, on purpose: over twelve frames an eased dissolve just reads as
   one slide holding longer than it should. */
const FADE_IN_UNTIL = 0.8;
const FADE_OUT_FROM = 0.2;

export interface SlideMotion {
    px: number;
    py: number;
    scale: number;
    opacity: number;
}

/**
 * The slide's displacement and opacity at one frame of one scene.
 *
 * Motion and opacity are never separated: every kind that moves also fades,
 * because a headline clipped in half at the edge of frame reads as a bug and
 * not as depth. Opacity leads the position slightly on the way in, so the
 * slide is legible before it has finished settling.
 */
export function slideMotion(
    local: number,
    duration: number,
    enter: TransitionKind | null,
    exit: TransitionKind | null,
): SlideMotion {
    let px = 0;
    let py = 0;
    let scale = 1;
    let opacity = 1;

    if (enter) {
        const { from } = MOVES[enter];
        const t = interpolate(local, [0, TRANSITION_FRAMES], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ARRIVE,
        });
        px += from.x * (1 - t);
        py += from.y * (1 - t);
        scale *= from.scale + (1 - from.scale) * t;
        opacity *= interpolate(local, [0, TRANSITION_FRAMES * FADE_IN_UNTIL], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
        });
    }

    if (exit) {
        const { to } = MOVES[exit];
        const start = duration - TRANSITION_FRAMES;
        const t = interpolate(local, [start, duration], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: EXIT,
        });
        px += to.x * t;
        py += to.y * t;
        scale *= 1 + (to.scale - 1) * t;
        opacity *= 1 - interpolate(local, [start + TRANSITION_FRAMES * FADE_OUT_FROM, duration], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
        });
    }

    // Whole pixels. A fractional translate puts glyphs on subpixel positions,
    // and display type on a compositor layer then rasterises differently from
    // one render to the next — invisible, but it costs byte-identical renders.
    return { px: Math.round(px), py: Math.round(py), scale, opacity };
}
