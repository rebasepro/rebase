import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Code } from "../components/Code";
import { pop, ramp, SPRING } from "../components/motion";
import { FONT, FRAME, INK } from "../theme";

/**
 * 03 · THE SECOND COPY — 180 frames.
 *
 * The film's missing beat: RECOGNITION. Everything before this scene was added
 * to it was assertion — here is what it does, here is what it generates, here
 * is why that is safe. Nothing asked the viewer to recognise a problem they
 * already have, so "there is no second data model" arrived as a feature rather
 * than as relief.
 *
 * This is the one thing every person watching has actually done: declared the
 * same table five times, in four languages, and then kept them in sync by hand.
 * The five fragments are real — a schema, a type, a validator, a route file and
 * a form field, all describing `orders` — and they collapse into the single
 * file that replaces them.
 *
 * It earns the next scene. "There is no second data model" is an ANSWER now.
 */

interface Copy {
    file: string;
    code: string;
}

const COPIES: Copy[] = [
    { file: "schema.sql", code: 'CREATE TABLE orders (\n  id       serial,\n  total    numeric,\n  status   text\n);' },
    { file: "types.ts", code: 'interface Order {\n  id: number\n  total: number\n  status: string\n}' },
    { file: "validation.ts", code: 'z.object({\n  id: z.number(),\n  total: z.number(),\n  status: z.string()\n})' },
    { file: "routes.ts", code: 'app.get("/orders")\napp.post("/orders")\napp.patch("/orders/:id")\napp.delete("/orders/:id")' },
    { file: "OrderForm.tsx", code: '<NumberField\n  name="total"\n  label="Total"\n/>' },
];

const ONE = `export const orders = defineCollection({
    table: "orders",
    properties: {
        total:  { type: "number" },
        status: { type: "string" }
    }
});`;

/** When the five give way to the one.
 *
 *  The last card lands at ~86, so this holds all five at full strength for
 *  about five seconds. That is the whole point of the scene: the viewer is
 *  being asked to READ five fragments and recognise their own week in them,
 *  and at the old value of 104 they had 2.6 seconds to do it. */
const COLLAPSE = 200;

export const S03_SecondCopy: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    /* The five GO. They used to fade to 14% and sit there behind the one, which
       read as a rendering fault rather than a design — half-legible file names
       and code fragments showing through the card on top of them, colliding
       with its own label. They now converge toward the centre and fade out
       completely, so five visibly become one. */
    const recede = ramp(frame, COLLAPSE, 30);
    const single = pop(frame, fps, COLLAPSE + 10, SPRING.card);

    return (
        <Scene>
            <Stage>
                <Chapter n="02" label="The second copy" delay={2} />
                <div style={{ marginTop: 22, marginBottom: 40 }}>
                    <DisplayLine size={DISPLAY.statement} delay={8}>You have written this table before.</DisplayLine>
                </div>

                <div style={{ position: "relative" }}>
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(5, 1fr)",
                            gap: 16,
                        }}
                    >
                        {COPIES.map((copy, i) => {
                            const t = ramp(frame, 26 + i * 10, 22);
                            // Each card slides toward the middle of the row as it
                            // goes, so the five collapse rather than blink out.
                            const toCentre = (2 - i) * 90 * recede;
                            return (
                                <div
                                    key={copy.file}
                                    style={{
                                        opacity: t * (1 - recede),
                                        transform:
                                            `translate(${toCentre}px, ${(1 - t) * 16}px) ` +
                                            `scale(${1 - recede * 0.12})`,
                                    }}
                                >
                                    <div
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: 13,
                                            color: INK.muted,
                                            marginBottom: 9,
                                            letterSpacing: "0.04em",
                                        }}
                                    >
                                        {copy.file}
                                    </div>
                                    <div
                                        style={{
                                            borderRadius: 10,
                                            border: FRAME.border,
                                            background: "#000",
                                            padding: "16px 16px 18px",
                                            minHeight: 232,
                                        }}
                                    >
                                        <Code
                                            code={copy.code}
                                            sql={copy.file.endsWith(".sql")}
                                            size={13}
                                            delay={32 + i * 10}
                                            step={1.2}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* The one that replaces them, over the top. */}
                    {single > 0.001 && (
                        <div
                            style={{
                                position: "absolute",
                                inset: 0,
                                display: "flex",
                                alignItems: "center",
                                // flex-start, not centre: centred put the card's
                                // left edge at x 588 while the headline above and
                                // the line below both start at 200.
                                justifyContent: "flex-start",
                            }}
                        >
                            <div
                                style={{
                                    width: 900,
                                    opacity: Math.min(1, single * 1.5),
                                    transform: `translateY(${(1 - single) * 22}px) scale(${0.97 + 0.03 * single})`,
                                }}
                            >
                                <div
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: 14,
                                        color: INK.muted,
                                        marginBottom: 10,
                                        letterSpacing: "0.04em",
                                    }}
                                >
                                    collections/orders.ts
                                </div>
                                <div
                                    style={{
                                        borderRadius: FRAME.radius,
                                        border: FRAME.border,
                                        background: "#000",
                                        boxShadow: FRAME.boxShadow,
                                        padding: "22px 28px",
                                    }}
                                >
                                    <Code code={ONE} size={17} delay={COLLAPSE + 18} step={1.6} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div
                    style={{
                        marginTop: 46,
                        fontFamily: FONT.body,
                        fontSize: 23,
                        color: INK.copy,
                        opacity: ramp(frame, COLLAPSE + 34, 22),
                    }}
                >
                    Five declarations of one table. Four of them can drift.
                </div>
            </Stage>
        </Scene>
    );
};
