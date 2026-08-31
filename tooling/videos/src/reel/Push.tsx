import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Frame } from "../components/Frame";
import { Terminal } from "../components/Terminal";
import { ramp } from "../components/motion";
import { CHROMA, FONT, INK } from "../theme";

/**
 * CANDIDATE — the edit, and what the database does about it.
 *
 * Every other scene shows a definition or shows a result. None of them shows
 * the STEP between, which is the one a developer is actually deciding about:
 * you change a line, and something has to happen to a production table.
 *
 * So this is the whole loop in one frame — the diff on the left, the command
 * and the SQL it generated on the right. The SQL matters more than the command
 * does: "it migrates for you" is a promise, and a printed `ALTER TABLE` you
 * can read before it runs is not a promise, it is the thing itself.
 */

const DIFF: { text: string; kind: "same" | "add" }[] = [
    { text: "export const orders = defineCollection({", kind: "same" },
    { text: "    table: \"orders\",", kind: "same" },
    { text: "    properties: {", kind: "same" },
    { text: "        total:    { type: \"number\" },", kind: "same" },
    { text: "        status:   { type: \"string\" },", kind: "same" },
    { text: "        currency: { type: \"string\" }", kind: "add" },
    { text: "    }", kind: "same" },
    { text: "});", kind: "same" },
];

export const Push: React.FC = () => {
    const frame = useCurrentFrame();
    return (
        <AbsoluteFill>
            <Stage style={{ justifyContent: "flex-start", paddingTop: 96 }}>
                <Chapter n="—" label="Migrations" delay={2} />
                <div style={{ marginTop: 20 }}>
                    {/* Two lines, not one that wraps. A statement headline that
                        breaks on its own reads as an accident. */}
                    <DisplayLine size={DISPLAY.statement} delay={8}>
                        You change the file.
                    </DisplayLine>
                    <DisplayLine size={DISPLAY.statement} delay={14}>
                        It writes the migration.
                    </DisplayLine>
                </div>
            </Stage>

            <AbsoluteFill>
                <div style={{ position: "absolute", left: 200, top: 372, width: 700 }}>
                    <Frame title="collections/orders.ts" delay={18} bodyStyle={{ padding: "24px 0 26px" }}>
                        {DIFF.map((l, i) => {
                            const up = ramp(frame, 30 + i * 3, 12);
                            const isAdd = l.kind === "add";
                            const landed = ramp(frame, 62, 16);
                            return (
                                <div
                                    key={l.text}
                                    style={{
                                        display: "flex",
                                        gap: 14,
                                        padding: "3px 26px",
                                        fontFamily: FONT.mono,
                                        fontSize: 17,
                                        lineHeight: 1.72,
                                        whiteSpace: "pre",
                                        opacity: up,
                                        /* The added line gets a ground, not a
                                           colour on the text: a green line of code
                                           among syntax-coloured code reads as a
                                           string literal, not as an addition. */
                                        background: isAdd
                                            ? `rgba(54,204,214,${0.14 * landed})`
                                            : "transparent",
                                    }}
                                >
                                    <span
                                        style={{
                                            color: isAdd ? CHROMA.cyan : INK.muted,
                                            width: 12,
                                            opacity: isAdd ? landed : 0.5,
                                        }}
                                    >
                                        {isAdd ? "+" : " "}
                                    </span>
                                    <span style={{ color: isAdd ? INK.high : INK.copy }}>{l.text}</span>
                                </div>
                            );
                        })}
                    </Frame>
                </div>

                <div style={{ position: "absolute", left: 980, top: 372, width: 740 }}>
                    <Frame title="zsh · ~/work" delay={92} bodyStyle={{ padding: "26px 30px 30px" }}>
                        <Terminal
                            delay={104}
                            size={21}
                            command="rebase db push"
                            output={[
                                { text: "", at: 10 },
                                { text: "Detected 1 change to `orders`.", tone: "muted", at: 14 },
                                { text: "", at: 18 },
                                /* The SQL is `accent`, not `ok`. `ok` prints a
                                   green tick, which turned two lines of DDL into
                                   two completed tasks — and the summary, which
                                   really is one, ended up with two ticks. */
                                { text: "ALTER TABLE orders", tone: "accent", at: 22 },
                                { text: "  ADD COLUMN currency text;", tone: "accent", at: 26 },
                                { text: "", at: 32 },
                                { text: "applied · 1 migration, 0 destructive", tone: "ok", at: 38 },
                            ]}
                        />
                    </Frame>
                </div>

                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 862,
                        width: 1460,
                        fontFamily: FONT.body,
                        fontSize: 25,
                        lineHeight: 1.5,
                        color: INK.copy,
                        opacity: ramp(frame, 196, 26),
                    }}
                >
                    The SQL is printed before it runs, and anything destructive stops
                    and asks.
                    <span style={{ color: INK.high }}> It is your database — it just does not need you to type this.</span>
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

export const PUSH_DURATION = 330;
