import React from "react";
import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ramp, ENTER } from "./motion";
import { FRAME } from "../theme";

/**
 * Studio's SQL editor, as a window: a real capture from the live demo of a
 * real query — orders joined to their VIP customers — typed, run, and then a
 * result row's related customer opened from the row's action menu. "Work on
 * the database itself" is a query and its rows, and the record opening out
 * of a result row is the panel and the database being one app. Building a
 * plausible Studio out of the toolkit would be inventing product.
 *
 * The window opens on the last line being typed (frame 460 of the take), so
 * six seconds hold the run, the rows, the menu and the record.
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
    const push = interpolate(frame, [enterAt, driftUntil], [1, 1.02], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });
    /* The capture really moves — the query runs, the record opens — so the
       pan on top is a slow reading drift, deliberately small, and the frame
       is shown nearly whole: the editor, the results and the record all
       have to be in it. */
    const pan = interpolate(frame, [enterAt, driftUntil], [2, -2], {
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
                    src={staticFile("demo/studio.mp4")}
                    startFrom={460}
                    muted
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        transform: `scale(1.04) translateY(${pan}%)`,
                    }}
                />
            </AbsoluteFill>
        </div>
    );
};
