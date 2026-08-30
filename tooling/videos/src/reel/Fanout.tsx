import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Code } from "../components/Code";
import { Frame } from "../components/Frame";
import { pop, ramp, SPRING } from "../components/motion";
import { FONT, GROUND, INK, TRACKING } from "../theme";

/**
 * CANDIDATE — one file, every surface.
 *
 * The film explains generation twice in words ("there is no second data model",
 * "one definition, every surface") and never once SHOWS it. This is the picture
 * that argument has been missing: the definition on the left, six things it
 * produces on the right, and a line drawn to each one as it arrives.
 *
 * It is deliberately a diagram. Nine scenes in the film are type beside a
 * screenshot; this is neither, which is most of the reason it is worth having.
 *
 * The build order is the argument: the file lands first and alone, then each
 * output is DRAWN OUT of it rather than fading in beside it. Six things
 * appearing at once would read as a feature list. One line at a time reads as
 * consequence.
 */

const SOURCE = `export const orders = defineCollection({
    table: "orders",
    properties: {
        total:  { type: "number" },
        status: { type: "string" }
    },
    securityRules: { /* … */ }
});`;

interface Out {
    label: string;
    value: string;
}

/* Every value here is real — a path this generates, a call you would write, a
   policy name it emits. Placeholder-looking output would undo the point. */
const OUTS: Out[] = [
    { label: "REST", value: "GET /api/orders" },
    { label: "Typed SDK", value: "client.data.orders.find()" },
    { label: "OpenAPI", value: "openapi.json" },
    { label: "RLS policy", value: "orders_select_9f2c1a4b" },
    { label: "Realtime", value: "orders.listen()" },
    { label: "Admin panel", value: "/c/orders" },
];

const CARD = { w: 430, h: 132 };
const COLS = [962, 1412];
const ROWS = [352, 516, 680];
/** Where the lines leave the source card. */
const ORIGIN = { x: 688, y: 546 };

const at = (i: number) => ({ x: COLS[i % 2], y: ROWS[Math.floor(i / 2)] });
const DELAY = (i: number) => 46 + i * 15;

export const Fanout: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    /* Deliberately NOT wrapped in <Scene>. That component applies the film's
       slide transition, which it reads from StationContext — outside the film
       that defaults to station 0, so it runs the cold open's 96-frame exit and
       the candidate goes black three seconds in. A candidate has no station. */
    return (
        <AbsoluteFill>
            <Stage style={{ justifyContent: "flex-start", paddingTop: 96 }}>
                <Chapter n="—" label="Generated" delay={2} />
                <div style={{ marginTop: 20 }}>
                    <DisplayLine size={DISPLAY.statement} delay={8}>
                        One file. Every surface.
                    </DisplayLine>
                </div>
            </Stage>

            {/* The connectors sit UNDER the cards so they can run to the middle
                of each without a visible join. */}
            <AbsoluteFill>
                <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
                    {OUTS.map((o, i) => {
                        const p = at(i);
                        const draw = ramp(frame, DELAY(i) - 10, 18);
                        const midX = (ORIGIN.x + p.x) / 2;
                        const y = p.y + CARD.h / 2;
                        const d = `M ${ORIGIN.x} ${ORIGIN.y} C ${midX} ${ORIGIN.y}, ${midX} ${y}, ${p.x} ${y}`;
                        return (
                            <path
                                key={o.label}
                                d={d}
                                fill="none"
                                stroke="rgba(255,255,255,0.20)"
                                strokeWidth={1.25}
                                pathLength={1}
                                strokeDasharray={1}
                                strokeDashoffset={1 - draw}
                            />
                        );
                    })}
                </svg>
            </AbsoluteFill>

            <AbsoluteFill>
                <div style={{ position: "absolute", left: 200, top: 386, width: 470 }}>
                    <Frame title="collections/orders.ts" delay={16} bodyStyle={{ padding: "22px 24px" }}>
                        <Code code={SOURCE} size={15} delay={26} step={1.4} />
                    </Frame>
                </div>

                {OUTS.map((o, i) => {
                    const p = at(i);
                    const s = pop(frame, fps, DELAY(i), SPRING.card);
                    return (
                        <div
                            key={o.label}
                            style={{
                                position: "absolute",
                                left: p.x,
                                top: p.y,
                                width: CARD.w,
                                height: CARD.h,
                                borderRadius: 14,
                                border: `1px solid ${INK.rule}`,
                                background: "#000",
                                padding: "24px 26px",
                                opacity: Math.min(1, s * 1.7),
                                transform: s < 1 ? `translateX(${(1 - s) * -26}px)` : undefined,
                            }}
                        >
                            <div
                                style={{
                                    fontFamily: FONT.body,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: INK.muted,
                                    textTransform: "uppercase",
                                    letterSpacing: TRACKING.eyebrow,
                                }}
                            >
                                {o.label}
                            </div>
                            <div
                                style={{
                                    marginTop: 14,
                                    fontFamily: FONT.mono,
                                    fontSize: 20,
                                    color: INK.high,
                                }}
                            >
                                {o.value}
                            </div>
                        </div>
                    );
                })}

                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 872,
                        width: 470,
                        fontFamily: FONT.body,
                        fontSize: 21,
                        lineHeight: 1.5,
                        color: INK.copy,
                        opacity: ramp(frame, 150, 22),
                    }}
                >
                    Change the file and all six change with it. There is nothing
                    to keep in sync, because there is nothing else to keep.
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

export const FANOUT_DURATION = 300;
export const FANOUT_GROUND = GROUND.base;
