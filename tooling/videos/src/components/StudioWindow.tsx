import React from "react";
import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ramp, ENTER } from "./motion";
import { FRAME } from "../theme";

/**
 * Studio's schema editor, as a window: real capture from the live demo, where
 * every property carries its type AND the column it sits on. Building a
 * plausible Studio out of the toolkit would be inventing product.
 *
 * Draws its own window chrome, so it gets no frame head.
 */
export const StudioWindow: React.FC<{
    enterAt?: number;
    /** Frame range of the slow reading drift over the capture. */
    driftUntil?: number;
    style?: React.CSSProperties;
}> = ({ enterAt = 12, driftUntil = 200, style }) => {
    const frame = useCurrentFrame();
    const enter = ramp(frame, enterAt, 30, ENTER);
    const push = interpolate(frame, [enterAt, driftUntil], [1, 1.03], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    /* The capture really moves — the property list scrolls — so the pan on
       top is a slow reading drift, deliberately small. */
    const pan = interpolate(frame, [enterAt, driftUntil], [6, -6], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });

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
                transform: `translateY(${(1 - enter) * 26}px) scale(${push})`,
                ...style,
            }}
        >
            <AbsoluteFill>
                <OffthreadVideo
                    src={staticFile("demo/schema.mp4")}
                    startFrom={90}
                    muted
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: `scale(1.18) translateY(${pan}%)`,
                    }}
                />
            </AbsoluteFill>
        </div>
    );
};
