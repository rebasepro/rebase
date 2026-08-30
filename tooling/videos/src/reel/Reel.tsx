import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { NeatCanvas } from "../gradient/NeatCanvas";
import { GROUND } from "../theme";

/**
 * The shell a CANDIDATE scene renders inside.
 *
 * Scenes in the film get their ground and their gradient from the shared plane
 * in Intro.tsx, which is addressed in absolute film frames. A candidate has no
 * position in that film yet — the whole point is to look at it before deciding
 * whether it earns one — so it carries its own ground and its own station.
 *
 * The station values are the film's: x 0, y -12, zoom 2.05, and a roll inside
 * the 0.10–0.82 plateau where coverage stays 11.8–13.5% of frame. A candidate
 * that were lit differently from the film would be judged on the wrong thing.
 */
export const Reel: React.FC<{
    children: React.ReactNode;
    ground?: string;
    roll?: number;
    reveal?: number;
}> = ({ children, ground = GROUND.base, roll = 0.34, reveal = 0.3 }) => {
    const frame = useCurrentFrame();
    return (
        <AbsoluteFill style={{ background: ground }}>
            <NeatCanvas
                framing="hero"
                opacity={reveal}
                camera={{ cameraX: 0, cameraY: -12, cameraZoom: 2.05, cameraRotationZ: roll }}
                time={frame / 30}
                style={{ mixBlendMode: "screen" }}
            />
            {children}
        </AbsoluteFill>
    );
};
