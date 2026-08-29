import React from "react";
import { useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Frame } from "../components/Frame";
import { ramp } from "../components/motion";
import { FONT, INK } from "../theme";

/**
 * 05 · THE PROOF — 175 frames.
 *
 * The claim before this one is the sort a reader has heard from four other
 * vendors, so it does not get to stand on its own. `rls-check` runs against a
 * database we have never seen, in ten seconds, with nothing installed — and
 * the ground is back to BASE because this is evidence, not argument.
 *
 * Every line below is what the tool actually prints. The check ids, the
 * severity words, the summary format and the fix SQL come from
 * `packages/rls-check/src/report.ts`, by way of the same sample the site
 * carries at `website/src/components/RlsCheckReport.astro`. The whole value of
 * the section is that the claim above it is testable — a dramatised report
 * would forfeit exactly that.
 */

type Line = { text: string; color?: string; at: number; indent?: number };

const C = {
    white: "#F7F8F8",
    dim: "#6B7078",
    rule: "#3A3E45",
    critical: "#FB7185",
    high: "#FBBF24",
    medium: "#FDE047",
    cyan: "#67E8F9",
    green: "#34D399",
    body: "#B4B8BD",
};

const RULE = "─".repeat(58);

const REPORT: Line[] = [
    { text: "rls-check 0.1.2  ·  read-only Row-Level Security audit", color: C.white, at: 0 },
    { text: RULE, color: C.rule, at: 2 },
    { text: "Database  db.acme.internal:5432/production", color: C.body, at: 4 },
    { text: "Scanned   3 schemas · 41 tables · 26 policies · 14 checks", color: C.body, at: 6 },
    { text: "", at: 8 },
    { text: "CRITICAL", color: C.critical, at: 12 },
    { text: RULE, color: C.rule, at: 13 },
    { text: "[critical] rls-disabled   public.invoices", color: C.critical, at: 16, indent: 2 },
    { text: "row-level security is disabled, and the table is granted", color: C.body, at: 19, indent: 6 },
    { text: "to anon and authenticated.", color: C.body, at: 20, indent: 6 },
    { text: "ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;", color: C.green, at: 24, indent: 6 },
    { text: "", at: 26 },
    { text: "[critical] policy-always-true   public.documents", color: C.critical, at: 28, indent: 2 },
    { text: "USING (true) grants every row to every role it applies to.", color: C.body, at: 31, indent: 6 },
    { text: "", at: 33 },
    { text: RULE, color: C.rule, at: 36 },
    { text: "Summary", color: C.white, at: 38 },
    { text: "2 critical · 1 high · 3 medium · 0 low", color: C.high, at: 41, indent: 2 },
];

export const S05_Proof: React.FC = () => {
    const frame = useCurrentFrame();
    const CMD = "npx @rebasepro/rls-check $DATABASE_URL";

    // Typed at a readable rate, then the report streams under it.
    const typed = Math.round(ramp(frame, 12, CMD.length * 0.95) * CMD.length);
    const reportAt = 12 + CMD.length * 0.95 + 5;

    return (
        <Scene>
            <Stage>
                <div style={{ display: "flex", gap: 84, alignItems: "center" }}>
                    <div style={{ width: 520, flexShrink: 0 }}>
                        <Chapter n="08" label="Don't take our word for it" delay={4} />
                        <div style={{ marginTop: 26 }}>
                            <DisplayLine size={DISPLAY.split} delay={10}>Point it at</DisplayLine>
                            <DisplayLine size={DISPLAY.split} delay={16}>any Postgres.</DisplayLine>
                        </div>
                        <div
                            style={{
                                marginTop: 30,
                                fontFamily: FONT.body,
                                fontSize: 24,
                                lineHeight: 1.55,
                                color: INK.copy,
                                opacity: ramp(frame, 36, 20),
                            }}
                        >
                            Supabase, Neon, RDS, your own server. It opens a read-only
                            transaction and reports what is actually exposed.
                        </div>
                        <div
                            style={{
                                marginTop: 26,
                                fontFamily: FONT.mono,
                                fontSize: 16,
                                color: INK.muted,
                                letterSpacing: "0.02em",
                                opacity: ramp(frame, 48, 20),
                            }}
                        >
                            Free · no signup · nothing leaves your machine
                        </div>
                    </div>

                    <Frame
                        title="rls-check · production"
                        delay={10}
                        style={{ flex: 1 }}
                        bodyStyle={{ padding: "28px 34px 34px" }}
                    >
                        <div style={{ fontFamily: FONT.mono, fontSize: 19, lineHeight: 1.7 }}>
                            <div style={{ color: C.white }}>
                                <span style={{ color: INK.muted, marginRight: 12 }}>$</span>
                                {CMD.slice(0, typed)}
                            </div>
                            <div style={{ height: 19 * 1.7 }} />
                            {REPORT.map((line, i) => {
                                const t = ramp(frame, reportAt + line.at * 1.5, 8);
                                return (
                                    <div
                                        key={i}
                                        style={{
                                            color: line.color ?? C.body,
                                            opacity: t,
                                            paddingLeft: (line.indent ?? 0) * 9,
                                            minHeight: 19 * 1.7,
                                            whiteSpace: "pre",
                                        }}
                                    >
                                        {line.text}
                                    </div>
                                );
                            })}
                        </div>
                    </Frame>
                </div>
            </Stage>
        </Scene>
    );
};
