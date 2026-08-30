import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, FRAME, INK } from "../theme";
import { useTone } from "../Plane";
import { pop, SPRING } from "./motion";

/**
 * The one treatment every product surface gets — the same border, radius and
 * shadow stack the site's `frame` utility carries, so a window in this film
 * and a window on rebase.pro are the same object.
 *
 * The rule that comes with it: a surface that draws its own window chrome must
 * NOT also get a frame head. One chrome per window.
 */
export const Frame: React.FC<{
    children: React.ReactNode;
    /** Shown in the head. Omit for a surface that has its own chrome. */
    title?: string;
    /** Right-hand side of the head — a copy affordance, a port, a status. */
    meta?: React.ReactNode;
    delay?: number;
    width?: number | string;
    style?: React.CSSProperties;
    bodyStyle?: React.CSSProperties;
    /** Skip the spring — for a frame that is already on screen when the scene
     *  starts and should not re-enter. */
    still?: boolean;
}> = ({ children, title, meta, delay = 0, width, style, bodyStyle, still }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const p = still ? 1 : pop(frame, fps, delay, SPRING.card);

    return (
        <div
            style={{
                width,
                borderRadius: FRAME.radius,
                border: FRAME.border,
                background: FRAME.background,
                boxShadow: FRAME.boxShadow,
                overflow: "hidden",
                opacity: Math.min(1, p * 1.6),
                transform: `translateY(${(1 - p) * 26}px) scale(${0.985 + 0.015 * p})`,
                ...style,
            }}
        >
            {title !== undefined && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "12px 18px",
                        borderBottom: `1px solid ${INK.ruleSoft}`,
                        fontFamily: FONT.mono,
                        fontSize: 14,
                        color: INK.muted,
                    }}
                >
                    <Dot color="rgba(244,63,94,0.7)" />
                    <Dot color="rgba(251,191,36,0.7)" />
                    <Dot color="rgba(52,211,153,0.7)" />
                    <span style={{ marginLeft: 10 }}>{title}</span>
                    {meta && <div style={{ marginLeft: "auto" }}>{meta}</div>}
                </div>
            )}
            <div style={{ padding: 28, ...bodyStyle }}>{children}</div>
        </div>
    );
};

const Dot: React.FC<{ color: string }> = ({ color }) => (
    <span style={{ width: 9, height: 9, borderRadius: 999, background: color, display: "block" }} />
);

/** A hairline card — the surface for anything that is a fact rather than a
 *  window. Page surfaces get a hairline; only floating surfaces get a definite
 *  edge, which is why this is not the Frame treatment at a smaller radius. */
export const Card: React.FC<{
    children: React.ReactNode;
    delay?: number;
    accent?: string;
    style?: React.CSSProperties;
}> = ({ children, delay = 0, accent, style }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const tone = useTone();
    const p = pop(frame, fps, delay, SPRING.card);

    return (
        <div
            style={{
                borderRadius: 12,
                border: `1px solid ${accent ? `${accent}44` : tone.cardBorder}`,
                background: tone.cardFill,
                padding: "22px 24px",
                opacity: Math.min(1, p * 1.7),
                transform: `translateY(${(1 - p) * 20}px)`,
                ...style,
            }}
        >
            {children}
        </div>
    );
};
