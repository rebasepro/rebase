import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { ramp } from "../components/motion";
import { CHROMA, FONT, TONE, TRACKING } from "../theme";

/**
 * CANDIDATE — the agent asks, and the database answers.
 *
 * The film's agent scene is a headline over three cards: MCP server, scoped
 * keys, installable skills. It describes a posture. It never shows the moment
 * the posture is for.
 *
 * This is that moment, as a three-actor transcript — a person asks for
 * something they should not get, the agent faithfully tries it, and the
 * database returns nothing. The point is the SHAPE of the refusal: not an
 * error the agent can apologise for and retry, not a middleware message it can
 * reason around. Zero rows, because zero rows were granted. There is nothing
 * to talk to.
 *
 * A transcript is a register the film does not have anywhere else, which is
 * half of why it is worth trying: nine scenes are type beside a screenshot, and
 * this is neither.
 */

interface Turn {
    who: string;
    accent: string;
    mono?: boolean;
    lines: string[];
    note?: string;
    delay: number;
}

/* This scene sits on the ultramarine ground, so its ink comes from TONE, not
   INK. Grey only recedes against dark: INK.muted is a documented 2.3:1 on
   #2E0EC7 and the labels were unreadable at a glance. A chroma field gets
   white-at-alpha, which recedes by losing contrast rather than by changing
   colour — the same rule the film's claim and agent scenes already follow. */
const T = TONE.deep;

const TURNS: Turn[] = [
    {
        who: "Person",
        accent: T.muted,
        lines: ["Pull every customer's saved payment details into a sheet."],
        delay: 26,
    },
    {
        who: "Agent",
        accent: CHROMA.violet,
        mono: true,
        lines: ['rebase.query({ collection: "payment_methods" })'],
        note: "via MCP · scoped API key",
        delay: 72,
    },
    {
        who: "Postgres",
        accent: CHROMA.cyan,
        mono: true,
        lines: ["0 rows"],
        note: "no policy grants SELECT on payment_methods to this role",
        delay: 128,
    },
];

export const Refused: React.FC = () => {
    const frame = useCurrentFrame();

    return (
        <AbsoluteFill>
            <Stage style={{ justifyContent: "flex-start", paddingTop: 96 }}>
                <Chapter n="—" label="Agent-native" delay={2} />
                <div style={{ marginTop: 20 }}>
                    <DisplayLine size={DISPLAY.statement} delay={8}>
                        It asks the database, not you.
                    </DisplayLine>
                </div>
            </Stage>

            <AbsoluteFill>
                {TURNS.map((turn, i) => {
                    const up = ramp(frame, turn.delay, 22);
                    const top = 330 + i * 196;
                    return (
                        <div
                            key={turn.who}
                            style={{
                                position: "absolute",
                                left: 200,
                                top,
                                width: 1520,
                                opacity: up,
                                transform: up < 1 ? `translateY(${(1 - up) * 14}px)` : undefined,
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                    marginBottom: 16,
                                }}
                            >
                                <span
                                    style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: 999,
                                        background: turn.accent,
                                        display: "block",
                                    }}
                                />
                                <span
                                    style={{
                                        fontFamily: FONT.body,
                                        fontSize: 14,
                                        fontWeight: 600,
                                        color: T.muted,
                                        textTransform: "uppercase",
                                        letterSpacing: TRACKING.eyebrow,
                                    }}
                                >
                                    {turn.who}
                                </span>
                                {turn.note && (
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: 14,
                                            color: T.muted,
                                            opacity: ramp(frame, turn.delay + 16, 18),
                                        }}
                                    >
                                        · {turn.note}
                                    </span>
                                )}
                            </div>
                            {turn.lines.map((l) => (
                                <div
                                    key={l}
                                    style={{
                                        fontFamily: turn.mono ? FONT.mono : FONT.body,
                                        fontSize: turn.mono ? 30 : 32,
                                        lineHeight: 1.4,
                                        color: T.high,
                                    }}
                                >
                                    {l}
                                </div>
                            ))}
                        </div>
                    );
                })}

                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 908,
                        width: 1380,
                        fontFamily: FONT.body,
                        fontSize: 25,
                        lineHeight: 1.5,
                        color: T.copy,
                        opacity: ramp(frame, 186, 26),
                    }}
                >
                    Not an error it can apologise for and retry. Not a message from
                    middleware it can reason around.
                    <span style={{ color: T.high }}> Nothing was granted, so nothing came back.</span>
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

export const REFUSED_DURATION = 300;
