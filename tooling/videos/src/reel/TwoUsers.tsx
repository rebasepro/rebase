import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { ramp } from "../components/motion";
import { CHROMA, FONT, INK, TRACKING } from "../theme";

/**
 * CANDIDATE — the same query, twice.
 *
 * The film ASSERTS that authorization is in the database ("security lives in
 * the database", "an agent gets the same authorization you do") and proves it
 * with a policy listing and an audit report. Both are evidence for a reader who
 * already believes the claim. Neither SHOWS the thing itself.
 *
 * This does: one query, run twice, returning different rows — because the two
 * callers are different people and the database knows. No middleware in the
 * picture, no `if (user.role === …)` anywhere, and deliberately no mention of
 * the policy: the policy is the previous scene's job. Here it is just true.
 *
 * Both sides run at once on purpose. Showing one and then the other reads as
 * two examples; showing them together reads as one fact.
 */

export const QUERY = "await client.data.orders.find()";

interface Row {
    id: string;
    who: string;
    amount: string;
}

export const MINE: Row[] = [
    { id: "ORD-2026-0162", who: "Robert Lopez", amount: "$1,857.79" },
    { id: "ORD-2026-0074", who: "Robert Lopez", amount: "$475.33" },
];

export const ALL: Row[] = [
    { id: "ORD-2026-0162", who: "Robert Lopez", amount: "$1,857.79" },
    { id: "ORD-2026-0129", who: "Jennifer Taylor", amount: "$112.67" },
    { id: "ORD-2026-0006", who: "Charles Wilson", amount: "$266.82" },
    { id: "ORD-2026-0036", who: "Robert Anderson", amount: "$95.73" },
    { id: "ORD-2026-0081", who: "Charles Martin", amount: "$1,956.18" },
    { id: "ORD-2026-0074", who: "Robert Lopez", amount: "$475.33" },
];

export const PANEL = { w: 740, h: 470, y: 400 };
const LEFT = 200;
const RIGHT = 980;

export const Side: React.FC<{
    x: number;
    /** Vertical position; defaults to the reel's own. */
    y?: number;
    w?: number;
    accent: string;
    who: string;
    role: string;
    count: string;
    rows: Row[];
    delay: number;
}> = ({ x, y = PANEL.y, w = PANEL.w, accent, who, role, count, rows, delay }) => {
    const frame = useCurrentFrame();
    const up = ramp(frame, delay, 20);
    return (
        <div
            style={{
                position: "absolute",
                left: x,
                top: y,
                width: w,
                height: PANEL.h,
                borderRadius: 16,
                border: `1px solid ${INK.rule}`,
                background: "#000",
                overflow: "hidden",
                opacity: up,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "22px 26px",
                    borderBottom: `1px solid ${INK.ruleSoft}`,
                }}
            >
                <span
                    style={{ width: 10, height: 10, borderRadius: 999, background: accent, display: "block" }}
                />
                <span style={{ fontFamily: FONT.body, fontSize: 22, fontWeight: 600, color: INK.high }}>
                    {who}
                </span>
                <span style={{ fontFamily: FONT.body, fontSize: 18, color: INK.muted }}>{role}</span>
                <span
                    style={{
                        marginLeft: "auto",
                        fontFamily: FONT.mono,
                        fontSize: 15,
                        color: INK.muted,
                        letterSpacing: TRACKING.eyebrow,
                    }}
                >
                    {count}
                </span>
            </div>

            {rows.map((r, i) => {
                const t = ramp(frame, delay + 16 + i * 7, 16);
                return (
                    <div
                        key={r.id + i}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 20,
                            padding: "17px 26px",
                            borderBottom: `1px solid ${INK.ruleSoft}`,
                            opacity: t,
                            transform: t < 1 ? `translateY(${(1 - t) * 8}px)` : undefined,
                        }}
                    >
                        <span style={{ fontFamily: FONT.mono, fontSize: 17, color: INK.high, width: 210 }}>
                            {r.id}
                        </span>
                        <span style={{ fontFamily: FONT.body, fontSize: 17, color: INK.copy }}>{r.who}</span>
                        <span
                            style={{
                                marginLeft: "auto",
                                fontFamily: FONT.mono,
                                fontSize: 17,
                                color: INK.copy,
                            }}
                        >
                            {r.amount}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

export const TwoUsers: React.FC = () => {
    const frame = useCurrentFrame();
    /* Typed once, above both panels, so it is unmistakably ONE query rather
       than two that happen to look alike. */
    const typed = Math.round(ramp(frame, 14, QUERY.length * 0.9) * QUERY.length);

    return (
        <AbsoluteFill>
            <Stage style={{ justifyContent: "flex-start", paddingTop: 96 }}>
                {/* Not "The same query, twice" — that is the headline, and an
                    eyebrow that repeats its headline is two lines saying one
                    thing. This names what the scene is evidence OF. */}
                <Chapter n="06" label="Row-level security, running" delay={2} />
                <div style={{ marginTop: 20 }}>
                    <DisplayLine size={DISPLAY.statement} delay={8}>
                        The same query, twice.
                    </DisplayLine>
                </div>
            </Stage>

            <AbsoluteFill>
                <div
                    style={{
                        position: "absolute",
                        left: LEFT,
                        top: 292,
                        fontFamily: FONT.mono,
                        fontSize: 26,
                        color: INK.high,
                        opacity: ramp(frame, 12, 12),
                    }}
                >
                    {QUERY.slice(0, typed)}
                    <span style={{ opacity: frame % 32 < 16 ? 1 : 0, color: CHROMA.cyan }}>▌</span>
                </div>

                <Side
                    x={LEFT}
                    accent={CHROMA.cyan}
                    who="Robert"
                    role="customer"
                    count="2 rows"
                    rows={MINE}
                    delay={62}
                />
                <Side
                    x={RIGHT}
                    accent={CHROMA.yellow}
                    who="Dana"
                    role="support"
                    count="48 rows"
                    rows={ALL}
                    delay={62}
                />

            </AbsoluteFill>
        </AbsoluteFill>
    );
};

export const TWO_USERS_DURATION = 300;
