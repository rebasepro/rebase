import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { ENTER, ramp } from "../components/motion";
import { CHROMA, FONT, INK } from "../theme";

/**
 * CANDIDATE — the list you are not writing.
 *
 * The film says what Rebase generates, several times, as prose in a column
 * beside a screenshot. Prose is the wrong instrument for SCOPE: "auth, storage,
 * realtime, functions, cron, backups" read aloud is six words and lands as six
 * words. The same six items struck off a list of twenty-four lands as a season
 * of work you are not doing.
 *
 * So this scene is a quantity, and it is paced to feel like one: the strikes
 * start slowly enough to read, then run away from the viewer. Nobody is meant
 * to finish reading the list — being unable to keep up IS the point, and the
 * count at the end is there to say what just went past.
 */

const ITEMS = [
    "email + password auth", "sessions and refresh", "password reset",
    "email verification", "roles and permissions", "API keys",
    "row-level security", "policy migrations", "REST routes",
    "OpenAPI spec", "typed SDK", "SDK regeneration",
    "realtime subscriptions", "presence and reconnect", "file uploads",
    "signed URLs", "CSV import", "CSV export",
    "audit trail", "scheduled backups", "cron jobs",
    "server functions", "pagination", "filtering and sort",
];

const COLS = 3;
const COL_W = 480;
const ROW_H = 62;
const TOP = 330;

/** Slow enough to read, then faster than anyone can. */
const strikeAt = (i: number) => 46 + Math.pow(i, 1.42) * 2.1;

export const Included: React.FC = () => {
    const frame = useCurrentFrame();
    const done = ITEMS.filter((_, i) => frame > strikeAt(i) + 10).length;

    return (
        <AbsoluteFill>
            <Stage style={{ justifyContent: "flex-start", paddingTop: 96 }}>
                <Chapter n="—" label="Included" delay={2} />
                <div style={{ marginTop: 20 }}>
                    <DisplayLine size={DISPLAY.statement} delay={8}>
                        None of this is your week.
                    </DisplayLine>
                </div>
            </Stage>

            <AbsoluteFill>
                {ITEMS.map((item, i) => {
                    const col = i % COLS;
                    const row = Math.floor(i / COLS);
                    const at = strikeAt(i);
                    const inK = ramp(frame, 24 + i * 1.6, 14);
                    const cut = interpolate(frame, [at, at + 9], [0, 1], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: ENTER,
                    });
                    return (
                        <div
                            key={item}
                            style={{
                                position: "absolute",
                                left: 200 + col * COL_W,
                                top: TOP + row * ROW_H,
                                width: COL_W - 40,
                                opacity: inK * (1 - cut * 0.55),
                            }}
                        >
                            {/* The strike is inside an inline-block, so it is
                                the width of the WORDS. Measured off the column
                                it overshot every short phrase by a third of the
                                cell and read as a rule under a list rather than
                                a line through an item. */}
                            <span style={{ position: "relative", display: "inline-block" }}>
                                <span
                                    style={{
                                        fontFamily: FONT.body,
                                        fontSize: 25,
                                        color: cut > 0.5 ? INK.muted : INK.high,
                                    }}
                                >
                                    {item}
                                </span>
                                {/* Drawn, not toggled — a strike that appears
                                    whole reads as a typo, one that travels reads
                                    as being crossed off. */}
                                <span
                                    style={{
                                        position: "absolute",
                                        left: 0,
                                        top: "54%",
                                        height: 2,
                                        width: `${cut * 100}%`,
                                        background: CHROMA.cyan,
                                        opacity: 0.9,
                                        display: "block",
                                    }}
                                />
                            </span>
                        </div>
                    );
                })}

                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 900,
                        fontFamily: FONT.mono,
                        fontSize: 22,
                        color: INK.muted,
                        opacity: ramp(frame, 60, 20),
                    }}
                >
                    {done} of {ITEMS.length} · already written
                </div>

                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 952,
                        width: 1200,
                        fontFamily: FONT.body,
                        fontSize: 25,
                        color: INK.copy,
                        opacity: ramp(frame, 190, 24),
                    }}
                >
                    Every one of them generated from the file you already wrote —
                    <span style={{ color: INK.high }}> and every one of them yours to change.</span>
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

export const INCLUDED_DURATION = 300;
