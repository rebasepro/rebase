import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { NeatCanvas } from "../gradient/NeatCanvas";
import { ramp, SHIFT } from "../components/motion";
import { ToneOverride } from "../Plane";
import { GROUND, TONE, type Ground } from "../theme";
import { Hook } from "./Hook";
import { Premise } from "./Premise";
import { Build, Claim, EndCard, Manage, Shape } from "./Sections";
import { FPS, type Section, sectionLength, sectionStart, SECTIONS } from "./score";

/**
 * RebaseLaunch — a 30-second teaser, cut to its own soundtrack.
 *
 *   hook     2 bars  the product up close, a cut every two beats
 *   premise  2 bars  the site's headline, a word group per beat
 *   build    2 bars  the backend: the typed SDK, realtime
 *   manage   2 bars  the admin panel: views, forms
 *   shape    2 bars  Studio: the schema editor, SQL
 *   claim    2 bars  open source, MIT, any Postgres, no lock-in
 *   end      3 bars  the mark, the line, the command
 *
 * Every section starts on a downbeat of the music in public/launch/music.wav,
 * which `pnpm launch:music` writes from the same score (src/launch/score.ts).
 */

/** Which ground each section sits on, and the ribbon's roll there. Rolls stay
 *  inside the 0.10–0.82 plateau where the ribbon's coverage of the frame is
 *  steady (see Reel.tsx), and turn 14–40 degrees per cut. */
const LOOK: Record<Section, { ground: Ground; roll: number }> = {
    hook: { ground: "base", roll: 0.3 },
    premise: { ground: "base", roll: 0.22 },
    build: { ground: "base", roll: 0.58 },
    manage: { ground: "base", roll: 0.34 },
    shape: { ground: "base", roll: 0.74 },
    claim: { ground: "claim", roll: 0.46 },
    end: { ground: "base", roll: 0.14 },
};

const ORDER = Object.keys(SECTIONS) as Section[];

/** The one gradient under the whole film. On each cut the camera turns and
 *  the ribbon's clock surges forward, so the art moves on the beat too. */
const Backdrop: React.FC = () => {
    const frame = useCurrentFrame();

    let roll = LOOK.hook.roll;
    let surge = 0;
    for (let i = 1; i < ORDER.length; i++) {
        const cut = sectionStart(ORDER[i]);
        const turn = ramp(frame, cut, 36, SHIFT);
        roll += (LOOK[ORDER[i]].roll - LOOK[ORDER[i - 1]].roll) * turn;
        surge += turn;
    }

    // The claim field is a hard cut on its downbeat, both ways: a fade puts
    // the hit on a half-coloured frame.
    const chroma = frame >= sectionStart("claim") && frame < sectionStart("end") ? 1 : 0;

    // The end card is the one place the art comes up: the brand, at the drop.
    const bloom = ramp(frame, sectionStart("end"), 40);

    return (
        <>
            <AbsoluteFill style={{ background: GROUND.base }} />
            <AbsoluteFill style={{ background: GROUND.claim, opacity: chroma }} />
            <NeatCanvas
                framing="hero"
                opacity={interpolate(bloom, [0, 1], [0.3, 0.5])}
                camera={{ cameraX: 0, cameraY: -12, cameraZoom: 2.05, cameraRotationZ: roll }}
                time={frame / FPS * 0.7 + surge * 0.8}
                style={{ mixBlendMode: "screen" }}
            />
        </>
    );
};

const PARTS: Record<Section, React.FC> = {
    hook: Hook,
    premise: Premise,
    build: Build,
    manage: Manage,
    shape: Shape,
    claim: Claim,
    end: EndCard,
};

export const RebaseLaunch: React.FC = () => (
    <AbsoluteFill>
        <Backdrop />
        {ORDER.map((s) => {
            const Part = PARTS[s];
            return (
                <Sequence key={s} from={sectionStart(s)} durationInFrames={sectionLength(s)} name={s}>
                    <ToneOverride.Provider value={TONE[LOOK[s].ground]}>
                        <Part />
                    </ToneOverride.Provider>
                </Sequence>
            );
        })}
        <Audio src={staticFile("launch/music.wav")} />
    </AbsoluteFill>
);
