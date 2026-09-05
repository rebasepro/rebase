import React from "react";
import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { ramp, ENTER } from "../components/motion";
import { FONT, FRAME } from "../theme";
import { useTone } from "../Plane";

/**
 * 07 · STUDIO — the third adoption mode, and the one the film never had.
 *
 * PRODUCT.md lists it plainly: SQL editor, schema visualizer, RLS editor,
 * logs, API explorer. That is a database workspace living inside the same app
 * the operators use, which is the part of the offer that turns "a backend with
 * an admin panel" into something a developer stays in.
 *
 * Shown with real capture from the live demo, not a mock — the schema editor,
 * where every property carries its type AND the column it sits on
 * (`order_number · string`, `customer · relation`). Building a plausible
 * Studio out of the toolkit would be inventing product.
 */

const SURFACES = [
    ["SQL editor", "Query your data, with the schema beside it"],
    ["Schema visualizer", "Tables and relations, as they really are"],
    ["RLS editor", "Read and write the policies where they live"],
    ["Logs & API explorer", "Every request, and what it was answered with"],
];

export const S07_Studio: React.FC = () => {
    const frame = useCurrentFrame();
    const tone = useTone();
    const enter = ramp(frame, 12, 30, ENTER);
    const push = interpolate(frame, [12, 200], [1, 1.03], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });

    /* The capture really moves — that took two tries to get right.
     *
     * The first pass recorded a still and the conclusion drawn from it was that
     * Studio's schema editor "cannot move": the property list fits 800px, so
     * there is nothing to scroll. That was wrong. The list sits in its own
     * overflow-y div with ~465px of overflow, and a wheel over it changes 100%
     * of the frame. The still came from the page's own settle, not the page.
     *
     * The capture now picks three collections and scrolls each one's property
     * list. Measured on the clip: 15% of frames moving, against 4% before.
     *
     * The pan on top is a slow reading drift, not a substitute for interaction.
     * It is deliberately small — the scroll is the motion now. */
    const pan = interpolate(frame, [12, 200], [6, -6], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    });

    return (
        <Scene>
            <Stage>
                <div style={{ display: "flex", gap: 64, alignItems: "center" }}>
                    <div style={{ width: 520, flexShrink: 0 }}>
                        <Chapter n="05" label="Studio" delay={2} />
                        <div style={{ marginTop: 24 }}>
                            <DisplayLine size={DISPLAY.split} delay={8}>Run the database</DisplayLine>
                            <DisplayLine size={DISPLAY.split} delay={13}>from the same app.</DisplayLine>
                        </div>

                        <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 16 }}>
                            {SURFACES.map(([name, note], i) => {
                                const t = ramp(frame, 34 + i * 8, 20);
                                return (
                                    <div
                                        key={name}
                                        style={{ opacity: t, transform: `translateY(${(1 - t) * 8}px)` }}
                                    >
                                        <div
                                            style={{
                                                fontFamily: FONT.display,
                                                fontWeight: 600,
                                                fontSize: 23,
                                                letterSpacing: "-0.014em",
                                                color: tone.high,
                                            }}
                                        >
                                            {name}
                                        </div>
                                        <div
                                            style={{
                                                fontFamily: FONT.body,
                                                fontSize: 17,
                                                color: tone.muted,
                                                marginTop: 1,
                                            }}
                                        >
                                            {note}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Draws its own window chrome, so it gets no frame head. */}
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
                            transform: `translateY(${(1 - enter) * 26}px) scale(${push})`,
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
                </div>
            </Stage>
        </Scene>
    );
};
