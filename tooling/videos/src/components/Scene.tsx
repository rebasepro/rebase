import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { useSlideMotion } from "../Plane";
import { ramp, SHIFT } from "./motion";

/**
 * A scene is CONTENT, and nothing else.
 *
 * It draws no art and no ground. The Neat ribbon and the ground over it are
 * both owned by the film (`Plane.tsx`) so they can be continuous across a cut;
 * all a scene does is put type in front of them and be carried by its
 * transition. Which ground it sits on and how much of the plane shows through
 * are declared in `film.ts`, next to the station — because those are facts
 * about where the scene sits in the film, not about what it says.
 */
export const Scene: React.FC<{
    children: React.ReactNode;
    /** Fades up from black. The film's opening only; everywhere else the
     *  transitions carry it. */
    fadeIn?: number;
    style?: React.CSSProperties;
}> = ({ children, fadeIn = 0, style }) => {
    const frame = useCurrentFrame();
    const up = fadeIn ? ramp(frame, 0, fadeIn, SHIFT) : 1;
    const { px, py, scale, opacity } = useSlideMotion();

    const still = px === 0 && py === 0 && scale === 1;
    const alpha = opacity * up;

    return (
        <AbsoluteFill style={{ overflow: "hidden", ...style }}>
            {fadeIn > 0 && <AbsoluteFill style={{ background: "#000", opacity: 1 - up }} />}

            {/* The transform is omitted entirely when the slide is at rest: a
                transform — even `translate3d(0,0,0)` — promotes this to its own
                compositor layer, and a promoted layer rasterises display type
                slightly differently from one process to the next. One level on
                glyph edges, invisible, but it is the difference between renders
                that are byte-identical and renders that are merely
                indistinguishable. Most frames sit still.

                It is also, and more importantly, a VISIBLE problem. A slow
                transform over type does not read as gentle movement, it reads
                as vibration: every glyph lands on a new sub-pixel offset each
                frame and is re-rasterised, so the whole block shimmers. This
                was tried — a 1.022 scale over a scene, meant as "a camera that
                has not quite settled" — and measured 87 of 89 frames changing
                in a code frame that should have been perfectly still. Type in
                this film moves to a position and then STOPS. Motion belongs to
                the footage, the gradient and the cuts. */}
            <AbsoluteFill
                style={
                    still && alpha === 1
                        ? undefined
                        : {
                              transform: `translate3d(${px}px, ${py}px, 0) scale(${scale})`,
                              opacity: alpha,
                          }
                }
            >
                {children}
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

/**
 * Where the film's content actually starts, in pixels at 1920 wide.
 *
 * Exported because it was being guessed. `Stage` pads 112 and then centres a
 * 1520 measure inside the remaining 1696, so content begins at
 * 112 + (1696 - 1520) / 2 = 200 — and two scenes were drawing their hairline
 * rules at 112, overhanging the type they were meant to sit under by 88px on
 * each side. Anything that needs to line up with the copy uses this.
 */
export const STAGE_INSET = 200;

/** The shell every scene composes inside. One measure for the whole film means
 *  the left margin never moves between stations, which is most of why nine very
 *  different slides still read as one piece. */
export const Stage: React.FC<{
    children: React.ReactNode;
    style?: React.CSSProperties;
}> = ({ children, style }) => (
    <AbsoluteFill
        style={{
            padding: "0 112px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            ...style,
        }}
    >
        <div style={{ width: "100%", maxWidth: 1520, margin: "0 auto" }}>{children}</div>
    </AbsoluteFill>
);
