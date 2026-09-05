import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { ramp, ENTER } from "../components/motion";
import { FONT, FRAME, INK } from "../theme";
import { OVERLAP } from "../transitions";

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

/* Rendered from the live demo at demo.rebase.pro rather than reused from the
   site's media library — dark mode at 1280x800, which is the size that keeps
   the app's own type readable once it sits in a window filling two thirds of a
   1920 frame. Rendered, not recorded: Playwright's recordVideo is locked to
   25fps and this film runs at 30, and no rate divides both.
   See scripts/render-demo.mjs. */
const SHOTS: Shot[] = [
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
    const push = interpolate(frame, [FIRST_SHOT_AT, 280], [1.0, 1.06], {
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
                        <Chapter n="04" label="The panel" delay={4} />
                        <div style={{ marginTop: 26 }}>
                            <DisplayLine size={DISPLAY.split} delay={10}>And an app for</DisplayLine>
                            <DisplayLine size={DISPLAY.split} delay={16}>everyone else.</DisplayLine>
                        </div>

                        {/* The shot label. One line that swaps rather than four
                            that stack: the montage is one idea, not four.

                            The swap is SEQUENTIAL — the old label is gone before
                            the new one starts. They used to cross-fade on the
                            same frames, and two words of tracked uppercase at
                            half strength on top of each other are not two
                            words, they are one: the render showed "EVERYAVIEWORD"
                            under the headline for ten frames at every shot
                            change. The window between them is short enough to
                            read as a blink rather than a gap. */}
                        <div style={{ marginTop: 30, height: 26, position: "relative" }}>
                            {SHOTS.map((shot, i) => {
                                const at = SHOT_AT[i];
                                const o =
                                    ramp(frame, at + 4, 8) *
                                    (1 - ramp(frame, at + shot.frames - 8, 8));
                                return (
                                    <div
                                        key={shot.label}
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
                                <AbsoluteFill key={shot.label} style={{ opacity: o }}>
                                    {/* The Sequence is load-bearing, not tidiness.
                                        Without it every clip plays against the
                                        SCENE clock, so the fourth shot opened 9s
                                        past its startFrom — filter.mp4 had already
                                        run past its full grid into the two-card
                                        tail, which is the near-empty frame that
                                        made this montage look static. */}
                                    <Sequence
                                        from={at}
                                        /* The last shot runs on through the
                                           exit window, which the scene is
                                           mounted OVERLAP frames longer for. */
                                        durationInFrames={
                                            shot.frames + DISSOLVE + 6 + (i === SHOTS.length - 1 ? OVERLAP : 0)
                                        }
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
