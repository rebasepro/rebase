import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { DeskPlane } from "./DeskPlane";
import { Desk } from "./Desk";
import { beat, DESK_DURATION } from "./beats";
import { Mark } from "../components/Mark";
import { ramp, SHIFT } from "../components/motion";
import { FONT, FRAME, INK } from "../theme";
import { Narration } from "../Narration";
import { DESK_FRAMES_PER_WORD, DESK_NARRATION } from "./script";

/**
 * The film: the ribbon, the desk on it, and two things in SCREEN space that
 * are not on the desk — the mark that opens it and the address that closes
 * it. Everything between those two is a place on the desk the camera goes.
 */
export const RebaseDesk: React.FC = () => (
    <AbsoluteFill style={{ background: "#000" }}>
        <DeskPlane />
        <Desk />
        <ColdOpen />
        <Close />
    </AbsoluteFill>
);

/** With the prompter, for timing the read. Not a deliverable. */
export const RebaseDeskVO: React.FC = () => (
    <>
        <RebaseDesk />
        <Narration script={DESK_NARRATION} framesPerWord={DESK_FRAMES_PER_WORD} />
    </>
);

const HOOK = beat("hook");

/** Black, then the mark building facet by facet, then the name. It fades as
 *  the first headline rises behind it on the desk. */
const ColdOpen: React.FC = () => {
    const frame = useCurrentFrame();
    const up = ramp(frame, 0, 22, SHIFT);
    const out = 1 - ramp(frame, HOOK.start - 4, 14, SHIFT);
    if (out <= 0) return null;
    const word = ramp(frame, 40, 22);
    const push = interpolate(frame, [0, HOOK.start], [1, 1.03], { extrapolateRight: "clamp" });
    return (
        <AbsoluteFill style={{ opacity: out }}>
            <AbsoluteFill style={{ background: "#000", opacity: 1 - up }} />
            <AbsoluteFill
                style={{
                    alignItems: "center",
                    justifyContent: "center",
                    transform: `translateY(-46px) scale(${push})`,
                }}
            >
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
                    <Mark size={214} delay={8} spread={28} />
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
                            rebase
                        </div>
                    </div>
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

const ALL = beat("all");

/** The address, over the whole desk pulled back: every window the film
 *  visited, small, for as long as the pull-back takes — then they go, and
 *  the one thing to take away is what is left.
 *
 *  The mark starts assembling while the camera is still pulling out, and the
 *  desk is most of the way to black by the time the wordmark is up. A first
 *  cut held the mosaic at 38% under the whole address, and with nine windows
 *  and three headlines behind it the close had more on screen than any
 *  other shot in the film — the one shot that should have the least. */
const Close: React.FC = () => {
    const frame = useCurrentFrame();
    const at = ALL.start + 24;
    const mark = ramp(frame, at, 1);
    if (mark <= 0) return null;
    const scrim = ramp(frame, at + 10, 44);
    const url = ramp(frame, at + 26, 26);
    const cmd = ramp(frame, at + 48, 24);
    const foot = ramp(frame, at + 66, 22);
    /* And to black entirely under the last line, so the final frame is the
       mark, the address and the command on ground. */
    const dark = ramp(frame, DESK_DURATION - 70, 56, SHIFT);
    return (
        <AbsoluteFill>
            <AbsoluteFill style={{ background: "#000", opacity: 0.86 * scrim + 0.14 * dark }} />
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <Mark size={116} delay={at} spread={18} />
                <div style={{ overflow: "hidden", marginTop: 38, paddingBottom: "0.1em" }}>
                    <div
                        style={{
                            fontFamily: FONT.display,
                            fontWeight: 600,
                            fontSize: 104,
                            letterSpacing: "-0.034em",
                            lineHeight: 1,
                            color: INK.high,
                            transform: `translateY(${(1 - url) * 108}%)`,
                        }}
                    >
                        rebase.pro
                    </div>
                </div>
                <div
                    style={{
                        marginTop: 42,
                        padding: "18px 34px",
                        borderRadius: 12,
                        border: `1px solid ${INK.rule}`,
                        background: FRAME.background,
                        fontFamily: FONT.mono,
                        fontSize: 28,
                        color: INK.high,
                        letterSpacing: "-0.01em",
                        opacity: cmd,
                        transform: `translateY(${(1 - cmd) * 14}px)`,
                    }}
                >
                    <span style={{ color: INK.muted, marginRight: 14 }}>$</span>
                    pnpm dlx @rebasepro/cli init
                </div>
                <div
                    style={{
                        marginTop: 38,
                        fontFamily: FONT.mono,
                        fontSize: 17,
                        letterSpacing: "0.22em",
                        textTransform: "uppercase",
                        color: INK.muted,
                        opacity: foot,
                    }}
                >
                    Open source · Postgres-native · Deploy anywhere
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};
