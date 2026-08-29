import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Scene } from "../components/Scene";
import { Mark } from "../components/Mark";
import { ramp } from "../components/motion";
import { FONT, INK } from "../theme";
import { interpolate } from "remotion";

/**
 * 00 · COLD OPEN — 105 frames.
 *
 * Black, then the ribbon, then the mark builds itself facet by facet. No copy
 * beyond the name: the film has not said anything yet, and the first thing it
 * says should not be a claim.
 *
 * The gradient arrives BEFORE the mark and is still arriving as it lands. Two
 * things resolving at the same instant makes for one loud moment and three
 * dead seconds; staggering them gives the shot somewhere to go.
 */
export const S00_ColdOpen: React.FC = () => {
    const frame = useCurrentFrame();

    // A slow push-in on the whole frame. 3% over the scene: below the threshold
    // where anyone notices a zoom, above the one where the shot feels locked off.
    const push = interpolate(frame, [0, 105], [1, 1.03], { extrapolateRight: "clamp" });

    // The name arrives after the mark has finished assembling.
    const word = ramp(frame, 52, 26);

    return (
        <Scene fadeIn={26}>
            <AbsoluteFill
                style={{
                    alignItems: "center",
                    justifyContent: "center",
                    transform: `translateY(-46px) scale(${push})`,
                }}
            >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
                    <Mark size={214} delay={14} spread={30} />

                    <div style={{ overflow: "hidden", paddingBottom: "0.12em", marginBottom: "-0.12em" }}>
                        <div
                            style={{
                                fontFamily: FONT.display,
                                fontWeight: 600,
                                fontSize: 76,
                                letterSpacing: "-0.03em",
                                color: INK.high,
                                transform: `translateY(${(1 - word) * 108}%)`,
                            }}
                        >
                            Rebase
                        </div>
                    </div>
                </div>
            </AbsoluteFill>
        </Scene>
    );
};
