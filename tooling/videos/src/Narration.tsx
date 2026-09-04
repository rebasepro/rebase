import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { SCENES, STARTS } from "./film";
import { LEAD_IN, NARRATION, WORDS_PER_SECOND } from "./vo-script";
import { ramp } from "./components/motion";
import { FONT } from "./theme";

/**
 * The voiceover, spoken on screen, for judging RHYTHM before it is recorded.
 *
 * Words appear one at a time at the narration pace, so what you are watching is
 * the delivery: where the line starts, how long it runs, and — the part that
 * actually matters — how much of the scene is left over in silence afterwards.
 * A static subtitle would show the words and hide exactly the thing being
 * tested.
 *
 * This is a SEPARATE composition. RebaseIntro renders without it and always
 * has; nothing here is meant to ship.
 */

const PER_WORD = 30 / WORDS_PER_SECOND;

export const Narration: React.FC = () => {
    const frame = useCurrentFrame();

    const i = SCENES.findIndex(
        (s, k) => frame >= STARTS[k] && frame < STARTS[k] + s.durationInFrames,
    );
    if (i < 0) return null;

    /* Scene ids in film.ts are names; the script is numbered by position, and
       the cold open is silent and holds slot 00. */
    const line = NARRATION[i - 1];
    if (!line) return null;

    const local = frame - STARTS[i];
    const spoken = line.words.filter((_, w) => local >= LEAD_IN + w * PER_WORD).length;
    const endsAt = LEAD_IN + line.words.length * PER_WORD;

    const up = ramp(local, LEAD_IN - 6, 8);
    /* Held briefly, then gone — so the silence at the end of a scene is visible
       as silence rather than as a caption nobody is reading any more. */
    const down = 1 - ramp(local, endsAt + 18, 12);
    const alpha = Math.max(0, Math.min(up, down));
    if (alpha <= 0.01) return null;

    return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 54,
                    display: "flex",
                    justifyContent: "center",
                    opacity: alpha,
                }}
            >
                <div
                    style={{
                        maxWidth: 1460,
                        padding: "18px 34px",
                        borderRadius: 14,
                        /* Opaque enough to survive the two chroma grounds; this
                           is a test overlay, not part of the design. */
                        background: "rgba(0,0,0,0.72)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        fontFamily: FONT.body,
                        fontSize: 34,
                        lineHeight: 1.35,
                        textAlign: "center",
                        color: "#FFFFFF",
                    }}
                >
                    {line.words.map((w, k) => (
                        <span key={k} style={{ opacity: k < spoken ? 1 : 0.16 }}>
                            {w}
                            {k < line.words.length - 1 ? " " : ""}
                        </span>
                    ))}
                </div>
            </div>
        </AbsoluteFill>
    );
};
