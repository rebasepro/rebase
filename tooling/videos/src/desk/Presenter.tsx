import React, { useEffect, useRef } from "react";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { useDeskTimeline, type DeskTimeline } from "./timeline";
import { FONT, FRAME, INK, SURFACE } from "../theme";

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
 * narration. What plays in it is one of three things:
 *
 *   a TAKE     a recording (scripts/take.mjs writes it and the props that
 *              point at it). The film's timing is the take's own: every
 *              beat hangs off the words as they were said (timeline.ts).
 *   the CAMERA live, on the recording page (src/live): the presenter sees
 *              themselves where the take will be, while the film follows
 *              their voice.
 *   nothing    a placeholder, so framing can be judged before either.
 */

/** A recorded take, under public/. `startFrom` trims its head so the first
 *  word lands where the timing says it does. */
export interface Take {
    src: string;
    startFrom: number;
}

/** The camera on the recording page. Not serialisable — it only ever
 *  exists in a browser, handed to the Player directly. */
export interface LiveFeed {
    stream: MediaStream | null;
}

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

/** The presenter is on screen from the first frame and speaking from the
 *  fifteenth — a person who appears and then waits is a person with nothing
 *  to say. The open runs through the question — "Anyone can build a backend
 *  in an afternoon. But can you trust it?", to camera — then the window flies
 *  to the corner (cues.flyToCorner, five frames after the question ends)
 *  while the evidence arrives on the desk behind it, and lifts off the corner
 *  as the camera lifts off the desk (cues.flyToClose). */
export const PRESENTER_IN = 0;
const FLY = 36;
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
 *  places it is at or heading to. A move whose moment has not come — live,
 *  a question not yet finished — has not started. */
export function presenterAt(frame: number, tl: DeskTimeline): Box & { opacity: number; stage: Stage } {
    const { flyToCorner, flyToClose } = tl.cues;
    const opacity = interpolate(frame, [PRESENTER_IN, PRESENTER_IN + 10], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    if (flyToCorner === null || frame < flyToCorner) return { ...OPEN, opacity, stage: "open" };
    if (flyToClose === null || frame < flyToClose) {
        return { ...lerpBox(frame, flyToCorner, flyToCorner + FLY, OPEN, CORNER), opacity, stage: "corner" };
    }
    return { ...lerpBox(frame, flyToClose, flyToClose + FLY_OUT, CORNER, CLOSE), opacity, stage: "close" };
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
export const Presenter: React.FC<{ take?: Take | null; live?: LiveFeed | null }> = ({ take, live }) => {
    const frame = useCurrentFrame();
    const p = presenterAt(frame, useDeskTimeline());
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
                    background: SURFACE.frame,
                    overflow: "hidden",
                    opacity: p.opacity,
                }}
            >
                {live?.stream ? (
                    <LiveCamera stream={live.stream} />
                ) : take ? (
                    <OffthreadVideo
                        src={staticFile(take.src)}
                        startFrom={take.startFrom}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                ) : (
                    <Placeholder stage={p.stage} />
                )}
            </div>
        </AbsoluteFill>
    );
};

/** The camera, live, on the recording page. Mirrored, as every self-view
 *  is — the recording itself is not — and muted, so the room is not fed
 *  back into the microphone. */
const LiveCamera: React.FC<{ stream: MediaStream }> = ({ stream }) => {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const video = ref.current;
        if (!video || video.srcObject === stream) return;
        video.srcObject = stream;
        void video.play().catch(() => undefined);
    }, [stream]);
    return (
        <video
            ref={ref}
            muted
            playsInline
            autoPlay
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
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
