import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { ramp } from "../components/motion";
import { FONT } from "../theme";
import { useTone } from "../Plane";

/**
 * 11 · YOURS — the beat the film was missing entirely.
 *
 * MIT, and self-hosting is not one deployment option among several: per
 * PRODUCT.md it is *the only thing that ships*. Every competitor in this
 * category is a service you rent, and none of them can end on this. It is the
 * strongest close available and it was not in the film at all.
 *
 * Careful with the constraint while writing here: no managed tier may be
 * presented as available, priced or deployable. The copy below claims nothing
 * about hosting except that you do it.
 */

const FACTS: [string, string][] = [
    ["MIT", "Fork it, change it, ship it. No clause takes that back."],
    ["Self-hosted", "Your laptop, your server, your cloud. Same artifact."],
    ["Your credentials", "No second party operates it and no one else holds the keys."],
];

export const S11_Ownership: React.FC = () => {
    const frame = useCurrentFrame();
    const tone = useTone();

    return (
        <Scene>
            <Stage>
                <Chapter n="10" label="Yours" delay={2} />
                <div style={{ marginTop: 24 }}>
                    <DisplayLine size={DISPLAY.statement} delay={8}>Nothing here can be</DisplayLine>
                    <DisplayLine size={DISPLAY.statement} delay={14}>taken away from you.</DisplayLine>
                </div>

                <div style={{ display: "flex", gap: 30, marginTop: 62 }}>
                    {FACTS.map(([term, note], i) => {
                        const t = ramp(frame, 40 + i * 9, 24);
                        return (
                            <div
                                key={term}
                                style={{
                                    flex: 1,
                                    opacity: t,
                                    transform: `translateY(${(1 - t) * 14}px)`,
                                    borderTop: `1px solid ${tone.rule}`,
                                    paddingTop: 20,
                                }}
                            >
                                <div
                                    style={{
                                        fontFamily: FONT.display,
                                        fontWeight: 600,
                                        fontSize: 30,
                                        letterSpacing: "-0.018em",
                                        color: tone.high,
                                    }}
                                >
                                    {term}
                                </div>
                                <div
                                    style={{
                                        marginTop: 8,
                                        fontFamily: FONT.body,
                                        fontSize: 19,
                                        lineHeight: 1.5,
                                        color: tone.copy,
                                    }}
                                >
                                    {note}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div
                    style={{
                        marginTop: 50,
                        fontFamily: FONT.mono,
                        fontSize: 19,
                        color: tone.muted,
                        letterSpacing: "0.02em",
                        opacity: ramp(frame, 74, 24),
                    }}
                >
                    github.com/rebasepro/rebase
                </div>
            </Stage>
        </Scene>
    );
};
