import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { Frame } from "../../components/Frame";
import { ramp } from "../../components/motion";
import { CHROMA, FONT, INK } from "../../theme";

/**
 * THE HOOK — two windows on the same database.
 *
 * Left, the agent's own summary of what it shipped. Right, what a read-only
 * audit finds in it. The contrast is the whole opening; neither half is
 * interesting alone. The scan window is the one the film comes back to: it
 * re-runs in place after the fix, which is why it is its own component with
 * two phases rather than a line in this one.
 */

const SHIPPED = [
    "auth · email, sessions, refresh",
    "CRUD for 9 tables",
    "REST + OpenAPI",
    "deployed · api.acme.com",
];

export const AgentSession: React.FC<{ x: number; y: number; w: number; at: number }> = ({ x, y, w, at }) => (
    <div style={{ position: "absolute", left: x, top: y, width: w }}>
        <Sequence from={at} layout="none">
            <SessionBody />
        </Sequence>
    </div>
);

const SessionBody: React.FC = () => {
    const frame = useCurrentFrame();
    return (
        <Frame title="agent · session summary" delay={0} bodyStyle={{ padding: "26px 30px 30px" }}>
            {SHIPPED.map((line, i) => (
                <div
                    key={line}
                    style={{
                        display: "flex",
                        gap: 14,
                        alignItems: "center",
                        padding: "9px 0",
                        fontFamily: FONT.mono,
                        fontSize: 20,
                        color: INK.copy,
                        opacity: ramp(frame, 12 + i * 9, 14),
                    }}
                >
                    <span style={{ color: CHROMA.cyan }}>✔</span>
                    {line}
                </div>
            ))}
            <div
                style={{
                    marginTop: 18,
                    fontFamily: FONT.mono,
                    fontSize: 20,
                    color: INK.high,
                    opacity: ramp(frame, 54, 16),
                }}
            >
                Done — your API is up.
            </div>
        </Frame>
    );
};

/* Findings on the agent's database. All three name checks rls-check ACTUALLY
   has — see packages/rls-check/src/checks — in the one scene whose subject is
   that you should verify claims rather than take them. */
const FOUND: { text: string; tone: "crit" | "body" }[] = [
    { text: "[critical] rls-disabled     public.customers", tone: "crit" },
    { text: "readable by anyone holding the anon key", tone: "body" },
    { text: "[critical] anonymous-write-allowed  public.orders", tone: "crit" },
    { text: "anon may INSERT with no policy restricting it", tone: "body" },
    { text: "[high]     grant-to-public  public.tickets", tone: "crit" },
];

/* What the tool prints when there is nothing to print — verbatim from
   packages/rls-check/src/report.ts, the green line and the summary line. */
const CLEAN = "No findings. Every table, view and policy in scope passed all checks.";
const CLEAN_SUMMARY = "0 confirmed · 0 worth checking · 15 checks run against 9 tables in 1 schema";

const CMD = "npx @rebasepro/rls-check $DATABASE_URL";

/**
 * The scan, twice. Phase one types the command and streams three findings.
 * Phase two, a minute later on the same desk, types the same command under
 * them, the findings fall away, and the tool's own clean report prints. Same
 * window, same database, same command — that is the argument.
 */
export const ScanWindow: React.FC<{
    x: number;
    y: number;
    w: number;
    at: number;
    rerunAt: number;
}> = ({ x, y, w, at, rerunAt }) => (
    <div style={{ position: "absolute", left: x, top: y, width: w }}>
        <Sequence from={at} layout="none">
            <ScanBody rerunAt={rerunAt - at} />
        </Sequence>
    </div>
);

const ScanBody: React.FC<{ rerunAt: number }> = ({ rerunAt }) => {
    const frame = useCurrentFrame();
    const rate = 0.6;
    const typed1 = Math.round(ramp(frame, 8, CMD.length * rate) * CMD.length);
    const report1 = 8 + CMD.length * rate + 8;

    const rerun = frame >= rerunAt;
    const typed2 = Math.round(ramp(frame, rerunAt + 4, CMD.length * rate) * CMD.length);
    const report2 = rerunAt + 4 + CMD.length * rate + 8;
    /* The first report collapses as the second command is typed, so the
       window does not grow: the findings fade and give up their height. */
    const collapse = ramp(frame, rerunAt + 2, 16);

    return (
        <Frame title="rls-check · the same database" delay={0} bodyStyle={{ padding: "24px 30px 28px" }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 19, lineHeight: 1.7 }}>
                <div style={{ color: INK.high }}>
                    <span style={{ color: INK.muted, marginRight: 12 }}>$</span>
                    {CMD.slice(0, typed1)}
                </div>

                <div
                    style={{
                        overflow: "hidden",
                        maxHeight: rerun ? `${(1 - collapse) * 320}px` : undefined,
                        opacity: 1 - collapse,
                        marginTop: 10,
                    }}
                >
                    {FOUND.map((l, i) => (
                        <div
                            key={l.text}
                            style={{
                                paddingLeft: l.tone === "body" ? 26 : 0,
                                fontSize: l.tone === "body" ? 17 : 19,
                                color: l.tone === "crit" ? CHROMA.coral : INK.muted,
                                opacity: ramp(frame, report1 + i * 9, 12),
                                whiteSpace: "pre",
                            }}
                        >
                            {l.text}
                        </div>
                    ))}
                    <div
                        style={{
                            marginTop: 12,
                            color: CHROMA.coral,
                            letterSpacing: "0.04em",
                            opacity: ramp(frame, report1 + 58, 14),
                        }}
                    >
                        2 critical · 1 high
                    </div>
                </div>

                {rerun && (
                    <>
                        <div style={{ color: INK.high, marginTop: 10 }}>
                            <span style={{ color: INK.muted, marginRight: 12 }}>$</span>
                            {CMD.slice(0, typed2)}
                        </div>
                        <div style={{ marginTop: 10, color: "#34D399", opacity: ramp(frame, report2, 12) }}>
                            {CLEAN}
                        </div>
                        <div
                            style={{
                                marginTop: 6,
                                fontSize: 17,
                                color: INK.muted,
                                opacity: ramp(frame, report2 + 14, 12),
                            }}
                        >
                            {CLEAN_SUMMARY}
                        </div>
                        <div
                            style={{
                                marginTop: 6,
                                fontSize: 17,
                                color: INK.copy,
                                opacity: ramp(frame, report2 + 26, 12),
                            }}
                        >
                            Exit code 0
                        </div>
                    </>
                )}
            </div>
        </Frame>
    );
};

/** The small print under the scan, once it has run clean. */
export const ScanNote: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => {
    const frame = useCurrentFrame();
    return (
        <div
            style={{
                position: "absolute",
                left: x,
                top: y,
                fontFamily: FONT.mono,
                fontSize: 16,
                color: INK.muted,
                letterSpacing: "0.02em",
                opacity: ramp(frame, at, 20),
            }}
        >
            Free · no signup · nothing leaves your machine · any Postgres
        </div>
    );
};
