import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, FRAME, GROUND, INK, PRIMARY, PRIMARY_LIGHT, RADIUS, SURFACE } from "../../theme";
import { At, checkFilm, Headline, lines, useBodyFor, useCue, type FilmSpec } from "../kit";

/**
 * 10 — BILLED FOR PHYSICS, FIREABLE BEFORE LUNCH.
 *
 * Rebase Cloud (private beta by request at rebase.pro) refuses two dishonest
 * cloud conventions: fake "reserved" tiers on pooled Postgres (the engine has
 * no per-database CPU/RAM quota) and per-seat admin taxes. Every project gets
 * a dedicated CNPG instance (or BYODB), resource dials with itemized pricing
 * and 50 CMS seats at €0.00/mo, one-click `Open CMS` SSO via a 1-minute
 * single-use platform token, upfront cross-boundary latency/egress warnings,
 * and same-day exit with `pg_dump` + `rebase eject` onto the MIT image.
 */

const CORAL = CHROMA.coral;
const EMERALD = "#34D399";
const AMBER = "#F59E0B";
const CYAN = CHROMA.cyan;

const SCRIPT = lines([
    ["hook", "Two habits in cloud pricing need to end: thirty dollars a seat for an admin panel, and reserved compute on databases that can't reserve anything."],
    ["physics", "Postgres has no per-tenant CPU quotas, so a shared cluster can't guarantee you anything. On Rebase Cloud, every project gets a dedicated engine."],
    ["dials", "Set three dials for app, database, and storage, read the itemized price, and invite fifty teammates to Rebase CMS at no extra cost."],
    ["signin", "Owners click Open CMS in the console and land in their panel already signed in, with no bootstrap passwords to set up."],
    ["region", "Put an app in Germany and an external Postgres in Belgium, and the form warns you about latency and double egress up front."],
    ["close", "Because Cloud runs our exact MIT image, a standard dump plus eject moves everything onto your own server the same day."],
]);

/* ── shared inline icons (clean 1.5-stroke SVGs, zero emojis) ───────── */

const DatabaseIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <ellipse cx="12" cy="6" rx="7.5" ry="3" stroke={color} strokeWidth="1.6" />
        <path d="M4.5 6v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6" stroke={color} strokeWidth="1.6" />
        <path d="M4.5 12v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6" stroke={color} strokeWidth="1.6" />
    </svg>
);

const WarningTriangleIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <path
            d="M10.4 4.2L2.8 17.6A1.8 1.8 0 004.4 20.3h15.2a1.8 1.8 0 001.6-2.7L13.6 4.2a1.8 1.8 0 00-3.2 0z"
            stroke={color}
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path d="M12 9.5v4.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1" fill={color} />
    </svg>
);

const KeyTokenIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="8" cy="12" r="4" stroke={color} strokeWidth="1.6" />
        <path d="M12 12h8.5M17.5 12v3.5M20 12v2.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
);

const GlobeNodeIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="1.6" />
        <ellipse cx="12" cy="12" rx="3.8" ry="8.5" stroke={color} strokeWidth="1.4" />
        <path d="M3.8 12h16.4" stroke={color} strokeWidth="1.4" />
    </svg>
);

const CursorIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <path
            d="M5 3.5l13 7.5-5.6 1.8-2.4 5.7L5 3.5z"
            fill={INK.high}
            stroke={GROUND.base}
            strokeWidth="1.4"
            strokeLinejoin="round"
        />
    </svg>
);

/* ── scene 1: physics — pooled fake "reserved" vs dedicated CNPG ────── */

const Physics: React.FC = () => {
    const frame = useCurrentFrame();
    const headline = "Every database is dedicated.";
    const { x, y, w, format } = useBodyFor(headline);
    const tall = format === "tall";

    const strikeAt = useCue({ line: "physics", word: "can't", plus: -4 }) ?? 9999;
    const dedicatedAt = useCue({ line: "physics", word: "dedicated", plus: -6 }) ?? 9999;

    const leftIn = ramp(frame, 0, 10, ENTER);
    const strike = ramp(frame, strikeAt, 12, ENTER);
    const rightIn = ramp(frame, Math.min(8, dedicatedAt), 12, ENTER);
    const rightLit = ramp(frame, dedicatedAt, 14, ENTER);

    return (
        <>
            <Headline text={headline} at={0} accent={EMERALD} mark={["dedicated."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: tall ? "1fr" : "1fr 1fr",
                        gap: tall ? 18 : 26,
                    }}
                >
                    {/* Left card: Pooled "Reserved" Postgres (crossed out in coral) */}
                    <div
                        style={{
                            position: "relative",
                            padding: tall ? "20px 22px" : "26px 28px",
                            borderRadius: FRAME.radius,
                            background: "rgba(28, 13, 17, 0.88)",
                            border: `1.5px solid ${strike > 0.2 ? CORAL : SURFACE.hairlineStrong}`,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: tall ? 14 : 20,
                            opacity: leftIn,
                            transform: leftIn < 1 ? `translateY(${(1 - leftIn) * 10}px)` : undefined,
                        }}
                    >
                        <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 14 : 15,
                                        letterSpacing: "0.12em",
                                        color: INK.muted,
                                    }}
                                >
                                    POOLED CLUSTER
                                </span>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontWeight: 600,
                                        fontSize: tall ? 14 : 15,
                                        color: CORAL,
                                        padding: "4px 12px",
                                        borderRadius: 99,
                                        background: "rgba(251,80,102,0.16)",
                                        border: `1px solid ${CORAL}66`,
                                        opacity: 0.35 + 0.65 * strike,
                                    }}
                                >
                                    × PROMISE ENGINE CANNOT KEEP
                                </span>
                            </div>

                            <div
                                style={{
                                    marginTop: tall ? 12 : 16,
                                    fontFamily: FONT.body,
                                    fontWeight: 600,
                                    fontSize: tall ? 26 : 30,
                                    color: INK.high,
                                    position: "relative",
                                    display: "inline-block",
                                }}
                            >
                                <span>Pooled </span>
                                <span style={{ color: CORAL, position: "relative", display: "inline-block" }}>
                                    &quot;Reserved&quot;
                                    <span
                                        style={{
                                            position: "absolute",
                                            left: -4,
                                            right: -4,
                                            top: "52%",
                                            height: 3,
                                            background: CORAL,
                                            transformOrigin: "left center",
                                            transform: `scaleX(${strike}) rotate(-2deg)`,
                                        }}
                                    />
                                </span>
                                <span> Postgres</span>
                            </div>

                            {/* Noisy-neighbor shared CPU bar */}
                            <div
                                style={{
                                    marginTop: tall ? 14 : 20,
                                    padding: tall ? "12px 14px" : "14px 16px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid ${SURFACE.hairline}`,
                                }}
                            >
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: INK.muted, marginBottom: 10 }}>
                                    1 SHARED ENGINE · 4 TENANTS COMPETING FOR CPU/RAM
                                </div>
                                <div style={{ display: "flex", gap: 6, height: tall ? 24 : 28 }}>
                                    {[
                                        { label: "tenant_a", flex: 2.3, bg: "rgba(251,80,102,0.42)" },
                                        { label: "tenant_b", flex: 1.8, bg: "rgba(251,80,102,0.28)" },
                                        { label: "tenant_c", flex: 1.5, bg: "rgba(255,255,255,0.12)" },
                                        { label: "you", flex: 0.9, bg: "rgba(245,158,11,0.35)" },
                                    ].map((seg) => (
                                        <div
                                            key={seg.label}
                                            style={{
                                                flex: seg.flex,
                                                borderRadius: RADIUS.md,
                                                background: seg.bg,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 13 : 14,
                                                color: INK.high,
                                                overflow: "hidden",
                                            }}
                                        >
                                            {seg.label}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div
                            style={{
                                padding: tall ? "13px 16px" : "15px 18px",
                                borderRadius: RADIUS.lg,
                                background: "rgba(251,80,102,0.13)",
                                border: `1px solid rgba(251,80,102,0.45)`,
                            }}
                        >
                            <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 17 : 19, color: CORAL }}>
                                PostgreSQL has no per-db CPU/RAM quota
                            </div>
                            <div style={{ fontFamily: FONT.body, fontSize: tall ? 15 : 17, color: INK.copy, marginTop: 4 }}>
                                Only connection limits &amp; timeouts — nothing reserved.
                            </div>
                        </div>
                    </div>

                    {/* Right card: Rebase Cloud · Dedicated CNPG Instance */}
                    <div
                        style={{
                            padding: tall ? "20px 22px" : "26px 28px",
                            borderRadius: FRAME.radius,
                            background: rightLit > 0.3 ? "rgba(10, 28, 22, 0.92)" : SURFACE.sheet,
                            border: `2px solid ${rightLit > 0.2 ? EMERALD : SURFACE.hairlineStrong}`,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: tall ? 14 : 20,
                            opacity: 0.4 + 0.6 * rightIn,
                            transform: rightIn < 1 ? `translateY(${(1 - rightIn) * 10}px)` : undefined,
                        }}
                    >
                        <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 14 : 15,
                                        letterSpacing: "0.12em",
                                        color: EMERALD,
                                    }}
                                >
                                    REBASE CLOUD
                                </span>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontWeight: 600,
                                        fontSize: tall ? 14 : 15,
                                        color: GROUND.base,
                                        background: EMERALD,
                                        padding: "4px 12px",
                                        borderRadius: 99,
                                        opacity: 0.35 + 0.65 * rightLit,
                                    }}
                                >
                                    ✓ ISOLATED ENGINE
                                </span>
                            </div>

                            <div
                                style={{
                                    marginTop: tall ? 12 : 16,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                }}
                            >
                                <DatabaseIcon color={EMERALD} size={tall ? 26 : 30} />
                                <span
                                    style={{
                                        fontFamily: FONT.body,
                                        fontWeight: 600,
                                        fontSize: tall ? 26 : 30,
                                        color: INK.high,
                                    }}
                                >
                                    Dedicated CNPG Instance
                                </span>
                            </div>

                            {/* Dedicated single-tenant box */}
                            <div
                                style={{
                                    marginTop: tall ? 14 : 20,
                                    padding: tall ? "12px 14px" : "14px 16px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid rgba(52,211,153,0.4)`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                }}
                            >
                                <div>
                                    <div style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 17, fontWeight: 600, color: EMERALD }}>
                                        your_project · CloudNativePG pod
                                    </div>
                                    <div style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: INK.copy, marginTop: 4 }}>
                                        100% own CPU • own RAM • own NVMe disk
                                    </div>
                                </div>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontWeight: 600,
                                        fontSize: tall ? 15 : 16,
                                        color: CYAN,
                                        padding: "6px 12px",
                                        borderRadius: RADIUS.md,
                                        background: "rgba(54,204,214,0.14)",
                                        border: `1px solid rgba(54,204,214,0.45)`,
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    or BYODB
                                </span>
                            </div>
                        </div>

                        <div
                            style={{
                                padding: tall ? "13px 16px" : "15px 18px",
                                borderRadius: RADIUS.lg,
                                background: "rgba(52,211,153,0.12)",
                                border: `1px solid rgba(52,211,153,0.45)`,
                            }}
                        >
                            <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 17 : 19, color: EMERALD }}>
                                Dedicated Postgres per project — or bring your own
                            </div>
                            <div style={{ fontFamily: FONT.body, fontSize: tall ? 15 : 17, color: INK.copy, marginTop: 4 }}>
                                Real hardware boundaries. Zero shared-pool throttling.
                            </div>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 2: dials — Create Project hardware dials + 50 CMS seats €0 ─ */

interface DialRow {
    label: string;
    spec: string;
    tenancy: string;
    unitNote: string;
    fill: number;
    color: string;
}

const DIALS: readonly DialRow[] = [
    {
        label: "App",
        spec: "1 vCPU / 1 GiB",
        tenancy: "reserved · Guaranteed QoS",
        unitNote: "itemized compute",
        fill: 0.44,
        color: PRIMARY_LIGHT,
    },
    {
        label: "Database",
        spec: "10 GiB dedicated",
        tenancy: "dedicated · CNPG instance",
        unitNote: "itemized storage + ram",
        fill: 0.34,
        color: CYAN,
    },
    {
        label: "Storage",
        spec: "dedicated bucket",
        tenancy: "dedicated · S3-compatible",
        unitNote: "€0 standing · usage only",
        fill: 0.28,
        color: EMERALD,
    },
];

const Dials: React.FC = () => {
    const frame = useCurrentFrame();
    const headline = "Pay for resources, not seats.";
    const { x, y, w, format } = useBodyFor(headline);
    const tall = format === "tall";

    const appAt = useCue({ line: "dials", word: "app", plus: -6 }) ?? 9999;
    const dbAt = useCue({ line: "dials", word: "database", plus: -4 }) ?? 9999;
    const storageAt = useCue({ line: "dials", word: "storage", plus: -4 }) ?? 9999;
    const priceAt = useCue({ line: "dials", word: "itemized", plus: -4 }) ?? 9999;
    const seatsAt = useCue({ line: "dials", word: "fifty", plus: -4 }) ?? 9999;

    const dialStarts = [Math.min(4, appAt), dbAt, storageAt];
    const cardIn = ramp(frame, 0, 10, ENTER);
    const priceIn = ramp(frame, priceAt, 12, ENTER);
    const seatsIn = ramp(frame, seatsAt, 14, ENTER);

    return (
        <>
            <Headline text={headline} at={0} accent={EMERALD} mark={["not", "seats."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.sheet,
                        overflow: "hidden",
                        opacity: cardIn,
                    }}
                >
                    {/* Console header bar */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: tall ? "12px 18px" : "13px 24px",
                            background: SURFACE.well,
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 99, background: EMERALD }} />
                            <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 18 : 19, color: INK.high }}>
                                Create Project
                            </span>
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: INK.muted }}>
                                · Rebase Cloud
                            </span>
                        </div>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: tall ? 14 : 15,
                                color: INK.copy,
                                padding: "4px 12px",
                                borderRadius: 99,
                                background: "rgba(255,255,255,0.05)",
                                border: `1px solid ${SURFACE.hairline}`,
                            }}
                        >
                            Hetzner · Falkenstein (DE)
                        </span>
                    </div>

                    {/* Body: dials + itemized summary */}
                    <div
                        style={{
                            padding: tall ? "16px 18px" : "22px 24px",
                            display: "grid",
                            gridTemplateColumns: tall ? "1fr" : "1.32fr 0.92fr",
                            gap: tall ? 16 : 24,
                            alignItems: "stretch",
                        }}
                    >
                        {/* 3 resource dials */}
                        <div style={{ display: "flex", flexDirection: "column", gap: tall ? 12 : 16 }}>
                            {DIALS.map((d, i) => {
                                const sweep = ramp(frame, dialStarts[i], 16, ENTER);
                                const pct = Math.round((0.12 + (d.fill - 0.12) * sweep) * 100);
                                return (
                                    <div
                                        key={d.label}
                                        style={{
                                            padding: tall ? "13px 16px" : "16px 20px",
                                            borderRadius: RADIUS.lg,
                                            background: SURFACE.well,
                                            border: `1px solid ${sweep > 0.2 ? `${d.color}66` : SURFACE.hairline}`,
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                                            <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 20 : 22, color: INK.high }}>
                                                {d.label}
                                                <span style={{ color: INK.muted, margin: "0 8px" }}>·</span>
                                                <span style={{ fontFamily: FONT.mono, color: d.color, fontSize: tall ? 19 : 21 }}>
                                                    {d.spec}
                                                </span>
                                            </div>
                                            <span
                                                style={{
                                                    fontFamily: FONT.mono,
                                                    fontSize: tall ? 13 : 14,
                                                    color: INK.copy,
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {d.tenancy}
                                            </span>
                                        </div>

                                        {/* Slider track with ticks and thumb */}
                                        <div style={{ marginTop: tall ? 12 : 14, position: "relative", height: 14, display: "flex", alignItems: "center" }}>
                                            <div
                                                style={{
                                                    width: "100%",
                                                    height: 6,
                                                    borderRadius: 99,
                                                    background: "rgba(255,255,255,0.10)",
                                                    overflow: "hidden",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: `${pct}%`,
                                                        height: "100%",
                                                        borderRadius: 99,
                                                        background: d.color,
                                                    }}
                                                />
                                            </div>
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    left: `calc(${pct}% - 9px)`,
                                                    width: 18,
                                                    height: 18,
                                                    borderRadius: 99,
                                                    background: INK.high,
                                                    border: `3px solid ${d.color}`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Itemized breakdown + 50 CMS seats badge */}
                        <div
                            style={{
                                padding: tall ? "16px 18px" : "20px 22px",
                                borderRadius: RADIUS.lg,
                                background: SURFACE.well,
                                border: `1px solid ${SURFACE.hairlineStrong}`,
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                gap: tall ? 14 : 18,
                            }}
                        >
                            <div>
                                <div
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 13 : 14,
                                        letterSpacing: "0.14em",
                                        color: INK.muted,
                                        marginBottom: tall ? 10 : 14,
                                    }}
                                >
                                    ITEMIZED BREAKDOWN
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: tall ? 8 : 11, opacity: 0.35 + 0.65 * priceIn }}>
                                    {DIALS.map((d) => (
                                        <div
                                            key={d.label}
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "space-between",
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 15 : 17,
                                            }}
                                        >
                                            <span style={{ color: INK.copy }}>
                                                {d.label} ({d.spec})
                                            </span>
                                            <span style={{ color: INK.high }}>{d.unitNote}</span>
                                        </div>
                                    ))}
                                    <div style={{ height: 1, background: SURFACE.hairline, margin: "4px 0" }} />
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            fontFamily: FONT.mono,
                                            fontSize: tall ? 16 : 18,
                                        }}
                                    >
                                        <span style={{ color: EMERALD }}>Rebase CMS &amp; Studio</span>
                                        <span style={{ color: EMERALD, fontWeight: 600 }}>€0.00 / seat</span>
                                    </div>
                                </div>
                            </div>

                            {/* Big emerald badge */}
                            <div
                                style={{
                                    padding: tall ? "14px 18px" : "18px 20px",
                                    borderRadius: RADIUS.lg,
                                    background: "rgba(12, 34, 26, 0.96)",
                                    border: `2px solid ${EMERALD}`,
                                    opacity: 0.25 + 0.75 * seatsIn,
                                    transform: seatsIn < 1 ? `translateY(${(1 - seatsIn) * 10}px)` : undefined,
                                }}
                            >
                                <div
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontWeight: 600,
                                        fontSize: tall ? 24 : 26,
                                        color: EMERALD,
                                        lineHeight: 1.2,
                                    }}
                                >
                                    50 CMS seats · €0.00 / mo
                                </div>
                                <div style={{ fontFamily: FONT.body, fontSize: tall ? 15 : 17, color: INK.copy, marginTop: 6 }}>
                                    Invite your whole ops team — billed for hardware only.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 3: signin — Open CMS one-click SSO ───────────────────────── */

const SignIn: React.FC = () => {
    const frame = useCurrentFrame();
    const headline = "One click into your CMS.";
    const { x, y, w, format } = useBodyFor(headline);
    const tall = format === "tall";

    const clickAt = useCue({ line: "signin", word: "Open", plus: -2 }) ?? 9999;
    const landAt = useCue({ line: "signin", word: "land", plus: -4 }) ?? 9999;
    const zeroAt = useCue({ line: "signin", word: "bootstrap", plus: -6 }) ?? 9999;

    const topIn = ramp(frame, 0, 10, ENTER);
    const clickProg = ramp(frame, clickAt, 10, ENTER);
    const pressed = frame >= clickAt + 4 && frame < clickAt + 14;
    const tokenIn = ramp(frame, clickAt + 8, 12, ENTER);
    const cmsIn = ramp(frame, landAt, 14, ENTER);
    const zeroIn = ramp(frame, zeroAt, 12, ENTER);

    return (
        <>
            <Headline text={headline} at={0} accent={CYAN} mark={["One", "click"]} />
            <At x={x} y={y} w={w}>
                {/* 1. Rebase Cloud console project top bar (quiet monochrome chrome) */}
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        background: SURFACE.sheet,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        padding: tall ? "14px 18px" : "16px 24px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                        opacity: topIn,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div
                            style={{
                                width: 6,
                                height: 6,
                                borderRadius: 99,
                                background: EMERALD,
                                flexShrink: 0,
                            }}
                        />
                        <div>
                            <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 19 : 21, color: INK.high }}>
                                acme / shop
                            </div>
                            <div style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: INK.muted, marginTop: 2 }}>
                                app.rebase.pro · owner@acme.dev
                            </div>
                        </div>
                    </div>

                    {/* Primary #0070F4 Open CMS button with animated click */}
                    <div style={{ position: "relative" }}>
                        <div
                            style={{
                                fontFamily: FONT.body,
                                fontWeight: 600,
                                fontSize: tall ? 18 : 20,
                                color: "#FFFFFF",
                                background: PRIMARY,
                                padding: tall ? "10px 20px" : "11px 24px",
                                borderRadius: RADIUS.lg,
                                border: `1px solid ${clickProg > 0.2 ? PRIMARY_LIGHT : PRIMARY}`,
                                transform: pressed ? "scale(0.95)" : undefined,
                                whiteSpace: "nowrap",
                            }}
                        >
                            Open CMS →
                        </div>
                        {/* Cursor arriving on button */}
                        <div
                            style={{
                                position: "absolute",
                                right: -10,
                                bottom: -14,
                                opacity: clickProg,
                                transform: `translate(${(1 - clickProg) * 28}px, ${(1 - clickProg) * 22}px)`,
                            }}
                        >
                            <CursorIcon size={26} />
                        </div>
                    </div>
                </div>

                {/* 2. Platform token exchange strip */}
                <div
                    style={{
                        marginTop: tall ? 11 : 13,
                        marginBottom: tall ? 11 : 13,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 12,
                        opacity: 0.25 + 0.75 * tokenIn,
                        transform: tokenIn < 1 ? `translateY(${(1 - tokenIn) * 8}px)` : undefined,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            justifyContent: "center",
                            gap: tall ? 10 : 14,
                            padding: tall ? "9px 16px" : "9px 20px",
                            borderRadius: 99,
                            background: SURFACE.well,
                            border: `1px solid ${SURFACE.hairlineStrong}`,
                        }}
                    >
                        <KeyTokenIcon color={CYAN} size={18} />
                        <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 15 : 16, color: CYAN }}>
                            POST /api/auth/platform-signin
                        </span>
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: INK.copy }}>
                            • 1-min single-use token • auth:admin-signin
                        </span>
                    </div>
                </div>

                {/* 3. Rebase CMS window signed in as admin (quiet monochrome chrome) */}
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        background: SURFACE.sheet,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        overflow: "hidden",
                        opacity: 0.25 + 0.75 * cmsIn,
                        transform: cmsIn < 1 ? `translateY(${(1 - cmsIn) * 14}px)` : undefined,
                    }}
                >
                    {/* CMS top bar */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: tall ? "11px 18px" : "12px 22px",
                            background: SURFACE.well,
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 99, background: EMERALD, flexShrink: 0 }} />
                            <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 17 : 18, color: INK.high }}>
                                Rebase CMS
                            </span>
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: INK.muted }}>
                                shop.rebase.website/admin
                            </span>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "4px 12px",
                                borderRadius: 99,
                                background: SURFACE.sheet,
                                border: `1px solid rgba(52,211,153,0.45)`,
                                fontFamily: FONT.mono,
                                fontWeight: 600,
                                fontSize: tall ? 13 : 14,
                                color: EMERALD,
                            }}
                        >
                            <span>✓</span>
                            <span>admin · owner@acme.dev</span>
                        </div>
                    </div>

                    {/* Mini CMS workspace body */}
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: tall ? "164px 1fr" : "220px 1fr",
                            minHeight: tall ? 182 : 182,
                        }}
                    >
                        <div
                            style={{
                                padding: tall ? "12px 12px" : "14px 16px",
                                borderRight: `1px solid ${SURFACE.hairline}`,
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                            }}
                        >
                            {["Orders", "Customers", "Products", "Studio"].map((item, idx) => (
                                <div
                                    key={item}
                                    style={{
                                        padding: "7px 12px",
                                        borderRadius: RADIUS.md,
                                        background: idx === 0 ? "rgba(255,255,255,0.07)" : "transparent",
                                        border: idx === 0 ? `1px solid ${SURFACE.hairline}` : "1px solid transparent",
                                        color: idx === 0 ? INK.high : INK.copy,
                                        fontFamily: FONT.body,
                                        fontWeight: idx === 0 ? 600 : 400,
                                        fontSize: tall ? 15 : 16,
                                    }}
                                >
                                    {item}
                                </div>
                            ))}
                        </div>

                        <div
                            style={{
                                padding: tall ? "14px 16px" : "16px 22px",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                gap: 12,
                            }}
                        >
                            <div>
                                <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 19 : 21, color: INK.high }}>
                                    Orders · live production table
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: INK.copy, marginTop: 8 }}>
                                    ord_9412 · paid · €148.00 · Falkenstein CNPG
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: INK.muted, marginTop: 4 }}>
                                    ord_9411 · shipped · €64.00 · Falkenstein CNPG
                                </div>
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    flexWrap: "wrap",
                                    gap: 10,
                                    padding: tall ? "9px 14px" : "10px 16px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid rgba(52,211,153,0.42)`,
                                    opacity: 0.25 + 0.75 * zeroIn,
                                }}
                            >
                                <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 16 : 18, color: EMERALD }}>
                                    0 bootstrap passwords
                                </span>
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: INK.copy }}>
                                    no REBASE_ADMIN_PASSWORD env var
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 4. Auto-link deploy summary footer */}
                <div
                    style={{
                        marginTop: tall ? 12 : 14,
                        padding: tall ? "10px 16px" : "11px 20px",
                        borderRadius: RADIUS.lg,
                        background: SURFACE.well,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        alignItems: tall ? "flex-start" : "center",
                        justifyContent: "space-between",
                        gap: tall ? 4 : 14,
                        opacity: 0.35 + 0.65 * zeroIn,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: PRIMARY_LIGHT, flexShrink: 0 }} />
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: INK.high }}>
                            rebase cloud deploy
                        </span>
                        <span style={{ fontFamily: FONT.body, fontSize: tall ? 14 : 15, color: INK.muted }}>
                            auto-links / creates project &amp; prints
                        </span>
                    </div>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: PRIMARY_LIGHT }}>
                        &lt;console&gt;/projects/&lt;id&gt;?open=admin
                    </span>
                </div>
            </At>
        </>
    );
};

/* ── scene 4: region — cross-boundary warning + same-day eject exit ─── */

const Region: React.FC = () => {
    const frame = useCurrentFrame();
    const headline = "Honest physics. Easy exit.";
    const { x, y, w, format } = useBodyFor(headline);
    const tall = format === "tall";

    const warnAt = useCue({ line: "region", word: "warns", plus: -4 }) ?? 9999;
    const exitAt = useCue({ line: "region", word: "egress", plus: -8 }) ?? 9999;

    const mapIn = ramp(frame, 0, 10, ENTER);
    const warnIn = ramp(frame, warnAt, 12, ENTER);
    const exitIn = ramp(frame, exitAt, 14, ENTER);

    /* Animated packet dot traveling smoothly along the dotted public-internet arc */
    const travel = ((frame % 54) / 54);
    const dotX = 24 + travel * 192;
    const dotY = 44 - Math.sin(travel * Math.PI) * 28;

    return (
        <>
            <Headline text={headline} at={0} accent={AMBER} mark={["Honest", "Easy"]} />
            <At x={x} y={y} w={w}>
                {/* 1. European placement card with dotted amber public-internet arc */}
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.sheet,
                        padding: tall ? "18px 20px" : "22px 28px",
                        opacity: mapIn,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: tall ? 14 : 16,
                        }}
                    >
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, letterSpacing: "0.14em", color: INK.muted }}>
                            PLACEMENT · EUROPE TOPOLOGY
                        </span>
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: AMBER }}>
                            cross-provider link detected
                        </span>
                    </div>

                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: tall ? "1fr 160px 1fr" : "1fr 240px 1fr",
                            alignItems: "center",
                            gap: tall ? 8 : 16,
                        }}
                    >
                        {/* Left node: App Falkenstein */}
                        <div
                            style={{
                                padding: tall ? "14px 16px" : "16px 20px",
                                borderRadius: RADIUS.lg,
                                background: SURFACE.well,
                                border: `1px solid ${PRIMARY_LIGHT}66`,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <GlobeNodeIcon color={PRIMARY_LIGHT} size={20} />
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: PRIMARY_LIGHT }}>
                                    APP · HETZNER
                                </span>
                            </div>
                            <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 21 : 24, color: INK.high, marginTop: 8 }}>
                                Falkenstein, DE
                            </div>
                        </div>

                        {/* Dotted amber public-internet arc */}
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                            <svg
                                width={tall ? 154 : 230}
                                height={60}
                                viewBox="0 0 240 60"
                                fill="none"
                                style={{ overflow: "visible" }}
                            >
                                <path
                                    d="M24 44 Q120 -12 216 44"
                                    stroke={AMBER}
                                    strokeWidth="2.4"
                                    strokeDasharray="6 6"
                                    fill="none"
                                />
                                <circle cx="24" cy="44" r="4.5" fill={PRIMARY_LIGHT} />
                                <circle cx="216" cy="44" r="4.5" fill={AMBER} />
                                <circle cx={dotX} cy={dotY} r="5.5" fill={AMBER} />
                            </svg>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontWeight: 600,
                                    fontSize: tall ? 13 : 14,
                                    color: AMBER,
                                    letterSpacing: "0.08em",
                                }}
                            >
                                ↔ PUBLIC INTERNET
                            </span>
                        </div>

                        {/* Right node: External DB Belgium */}
                        <div
                            style={{
                                padding: tall ? "14px 16px" : "16px 20px",
                                borderRadius: RADIUS.lg,
                                background: SURFACE.well,
                                border: `1px solid ${AMBER}77`,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <DatabaseIcon color={AMBER} size={20} />
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: AMBER }}>
                                    EXTERNAL DB · BYODB
                                </span>
                            </div>
                            <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 21 : 24, color: INK.high, marginTop: 8 }}>
                                Belgium
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Console crossBoundaryWarning banner */}
                <div
                    style={{
                        marginTop: tall ? 16 : 18,
                        borderRadius: FRAME.radius,
                        background: "rgba(38, 26, 8, 0.94)",
                        border: `2px solid ${AMBER}`,
                        padding: tall ? "16px 20px" : "18px 24px",
                        opacity: 0.25 + 0.75 * warnIn,
                        transform: warnIn < 1 ? `translateY(${(1 - warnIn) * 12}px)` : undefined,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <WarningTriangleIcon color={AMBER} size={22} />
                            <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 17 : 19, color: AMBER }}>
                                crossBoundaryWarning
                            </span>
                        </div>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontWeight: 600,
                                fontSize: tall ? 13 : 14,
                                color: GROUND.base,
                                background: AMBER,
                                padding: "4px 12px",
                                borderRadius: 99,
                                whiteSpace: "nowrap",
                            }}
                        >
                            WARNED BEFORE SAVING
                        </span>
                    </div>
                    <div
                        style={{
                            marginTop: 10,
                            fontFamily: FONT.body,
                            fontWeight: 600,
                            fontSize: tall ? 19 : 22,
                            lineHeight: 1.4,
                            color: INK.high,
                        }}
                    >
                        Public internet round trips · tens of ms latency · double egress billed — warned BEFORE saving
                    </div>
                </div>

                {/* 3. Bottom exit strip: pg_dump + rebase eject -> MIT image */}
                <div
                    style={{
                        marginTop: tall ? 16 : 18,
                        borderRadius: FRAME.radius,
                        background: "rgba(10, 28, 22, 0.92)",
                        border: `1.5px solid ${EMERALD}`,
                        padding: tall ? "15px 20px" : "16px 24px",
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        alignItems: tall ? "flex-start" : "center",
                        justifyContent: "space-between",
                        gap: tall ? 10 : 18,
                        opacity: 0.25 + 0.75 * exitIn,
                        transform: exitIn < 1 ? `translateY(${(1 - exitIn) * 10}px)` : undefined,
                    }}
                >
                    <div>
                        <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 19 : 21, color: INK.high }}>
                            <span style={{ color: EMERALD }}>pg_dump</span> +{" "}
                            <span style={{ color: CYAN }}>rebase eject</span> → MIT image on your own box
                        </div>
                        <div style={{ fontFamily: FONT.body, fontSize: tall ? 15 : 17, color: INK.copy, marginTop: 4 }}>
                            Same-day exit · Rebase Cloud private beta by request at rebase.pro
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {["Dockerfile", "docker-compose.yml", "MIT"].map((chip) => (
                            <span
                                key={chip}
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 14 : 15,
                                    color: EMERALD,
                                    padding: "5px 10px",
                                    borderRadius: RADIUS.md,
                                    background: "rgba(52,211,153,0.14)",
                                    border: `1px solid rgba(52,211,153,0.4)`,
                                }}
                            >
                                {chip}
                            </span>
                        ))}
                    </div>
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const HONEST_CLOUD: FilmSpec = checkFilm({
    id: "honest-cloud",
    number: 10,
    title: "Billed for physics",
    accent: CORAL,
    endCommand: null,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "physics", at: { line: "physics", plus: -16 }, render: Physics, roll: 0.22 },
        { id: "dials", at: { line: "dials", plus: 2 }, render: Dials, roll: 0.48 },
        { id: "signin", at: { line: "signin", plus: 2 }, render: SignIn, roll: 0.72 },
        { id: "region", at: { line: "region", plus: 2 }, render: Region, roll: 0.34, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.5 },
    ],
});
