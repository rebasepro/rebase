import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { FRAMES_PER_WORD, NARRATION } from "./vo-script";
import { ramp } from "./components/motion";
import { CHROMA, FONT } from "./theme";

/**
 * The voiceover on screen — a PROMPTER, not a subtitle.
 *
 * It is read from while recording, so the line has to be legible before the
 * moment it starts, not at it. The whole line appears dimmed one and a fifth
 * seconds early, a cue bar fills across that time, and the first word lights on
 * the frame the read begins. You look, you draw breath, you start on the bar.
 *
 * Three lines in this film have less than forty frames of clearance from the
 * one before, so a read-ahead this long necessarily overlaps the previous
 * line's tail. The active line is therefore the LATEST one whose read-ahead has
 * begun — an incoming line takes the box over rather than being suppressed by
 * an outgoing one, which is what a find-first would have done.
 */

/** How long the line is readable before its first word. */
const READ_AHEAD = 36;
const HOLD = 16;
const FADE = 10;

export const Narration: React.FC = () => {
    const frame = useCurrentFrame();

    let line: (typeof NARRATION)[number] | undefined;
    for (const l of NARRATION) {
        if (frame >= l.at - READ_AHEAD) line = l;
        else break;
    }
    if (!line) return null;

    const spoken = line.words.filter((_, i) => frame >= line!.at + i * FRAMES_PER_WORD).length;
    const endsAt = line.at + line.words.length * FRAMES_PER_WORD;
    if (frame > endsAt + HOLD + FADE) return null;

    const alpha = Math.max(
        0,
        Math.min(ramp(frame, line.at - READ_AHEAD, 8), 1 - ramp(frame, endsAt + HOLD, FADE)),
    );
    if (alpha <= 0.01) return null;

    /* Fills across the read-ahead and is gone the instant the line starts. */
    const cue = interpolate(frame, [line.at - READ_AHEAD, line.at], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    const counting = frame < line.at;

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
                        position: "relative",
                        maxWidth: 1460,
                        padding: "18px 34px",
                        borderRadius: 14,
                        overflow: "hidden",
                        background: "rgba(0,0,0,0.78)",
                        border: `1px solid ${counting ? "rgba(54,204,214,0.5)" : "rgba(255,255,255,0.12)"}`,
                        fontFamily: FONT.body,
                        fontSize: 34,
                        lineHeight: 1.35,
                        textAlign: "center",
                        color: "#FFFFFF",
                    }}
                >
                    {line.words.map((w, i) => (
                        /* Unspoken words sit at 0.34, not 0.16 — they are there
                           to be READ AHEAD of, so they have to be readable. */
                        <span key={i} style={{ opacity: i < spoken ? 1 : 0.34 }}>
                            {w}
                            {i < line.words.length - 1 ? " " : ""}
                        </span>
                    ))}
                    {counting && (
                        <div
                            style={{
                                position: "absolute",
                                left: 0,
                                bottom: 0,
                                height: 3,
                                width: `${cue * 100}%`,
                                background: CHROMA.cyan,
                            }}
                        />
                    )}
                </div>
            </div>
        </AbsoluteFill>
    );
};
