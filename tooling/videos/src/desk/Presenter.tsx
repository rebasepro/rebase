import React from "react";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { beat, tempo, TEMPO } from "./beats";
import { FONT, FRAME, INK } from "../theme";

/**
 * THE PRESENTER — a person narrating to camera, in screen space, over the
 * desk. Three places, and two moves between them:
 *
 *   OPEN    large and centred, over bare ground and ribbon, for the first
 *           two sentences. The film opens on a person, not a claim.
 *   CORNER  a rounded square, bottom right, for the whole demo. The one
 *           fixed point while the desk pans behind it — the right role for
 *           a narrator. Every desk composition leaves this corner clear.
 *   CLOSE   large again, left of the address, as the desk recedes. The last
 *           line is said to camera, not over a logo.
 *
 * It is ONE video element for the whole film — the window moves and
 * resizes around it — so the take's audio is continuous and is the
 * narration. Until a take exists the window shows a placeholder.
 *
 * WHEN THERE IS A TAKE: set `TAKE`, then derive the beat starts from the
 * take's word timestamps rather than asking the read to hit the prompter's
 * frames. `beats.ts` already routes every start through `tempo()`; that
 * becomes a per-beat table. Nobody reads at exactly eleven frames a word,
 * and a read chasing a timer sounds like one.
 */

/** The recorded take, or null for the placeholder. Put the file in
 *  public/presenter/ and point at it here. `startFrom` trims the head of
 *  the clip so its first spoken word lands on the film's first line. */
export const TAKE = null as { src: string; startFrom: number } | null;

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Bottom right, 60 from either edge. 260 is 24% of the frame's height:
 *  large enough to read an expression at phone size, small enough that the
 *  product is still the subject. */
export const CORNER: Box = { x: 1600, y: 760, w: 260, h: 260 };
/** Centred, 4:3, with the ribbon around it. */
export const OPEN: Box = { x: 520, y: 210, w: 880, h: 660 };
/** Left column of the close; the address takes the right. */
export const CLOSE: Box = { x: 200, y: 240, w: 680, h: 600 };

const ALL = beat("all");

/** Frames of the presenter's own timeline, absolute. The open runs through
 *  the question — "You can build a backend in an afternoon now. But can you
 *  trust it?", fourteen words to camera — then the window flies to the
 *  corner while the evidence arrives on the desk behind it. */
export const PRESENTER_IN = 52;
export const FLY_TO_CORNER = tempo(92) + 14 * Math.round(10 * TEMPO) + 5;
const FLY = 36;
/** Lifts off the corner as the camera lifts off the desk. */
export const FLY_TO_CLOSE = ALL.start + 4;
const FLY_OUT = 60;

const EASE = Easing.inOut(Easing.cubic);
const OPTS = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE } as const;

function lerpBox(frame: number, a: number, z: number, from: Box, to: Box): Box {
    const t = interpolate(frame, [a, z], [0, 1], OPTS);
    return {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        w: from.w + (to.w - from.w) * t,
        h: from.h + (to.h - from.h) * t,
    };
}

export type Stage = "open" | "corner" | "close";

/** Where the window is at this frame, how visible, and which of the three
 *  places it is at or heading to. */
export function presenterAt(frame: number): Box & { opacity: number; stage: Stage } {
    const opacity = interpolate(frame, [PRESENTER_IN, PRESENTER_IN + 16], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    if (frame < FLY_TO_CORNER) return { ...OPEN, opacity, stage: "open" };
    if (frame < FLY_TO_CLOSE) {
        return { ...lerpBox(frame, FLY_TO_CORNER, FLY_TO_CORNER + FLY, OPEN, CORNER), opacity, stage: "corner" };
    }
    return { ...lerpBox(frame, FLY_TO_CLOSE, FLY_TO_CLOSE + FLY_OUT, CORNER, CLOSE), opacity, stage: "close" };
}


/**
 * The presenter's window. Same treatment as every other window on the desk
 * — the frame radius, the hairline, the shadow — and no title bar: a face
 * does not need a caption. It is a rounded rectangle, not a circle, because
 * this film is made of rectangles and the circle is somebody else's
 * convention.
 *
 * One element, moved and resized by CSS, so the take plays continuously
 * and its audio is the film's narration.
 */
export const Presenter: React.FC = () => {
    const frame = useCurrentFrame();
    const p = presenterAt(frame);
    if (p.opacity <= 0) return null;

    return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
            <div
                style={{
                    position: "absolute",
                    left: Math.round(p.x),
                    top: Math.round(p.y),
                    width: Math.round(p.w),
                    height: Math.round(p.h),
                    borderRadius: FRAME.radius,
                    border: FRAME.border,
                    boxShadow: FRAME.boxShadow,
                    background: "#0B0C0F",
                    overflow: "hidden",
                    opacity: p.opacity,
                }}
            >
                {TAKE ? (
                    <OffthreadVideo
                        src={staticFile(TAKE.src)}
                        startFrom={TAKE.startFrom}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                ) : (
                    <Placeholder stage={p.stage} />
                )}
            </div>
        </AbsoluteFill>
    );
};

/** Stands in for the take: a quiet surface with a head-and-shoulders
 *  silhouette where the face will be, so framing can be judged now. */
const Placeholder: React.FC<{ stage: string }> = ({ stage }) => (
    <AbsoluteFill
        style={{
            background: "radial-gradient(ellipse at 50% 42%, #1B1E25 0%, #0B0C0F 70%)",
            alignItems: "center",
            justifyContent: "center",
        }}
    >
        <svg viewBox="0 0 100 100" style={{ width: "62%", height: "62%", opacity: 0.35 }}>
            <circle cx="50" cy="38" r="17" fill="none" stroke={INK.copy} strokeWidth="1.5" />
            <path d="M 18 92 C 18 66, 82 66, 82 92" fill="none" stroke={INK.copy} strokeWidth="1.5" />
        </svg>
        <div
            style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "9%",
                textAlign: "center",
                fontFamily: FONT.mono,
                fontSize: stage === "corner" ? 11 : 14,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: INK.muted,
            }}
        >
            camera · you
        </div>
    </AbsoluteFill>
);
