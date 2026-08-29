import React from "react";
import { useCurrentFrame } from "remotion";
import { FONT, INK, TRACKING } from "../theme";
import { useTone } from "../Plane";
import { lineReveal, rise } from "./motion";

/**
 * The type tiers, keyed to RENDERED SIZE rather than to any tag depth — the
 * same rule the product's scale uses.
 *
 * The weight ceiling is 600 and it is not negotiable: the display tier
 * separates itself by size and tracking, which is the whole reason the tier
 * exists instead of reaching for 700. (The bento renders already in this
 * package are from before that rule and still show 800s. They are the reason
 * it is written down.)
 */

/**
 * The display scale. Three sizes, and a scene picks one by ROLE — not by how
 * long its headline happens to be.
 *
 * Before this the film ran twelve different headline sizes (104, 82, 68, 78,
 * 62, 54, 58, 90, 68, 76, 78, 110), which is why it read as unsettled from cut
 * to cut even though every other measure had been made consistent.
 *
 *   BOOKEND    the first and last frames. Larger than anything between them.
 *   STATEMENT  the headline IS the slide; full width, nothing beside it.
 *   SPLIT      a headline in a column with an artifact next to it.
 */
export const DISPLAY = {
    bookend: 104,
    statement: 84,
    split: 56,
} as const;

interface LineProps {
    children: React.ReactNode;
    delay?: number;
    duration?: number;
    style?: React.CSSProperties;
}

/** A display line inside its own clip box, so it can rise into frame.
 *  One box PER LINE — a shared box would let a later line be visible through
 *  the gap above an earlier one before its turn. */
export const DisplayLine: React.FC<LineProps & { size?: number }> = ({
    children,
    delay = 0,
    duration = 18,
    size = 92,
    style,
}) => {
    const frame = useCurrentFrame();
    const tone = useTone();
    /* The clip box is what lets the line rise into frame, so it cannot go — but
       overflow clips at the PADDING edge, and 0.08em was less room than a
       descender needs: every g, y and p in the film was sliced flat. 0.24em
       clears the face's descender, and the equal negative margin keeps the line
       box exactly the height it always was. */
    return (
        <div style={{ overflow: "hidden", paddingBottom: "0.24em", marginBottom: "-0.24em" }}>
            <div
                style={{
                    fontFamily: FONT.display,
                    fontWeight: 600,
                    fontSize: size,
                    lineHeight: 0.98,
                    letterSpacing: TRACKING.display,
                    color: tone.high,
                    ...lineReveal(frame, delay, duration),
                    ...style,
                }}
            >
                {children}
            </div>
        </div>
    );
};

/** The sentence under a display line. 34rem-equivalent measure, kept short. */
export const Lead: React.FC<LineProps & { size?: number; width?: number }> = ({
    children,
    delay = 0,
    size = 26,
    width = 560,
    style,
}) => {
    const frame = useCurrentFrame();
    const tone = useTone();
    return (
        <p
            style={{
                fontFamily: FONT.body,
                fontWeight: 400,
                fontSize: size,
                lineHeight: 1.5,
                letterSpacing: "-0.005em",
                color: tone.copy,
                maxWidth: width,
                ...rise(frame, delay, 14),
                ...style,
            }}
        >
            {children}
        </p>
    );
};

/** Uppercase, tracked, monospace. It never carries a sentence — that is what
 *  earns it the right to be this small. */
export const Eyebrow: React.FC<LineProps & { tone?: string }> = ({
    children,
    delay = 0,
    tone,
    style,
}) => {
    const frame = useCurrentFrame();
    const ground = useTone();
    const colour = tone ?? ground.muted;
    return (
        <div
            style={{
                fontFamily: FONT.mono,
                fontWeight: 400,
                fontSize: 15,
                textTransform: "uppercase",
                letterSpacing: TRACKING.eyebrow,
                color: colour,
                ...rise(frame, delay, 8),
                ...style,
            }}
        >
            {children}
        </div>
    );
};

/** A chapter number. Same tier as the eyebrow, paired with it, never tinted —
 *  the site used to give each chapter a hue of its own and it meant nothing. */
export const Chapter: React.FC<{ n: string; label: string; delay?: number }> = ({
    n,
    label,
    delay = 0,
}) => {
    const tone = useTone();
    return (
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            <Eyebrow delay={delay} tone={tone.copy}>{n}</Eyebrow>
            <div style={{ height: 1, width: 40, background: tone.rule, transform: "translateY(-5px)" }} />
            <Eyebrow delay={delay + 3}>{label}</Eyebrow>
        </div>
    );
};

export const Mono: React.FC<{
    children: React.ReactNode;
    size?: number;
    color?: string;
    style?: React.CSSProperties;
}> = ({ children, size = 20, color = INK.copy, style }) => (
    <span style={{ fontFamily: FONT.mono, fontSize: size, color, letterSpacing: "-0.01em", ...style }}>
        {children}
    </span>
);
