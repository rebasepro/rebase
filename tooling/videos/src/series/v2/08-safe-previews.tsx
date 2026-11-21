import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, RADIUS, SURFACE, TONE } from "../../theme";
import { At, checkFilm, Headline, lines, Prompt, useBodyFor, useCue, type FilmSpec } from "../kit";

/**
 * 08 — AGENT PREVIEWS THAT CANNOT TOUCH PROD.
 *
 * Four coding agents opening pull requests against one shared staging server
 * overwrite each other's tables, policies, and crons. On Rebase Cloud, every
 * `--preview-name` deploy boots its own isolated pod, empty Postgres instance,
 * and separate service key — behind a dedicated `/api/functions/previews/<id>`
 * route that fails closed with 404 on older control planes.
 *
 * Real: commands, URLs, hazards, and route behavior match
 * docs/preview-deployments.md verbatim.
 */

const ACCENT = CHROMA.cyan;
const GREEN = "#34D399";
const CORAL = CHROMA.coral;
const AMBER = "#F59E0B";

const SCRIPT = lines([
    ["hook", "When four coding agents open backend pull requests before lunch, a shared staging server turns into a crime scene."],
    ["deploy", "On Rebase Cloud, pass a preview name when you deploy, and that branch gets its own live address in seconds."],
    ["isolated", "Every backend preview boots inside an isolated pod on a fresh, empty Postgres instance with a separate service key."],
    ["why", "Production tables stay untouched, live security policies never get overwritten, and scheduled jobs cannot fire against real users."],
    ["guard", "Even the upload route is fail-safe: hit an older control plane by mistake, and it returns four-oh-four rather than touching live traffic."],
    ["close", "Ship ten agent branches at once with Rebase Cloud and stop sweating production."],
]);

/* ── inline glyphs (zero emojis) ────────────────────────────────────── */

const ShieldGlyph: React.FC<{ color: string; size?: number }> = ({ color, size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" style={{ flexShrink: 0 }}>
        <path d="M11 2 L19 5.5 V11 C19 15.8 15.6 19.2 11 20.5 C6.4 19.2 3 15.8 3 11 V5.5 L11 2 Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M7.5 11.2 L10 13.7 L14.8 8.7" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const LockGlyph: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <rect x="4" y="9" width="12" height="8.5" rx="2" stroke={color} strokeWidth="1.7" />
        <path d="M6.8 9 V6.5 C6.8 4.7 8.2 3.3 10 3.3 C11.8 3.3 13.2 4.7 13.2 6.5 V9" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
);

const GlobeGlyph: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="10" cy="10" r="7.5" stroke={color} strokeWidth="1.6" />
        <ellipse cx="10" cy="10" rx="3.4" ry="7.5" stroke={color} strokeWidth="1.4" />
        <path d="M2.8 10 H17.2" stroke={color} strokeWidth="1.4" />
    </svg>
);

const TerminalBar: React.FC<{ title: string; badge?: string; badgeColor?: string }> = ({ title, badge, badgeColor = ACCENT }) => (
    <div
        style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "11px 18px",
            borderBottom: `1px solid ${SURFACE.hairline}`,
            background: SURFACE.sheet,
        }}
    >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {["#F43F5E", "#FBBF24", "#34D399"].map((c) => (
                <span key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c, opacity: 0.6 }} />
            ))}
            <span style={{ marginLeft: 8, fontFamily: FONT.mono, fontSize: 15, color: INK.muted }}>{title}</span>
        </div>
        {badge && (
            <span
                style={{
                    fontFamily: FONT.mono,
                    fontSize: 13,
                    letterSpacing: "0.1em",
                    color: badgeColor,
                    padding: "3px 10px",
                    borderRadius: RADIUS.md,
                    border: `1px solid ${badgeColor}55`,
                    background: `${badgeColor}14`,
                }}
            >
                {badge}
            </span>
        )}
    </div>
);

/* ── scene 1: deploy --preview-name ─────────────────────────────────── */

const H_DEPLOY = "One flag. Live preview URL.";

const Deploy: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_DEPLOY);
    const tall = format === "tall";

    const cLive = useCue({ line: "deploy", word: "live", plus: -4 }) ?? 9999;
    const cSec = useCue({ line: "deploy", word: "seconds", plus: -6 }) ?? 9999;

    const shellO = ramp(frame, 0, 8, ENTER);
    const uploadAt = 24;
    const bootAt = 34;
    const liveAt = Math.min(cLive, 48);
    const flip = ramp(frame, Math.min(cSec, liveAt + 10), 12, ENTER);

    const statusColor = flip > 0.5 ? GREEN : ACCENT;

    return (
        <>
            <Headline text={H_DEPLOY} at={0} accent={ACCENT} mark={["preview", "URL."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: RADIUS.xl,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.well,
                        overflow: "hidden",
                        opacity: shellO,
                        transform: shellO < 1 ? `translateY(${(1 - shellO) * 10}px)` : undefined,
                    }}
                >
                    <TerminalBar title="zsh · ~/songbuzz" badge="PREVIEW DEPLOY" badgeColor={ACCENT} />
                    <div style={{ padding: tall ? "20px 22px" : "24px 28px" }}>
                        <Prompt
                            command={tall ? "rebase cloud deploy \\\n  --preview-name new-quiz" : "rebase cloud deploy --preview-name new-quiz"}
                            at={2}
                            size={tall ? 22 : 26}
                            rate={0.34}
                        />
                        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8, fontFamily: FONT.mono, fontSize: tall ? 18 : 21 }}>
                            <div style={{ color: INK.copy, opacity: ramp(frame, uploadAt, 8, ENTER) }}>
                                <span style={{ color: ACCENT }}>→</span> Uploading bundle · POST /api/functions/previews/songbuzz
                            </div>
                            <div style={{ color: INK.copy, opacity: ramp(frame, bootAt, 8, ENTER) }}>
                                <span style={{ color: ACCENT }}>→</span> Provisioning isolated pod + empty Postgres DB
                            </div>
                            <div style={{ color: GREEN, fontWeight: 600, opacity: ramp(frame, liveAt, 10, ENTER) }}>
                                ✓ Live check passed (200 OK) · backend: preview
                            </div>
                        </div>
                    </div>
                </div>

                {/* Live preview URL card */}
                <div
                    style={{
                        marginTop: tall ? 18 : 22,
                        padding: tall ? "18px 20px" : "20px 26px",
                        borderRadius: RADIUS.xl,
                        background: flip > 0.5 ? "rgba(52,211,153,0.09)" : SURFACE.sheet,
                        border: `1.5px solid ${flip > 0.5 ? "rgba(52,211,153,0.55)" : SURFACE.hairlineStrong}`,
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        alignItems: tall ? "flex-start" : "center",
                        justifyContent: "space-between",
                        gap: tall ? 14 : 18,
                        opacity: ramp(frame, 10, 10, ENTER),
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
                        <div
                            style={{
                                width: 38,
                                height: 38,
                                borderRadius: 99,
                                background: `${statusColor}1A`,
                                border: `1.5px solid ${statusColor}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                            }}
                        >
                            <GlobeGlyph color={statusColor} size={20} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.14em", color: statusColor }}>
                                {flip > 0.5 ? "✓ LIVE CHECK PASSED" : "CHECKING PREVIEW ADDRESS…"}
                            </div>
                            <div
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 20 : 25,
                                    fontWeight: 600,
                                    color: INK.high,
                                    marginTop: 2,
                                }}
                            >
                                https://songbuzz--new-quiz.rebase.website
                            </div>
                        </div>
                    </div>

                    <div
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: tall ? "8px 14px" : "10px 16px",
                            borderRadius: RADIUS.lg,
                            background: "rgba(52,211,153,0.14)",
                            border: `1px solid rgba(52,211,153,0.48)`,
                            fontFamily: FONT.mono,
                            fontSize: tall ? 17 : 18,
                            fontWeight: 600,
                            color: GREEN,
                            flexShrink: 0,
                            opacity: 0.4 + 0.6 * flip,
                        }}
                    >
                        <LockGlyph color={GREEN} size={16} />
                        <span>production: unchanged</span>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 2: architectural split diagram (ground: GROUND.deep) ─────── */

const H_ISOLATED = "Isolated pod. Empty Postgres.";

const PREVIEW_LANES = [
    { name: "--new-quiz", host: "songbuzz--new-quiz.rebase.website" },
    { name: "--billing-v2", host: "songbuzz--billing-v2.rebase.website" },
    { name: "--rls-fix", host: "songbuzz--rls-fix.rebase.website" },
] as const;

const Isolated: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_ISOLATED);
    const tall = format === "tall";

    const cEmpty = useCue({ line: "isolated", word: "empty", plus: -6 }) ?? 9999;
    const cSep = useCue({ line: "isolated", word: "separate", plus: -6 }) ?? 9999;
    const laneAts = [4, Math.min(cEmpty, 36), Math.min(cSep, 68)];

    const rootO = ramp(frame, 0, 8, ENTER);
    const barrierO = ramp(frame, 2, 12, ENTER);
    const pulse = 0.55 + 0.45 * Math.sin(frame * 0.14);

    const cardBg = "rgba(8,9,12,0.78)";

    return (
        <>
            <Headline text={H_ISOLATED} at={0} accent={ACCENT} mark={["Isolated", "Empty"]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        alignItems: "stretch",
                        gap: tall ? 14 : 22,
                        opacity: rootO,
                    }}
                >
                    {/* PRODUCTION column */}
                    <div
                        style={{
                            width: tall ? w : 440,
                            flexShrink: 0,
                            borderRadius: RADIUS.xl,
                            background: cardBg,
                            border: `1.5px solid rgba(251,80,102,0.65)`,
                            padding: tall ? "16px 20px" : "22px 24px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: tall ? 12 : 16,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 9, height: 9, borderRadius: 99, background: CORAL }} />
                                <span style={{ fontFamily: FONT.mono, fontSize: 16, fontWeight: 600, letterSpacing: "0.14em", color: CORAL }}>
                                    PRODUCTION
                                </span>
                            </div>
                            <span style={{ fontFamily: FONT.mono, fontSize: 14, color: TONE.deep.muted }}>LOCKED</span>
                        </div>

                        <div style={{ fontFamily: FONT.mono, fontSize: tall ? 19 : 21, fontWeight: 600, color: TONE.deep.high }}>
                            songbuzz.rebase.website
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: tall ? "repeat(3, 1fr)" : "1fr",
                                gap: tall ? 10 : 12,
                            }}
                        >
                            {[
                                { k: "APP POD", v: "live traffic" },
                                { k: "PROD CNPG DB", v: "customer rows" },
                                { k: "SERVICE KEY", v: "REBASE_SERVICE_KEY" },
                            ].map((item) => (
                                <div
                                    key={item.k}
                                    style={{
                                        padding: tall ? "10px 12px" : "12px 14px",
                                        borderRadius: RADIUS.lg,
                                        background: "rgba(255,255,255,0.06)",
                                        border: `1px solid ${TONE.deep.cardBorder}`,
                                    }}
                                >
                                    <div style={{ fontFamily: FONT.mono, fontSize: 12, letterSpacing: "0.12em", color: TONE.deep.muted }}>
                                        {item.k}
                                    </div>
                                    <div
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: tall ? 14 : 17,
                                            color: TONE.deep.high,
                                            marginTop: 3,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {item.v}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Animated solid isolation barrier */}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: tall ? "row" : "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 10,
                            flexShrink: 0,
                            opacity: barrierO,
                        }}
                    >
                        <div
                            style={{
                                flex: 1,
                                width: tall ? undefined : 4,
                                height: tall ? 4 : undefined,
                                borderRadius: 99,
                                background: `linear-gradient(${tall ? "90deg" : "180deg"}, rgba(251,80,102,0.35), ${CORAL}, rgba(251,80,102,0.35))`,
                                opacity: pulse,
                            }}
                        />
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                padding: tall ? "6px 14px" : "10px 12px",
                                borderRadius: 99,
                                background: cardBg,
                                border: `1.5px solid ${CORAL}`,
                                fontFamily: FONT.mono,
                                fontSize: 13,
                                fontWeight: 600,
                                letterSpacing: "0.12em",
                                color: CORAL,
                                whiteSpace: "nowrap",
                            }}
                        >
                            <LockGlyph color={CORAL} size={14} />
                            <span>ISOLATED</span>
                        </div>
                        <div
                            style={{
                                flex: 1,
                                width: tall ? undefined : 4,
                                height: tall ? 4 : undefined,
                                borderRadius: 99,
                                background: `linear-gradient(${tall ? "90deg" : "180deg"}, rgba(251,80,102,0.35), ${CORAL}, rgba(251,80,102,0.35))`,
                                opacity: pulse,
                            }}
                        />
                    </div>

                    {/* Three stacked live preview lanes */}
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: tall ? 12 : 16 }}>
                        {PREVIEW_LANES.map((lane, i) => {
                            const o = ramp(frame, laneAts[i], 12, ENTER);
                            return (
                                <div
                                    key={lane.name}
                                    style={{
                                        borderRadius: RADIUS.xl,
                                        background: cardBg,
                                        border: `1.5px solid ${o > 0.4 ? "rgba(52,211,153,0.58)" : TONE.deep.cardBorder}`,
                                        padding: tall ? "13px 18px" : "16px 22px",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: tall ? 9 : 12,
                                        opacity: 0.25 + 0.75 * o,
                                        transform: o < 1 ? `translateX(${(1 - o) * 18}px)` : undefined,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                            <span style={{ width: 9, height: 9, borderRadius: 99, background: GREEN }} />
                                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 19 : 22, fontWeight: 600, color: GREEN }}>
                                                {lane.name}
                                            </span>
                                        </div>
                                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 16, color: TONE.deep.muted }}>
                                            {lane.host}
                                        </span>
                                    </div>

                                    <div style={{ display: "flex", flexWrap: "wrap", gap: tall ? 8 : 10 }}>
                                        {["own pod", "empty Postgres DB", "preview key"].map((chip) => (
                                            <span
                                                key={chip}
                                                style={{
                                                    fontFamily: FONT.mono,
                                                    fontSize: tall ? 14 : 16,
                                                    color: TONE.deep.high,
                                                    background: "rgba(54,204,214,0.14)",
                                                    border: `1px solid rgba(54,204,214,0.42)`,
                                                    padding: tall ? "4px 10px" : "5px 12px",
                                                    borderRadius: RADIUS.md,
                                                }}
                                            >
                                                ✓ {chip}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 3: three runtime hazards bouncing off shield ─────────────── */

const H_WHY = "Three hazards, blocked cold.";

const HAZARDS = [
    {
        name: "REBASE_MIGRATE_ON_BOOT",
        tag: "schema",
        prodStatus: "Tables untouched",
    },
    {
        name: "ensureCollectionPolicies",
        tag: "RLS",
        prodStatus: "Policies intact",
    },
    {
        name: "cron workers",
        tag: "scheduled jobs",
        prodStatus: "0 crons fired",
    },
] as const;

const Why: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_WHY);
    const tall = format === "tall";

    const cPol = useCue({ line: "why", word: "policies", plus: -6 }) ?? 9999;
    const cSched = useCue({ line: "why", word: "scheduled", plus: -6 }) ?? 9999;
    const hitAts = [8, Math.min(cPol, 38), Math.min(cSched, 68)];

    const rootO = ramp(frame, 0, 8, ENTER);

    return (
        <>
            <Headline text={H_WHY} at={0} accent={GREEN} mark={["blocked", "cold."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "stretch",
                        gap: tall ? 14 : 26,
                        opacity: rootO,
                    }}
                >
                    {/* Left: 3 runtime hazards approaching & bouncing off the shield */}
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: tall ? 14 : 18 }}>
                        {HAZARDS.map((h, i) => {
                            const start = hitAts[i];
                            const o = ramp(frame, Math.max(0, start - 6), 8, ENTER);
                            /* Smooth approach right (+24px toward shield), impact, recoil back to 0 */
                            const dx = interpolate(
                                frame,
                                [start, start + 8, start + 16],
                                [-10, tall ? 14 : 26, 0],
                                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                            );
                            const bounced = ramp(frame, start + 8, 8, ENTER);

                            return (
                                <div
                                    key={h.name}
                                    style={{
                                        padding: tall ? "15px 18px" : "20px 24px",
                                        borderRadius: RADIUS.xl,
                                        background: SURFACE.sheet,
                                        border: `1.5px solid ${bounced > 0.4 ? "rgba(52,211,153,0.45)" : "rgba(251,80,102,0.45)"}`,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 10,
                                        opacity: 0.3 + 0.7 * o,
                                        transform: `translateX(${dx}px)`,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 19 : 23, fontWeight: 600, color: INK.high }}>
                                            {h.name}
                                        </span>
                                        <span
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 13 : 15,
                                                color: INK.copy,
                                                padding: "3px 10px",
                                                borderRadius: RADIUS.md,
                                                background: SURFACE.card,
                                                border: `1px solid ${SURFACE.hairline}`,
                                            }}
                                        >
                                            {h.tag}
                                        </span>
                                    </div>

                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                        <span
                                            style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: 7,
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 14 : 16,
                                                fontWeight: 600,
                                                letterSpacing: "0.08em",
                                                color: bounced > 0.4 ? GREEN : CORAL,
                                                padding: "4px 11px",
                                                borderRadius: RADIUS.md,
                                                background: bounced > 0.4 ? "rgba(52,211,153,0.12)" : "rgba(251,80,102,0.12)",
                                                border: `1px solid ${bounced > 0.4 ? "rgba(52,211,153,0.42)" : "rgba(251,80,102,0.42)"}`,
                                            }}
                                        >
                                            {bounced > 0.4 ? "✓ CONTAINED IN PREVIEW" : "→ BLOCKING…"}
                                        </span>
                                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 18, color: bounced > 0.4 ? ACCENT : CORAL }}>
                                            ×→
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Center: Vertical cyan/emerald shield */}
                    <div
                        style={{
                            width: tall ? 38 : 52,
                            flexShrink: 0,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            position: "relative",
                        }}
                    >
                        <div
                            style={{
                                position: "absolute",
                                top: 6,
                                bottom: 6,
                                width: 6,
                                borderRadius: 99,
                                background: `linear-gradient(180deg, ${ACCENT}, ${GREEN}, ${ACCENT})`,
                                boxShadow: `0 0 24px rgba(54,204,214,0.45)`,
                            }}
                        />
                        <div
                            style={{
                                position: "relative",
                                width: tall ? 36 : 46,
                                height: tall ? 36 : 46,
                                borderRadius: 99,
                                background: GROUND.base,
                                border: `2px solid ${GREEN}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <ShieldGlyph color={GREEN} size={tall ? 20 : 24} />
                        </div>
                    </div>

                    {/* Right: Protected Production Vault */}
                    <div
                        style={{
                            width: tall ? 290 : 410,
                            flexShrink: 0,
                            borderRadius: RADIUS.xl,
                            background: SURFACE.well,
                            border: `1.5px solid rgba(52,211,153,0.5)`,
                            padding: tall ? "18px 16px" : "24px 24px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: 14,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <ShieldGlyph color={GREEN} size={22} />
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 19, fontWeight: 600, letterSpacing: "0.12em", color: GREEN }}>
                                PRODUCTION
                            </span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: tall ? 12 : 14 }}>
                            {HAZARDS.map((h, i) => {
                                const safeO = ramp(frame, hitAts[i] + 8, 10, ENTER);
                                return (
                                    <div
                                        key={h.prodStatus}
                                        style={{
                                            padding: tall ? "12px 12px" : "14px 16px",
                                            borderRadius: RADIUS.lg,
                                            background: "rgba(52,211,153,0.08)",
                                            border: `1px solid rgba(52,211,153,0.32)`,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 10,
                                            fontFamily: FONT.mono,
                                            fontSize: tall ? 16 : 19,
                                            color: INK.high,
                                            opacity: 0.35 + 0.65 * safeO,
                                        }}
                                    >
                                        <span style={{ color: GREEN, fontWeight: 600 }}>✓</span>
                                        <span>{h.prodStatus}</span>
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 15, color: INK.muted }}>
                            0 writes · 0 policy diffs
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 4: fail-safe route guard (bright: true) ──────────────────── */

const H_GUARD = "Fail-safe by route design.";

const Guard: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_GUARD);
    const tall = format === "tall";

    const cRet = useCue({ line: "guard", word: "returns", plus: -6 }) ?? 9999;
    const respAt = Math.min(cRet, 42);

    const topO = ramp(frame, 0, 8, ENTER);
    const strike = ramp(frame, 8, 12, ENTER);
    const botO = ramp(frame, 6, 10, ENTER);
    const respO = ramp(frame, respAt, 12, ENTER);

    return (
        <>
            <Headline text={H_GUARD} at={0} accent={ACCENT} mark={["Fail-safe"]} />
            <At x={x} y={y} w={w}>
                {/* Top: Dangerous /deploy with flag (crossed out) */}
                <div
                    style={{
                        position: "relative",
                        borderRadius: RADIUS.xl,
                        background: "rgba(17,19,22,0.86)",
                        border: `1px solid rgba(251,80,102,0.45)`,
                        padding: tall ? "16px 20px" : "20px 26px",
                        opacity: topO,
                        transform: topO < 1 ? `translateY(${(1 - topO) * 10}px)` : undefined,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, fontWeight: 600, letterSpacing: "0.14em", color: CORAL }}>
                            × DANGEROUS PATTERN · FLAG ON /deploy
                        </span>
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: CORAL }}>NEVER USED</span>
                    </div>

                    <div
                        style={{
                            marginTop: 12,
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 12,
                            position: "relative",
                        }}
                    >
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: tall ? 18 : 22,
                                color: INK.muted,
                                textDecoration: strike > 0.3 ? "line-through" : "none",
                                textDecorationColor: CORAL,
                                textDecorationThickness: "2px",
                            }}
                        >
                            POST /api/functions/deploy {"{ preview: true }"}
                        </span>
                        <span style={{ fontFamily: FONT.body, fontSize: tall ? 17 : 19, color: "rgba(251,80,102,0.88)" }}>
                            → older server ignores unknown flag &amp; overwrites prod
                        </span>
                    </div>
                </div>

                {/* Bottom: Dedicated fail-safe preview route */}
                <div
                    style={{
                        marginTop: tall ? 18 : 24,
                        borderRadius: RADIUS.xl,
                        background: "rgba(9,10,12,0.9)",
                        border: `1.5px solid rgba(54,204,214,0.65)`,
                        padding: tall ? "20px 20px" : "24px 28px",
                        opacity: botO,
                        transform: botO < 1 ? `translateY(${(1 - botO) * 12}px)` : undefined,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, fontWeight: 600, letterSpacing: "0.14em", color: ACCENT }}>
                            ✓ REBASE CLOUD · DEDICATED PREVIEW ROUTE
                        </span>
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: GREEN }}>FAIL-CLOSED</span>
                    </div>

                    <div
                        style={{
                            marginTop: 16,
                            padding: tall ? "14px 16px" : "16px 20px",
                            borderRadius: RADIUS.lg,
                            background: SURFACE.sheet,
                            border: `1px solid ${SURFACE.hairlineStrong}`,
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                        }}
                    >
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: tall ? 16 : 18,
                                fontWeight: 600,
                                color: GROUND.base,
                                background: ACCENT,
                                padding: "4px 10px",
                                borderRadius: RADIUS.md,
                            }}
                        >
                            POST
                        </span>
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 20 : 25, fontWeight: 600, color: INK.high }}>
                            /api/functions/previews/&lt;id&gt;
                        </span>
                    </div>

                    {/* Arrow + Older control plane response */}
                    <div
                        style={{
                            marginTop: tall ? 16 : 18,
                            display: "flex",
                            flexDirection: tall ? "column" : "row",
                            alignItems: tall ? "stretch" : "center",
                            justifyContent: "space-between",
                            gap: tall ? 12 : 18,
                            padding: tall ? "14px 16px" : "16px 20px",
                            borderRadius: RADIUS.lg,
                            background: "rgba(52,211,153,0.08)",
                            border: `1px solid rgba(52,211,153,0.42)`,
                            opacity: 0.3 + 0.7 * respO,
                            transform: respO < 1 ? `translateY(${(1 - respO) * 8}px)` : undefined,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 17, color: INK.muted }}>
                                older control plane →
                            </span>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 18 : 21,
                                    fontWeight: 600,
                                    color: GROUND.base,
                                    background: AMBER,
                                    padding: "3px 11px",
                                    borderRadius: RADIUS.md,
                                }}
                            >
                                404
                            </span>
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 18 : 21, fontWeight: 600, color: INK.high }}>
                                previews_unavailable
                            </span>
                        </div>

                        <div
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                fontFamily: FONT.mono,
                                fontSize: tall ? 17 : 19,
                                fontWeight: 600,
                                color: GREEN,
                            }}
                        >
                            <span>✓ Nothing deployed</span>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const SAFE_PREVIEWS: FilmSpec = checkFilm({
    id: "safe-previews",
    number: 8,
    title: "Agent previews that cannot touch prod",
    accent: ACCENT,
    endCommand: "rebase cloud deploy --preview",
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "deploy", at: { line: "deploy", plus: -16 }, render: Deploy, roll: 0.24 },
        { id: "isolated", at: { line: "isolated", plus: 0 }, render: Isolated, roll: 0.52, ground: GROUND.deep, reveal: 0.55 },
        { id: "why", at: { line: "why", plus: 0 }, render: Why, roll: 0.16 },
        { id: "guard", at: { line: "guard", plus: 0 }, render: Guard, roll: 0.72, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.45 },
    ],
});
