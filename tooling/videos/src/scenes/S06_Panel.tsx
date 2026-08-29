import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { ramp, ENTER } from "../components/motion";
import { FONT, FRAME, INK } from "../theme";

/**
 * 06 · THE PANEL — 260 frames.
 *
 * Claim 3, and the one nobody else in the category can make. The claim itself
 * is unchanged and the site still records it as "the panel is a separate
 * product" — but that is an ARCHITECTURE note, and saying it out loud to a
 * viewer sells the product short twice: it makes the panel sound like a second
 * thing to buy, and it makes the backend sound like it comes with an
 * afterthought attached.
 *
 * What is actually true is better: it is the SAME definition, rendered for
 * people instead of for code. The optionality survives in the sub — nothing is
 * duplicated, the API does not move — where it belongs, as a consequence.
 *
 * Shown rather than described: this is the only scene running real captured
 * footage, and the ground is BASE because that is what base means here.
 *
 * The window draws its own chrome (it is a screen recording of an app that has
 * a header), so it does NOT also get a frame head. One chrome per window.
 */

interface Shot {
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

/* Captured fresh from the live demo at demo.rebase.pro rather than reused from
   the site's media library — recorded in dark mode at 1280x800, which is the
   size that keeps the app's own type readable once it sits in a window filling
   two thirds of a 1920 frame.
   See scripts/capture-demo.mjs. */
const SHOTS: Shot[] = [
    { file: "demo/products.mp4", label: "Cards", from: 150, frames: 76 },
    /* The one that shows the panel being USED, and the reason the montage
       stopped reading as static: the grid, a product picked out of it, and the
       record that opens. It gets by far the longest hold because it is three
       beats where a scrolling list is one — the cut lands 35 frames in, so it
       needs a real lead on the grid before it and room to read after.
       A fourth shot of filter chips used to sit after this one and was cut: it
       measured 3.15 mean delta against this clip's beats, and four shots left
       none of them long enough to land. */
    { file: "demo/record.mp4", label: "Open a record", from: 205, frames: 160 },
    { file: "demo/orders.mp4", label: "Every view", from: 180, frames: 96 },
];

const DISSOLVE = 14;
const FIRST_SHOT_AT = 28;

/** Where each shot starts, so a shot's length is a property of the shot. */
const SHOT_AT = SHOTS.reduce<number[]>(
    (acc, shot, i) => [...acc, i === 0 ? FIRST_SHOT_AT : acc[i - 1] + SHOTS[i - 1].frames],
    [],
);

export const S06_Panel: React.FC = () => {
    const frame = useCurrentFrame();

    // One slow push across the whole montage rather than one per shot: the
    // cuts already supply the rhythm, and re-zooming on every cut is the thing
    // that makes a product montage feel like an ad.
    const push = interpolate(frame, [FIRST_SHOT_AT, 360], [1.0, 1.06], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    const enter = ramp(frame, 10, 32, ENTER);

    return (
        <Scene>
            <Stage>
                <div style={{ display: "flex", gap: 72, alignItems: "center" }}>
                    {/* 520, not 460: at 62px in a 460 column the headline set in FOUR
                        lines and became the tallest thing in the shot, which is
                        the wrong emphasis for a scene whose subject is the
                        window beside it. */}
                    <div style={{ width: 520, flexShrink: 0 }}>
                        <Chapter n="05" label="The panel" delay={4} />
                        <div style={{ marginTop: 26 }}>
                            <DisplayLine size={DISPLAY.split} delay={10}>Add the panel.</DisplayLine>
                            <DisplayLine size={DISPLAY.split} delay={16}>It becomes an app.</DisplayLine>
                        </div>
                        <div
                            style={{
                                marginTop: 28,
                                fontFamily: FONT.body,
                                fontSize: 23,
                                lineHeight: 1.55,
                                color: INK.copy,
                                opacity: ramp(frame, 34, 22),
                            }}
                        >
                            The same definition, rendered for everyone who is not a
                            developer — reading the same API your code reads, under the
                            same policies. Nothing is duplicated for them.
                        </div>

                        {/* The shot label. One line that swaps rather than four
                            that stack: the montage is one idea, not four. */}
                        <div style={{ marginTop: 30, height: 26, position: "relative" }}>
                            {SHOTS.map((shot, i) => {
                                const at = SHOT_AT[i];
                                const o =
                                    ramp(frame, at, 10) *
                                    (1 - ramp(frame, at + shot.frames, 10));
                                return (
                                    <div
                                        key={shot.file}
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            fontFamily: FONT.mono,
                                            fontSize: 16,
                                            letterSpacing: "0.22em",
                                            textTransform: "uppercase",
                                            color: INK.high,
                                            opacity: o,
                                        }}
                                    >
                                        {shot.label}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div
                        style={{
                            flex: 1,
                            aspectRatio: "1280 / 800",
                            borderRadius: FRAME.radius,
                            border: FRAME.border,
                            background: "#000",
                            boxShadow: FRAME.boxShadow,
                            overflow: "hidden",
                            position: "relative",
                            opacity: enter,
                            transform: `translateY(${(1 - enter) * 30}px) scale(${push})`,
                        }}
                    >
                        {SHOTS.map((shot, i) => {
                            const at = SHOT_AT[i];
                            // Cross-dissolve: each shot fades up as the one before
                            // it fades down, so the window is never empty.
                            const o =
                                ramp(frame, at, i === 0 ? DISSOLVE + 6 : DISSOLVE) *
                                (i === SHOTS.length - 1
                                    ? 1
                                    : 1 - ramp(frame, at + shot.frames, DISSOLVE));
                            if (o <= 0.001) return null;
                            return (
                                <AbsoluteFill key={shot.file} style={{ opacity: o }}>
                                    {/* The Sequence is load-bearing, not tidiness.
                                        Without it every clip plays against the
                                        SCENE clock, so the fourth shot opened 9s
                                        past its startFrom — filter.mp4 had already
                                        run past its full grid into the two-card
                                        tail, which is the near-empty frame that
                                        made this montage look static. */}
                                    <Sequence
                                        from={at}
                                        durationInFrames={shot.frames + DISSOLVE + 6}
                                        layout="none"
                                    >
                                    <OffthreadVideo
                                        src={staticFile(shot.file)}
                                        startFrom={shot.from}
                                        muted
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "cover",
                                        }}
                                    />
                                    </Sequence>
                                </AbsoluteFill>
                            );
                        })}
                    </div>
                </div>
            </Stage>
        </Scene>
    );
};
