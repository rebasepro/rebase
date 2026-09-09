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

/** What was asked. Without it the window was a checklist that could have
 *  come from anywhere; with it, it is unmistakably a coding agent's session:
 *  a person asked for a backend in one sentence and got one. */
const PROMPT = "Build a backend for this database. Auth, CRUD for every table, a REST API. Deploy it.";

const Speaker: React.FC<{ who: string; at: number }> = ({ who, at }) => {
    const frame = useCurrentFrame();
    return (
        <div
            style={{
                fontFamily: FONT.mono,
                fontSize: 12,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: INK.muted,
                marginBottom: 6,
                opacity: ramp(frame, at, 10),
            }}
        >
            {who}
        </div>
    );
};

const SessionBody: React.FC = () => {
    const frame = useCurrentFrame();
    return (
        <Frame title="coding agent · session" delay={0} bodyStyle={{ padding: "22px 30px 24px" }}>
            <Speaker who="you" at={6} />
            <div
                style={{
                    fontFamily: FONT.mono,
                    fontSize: 19,
                    lineHeight: 1.5,
                    color: INK.high,
                    opacity: ramp(frame, 8, 12),
                }}
            >
                {PROMPT}
            </div>
            <div style={{ height: 18 }} />
            <Speaker who="agent" at={26} />
            {SHIPPED.map((line, i) => (
                <div
                    key={line}
                    style={{
                        display: "flex",
                        gap: 14,
                        alignItems: "center",
                        padding: "7px 0",
                        fontFamily: FONT.mono,
                        fontSize: 19,
                        color: INK.copy,
                        opacity: ramp(frame, 30 + i * 9, 14),
                    }}
                >
                    <span style={{ color: CHROMA.cyan }}>✔</span>
                    {line}
                </div>
            ))}
            <div
                style={{
                    marginTop: 14,
                    fontFamily: FONT.mono,
                    fontSize: 19,
                    color: INK.high,
                    opacity: ramp(frame, 72, 16),
                }}
            >
                Done — your API is up.
            </div>
        </Frame>
    );
};

import { SCAN_AFTER, SCAN_BEFORE } from "./scan-output";

/**
 * The scan, twice. Phase one types the command and rls-check's report
 * prints — the real report, verbatim (scan-output.ts): header, the caveat
 * about the connecting role, nine critical findings, the tally, the exit
 * code. Phase two, a minute later on the same desk, types the same command
 * under it and the clean report prints. Same window, same database, same
 * command — that is the argument.
 *
 * The window is a fixed height and scrolls like the shell: a report this
 * long streams past and the tail settles — "critical 9", "9 of 9 tables
 * have row-level security disabled", "Exit code 1"; then "No findings",
 * zeros, "Exit code 0".
 *
 * ON THE CLEAN REPORT: rls-check 0.18.1 reports `rls-enabled-not-forced`
 * (high, when the owner can log in) on every table `db push` produces,
 * because push does not set FORCE and the server context is meant to
 * bypass. The clean capture was taken with FORCE on every table. Whether
 * the tool should skip that check on a Rebase database is an open product
 * decision; until it is made, this window shows what the tool prints
 * with the check satisfied, not what it prints after push alone.
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

const CMD = "npx @rebasepro/rls-check";
/** Lines of report per frame once it starts printing: a burst, as a tool
 *  prints, not a stream. */
const BURST = 6;
const HEIGHT = 300;

function paint(line: string): string {
    const t = line.trim();
    if (t.startsWith("[critical]") || t.startsWith("CRITICAL")) return CHROMA.coral;
    if (t.startsWith("[high]") || t.startsWith("HIGH")) return CHROMA.coral;
    if (t.startsWith("No findings.")) return "#34D399";
    if (t.startsWith("Exit code 1")) return CHROMA.coral;
    if (t.startsWith("Exit code 0")) return "#34D399";
    if (t.startsWith("critical ")) return t.startsWith("critical 0") ? INK.muted : CHROMA.coral;
    if (t.startsWith("rls-check ") || t === "Summary" || t.startsWith("Note")) return INK.high;
    if (/^public\./.test(t) || t.startsWith("9 of 9")) return INK.copy;
    return INK.muted;
}

const Report: React.FC<{ lines: string[]; from: number }> = ({ lines, from }) => {
    const frame = useCurrentFrame();
    return (
        <>
            {lines.map((line, i) => {
                const at = from + Math.floor(i / BURST);
                if (frame < at) return null;
                return (
                    <div key={i} style={{ color: paint(line), whiteSpace: "pre", opacity: ramp(frame, at, 4) }}>
                        {line === "" ? "\u00a0" : line}
                    </div>
                );
            })}
        </>
    );
};

const ScanBody: React.FC<{ rerunAt: number }> = ({ rerunAt }) => {
    const frame = useCurrentFrame();
    const rate = 0.5;
    const typed1 = Math.round(ramp(frame, 8, CMD.length * rate) * CMD.length);
    const report1 = 8 + CMD.length * rate + 8;
    const rerun = frame >= rerunAt;
    const typed2 = Math.round(ramp(frame, rerunAt + 4, CMD.length * rate) * CMD.length);
    const report2 = rerunAt + 4 + CMD.length * rate + 8;

    return (
        <Frame title="rls-check · the same database" surface="well" delay={0} bodyStyle={{ padding: "22px 30px 26px" }}>
            {/* Bottom-anchored once it overflows, top-anchored before — the
                same box as the shell's (Terminal.tsx). */}
            <div style={{ position: "relative", height: HEIGHT, overflow: "hidden" }}>
                <div
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        minHeight: "100%",
                        fontFamily: FONT.mono,
                        fontSize: 14,
                        lineHeight: 1.65,
                    }}
                >
                    <div style={{ color: INK.high }}>
                        <span style={{ color: INK.muted, marginRight: 12 }}>$</span>
                        {CMD.slice(0, typed1)}
                    </div>
                    <Report lines={SCAN_BEFORE} from={report1} />
                    {rerun && (
                        <>
                            <div style={{ color: INK.high, marginTop: 6 }}>
                                <span style={{ color: INK.muted, marginRight: 12 }}>$</span>
                                {CMD.slice(0, typed2)}
                            </div>
                            <Report lines={SCAN_AFTER} from={report2} />
                        </>
                    )}
                </div>
            </div>
        </Frame>
    );
};

