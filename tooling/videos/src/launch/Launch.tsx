import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { NeatCanvas } from "../gradient/NeatCanvas";
import { ramp, SHIFT } from "../components/motion";
import { ToneOverride } from "../Plane";
import { GROUND, TONE, type Ground } from "../theme";
import { Hook } from "./Hook";
import { Premise } from "./Premise";
import { Agents, Define, Secure } from "./Claims";
import { Build, Claim, EndCard, Manage, Shape } from "./Sections";
import { FPS, type Section, sectionLength, sectionStart, SECTIONS, type Track } from "./score";

/**
 * RebaseLaunch — a 46-second teaser, cut to its own soundtrack.
 *
 *   hook     2 bars  a wall of the live product
 *   premise  2 bars  the site's headline, a word group per beat
 *   define   3 bars  one collection file, and every surface drawn out of it
 *   secure   3 bars  the same query, two users, different rows (claim field)
 *   build    2 bars  the backend: the typed SDK, realtime
 *   agents   2 bars  an MCP session under a scoped key, and its 403
 *   manage   2 bars  the admin panel: views, the same policies
 *   shape    2 bars  Studio: relations, SQL
 *   claim    2 bars  open source, MIT, any Postgres, no lock-in (deep field)
 *   end      3 bars  the mark, the line, the command
 *
 * The verbs follow docs/PRODUCT.md's ranked claims. Every section starts on a
 * downbeat of public/launch/music.wav, which `pnpm launch:music` writes from
 * the same score (src/launch/score.ts).
 */

/** Which ground each section sits on, and the ribbon's roll there. Rolls stay
 *  inside the 0.10–0.82 plateau where the ribbon's coverage of the frame is
 *  steady (see Reel.tsx), and turn 14–40 degrees per cut. */
const LOOK: Record<Section, { ground: Ground; roll: number }> = {
    hook: { ground: "base", roll: 0.3 },
    premise: { ground: "base", roll: 0.22 },
    define: { ground: "base", roll: 0.62 },
    // Security in the database is THE CLAIM, and the claim field is the
    // system's for exactly that (theme.ts). The closing list gets the second
    // field, so chroma is spent twice, as in the long film.
    secure: { ground: "claim", roll: 0.36 },
    build: { ground: "base", roll: 0.7 },
    agents: { ground: "base", roll: 0.44 },
    manage: { ground: "base", roll: 0.16 },
    shape: { ground: "base", roll: 0.52 },
    claim: { ground: "deep", roll: 0.28 },
    end: { ground: "base", roll: 0.62 },
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

    // A field is a hard cut on its downbeat, both ways: a fade puts the hit
    // on a half-coloured frame.
    const current = [...ORDER].reverse().find((s) => frame >= sectionStart(s)) ?? "hook";
    const field = LOOK[current].ground;

    // The end card is the one place the art comes up: the brand, at the drop.
    const bloom = ramp(frame, sectionStart("end"), 40);

    return (
        <>
            <AbsoluteFill style={{ background: GROUND.base }} />
            {field !== "base" && <AbsoluteFill style={{ background: GROUND[field] }} />}
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
    define: Define,
    secure: Secure,
    agents: Agents,
    build: Build,
    manage: Manage,
    shape: Shape,
    claim: Claim,
    end: EndCard,
};

export const RebaseLaunch: React.FC<{ track: Track }> = ({ track }) => (
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
        <Audio src={staticFile(`launch/music-${track}.wav`)} />
    </AbsoluteFill>
);
