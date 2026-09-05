import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ramp, ENTER } from "./motion";
import { FRAME } from "../theme";

/**
 * The admin panel, as a window running a short montage of real captures.
 *
 * Shared by the slide film's panel scene and the desk. The window draws its
 * own chrome (it is a screen recording of an app that has a header), so it
 * does NOT also get a frame head. One chrome per window.
 */

export interface Shot {
    file: string;
    label: string;
    /** Source frame to start from — the first frames of a capture are usually
     *  the cursor still arriving. */
    from: number;
    /** How long this shot holds. Not every shot is worth the same time: the
     *  click-through needs to show a grid, a click and the record that opens,
     *  which is three beats where a scrolling list is one. */
    frames: number;
}

/* Rendered from the live demo at demo.rebase.pro rather than reused from the
   site's media library — dark mode at 1280x800, which is the size that keeps
   the app's own type readable once it sits in a window filling two thirds of a
   1920 frame. Rendered, not recorded: Playwright's recordVideo is locked to
   25fps and this film runs at 30, and no rate divides both.
   See scripts/render-demo.mjs. */
export const PANEL_SHOTS: Shot[] = [
    /* Shots 1 and 2 are two windows onto ONE take. They have to be: the demo
       signs its image URLs per request, so a second visit to the grid is forty
       cache misses at once and its storage endpoint answers that burst with
       429 — the second take is always a field of grey placeholder tiles. So
       the grid is loaded once and never left, and the cut here is a cut in the
       edit rather than a second recording. */
    { file: "demo/panel.mp4", label: "Cards", from: 24, frames: 58 },
    /* The click-through, and the reason the montage stopped reading as static:
       a product picked out of the grid and the record that opens. The window
       starts on held grid so the cursor is seen travelling to the card — the
       cut lands about 40 frames in, which is what makes it read as a click
       rather than as an edit. */
    { file: "demo/panel.mp4", label: "Open a record", from: 244, frames: 122 },
    { file: "demo/orders.mp4", label: "Every view", from: 20, frames: 72 },
];

export const DISSOLVE = 14;

/** Where each shot starts, so a shot's length is a property of the shot. */
export function shotStarts(shots: Shot[], first: number): number[] {
    return shots.reduce<number[]>(
        (acc, shot, i) => [...acc, i === 0 ? first : acc[i - 1] + shots[i - 1].frames],
        [],
    );
}

export const PanelWindow: React.FC<{
    shots?: Shot[];
    /** Frame the first shot starts. */
    firstShotAt?: number;
    /** Frame the window itself arrives. */
    enterAt?: number;
    /** Frames the last shot keeps playing past its nominal length — for a
     *  window that stays on screen after the montage. */
    tail?: number;
    style?: React.CSSProperties;
}> = ({ shots = PANEL_SHOTS, firstShotAt = 28, enterAt = 10, tail = 0, style }) => {
    const frame = useCurrentFrame();
    const at = shotStarts(shots, firstShotAt);
    const end = at[at.length - 1] + shots[shots.length - 1].frames;

    // One slow push across the whole montage rather than one per shot: the
    // cuts already supply the rhythm, and re-zooming on every cut is the thing
    // that makes a product montage feel like an ad.
    const push = interpolate(frame, [firstShotAt, end], [1.0, 1.06], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    const enter = ramp(frame, enterAt, 32, ENTER);

    return (
        <div
            style={{
                aspectRatio: "1280 / 800",
                borderRadius: FRAME.radius,
                border: FRAME.border,
                background: "#000",
                boxShadow: FRAME.boxShadow,
                overflow: "hidden",
                position: "relative",
                opacity: enter,
                transform: `translateY(${(1 - enter) * 30}px) scale(${push})`,
                ...style,
            }}
        >
            {shots.map((shot, i) => {
                const start = at[i];
                const last = i === shots.length - 1;
                // Cross-dissolve: each shot fades up as the one before it fades
                // down, so the window is never empty.
                const o =
                    ramp(frame, start, i === 0 ? DISSOLVE + 6 : DISSOLVE) *
                    (last ? 1 : 1 - ramp(frame, start + shot.frames, DISSOLVE));
                if (o <= 0.001) return null;
                return (
                    <AbsoluteFill key={shot.label} style={{ opacity: o }}>
                        {/* The Sequence is load-bearing, not tidiness. Without it
                            every clip plays against the SCENE clock, so a later
                            shot opens seconds past its startFrom — see the
                            note in the slide film's panel scene. */}
                        <Sequence
                            from={start}
                            durationInFrames={shot.frames + DISSOLVE + 6 + (last ? tail : 0)}
                            layout="none"
                        >
                            <OffthreadVideo
                                src={staticFile(shot.file)}
                                startFrom={shot.from}
                                muted
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                        </Sequence>
                    </AbsoluteFill>
                );
            })}
        </div>
    );
};

/** The one-line label under the headline that names the shot playing. The
 *  swap is SEQUENTIAL — the old label is gone before the new one starts;
 *  two words of tracked uppercase cross-fading read as one garbled word. */
export const ShotLabel: React.FC<{
    shots?: Shot[];
    firstShotAt?: number;
    style?: React.CSSProperties;
}> = ({ shots = PANEL_SHOTS, firstShotAt = 28, style }) => {
    const frame = useCurrentFrame();
    const at = shotStarts(shots, firstShotAt);
    return (
        <div style={{ height: 26, position: "relative", ...style }}>
            {shots.map((shot, i) => {
                const o = ramp(frame, at[i] + 4, 8) * (1 - ramp(frame, at[i] + shot.frames - 8, 8));
                return (
                    <div
                        key={shot.label}
                        style={{
                            position: "absolute",
                            inset: 0,
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            fontSize: 16,
                            letterSpacing: "0.22em",
                            textTransform: "uppercase",
                            color: "#F7F8F8",
                            opacity: o,
                        }}
                    >
                        {shot.label}
                    </div>
                );
            })}
        </div>
    );
};
