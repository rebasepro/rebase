import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Scene } from "../components/Scene";
import { Mark } from "../components/Mark";
import { ramp } from "../components/motion";
import { FRAME, FONT, INK } from "../theme";

/**
 * 08 · THE ASK — 175 frames.
 *
 * LIT, not chroma. This was a flat coral field, which is what the design
 * system nominates for "the ask" — and it was wrong here. Coral is the site's
 * alarm hue and it only exists at high lightness, so the closing card had to
 * invert to near-black ink and the film ended on a register it had used
 * nowhere else. Fifty seconds of dark strata and one bright pink card at the
 * end reads as a different piece of film.
 *
 * So the close bookends the open instead: the same ribbon, the same mark
 * assembling out of it. That also leaves the deep blue of 04 as the ONLY flat
 * colour in the film — one chroma moment, spent on the one claim that survives
 * an expert, which is a stronger use of the device than two.
 *
 * The camera keeps moving through the shot (see `travel` below), so the last
 * thing on screen is still travelling when the film ends on it.
 */
export const S08_Close: React.FC = () => {
    const frame = useCurrentFrame();

    const url = ramp(frame, 26, 28);
    const cmd = ramp(frame, 46, 26);
    const foot = ramp(frame, 62, 24);

    return (
        <Scene>
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
                <Mark size={116} delay={2} spread={20} />

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

                {/* The command, once, as the one thing to take away. A field
                    rather than a line of type: this is an object to be copied. */}
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
        </Scene>
    );
};
