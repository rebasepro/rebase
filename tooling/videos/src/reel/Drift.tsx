import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Code } from "../components/Code";
import { pop, ramp, SPRING } from "../components/motion";
import { CHROMA, FONT, INK, TRACKING } from "../theme";

/**
 * CANDIDATE — add one column.
 *
 * The film's second-copy scene shows that five declarations of one table
 * exist. It never shows what that COSTS, and the cost is the whole reason
 * anyone cares: not that the copies exist, but that changing one silently
 * invalidates the other four and nothing tells you.
 *
 * So this is the same five files and one edit. The change lands in the schema
 * and the other four go stale one at a time — deliberately staggered, because
 * four badges appearing together reads as a diagram and four arriving in
 * sequence reads as a problem spreading.
 *
 * It ends on the count rather than on the fix. The fix is what the rest of the
 * film is; this scene's job is to make the number land.
 */

interface Copy {
    file: string;
    code: string;
    /** Where the new column would have to be repeated. */
    stale: string;
}

const COPIES: Copy[] = [
    {
        file: "schema.sql",
        code: "CREATE TABLE orders (\n  id       serial,\n  total    numeric,\n  status   text,\n  currency text\n);",
        stale: "",
    },
    { file: "types.ts", code: "interface Order {\n  id: number\n  total: number\n  status: string\n}", stale: "currency missing" },
    { file: "validation.ts", code: "z.object({\n  id: z.number(),\n  total: z.number(),\n  status: z.string()\n})", stale: "currency missing" },
    { file: "routes.ts", code: 'app.get("/orders")\napp.post("/orders")\napp.patch("/orders/:id")', stale: "no validation" },
    { file: "OrderForm.tsx", code: '<NumberField\n  name="total"\n  label="Total"\n/>', stale: "no field" },
];

const EDIT_AT = 40;
const STALE_AT = (i: number) => 96 + (i - 1) * 26;

export const Drift: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const stale = COPIES.filter((c, i) => i > 0 && frame > STALE_AT(i) + 8).length;

    return (
        <AbsoluteFill>
            <Stage style={{ justifyContent: "flex-start", paddingTop: 96 }}>
                <Chapter n="02" label="The second copy" delay={2} />
                <div style={{ marginTop: 20 }}>
                    <DisplayLine size={DISPLAY.statement} delay={8}>
                        Add one column.
                    </DisplayLine>
                </div>
            </Stage>

            <AbsoluteFill>
                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 330,
                        width: 1520,
                        display: "grid",
                        gridTemplateColumns: "repeat(5, 1fr)",
                        gap: 18,
                    }}
                >
                    {COPIES.map((copy, i) => {
                        const up = ramp(frame, 20 + i * 6, 18);
                        const isSource = i === 0;
                        const flag = isSource ? 0 : ramp(frame, STALE_AT(i), 12);
                        return (
                            <div key={copy.file} style={{ opacity: up }}>
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
                                        position: "relative",
                                        borderRadius: 10,
                                        /* The stale files are not dimmed. Dimming
                                           says "less important"; the point is that
                                           they are still there, still shipping, and
                                           now wrong. They get a border instead. */
                                        border: `1px solid ${
                                            flag > 0.5 ? "rgba(251,80,102,0.55)" : INK.rule
                                        }`,
                                        background: "#000",
                                        padding: "16px 16px 18px",
                                        minHeight: 306,
                                    }}
                                >
                                    <Code
                                        code={copy.code}
                                        sql={copy.file.endsWith(".sql")}
                                        size={13}
                                        delay={26 + i * 6}
                                        /* The source card types SLOWLY, so its
                                           last line — `currency text` — lands on
                                           frame 40, with the callout. The others
                                           are already finished by then: the point
                                           is that they were written before the
                                           change and nobody went back. */
                                        step={isSource ? 3.5 : 1.1}
                                        /* Line 4 is `currency text`; emphasise dims the
                                           others, which is how the new column reads as new
                                           without a colour that means something else. */
                                        emphasise={isSource ? [4] : undefined}
                                    />
                                    {!isSource && (
                                        <div
                                            style={{
                                                position: "absolute",
                                                left: 16,
                                                right: 16,
                                                bottom: 14,
                                                fontFamily: FONT.mono,
                                                fontSize: 12,
                                                color: CHROMA.coral,
                                                letterSpacing: TRACKING.eyebrow,
                                                textTransform: "uppercase",
                                                opacity: flag,
                                                transform: `translateY(${(1 - flag) * 6}px)`,
                                            }}
                                        >
                                            stale · {copy.stale}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* The edit, called out where it happened. */}
                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 688,
                        fontFamily: FONT.mono,
                        fontSize: 16,
                        color: CHROMA.cyan,
                        opacity: ramp(frame, EDIT_AT, 16),
                    }}
                >
                    + currency text
                </div>

                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 754,
                        fontFamily: FONT.display,
                        fontSize: 84,
                        fontWeight: 600,
                        letterSpacing: "-0.02em",
                        color: INK.high,
                        opacity: ramp(frame, 104, 18),
                    }}
                >
                    {stale}
                    <span style={{ fontSize: 34, color: INK.copy, marginLeft: 18, fontWeight: 500 }}>
                        {stale === 1 ? "file now wrong" : "files now wrong"}
                    </span>
                </div>

                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 892,
                        width: 1300,
                        fontFamily: FONT.body,
                        fontSize: 25,
                        lineHeight: 1.5,
                        color: INK.copy,
                        opacity: ramp(frame, 210, 26),
                    }}
                >
                    Nothing failed. Nothing warned you. They will keep serving the
                    old shape
                    <span style={{ color: INK.high }}> until something downstream breaks.</span>
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

export const DRIFT_DURATION = 330;
