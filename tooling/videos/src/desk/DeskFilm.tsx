import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { DeskPlane } from "./DeskPlane";
import { Desk } from "./Desk";
import { beat, DESK_DURATION } from "./beats";
import { Mark } from "../components/Mark";
import { ramp, SHIFT } from "../components/motion";
import { FONT, FRAME, INK } from "../theme";
import { Narration } from "../Narration";
import { DESK_NARRATION } from "./script";

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
        <Narration script={DESK_NARRATION} />
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

/** The address, over the whole desk pulled back behind a scrim: every
 *  window the film visited, small, and the one thing to take away in front
 *  of them. */
const Close: React.FC = () => {
    const frame = useCurrentFrame();
    const at = ALL.start + 40;
    const scrim = ramp(frame, at, 30);
    if (scrim <= 0) return null;
    const url = ramp(frame, at + 30, 26);
    const cmd = ramp(frame, at + 52, 24);
    const foot = ramp(frame, at + 70, 22);
    /* The desk goes, the address stays: the scrim closes to black under the
       wordmark over the last two seconds, so the final frame is the mark, the
       address and the command on ground — not the mosaic coming back as the
       overlay fades. */
    const dark = ramp(frame, DESK_DURATION - 64, 54, SHIFT);
    return (
        <AbsoluteFill>
            <AbsoluteFill style={{ background: "#000", opacity: 0.62 * scrim + 0.38 * dark }} />
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <Mark size={116} delay={at + 12} spread={20} />
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
