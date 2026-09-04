import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { FRAMES_PER_WORD, NARRATION } from "./vo-script";
import { ramp } from "./components/motion";
import { FONT } from "./theme";

/**
 * The voiceover, spoken on screen, for judging RHYTHM before it is recorded.
 *
 * Words appear one at a time at the narration pace, so what you are watching is
 * the delivery: where a line starts, how long it runs, and how much silence
 * follows it. A static subtitle would show the words and hide the thing being
 * tested.
 *
 * Timing is ABSOLUTE, not per scene — several lines begin before their own cut
 * and carry across it, which is the whole point and something a scene-indexed
 * caption could not express.
 *
 * This is a separate composition. RebaseIntro renders without it.
 */

const HOLD = 18;   // frames the finished line stays up
const FADE = 12;

export const Narration: React.FC = () => {
    const frame = useCurrentFrame();

    const line = NARRATION.find(
        (l) => frame >= l.at - 8 && frame < l.at + l.words.length * FRAMES_PER_WORD + HOLD + FADE,
    );
    if (!line) return null;

    const spoken = line.words.filter((_, i) => frame >= line.at + i * FRAMES_PER_WORD).length;
    const endsAt = line.at + line.words.length * FRAMES_PER_WORD;
    const alpha = Math.max(0, Math.min(ramp(frame, line.at - 8, 8), 1 - ramp(frame, endsAt + HOLD, FADE)));
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
                        background: "rgba(0,0,0,0.72)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        fontFamily: FONT.body,
                        fontSize: 34,
                        lineHeight: 1.35,
                        textAlign: "center",
                        color: "#FFFFFF",
                    }}
                >
                    {line.words.map((w, i) => (
                        <span key={i} style={{ opacity: i < spoken ? 1 : 0.16 }}>
                            {w}
                            {i < line.words.length - 1 ? " " : ""}
                        </span>
                    ))}
                </div>
            </div>
        </AbsoluteFill>
    );
};
