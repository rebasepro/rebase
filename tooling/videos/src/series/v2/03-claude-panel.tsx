import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ENTER, ramp, SHIFT } from "../../components/motion";
import { Dot } from "../../components/Type";
import { CHROMA, FONT, FRAME, GROUND, INK, PRIMARY, PRIMARY_LIGHT, RADIUS, SURFACE, TRACKING } from "../../theme";
import { At, checkFilm, Headline, Label, lines, useBodyFor, useCue, type FilmSpec } from "../kit";

/**
 * 03 — YOUR ADMIN PANEL INSIDE CLAUDE.
 *
 * Stop vibe-coding disposable internal dashboards and stop letting Claude
 * mutate production rows blind in plain text. Connect Rebase's hosted MCP
 * connector (`https://app.rebase.pro/mcp`), open your live admin table right
 * inside the chat (`show_collection`), let Claude sketch custom interactive
 * views over live rows (`show_app`), and review every write plan before
 * clicking Confirm — acting as your own Rebase account with RLS enforced.
 *
 * Real product assets: `public/claude/1-table.png`, `2-edit-plan.png`, and
 * `3-switches-and-stats.png` captured live in Claude against Rebase Cloud.
 */

const ACCENT = CHROMA.cyan;
const CORAL = CHROMA.coral;
const GREEN = "#34D399";
const AMBER = "#F59E0B";

const SCRIPT = lines([
    ["hook", "Internal dashboards: teams vibe-code dozens of them, and they break the next time somebody renames a column."],
    ["blind", "Meanwhile, AI assistants edit production rows blind, in plain text."],
    ["open", "Connect Rebase to Claude, ask for your orders, and your real admin table opens inside the chat, with live search, filters, and forms."],
    ["app", "Need a custom view? Ask Claude to build an interactive app over those records and run it right there."],
    ["confirm", "Every edit, deploy, rollback, or cron trigger shows the exact plan first and waits for your click, signed in as your own account."],
    ["close", "Use it on Rebase Cloud from a laptop or a phone, or link any self-hosted server in seconds."],
]);

/* ── inline icons (no emojis) ───────────────────────────────────────── */

const ShieldAlertIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2.2 3.2 5.1v4.7c0 4.1 2.9 7.5 6.8 8.4 3.9-.9 6.8-4.3 6.8-8.4V5.1L10 2.2Z" stroke={color} strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M10 6.8v4.2" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="10" cy="13.8" r="1" fill={color} />
    </svg>
);

const LockIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="4" y="9" width="12" height="8.5" rx="2.2" stroke={color} strokeWidth="1.7" />
        <path d="M6.8 9V6.5a3.2 3.2 0 1 1 6.4 0V9" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
);

const SparkIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2.5 11.9 8.1 17.5 10l-5.6 1.9L10 17.5l-1.9-5.6L2.5 10l5.6-1.9L10 2.5Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
);

/* ── scenes ─────────────────────────────────────────────────────────── */

/** Split hazard vs. fix card: blind plain-text mutations vs. the hosted Rebase MCP connector. */
const Blind: React.FC = () => {
    const frame = useCurrentFrame();
    const H = "Never edit prod blind.";
    const { x, y, w, format } = useBodyFor(H);
    const tall = format === "tall";
    const rightCue = useCue({ line: "blind", word: "production", plus: -8 }) ?? 22;
    const chipsCue = useCue({ line: "blind", word: "plain", plus: -6 }) ?? 44;

    const leftIn = ramp(frame, 0, 12, ENTER);
    const rightIn = ramp(frame, Math.min(12, rightCue), 14, ENTER);
    const pulse = 0.55 + 0.45 * Math.sin(frame / 7);

    const cardStyle: React.CSSProperties = {
        flex: 1,
        borderRadius: FRAME.radius,
        background: SURFACE.sheet,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
    };

    const connectorTools = ["query", "show_collection", "show_record", "show_app", "write", "deploy", "env", "cron"];

    return (
        <>
            <Headline text={H} at={0} accent={CORAL} mark={["blind."]} />
            <At x={x} y={y} w={w}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 20 : 28, alignItems: "stretch" }}>
                    {/* Left: Blind text hazard */}
                    <div
                        style={{
                            ...cardStyle,
                            border: `1px solid rgba(251,80,102,${0.42 + 0.22 * pulse})`,
                            opacity: leftIn,
                            transform: leftIn < 1 ? `translateY(${(1 - leftIn) * 14}px)` : undefined,
                            padding: tall ? "20px 22px" : "26px 28px",
                        }}
                    >
                        <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: tall ? 14 : 20 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <ShieldAlertIcon color={CORAL} size={tall ? 20 : 22} />
                                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, letterSpacing: TRACKING.eyebrow, color: CORAL, textTransform: "uppercase" }}>
                                        NO PLAN · BLIND TEXT
                                    </span>
                                </div>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: 13,
                                        padding: "4px 10px",
                                        borderRadius: RADIUS.md,
                                        background: "rgba(251,80,102,0.16)",
                                        color: CORAL,
                                        border: "1px solid rgba(251,80,102,0.35)",
                                    }}
                                >
                                    UNVERIFIED
                                </span>
                            </div>

                            <div
                                style={{
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid ${SURFACE.hairline}`,
                                    padding: tall ? "16px 18px" : "20px 22px",
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 19 : 21,
                                    lineHeight: 1.6,
                                }}
                            >
                                <div style={{ color: INK.muted, fontSize: tall ? 14 : 15, marginBottom: 8 }}>chat › raw mutation text</div>
                                <div style={{ color: CORAL }}>DELETE FROM orders</div>
                                <div style={{ color: INK.high, paddingLeft: 18 }}>WHERE status = &apos;pending&apos;;</div>
                                <div style={{ height: 8 }} />
                                <div style={{ color: AMBER }}>UPDATE orders SET refunded = true;</div>
                            </div>
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: tall ? 14 : 20 }}>
                            {["× No plan preview", "× Blind SQL text", "× No RLS check"].map((item) => (
                                <span
                                    key={item}
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 15 : 16,
                                        color: CORAL,
                                        padding: "6px 12px",
                                        borderRadius: RADIUS.md,
                                        background: "rgba(251,80,102,0.10)",
                                    }}
                                >
                                    {item}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Right: Hosted Rebase MCP Connector */}
                    <div
                        style={{
                            ...cardStyle,
                            border: `1px solid ${SURFACE.hairlineStrong}`,
                            opacity: rightIn,
                            transform: rightIn < 1 ? `translateY(${(1 - rightIn) * 14}px)` : undefined,
                            padding: tall ? "20px 22px" : "26px 28px",
                        }}
                    >
                        <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: tall ? 14 : 20 }}>
                                <Label at={0} color={ACCENT} size={tall ? 15 : 16}>
                                    HOSTED MCP CONNECTOR
                                </Label>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: 13,
                                        padding: "4px 10px",
                                        borderRadius: RADIUS.md,
                                        background: "rgba(52,211,153,0.14)",
                                        color: GREEN,
                                        border: "1px solid rgba(52,211,153,0.35)",
                                    }}
                                >
                                    ✓ LIVE
                                </span>
                            </div>

                            <div
                                style={{
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid rgba(54,204,214,0.35)`,
                                    padding: tall ? "15px 18px" : "18px 22px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                }}
                            >
                                <LockIcon color={ACCENT} size={tall ? 20 : 22} />
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 22 : 25, fontWeight: 600, color: INK.high }}>
                                    https://app.rebase.pro/mcp
                                </span>
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: tall ? 14 : 18 }}>
                                {[
                                    { label: "OAuth 2.1", color: ACCENT },
                                    { label: "Acts as you", color: GREEN },
                                    { label: "12 tools", color: INK.high },
                                ].map((pill, i) => {
                                    const o = ramp(frame, Math.min(20, chipsCue) + i * 5, 10, ENTER);
                                    return (
                                        <span
                                            key={pill.label}
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 16 : 18,
                                                fontWeight: 500,
                                                color: pill.color,
                                                padding: "7px 14px",
                                                borderRadius: RADIUS.md,
                                                background: SURFACE.card,
                                                border: `1px solid ${SURFACE.hairlineStrong}`,
                                                opacity: o,
                                                transform: o < 1 ? `translateY(${(1 - o) * 8}px)` : undefined,
                                            }}
                                        >
                                            {pill.label}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>

                        <div style={{ marginTop: tall ? 14 : 20, paddingTop: tall ? 12 : 16, borderTop: `1px solid ${SURFACE.hairline}` }}>
                            <div style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.14em", color: INK.muted, marginBottom: 8 }}>
                                TOOLS · READ + PLAN-THEN-CONFIRM
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                {connectorTools.map((tool, i) => {
                                    const isWrite = i >= 4;
                                    return (
                                        <span
                                            key={tool}
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 14 : 15,
                                                color: isWrite ? AMBER : INK.copy,
                                                padding: "4px 10px",
                                                borderRadius: RADIUS.md,
                                                background: isWrite ? "rgba(245,158,11,0.10)" : "rgba(255,255,255,0.05)",
                                            }}
                                        >
                                            {tool}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/** Real Rebase admin table rendered inside Claude via `show_collection` MCP App. */
const Open: React.FC = () => {
    const frame = useCurrentFrame();
    const H = "Your real table in Claude.";
    const { x, y, w, format } = useBodyFor(H);
    const tall = format === "tall";

    const openCue = useCue({ line: "open", word: "opens", plus: -6 }) ?? 48;
    const searchCue = useCue({ line: "open", word: "search,", plus: -4 }) ?? 78;
    const filtersCue = useCue({ line: "open", word: "filters,", plus: -4 }) ?? 92;
    const formsCue = useCue({ line: "open", word: "forms.", plus: -6 }) ?? 108;

    const shellIn = ramp(frame, 0, 10, ENTER);
    const appReveal = ramp(frame, 4, 16, ENTER);
    // Smoothly pan from table view (1-table.png) to switches & stats (3-switches-and-stats.png) when filters/forms hit
    const switchesMix = ramp(frame, Math.max(openCue + 24, filtersCue - 2), 18, SHIFT);

    /* Tall crops to the screenshot's left columns at a legible scale
       instead of shrinking the whole 1568px capture to 9px text. */
    const imgH = tall ? 440 : 410;
    const imgW: number | string = tall ? 1240 : "100%";
    const capabilities = [
        { label: "Live search", at: searchCue },
        { label: "Filters & sorting", at: filtersCue },
        { label: "Switches & inline forms", at: formsCue },
    ];

    return (
        <>
            <Headline text={H} at={0} accent={ACCENT} mark={["Claude."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.sheet,
                        overflow: "hidden",
                        opacity: shellIn,
                        transform: shellIn < 1 ? `translateY(${(1 - shellIn) * 12}px)` : undefined,
                    }}
                >
                    {/* Prompt header inside Claude */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 14,
                            padding: tall ? "14px 18px" : "14px 24px",
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                            background: SURFACE.card,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                            <div
                                style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 99,
                                    background: SURFACE.raised,
                                    border: `1px solid ${SURFACE.hairlineStrong}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontFamily: FONT.mono,
                                    fontSize: 14,
                                    color: INK.high,
                                    flexShrink: 0,
                                }}
                            >
                                U
                            </div>
                            <span
                                style={{
                                    fontFamily: FONT.body,
                                    fontWeight: 500,
                                    fontSize: tall ? 20 : 22,
                                    color: INK.high,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                &ldquo;Show me the orders table, most recent first&rdquo;
                            </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 14 : 15,
                                    color: ACCENT,
                                    padding: "5px 12px",
                                    borderRadius: RADIUS.md,
                                    background: "rgba(54,204,214,0.12)",
                                    border: "1px solid rgba(54,204,214,0.38)",
                                }}
                            >
                                show_collection
                            </span>
                            {!tall && (
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: 14,
                                        color: INK.muted,
                                        padding: "5px 10px",
                                        borderRadius: RADIUS.md,
                                        background: SURFACE.well,
                                    }}
                                >
                                    MCP App
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Real Rebase MCP App screenshot viewport */}
                    <div
                        style={{
                            position: "relative",
                            height: imgH,
                            background: SURFACE.well,
                            overflow: "hidden",
                            opacity: appReveal,
                        }}
                    >
                        <Img
                            src={staticFile("claude/1-table.png")}
                            style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                width: imgW,
                                height: "auto",
                                transformOrigin: "left top",
                                opacity: 1 - switchesMix,
                                transform: `scale(${interpolate(appReveal, [0, 1], [1.03, 1])})`,
                            }}
                        />
                        <Img
                            src={staticFile("claude/3-switches-and-stats.png")}
                            style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                width: imgW,
                                height: "auto",
                                opacity: switchesMix,
                            }}
                        />
                    </div>

                    {/* Capability strip */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 12,
                            padding: tall ? "14px 18px" : "14px 24px",
                            borderTop: `1px solid ${SURFACE.hairline}`,
                            background: SURFACE.sheet,
                        }}
                    >
                        <div style={{ display: "flex", flexWrap: "wrap", gap: tall ? 10 : 14 }}>
                            {capabilities.map((cap) => {
                                const lit = ramp(frame, cap.at, 10, ENTER);
                                return (
                                    <span
                                        key={cap.label}
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: tall ? 15 : 16,
                                            padding: "5px 12px",
                                            borderRadius: RADIUS.md,
                                            border: `1px solid ${lit > 0.4 ? ACCENT : SURFACE.hairline}`,
                                            background: lit > 0.4 ? "rgba(54,204,214,0.12)" : SURFACE.card,
                                            color: lit > 0.4 ? INK.high : INK.muted,
                                        }}
                                    >
                                        <span style={{ color: lit > 0.4 ? GREEN : INK.muted, marginRight: 8 }}>✓</span>
                                        {cap.label}
                                    </span>
                                );
                            })}
                        </div>
                        {!tall && (
                            <span style={{ fontFamily: FONT.mono, fontSize: 14, color: INK.muted }}>
                                Same schema · Zero custom frontend code
                            </span>
                        )}
                    </div>
                </div>
            </At>
        </>
    );
};

interface TriageOrder {
    id: string;
    customer: string;
    total: string;
    status: "Pending" | "Flagged";
    wait: string;
}

const TRIAGE_ORDERS: TriageOrder[] = [
    { id: "#4821", customer: "Acme Logistics", total: "$1,240", status: "Pending", wait: "8m" },
    { id: "#4819", customer: "Northstar Goods", total: "$890", status: "Pending", wait: "14m" },
    { id: "#4815", customer: "Kestrel Labs", total: "$610", status: "Flagged", wait: "29m" },
];

/** Custom interactive mini-app rendered via `show_app` over live preloaded records. */
const AppScene: React.FC = () => {
    const frame = useCurrentFrame();
    const H = "Custom apps, right in chat.";
    const { x, y, w, format } = useBodyFor(H);
    const tall = format === "tall";

    const sketchCue = useCue({ line: "app", word: "build", plus: -4 }) ?? 18;
    const interactiveCue = useCue({ line: "app", word: "interactive", plus: -4 }) ?? 44;
    const runCue = useCue({ line: "app", word: "run", plus: -4 }) ?? 78;

    const promptIn = ramp(frame, 0, 10, ENTER);
    const appIn = ramp(frame, 4, 14, ENTER);
    const filterActive = ramp(frame, interactiveCue, 12, ENTER);
    const actionFired = ramp(frame, runCue, 12, ENTER);

    const kpis = [
        { label: "PENDING", value: String(Math.round(interpolate(appIn, [0, 1], [0, 12]))), sub: "$4,820 value", color: ACCENT },
        { label: "AVG WAIT", value: `${Math.round(interpolate(appIn, [0, 1], [0, 14]))}m`, sub: "SLA < 20m", color: GREEN },
        { label: "FLAGGED", value: String(Math.round(interpolate(appIn, [0, 1], [0, 4]))), sub: "needs review", color: AMBER },
    ];

    return (
        <>
            <Headline text={H} at={0} accent={ACCENT} mark={["in", "chat."]} />
            <At x={x} y={y} w={w}>
                {/* Prompt bar */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 14,
                        padding: tall ? "14px 18px" : "15px 22px",
                        borderRadius: FRAME.radius,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.sheet,
                        opacity: promptIn,
                        marginBottom: tall ? 16 : 18,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                        <SparkIcon color={ACCENT} size={20} />
                        <span
                            style={{
                                fontFamily: FONT.body,
                                fontWeight: 500,
                                fontSize: tall ? 19 : 22,
                                color: INK.high,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                            }}
                        >
                            &ldquo;Build a quick fulfillment triage view on those rows&rdquo;
                        </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: tall ? 14 : 15,
                                color: GROUND.base,
                                background: ACCENT,
                                fontWeight: 600,
                                padding: "5px 12px",
                                borderRadius: RADIUS.md,
                            }}
                        >
                            show_app
                        </span>
                        {!tall && (
                            <span style={{ fontFamily: FONT.mono, fontSize: 14, color: INK.muted }}>
                                preloaded page 1
                            </span>
                        )}
                    </div>
                </div>

                {/* Live Mini-App Surface */}
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.sheet,
                        overflow: "hidden",
                        opacity: appIn,
                        transform: appIn < 1 ? `translateY(${(1 - appIn) * 14}px)` : undefined,
                    }}
                >
                    {/* App top bar + filter tabs */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            flexWrap: "wrap",
                            gap: 12,
                            padding: tall ? "13px 18px" : "14px 24px",
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                            background: SURFACE.sheet,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Dot color={GREEN} size={6} />
                            <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 20 : 22, color: INK.high }}>
                                Fulfillment Triage
                            </span>
                            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: INK.muted }}>
                                · live orders
                            </span>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            {[
                                { label: "All (48)", active: filterActive < 0.5 },
                                { label: "Pending (12)", active: filterActive >= 0.5 },
                                { label: "Flagged (4)", active: false },
                            ].map((tab) => (
                                <span
                                    key={tab.label}
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 14 : 15,
                                        padding: "6px 12px",
                                        borderRadius: RADIUS.md,
                                        background: tab.active ? PRIMARY : SURFACE.well,
                                        color: tab.active ? "#FFFFFF" : INK.copy,
                                        border: `1px solid ${tab.active ? PRIMARY_LIGHT : SURFACE.hairline}`,
                                    }}
                                >
                                    {tab.label}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div style={{ padding: tall ? "16px 18px 18px" : "20px 24px 22px" }}>
                        {/* KPI Row */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: tall ? 12 : 16, marginBottom: tall ? 16 : 18 }}>
                            {kpis.map((kpi, i) => {
                                const o = ramp(frame, Math.min(8, sketchCue) + i * 4, 10, ENTER);
                                return (
                                    <div
                                        key={kpi.label}
                                        style={{
                                            borderRadius: RADIUS.lg,
                                            background: SURFACE.well,
                                            border: `1px solid ${SURFACE.hairline}`,
                                            padding: tall ? "12px 14px" : "14px 18px",
                                            opacity: o,
                                        }}
                                    >
                                        <div style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.14em", color: INK.muted }}>{kpi.label}</div>
                                        <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 30 : 36, color: kpi.color, marginTop: 4, lineHeight: 1.1 }}>
                                            {kpi.value}
                                        </div>
                                        <div style={{ fontFamily: FONT.body, fontSize: tall ? 14 : 15, color: INK.copy, marginTop: 4 }}>{kpi.sub}</div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Interactive order rows */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            {TRIAGE_ORDERS.map((order, i) => {
                                const rowIn = ramp(frame, 10 + i * 4, 10, ENTER);
                                const dimmed = filterActive > 0.5 && order.status === "Flagged";
                                const isDispatched = i === 0 && actionFired > 0.5;
                                return (
                                    <div
                                        key={order.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: tall ? "12px 14px" : "13px 18px",
                                            borderRadius: RADIUS.lg,
                                            background: isDispatched ? "rgba(52,211,153,0.09)" : SURFACE.card,
                                            border: `1px solid ${isDispatched ? GREEN : SURFACE.hairline}`,
                                            opacity: rowIn * (dimmed ? 0.36 : 1),
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: tall ? 12 : 20 }}>
                                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 17 : 19, color: ACCENT, fontWeight: 600 }}>{order.id}</span>
                                            <span style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: tall ? 18 : 20, color: INK.high }}>{order.customer}</span>
                                            {!tall && (
                                                <span style={{ fontFamily: FONT.mono, fontSize: 16, color: INK.muted }}>wait {order.wait}</span>
                                            )}
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: tall ? 10 : 16 }}>
                                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 17 : 19, color: INK.high }}>{order.total}</span>
                                            <span
                                                style={{
                                                    fontFamily: FONT.mono,
                                                    fontSize: tall ? 14 : 15,
                                                    fontWeight: 600,
                                                    padding: "6px 14px",
                                                    borderRadius: RADIUS.md,
                                                    background: isDispatched ? "rgba(52,211,153,0.18)" : PRIMARY,
                                                    color: isDispatched ? GREEN : "#FFFFFF",
                                                    border: isDispatched ? `1px solid ${GREEN}` : "none",
                                                }}
                                            >
                                                {isDispatched ? "✓ Plan ready →" : "Dispatch"}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/** Two-step plan-then-confirm with the real `2-edit-plan.png` screenshot + write tool chips. */
const Confirm: React.FC = () => {
    const frame = useCurrentFrame();
    const H = "Every write waits for you.";
    const { x, y, w, format } = useBodyFor(H);
    const tall = format === "tall";

    const editCue = useCue({ line: "confirm", word: "edit,", plus: -4 }) ?? 4;
    const deployCue = useCue({ line: "confirm", word: "deploy,", plus: -4 }) ?? 16;
    const rollbackCue = useCue({ line: "confirm", word: "rollback,", plus: -4 }) ?? 28;
    const cronCue = useCue({ line: "confirm", word: "cron", plus: -4 }) ?? 40;
    const waitsCue = useCue({ line: "confirm", word: "waits", plus: -4 }) ?? 70;
    const signedCue = useCue({ line: "confirm", word: "signed", plus: -4 }) ?? 92;

    const frameIn = ramp(frame, 0, 12, ENTER);
    const waitsLit = ramp(frame, waitsCue, 12, ENTER);
    const signedLit = ramp(frame, signedCue, 12, ENTER);

    const writeTools = [
        { name: "write", desc: "Row edits", at: editCue },
        { name: "deploy", desc: "Ship & rollback", at: deployCue },
        { name: "env", desc: "Secrets & vars", at: rollbackCue },
        { name: "cron", desc: "Trigger jobs", at: cronCue },
    ];

    /* The Save bar sits at 99-165px of the 1568px-wide capture; the frame
       scales with the panel so it lands on the bar in both shapes. */
    const shotScale = (tall ? w - 2 : 874) / 1568;
    const planBar = { top: Math.round(99 * shotScale) - 1, height: Math.round(66 * shotScale) };

    const screenshotPanel = (
        <div
            style={{
                borderRadius: FRAME.radius,
                border: `1px solid ${SURFACE.hairlineStrong}`,
                background: SURFACE.sheet,
                overflow: "hidden",
                opacity: frameIn,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: tall ? "10px 16px" : "12px 18px",
                    borderBottom: `1px solid ${SURFACE.hairline}`,
                    background: SURFACE.sheet,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Dot color={AMBER} size={6} />
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: INK.copy, letterSpacing: "0.08em" }}>
                        PLAN PREVIEW · 2-STEP WRITE
                    </span>
                </div>
                <span
                    style={{
                        fontFamily: FONT.mono,
                        fontSize: 13,
                        padding: "4px 10px",
                        borderRadius: RADIUS.md,
                        background: "rgba(245,158,11,0.14)",
                        color: AMBER,
                        border: "1px solid rgba(245,158,11,0.4)",
                    }}
                >
                    Waiting on Confirm
                </span>
            </div>

            <div style={{ position: "relative", height: tall ? 330 : 374, background: SURFACE.well, overflow: "hidden" }}>
                <Img
                    src={staticFile("claude/2-edit-plan.png")}
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        objectPosition: "left top",
                    }}
                />
                {/* Subtle highlight frame calling attention to the real Save confirmation bar */}
                <div
                    style={{
                        position: "absolute",
                        left: "1%",
                        right: "1%",
                        top: planBar.top,
                        height: planBar.height,
                        borderRadius: 8,
                        border: `2px solid ${AMBER}`,
                        opacity: 0.35 + 0.65 * waitsLit,
                        pointerEvents: "none",
                    }}
                />
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: tall ? "10px 16px" : "12px 18px",
                    borderTop: `1px solid ${SURFACE.hairline}`,
                    background: SURFACE.sheet,
                }}
            >
                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: signedLit > 0.4 ? GREEN : INK.copy }}>
                    ✓ Acts as you · RLS enforced · no service key
                </span>
                {!tall && (
                    <span style={{ fontFamily: FONT.mono, fontSize: 14, color: INK.muted }}>
                        OAuth 2.1
                    </span>
                )}
            </div>
        </div>
    );

    return (
        <>
            <Headline text={H} at={0} accent={ACCENT} mark={["waits"]} />
            <At x={x} y={y} w={w}>
                {tall ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        {screenshotPanel}
                        {/* 4 write tool chips in a single row */}
                        <div
                            style={{
                                borderRadius: FRAME.radius,
                                border: `1px solid ${SURFACE.hairlineStrong}`,
                                background: SURFACE.sheet,
                                padding: "12px 16px",
                                opacity: frameIn,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                                <span style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.14em", color: INK.muted }}>
                                    GUARDED WRITE TOOLS
                                </span>
                                <span style={{ fontFamily: FONT.mono, fontSize: 13, color: CORAL }}>
                                    destructiveHint: true
                                </span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                                {writeTools.map((t) => {
                                    const lit = ramp(frame, t.at, 10, ENTER);
                                    return (
                                        <div
                                            key={t.name}
                                            style={{
                                                padding: "8px 10px",
                                                borderRadius: RADIUS.md,
                                                background: lit > 0.4 ? "rgba(245,158,11,0.14)" : SURFACE.well,
                                                border: `1px solid ${lit > 0.4 ? AMBER : SURFACE.hairline}`,
                                                textAlign: "center",
                                            }}
                                        >
                                            <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 17, color: lit > 0.4 ? INK.high : INK.copy }}>
                                                {t.name}
                                            </div>
                                            <div style={{ fontFamily: FONT.body, fontSize: 12, color: INK.muted, marginTop: 2 }}>{t.desc}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: "flex", gap: 24, alignItems: "stretch" }}>
                        {/* Left: Real screenshot + self-hosted command */}
                        <div style={{ width: 876, display: "flex", flexDirection: "column", gap: 16 }}>
                            {screenshotPanel}
                            </div>

                        {/* Right: Guarded write tool chips + confirm protocol */}
                        <div
                            style={{
                                flex: 1,
                                borderRadius: FRAME.radius,
                                border: `1px solid ${SURFACE.hairlineStrong}`,
                                background: SURFACE.sheet,
                                padding: "22px 24px",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                opacity: frameIn,
                            }}
                        >
                            <div>
                                <div style={{ fontFamily: FONT.mono, fontSize: 14, letterSpacing: "0.14em", color: INK.muted, marginBottom: 6 }}>
                                    PLAN THEN CONFIRM
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontSize: 16, color: CORAL, marginBottom: 18 }}>
                                    destructiveHint: true
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                                    {writeTools.map((t) => {
                                        const lit = ramp(frame, t.at, 10, ENTER);
                                        return (
                                            <div
                                                key={t.name}
                                                style={{
                                                    padding: "14px 16px",
                                                    borderRadius: RADIUS.lg,
                                                    background: lit > 0.4 ? "rgba(245,158,11,0.14)" : SURFACE.well,
                                                    border: `1px solid ${lit > 0.4 ? AMBER : SURFACE.hairline}`,
                                                    transform: lit < 1 ? `translateY(${(1 - lit) * 6}px)` : undefined,
                                                }}
                                            >
                                                <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: 22, color: lit > 0.4 ? INK.high : INK.copy }}>
                                                    {t.name}
                                                </div>
                                                <div style={{ fontFamily: FONT.body, fontSize: 15, color: INK.muted, marginTop: 4 }}>{t.desc}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div
                                style={{
                                    marginTop: 20,
                                    padding: "16px 18px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid ${waitsLit > 0.4 ? AMBER : SURFACE.hairline}`,
                                }}
                            >
                                <div style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.14em", color: AMBER, marginBottom: 8 }}>
                                    EXECUTION GATE
                                </div>
                                <div style={{ fontFamily: FONT.body, fontSize: 17, color: INK.high, lineHeight: 1.45 }}>
                                    1. Show exact diff / plan
                                    <br />
                                    2. Wait for human click
                                </div>
                                <div style={{ marginTop: 12, fontFamily: FONT.mono, fontSize: 14, color: signedLit > 0.4 ? GREEN : INK.muted }}>
                                    {signedLit > 0.4 ? "✓ Your org role · Your RLS" : "• Waiting on Confirm"}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const CLAUDE_PANEL: FilmSpec = checkFilm({
    id: "claude-panel",
    number: 3,
    title: "Your admin panel inside Claude",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    backdrop: "dark",
    endCommand: "rebase cloud connect <url>",
    scenes: [
        { id: "blind", at: { line: "blind", plus: -16 }, render: Blind, roll: 0.24 },
        { id: "open", at: { line: "open", plus: 0 }, render: Open, roll: 0.56 },
        { id: "app", at: { line: "app", plus: 0 }, render: AppScene, roll: 0.78 },
        { id: "confirm", at: { line: "confirm", plus: 0 }, render: Confirm, roll: 0.38, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.5 },
    ],
});
