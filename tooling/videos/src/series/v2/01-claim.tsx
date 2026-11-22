import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { ENTER, ramp, SHIFT } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, PRIMARY, PRIMARY_LIGHT, RADIUS, SURFACE, TONE, TRACKING } from "../../theme";
import { At, checkFilm, Headline, lines, Log, Prompt, useBodyFor, useCue, Window, type FilmSpec } from "../kit";

/**
 * 01 — ZERO-ACCOUNT AGENT PROVISIONING (`claim`).
 *
 * A coding agent deploys a live backend with Postgres and a public URL before
 * anyone creates an account: `rebase cloud init --claim`. Until claimed, mail
 * ports stay closed, secrets stay redacted, and the stack self-destructs after
 * 72 hours. Clicking the single-use claim link moves the project into an org,
 * revokes the agent's bootstrap token, and rotates `REBASE_SERVICE_KEY` with
 * one clean restart.
 */

const ACCENT = CHROMA.cyan;
const CORAL = CHROMA.coral;
const GREEN = "#34D399";
const AMBER = "#F59E0B";

const SCRIPT = lines([
    ["hook", "My coding agent just deployed a live production backend, and I haven't even created an account yet."],
    ["run", "One Rebase Cloud command spins up Postgres, pushes the schema, and puts the API on a real public address."],
    ["locked", "Until a human claims the project, mail ports remain shut, secrets stay hidden, and the whole stack self-destructs after seventy-two hours."],
    ["handover", "When the app works, my agent hands me a single-use link. I click it, drop the backend into my org, and keep shipping."],
    ["rotate", "Claiming revokes the agent's bootstrap token and rotates the service key behind its back with one clean restart."],
    ["close", "Let agents build at full speed, then take the keys away on Rebase Cloud."],
]);

/* ── inline icons ───────────────────────────────────────────────────── */

const ClockIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
    </svg>
);

const LockIcon: React.FC<{ size: number; color: string; locked: number }> = ({ size, color, locked }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path
            d="M8 11V7a4 4 0 0 1 8 0v4"
            style={{ transform: `translateY(${(1 - locked) * -3}px)` }}
        />
        <circle cx="12" cy="16" r="1.2" fill={color} stroke="none" />
    </svg>
);

const ShieldIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
        <path d="M9 12h6" />
    </svg>
);

const HourglassIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h12M6 21h12" />
        <path d="M7 3v4l5 5 5-5V3" />
        <path d="M7 21v-4l5-5 5 5v4" />
    </svg>
);

const RotateIcon: React.FC<{ size: number; color: string; angle: number }> = ({ size, color, angle }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: `rotate(${angle}deg)` }}
    >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 4v5h-5" />
    </svg>
);

const PointerCursor: React.FC<{ size: number; pressed: number }> = ({ size, pressed }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={INK.high}
        stroke={GROUND.base}
        strokeWidth="1.5"
        style={{ transform: `scale(${1 - pressed * 0.14})` }}
    >
        <path d="M4 3l7.2 17 2.5-6.2L20 11.2 4 3z" />
    </svg>
);

function formatCountdown(frame: number): string {
    const elapsed = Math.min(59, Math.floor(frame / 30));
    const total = 72 * 3600 - elapsed;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/* ── scenes ─────────────────────────────────────────────────────────── */

const RUN_HEADLINE = "Live backend, zero account.";

const Run: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(RUN_HEADLINE);
    const tall = format === "tall";
    const pgAt = useCue({ line: "run", word: "Postgres", plus: -4 }) ?? 9999;
    const schemaAt = useCue({ line: "run", word: "schema", plus: -4 }) ?? 9999;
    const addrAt = useCue({ line: "run", word: "public", plus: -6 }) ?? 9999;
    const urlsO = ramp(frame, addrAt, 12, ENTER);
    const pulse = 0.72 + 0.28 * Math.sin(frame / 7);
    const barO = ramp(frame, 0, 10, ENTER);
    const logSize = tall ? 20 : 23;
    const rowSize = tall ? 19 : 22;

    return (
        <>
            <Headline text={RUN_HEADLINE} at={2} accent={ACCENT} mark={["zero", "account."]} />
            <At x={x} y={y} w={w}>
                <Window title="zsh · ~/shop" at={0} pad={tall ? "20px 22px" : "24px 28px"}>
                    <Prompt command="rebase cloud init --claim" at={2} size={tall ? 23 : 27} rate={0.45} />
                    <div style={{ height: 10 }} />
                    <Log
                        size={logSize}
                        lines={[
                            { text: "  provisioning unclaimed sandbox…", at: 14, color: INK.muted },
                            { text: "  ✓ Dedicated Postgres ready (eu-central)", at: pgAt, color: GREEN },
                            { text: "  ✓ Schema pushed & bundle deployed (3 tables)", at: schemaAt, color: GREEN },
                        ]}
                    />
                    <div
                        style={{
                            marginTop: tall ? 14 : 18,
                            padding: tall ? "14px 16px" : "16px 22px",
                            borderRadius: RADIUS.lg,
                            border: `1px solid ${SURFACE.hairlineStrong}`,
                            borderLeft: `3px solid ${ACCENT}`,
                            background: SURFACE.sheet,
                            opacity: urlsO,
                            transform: urlsO < 1 ? `translateY(${(1 - urlsO) * 10}px)` : undefined,
                            display: "flex",
                            flexDirection: "column",
                            gap: tall ? 8 : 10,
                            fontFamily: FONT.mono,
                            fontSize: rowSize,
                        }}
                    >
                        <div style={{ display: "flex", gap: 16 }}>
                            <span style={{ color: INK.muted, width: tall ? 78 : 88, flexShrink: 0 }}>Live</span>
                            <span style={{ color: ACCENT }}>https://shop-4k9a.rebase.website</span>
                        </div>
                        <div style={{ display: "flex", gap: 16 }}>
                            <span style={{ color: INK.muted, width: tall ? 78 : 88, flexShrink: 0 }}>Admin</span>
                            <span style={{ color: INK.copy }}>https://shop-4k9a.rebase.website/admin</span>
                        </div>
                        <div style={{ display: "flex", gap: 16 }}>
                            <span style={{ color: INK.muted, width: tall ? 78 : 88, flexShrink: 0 }}>Claim</span>
                            <span style={{ color: AMBER }}>https://app.rebase.pro/claim/c_9x82f1…</span>
                        </div>
                    </div>
                </Window>

                <div
                    style={{
                        marginTop: tall ? 16 : 20,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 16,
                        padding: tall ? "12px 18px" : "14px 24px",
                        borderRadius: RADIUS.xl,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.sheet,
                        opacity: barO,
                        transform: barO < 1 ? `translateY(${(1 - barO) * 10}px)` : undefined,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: FONT.mono, fontSize: tall ? 17 : 19, color: INK.copy }}>
                        <span style={{ width: 9, height: 9, borderRadius: 99, background: ACCENT, opacity: pulse }} />
                        <span>.env linked · REBASE_API_TOKEN minted</span>
                    </div>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: tall ? "7px 14px" : "8px 16px",
                            borderRadius: RADIUS.lg,
                            border: `1.5px solid rgba(245,158,11,${0.45 + 0.35 * pulse})`,
                            background: `rgba(245,158,11,${0.1 + 0.08 * pulse})`,
                            fontFamily: FONT.mono,
                            fontWeight: 600,
                            fontSize: tall ? 19 : 21,
                            color: AMBER,
                            flexShrink: 0,
                        }}
                    >
                        <ClockIcon size={tall ? 18 : 20} color={AMBER} />
                        <span>{formatCountdown(frame)}</span>
                    </div>
                </div>
            </At>
        </>
    );
};

const LOCKED_HEADLINE = "Locked down until claimed.";

interface GuardCardSpec {
    eyebrow: string;
    title: string;
    badge: string;
    detail: string;
    accent: string;
    kind: "lock" | "shield" | "ttl";
}

const GUARD_CARDS: readonly GuardCardSpec[] = [
    {
        eyebrow: "OUTBOUND EGRESS",
        title: "SMTP 465 / 587 / 993",
        badge: "CLOSED",
        detail: "Only HTTP 80 & 443 open until claimed",
        accent: CORAL,
        kind: "lock",
    },
    {
        eyebrow: "AGENT TOKEN",
        title: "SECRETS & ENV",
        badge: "REDACTED",
        detail: "Cannot read env values, DB password, or db connect",
        accent: ACCENT,
        kind: "shield",
    },
    {
        eyebrow: "SANDBOX TTL",
        title: "AUTO-DELETE IN 72H",
        badge: "72:00:00",
        detail: "App & Postgres wiped if unclaimed; $0 billed",
        accent: AMBER,
        kind: "ttl",
    },
];

const Locked: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(LOCKED_HEADLINE);
    const tall = format === "tall";
    const tone = TONE.deep;
    const mailAt = useCue({ line: "locked", word: "mail", plus: -4 }) ?? 9999;
    const secretsAt = useCue({ line: "locked", word: "secrets", plus: -4 }) ?? 9999;
    const ttlAt = useCue({ line: "locked", word: "seventy-two", plus: -6 }) ?? 9999;
    const cues = [mailAt, secretsAt, ttlAt];
    const shellO = ramp(frame, 0, 10, ENTER);

    return (
        <>
            <Headline text={LOCKED_HEADLINE} at={2} accent={ACCENT} mark={["Locked", "down"]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: tall ? "1fr" : "repeat(3, 1fr)",
                        gap: tall ? 14 : 22,
                        opacity: shellO,
                        transform: shellO < 1 ? `translateY(${(1 - shellO) * 12}px)` : undefined,
                    }}
                >
                    {GUARD_CARDS.map((card, i) => {
                        const lit = ramp(frame, cues[i], 12, ENTER);
                        const border = lit > 0.5 ? card.accent : tone.cardBorder;
                        const fill = lit > 0.5 ? "rgba(8,9,10,0.42)" : tone.cardFill;
                        const iconColor = lit > 0.5 ? card.accent : tone.high;

                        return (
                            <div
                                key={card.title}
                                style={{
                                    borderRadius: RADIUS.xl,
                                    border: `1.5px solid ${border}`,
                                    background: fill,
                                    padding: tall ? "18px 22px" : "26px 24px",
                                    display: "flex",
                                    flexDirection: tall ? "row" : "column",
                                    alignItems: tall ? "center" : "flex-start",
                                    justifyContent: tall ? "space-between" : "flex-start",
                                    gap: tall ? 18 : 18,
                                    minHeight: tall ? 132 : 340,
                                    transform: lit > 0 && lit < 1 ? `scale(${0.985 + 0.015 * lit})` : undefined,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 14, width: tall ? undefined : "100%", justifyContent: tall ? "flex-start" : "space-between" }}>
                                    <div
                                        style={{
                                            width: tall ? 52 : 58,
                                            height: tall ? 52 : 58,
                                            borderRadius: RADIUS.lg,
                                            border: `1px solid ${lit > 0.5 ? card.accent : tone.cardBorder}`,
                                            background: "rgba(255,255,255,0.08)",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            flexShrink: 0,
                                        }}
                                    >
                                        {card.kind === "lock" && <LockIcon size={28} color={iconColor} locked={lit} />}
                                        {card.kind === "shield" && <ShieldIcon size={28} color={iconColor} />}
                                        {card.kind === "ttl" && <HourglassIcon size={28} color={iconColor} />}
                                    </div>
                                    {!tall && (
                                        <span
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontWeight: 600,
                                                fontSize: 16,
                                                letterSpacing: "0.1em",
                                                padding: "6px 12px",
                                                borderRadius: RADIUS.md,
                                                border: `1.5px solid ${card.accent}`,
                                                color: lit > 0.5 ? GROUND.base : card.accent,
                                                background: lit > 0.5 ? card.accent : "transparent",
                                            }}
                                        >
                                            {card.badge}
                                        </span>
                                    )}
                                </div>

                                <div style={{ flex: 1 }}>
                                    <div
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: tall ? 14 : 15,
                                            letterSpacing: TRACKING.eyebrow,
                                            color: tone.eyebrow,
                                            marginBottom: 6,
                                        }}
                                    >
                                        {card.eyebrow}
                                    </div>
                                    <div
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontWeight: 600,
                                            fontSize: tall ? 24 : 25,
                                            color: tone.high,
                                            lineHeight: 1.25,
                                        }}
                                    >
                                        {card.title}
                                    </div>
                                    <div
                                        style={{
                                            fontFamily: FONT.body,
                                            fontSize: tall ? 19 : 20,
                                            color: tone.copy,
                                            marginTop: tall ? 6 : 12,
                                            lineHeight: 1.4,
                                        }}
                                    >
                                        {card.detail}
                                    </div>
                                </div>

                                {tall && (
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontWeight: 600,
                                            fontSize: 16,
                                            letterSpacing: "0.08em",
                                            padding: "7px 14px",
                                            borderRadius: RADIUS.md,
                                            border: `1.5px solid ${card.accent}`,
                                            color: lit > 0.5 ? GROUND.base : card.accent,
                                            background: lit > 0.5 ? card.accent : "transparent",
                                            flexShrink: 0,
                                        }}
                                    >
                                        {card.badge}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div
                    style={{
                        marginTop: tall ? 16 : 22,
                        padding: tall ? "12px 18px" : "14px 24px",
                        borderRadius: RADIUS.xl,
                        border: `1px solid ${tone.cardBorder}`,
                        background: tone.cardFill,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontFamily: FONT.mono,
                        fontSize: tall ? 16 : 18,
                        color: tone.copy,
                        opacity: shellO,
                    }}
                >
                    <span>UNCLAIMED SANDBOX GUARDRAILS</span>
                    <span style={{ color: tone.high }}>PRE-CLAIM USAGE · $0 BILLED</span>
                </div>
            </At>
        </>
    );
};

const HANDOVER_HEADLINE = "One link moves it to your org.";

const Handover: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(HANDOVER_HEADLINE);
    const tall = format === "tall";
    const clickAt = useCue({ line: "handover", word: "click", plus: -4 }) ?? 9999;
    const orgAt = useCue({ line: "handover", word: "org", plus: -4 }) ?? 9999;

    const enterO = ramp(frame, 0, 10, ENTER);
    const cursorMove = ramp(frame, clickAt - 18, 18, ENTER);
    const pressDown = ramp(frame, clickAt + 2, 4, ENTER) * (1 - ramp(frame, clickAt + 7, 5, SHIFT));
    const claimed = ramp(frame, clickAt + 6, 10, ENTER);
    const settled = ramp(frame, orgAt, 12, ENTER);
    const cursorFade = 1 - ramp(frame, clickAt + 22, 10, SHIFT);

    const statusColor = claimed > 0.5 ? GREEN : AMBER;
    const expiryColor = settled > 0.5 ? GREEN : AMBER;

    return (
        <>
            <Headline text={HANDOVER_HEADLINE} at={2} accent={GREEN} mark={["your", "org."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: RADIUS.xl,
                        border: `1px solid ${claimed > 0.5 ? "rgba(52,211,153,0.45)" : SURFACE.hairlineStrong}`,
                        background: SURFACE.sheet,
                        overflow: "hidden",
                        opacity: enterO,
                        transform: enterO < 1 ? `translateY(${(1 - enterO) * 14}px)` : undefined,
                        position: "relative",
                    }}
                >
                    {/* Browser chrome */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: tall ? "12px 18px" : "14px 22px",
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                            background: SURFACE.well,
                            gap: 14,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {["#F43F5E", "#FBBF24", "#34D399"].map((c) => (
                                <span key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c, opacity: 0.55 }} />
                            ))}
                        </div>
                        <div
                            style={{
                                flex: 1,
                                maxWidth: tall ? 560 : 680,
                                padding: "6px 14px",
                                borderRadius: RADIUS.md,
                                background: SURFACE.card,
                                border: `1px solid ${SURFACE.hairline}`,
                                fontFamily: FONT.mono,
                                fontSize: tall ? 16 : 17,
                                color: INK.copy,
                                textAlign: "center",
                                overflow: "hidden",
                                whiteSpace: "nowrap",
                            }}
                        >
                            https://app.rebase.pro/claim/c_9x82f1
                        </div>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: 14,
                                letterSpacing: "0.08em",
                                color: claimed > 0.5 ? INK.muted : ACCENT,
                            }}
                        >
                            {claimed > 0.5 ? "LINK CONSUMED" : "SINGLE-USE"}
                        </span>
                    </div>

                    {/* Modal body */}
                    <div
                        style={{
                            padding: tall ? "22px 24px" : "28px 32px",
                            display: "grid",
                            gridTemplateColumns: tall ? "1fr" : "1.18fr 0.82fr",
                            gap: tall ? 18 : 28,
                        }}
                    >
                        {/* Left: Claim project panel */}
                        <div style={{ display: "flex", flexDirection: "column", gap: tall ? 14 : 18 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                <div>
                                    <div style={{ fontFamily: FONT.mono, fontSize: 14, letterSpacing: TRACKING.eyebrow, color: INK.muted }}>
                                        REBASE CLOUD · CLAIM PROJECT
                                    </div>
                                    <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 26 : 30, color: INK.high, marginTop: 4 }}>
                                        Claim project <span style={{ fontFamily: FONT.mono, color: ACCENT }}>shop-4k9a</span>
                                    </div>
                                </div>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontWeight: 600,
                                        fontSize: tall ? 15 : 16,
                                        padding: "7px 14px",
                                        borderRadius: RADIUS.md,
                                        border: `1.5px solid ${statusColor}`,
                                        background: claimed > 0.5 ? "rgba(52,211,153,0.16)" : "rgba(245,158,11,0.14)",
                                        color: statusColor,
                                    }}
                                >
                                    {claimed > 0.5 ? "✓ CLAIMED · BILLING ACTIVE" : "• UNCLAIMED"}
                                </span>
                            </div>

                            {/* Target organization selector */}
                            <div
                                style={{
                                    padding: tall ? "14px 18px" : "16px 20px",
                                    borderRadius: RADIUS.lg,
                                    border: `1.5px solid ${settled > 0.5 ? GREEN : SURFACE.hairlineStrong}`,
                                    background: SURFACE.card,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}
                            >
                                <div>
                                    <div style={{ fontFamily: FONT.mono, fontSize: 14, color: INK.muted, letterSpacing: "0.1em" }}>
                                        DESTINATION ORGANIZATION
                                    </div>
                                    <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 22 : 24, color: INK.high, marginTop: 4 }}>
                                        Organization · Acme
                                    </div>
                                </div>
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, color: GREEN }}>
                                    ✓ Card on file
                                </span>
                            </div>

                            {/* Action button with animated cursor */}
                            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 16 }}>
                                <div
                                    style={{
                                        padding: tall ? "14px 26px" : "16px 32px",
                                        borderRadius: RADIUS.lg,
                                        background: claimed > 0.5 ? GREEN : PRIMARY,
                                        color: claimed > 0.5 ? GROUND.base : "#FFFFFF",
                                        fontFamily: FONT.body,
                                        fontWeight: 600,
                                        fontSize: tall ? 21 : 23,
                                        transform: `scale(${1 - pressDown * 0.04})`,
                                    }}
                                >
                                    {claimed > 0.5 ? "✓ Claimed into Acme" : "Claim into Acme →"}
                                </div>
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 17, color: INK.muted }}>
                                    {claimed > 0.5 ? "Mail ports 465 / 587 / 993 opened" : "Signed in as founder@acme.io"}
                                </span>

                                {cursorMove > 0 && cursorFade > 0 && (
                                    <div
                                        style={{
                                            position: "absolute",
                                            left: interpolate(cursorMove, [0, 1], [360, 165]),
                                            top: interpolate(cursorMove, [0, 1], [80, 22]),
                                            opacity: cursorMove * cursorFade,
                                            pointerEvents: "none",
                                        }}
                                    >
                                        {pressDown > 0.1 && (
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    left: -12,
                                                    top: -12,
                                                    width: 32,
                                                    height: 32,
                                                    borderRadius: 99,
                                                    border: `2px solid ${ACCENT}`,
                                                    opacity: pressDown,
                                                }}
                                            />
                                        )}
                                        <PointerCursor size={30} pressed={pressDown} />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right: Token handover status */}
                        <div
                            style={{
                                padding: tall ? "16px 20px" : "22px 24px",
                                borderRadius: RADIUS.lg,
                                border: `1px solid ${settled > 0.5 ? "rgba(52,211,153,0.45)" : SURFACE.hairline}`,
                                background: SURFACE.well,
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                gap: tall ? 12 : 16,
                            }}
                        >
                            <div>
                                <div style={{ fontFamily: FONT.mono, fontSize: 14, letterSpacing: TRACKING.eyebrow, color: INK.muted }}>
                                    APP CREDENTIAL HANDOVER
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 20 : 22, color: INK.high, marginTop: 8 }}>
                                    REBASE_API_TOKEN
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 17, color: INK.copy, marginTop: 4 }}>
                                    rk_live_9a4e…  (.env intact)
                                </div>
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: tall ? "10px 14px" : "12px 16px",
                                    borderRadius: RADIUS.md,
                                    border: `1px solid ${expiryColor}`,
                                    background: settled > 0.5 ? "rgba(52,211,153,0.12)" : "rgba(245,158,11,0.10)",
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 16 : 17,
                                }}
                            >
                                <span style={{ color: INK.copy }}>EXPIRY</span>
                                <span style={{ color: expiryColor, fontWeight: 600 }}>
                                    {settled > 0.5 ? "NO EXPIRY" : "71H 58M LEFT"}
                                </span>
                            </div>

                            <div style={{ fontFamily: FONT.body, fontSize: tall ? 16 : 18, color: INK.muted, lineHeight: 1.4 }}>
                                {settled > 0.5
                                    ? "Prior sandbox usage waived. Production billing starts now."
                                    : "Your .env keeps working seamlessly once claimed."}
                            </div>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

const ROTATE_HEADLINE = "Old keys die on claim.";

const Rotate: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(ROTATE_HEADLINE);
    const tall = format === "tall";
    const revokeAt = useCue({ line: "rotate", word: "revokes", plus: -4 }) ?? 9999;
    const rotateAt = useCue({ line: "rotate", word: "rotates", plus: -4 }) ?? 9999;
    const restartAt = useCue({ line: "rotate", word: "restart", plus: -4 }) ?? 9999;

    const enterO = ramp(frame, 0, 10, ENTER);
    const rev = ramp(frame, revokeAt, 12, ENTER);
    const rot = ramp(frame, rotateAt, 18, ENTER);
    const spinAngle = interpolate(rot, [0, 1], [0, 360]);
    const rest = ramp(frame, restartAt, 12, ENTER);

    return (
        <>
            <Headline text={ROTATE_HEADLINE} at={2} accent={CORAL} mark={["die"]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: tall ? 16 : 20,
                        opacity: enterO,
                        transform: enterO < 1 ? `translateY(${(1 - enterO) * 12}px)` : undefined,
                    }}
                >
                    {/* Lane 1: Agent bootstrap token */}
                    <div
                        style={{
                            borderRadius: RADIUS.xl,
                            border: `1.5px solid ${rev > 0.5 ? "rgba(251,80,102,0.65)" : SURFACE.hairlineStrong}`,
                            background: rev > 0.5 ? "rgba(251,80,102,0.08)" : SURFACE.sheet,
                            padding: tall ? "20px 22px" : "24px 28px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, letterSpacing: TRACKING.eyebrow, color: INK.muted }}>
                                CONTROL PLANE · AGENT BOOTSTRAP TOKEN
                            </div>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontWeight: 600,
                                    fontSize: tall ? 16 : 18,
                                    padding: "6px 14px",
                                    borderRadius: RADIUS.md,
                                    border: `1.5px solid ${rev > 0.5 ? CORAL : SURFACE.hairlineStrong}`,
                                    background: rev > 0.5 ? CORAL : "transparent",
                                    color: rev > 0.5 ? GROUND.base : INK.muted,
                                }}
                            >
                                {rev > 0.5 ? "× REVOKED" : "ACTIVE"}
                            </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                            <div style={{ position: "relative", display: "inline-block" }}>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontWeight: 600,
                                        fontSize: tall ? 24 : 28,
                                        color: rev > 0.5 ? INK.muted : INK.high,
                                    }}
                                >
                                    rb_claim_8f2a9c41e0…
                                </span>
                                <div
                                    style={{
                                        position: "absolute",
                                        left: 0,
                                        top: "52%",
                                        height: 3,
                                        width: `${rev * 100}%`,
                                        background: CORAL,
                                        borderRadius: 2,
                                    }}
                                />
                            </div>
                            <span style={{ fontFamily: FONT.body, fontSize: tall ? 18 : 20, color: rev > 0.5 ? CORAL : INK.copy }}>
                                {rev > 0.5 ? "Session revoked — agent locked out of cloud deploys" : "~/.rebase/credentials.json"}
                            </span>
                        </div>
                    </div>

                    {/* Lane 2: REBASE_SERVICE_KEY rotation */}
                    <div
                        style={{
                            borderRadius: RADIUS.xl,
                            border: `1.5px solid ${rot > 0.5 ? "rgba(52,211,153,0.65)" : SURFACE.hairlineStrong}`,
                            background: rot > 0.5 ? "rgba(52,211,153,0.07)" : SURFACE.sheet,
                            padding: tall ? "20px 22px" : "24px 28px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 14,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <div style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, letterSpacing: TRACKING.eyebrow, color: INK.muted }}>
                                APP ADMIN PLANE · REBASE_SERVICE_KEY
                            </div>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontWeight: 600,
                                    fontSize: tall ? 16 : 18,
                                    padding: "6px 14px",
                                    borderRadius: RADIUS.md,
                                    border: `1.5px solid ${rot > 0.5 ? GREEN : ACCENT}`,
                                    background: rot > 0.5 ? GREEN : "transparent",
                                    color: rot > 0.5 ? GROUND.base : ACCENT,
                                }}
                            >
                                {rot > 0.5 ? "✓ ROTATED" : "ROTATING"}
                            </span>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                flexDirection: tall ? "column" : "row",
                                alignItems: tall ? "stretch" : "center",
                                gap: tall ? 12 : 20,
                            }}
                        >
                            <div
                                style={{
                                    flex: 1,
                                    padding: tall ? "12px 16px" : "14px 20px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid ${SURFACE.hairline}`,
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 20 : 23,
                                    color: rot > 0.4 ? INK.muted : INK.copy,
                                    textDecoration: rot > 0.4 ? "line-through" : "none",
                                }}
                            >
                                rbs_prev_41e9a8…
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: tall ? "100%" : 54,
                                    height: tall ? 36 : 54,
                                }}
                            >
                                <div
                                    style={{
                                        width: 46,
                                        height: 46,
                                        borderRadius: 99,
                                        background: rot > 0.5 ? "rgba(52,211,153,0.16)" : SURFACE.card,
                                        border: `1.5px solid ${rot > 0.5 ? GREEN : SURFACE.hairlineStrong}`,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    <RotateIcon size={24} color={rot > 0.5 ? GREEN : PRIMARY_LIGHT} angle={spinAngle} />
                                </div>
                            </div>

                            <div
                                style={{
                                    flex: 1,
                                    padding: tall ? "12px 16px" : "14px 20px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1.5px solid ${rot > 0.5 ? GREEN : SURFACE.hairline}`,
                                    fontFamily: FONT.mono,
                                    fontWeight: 600,
                                    fontSize: tall ? 20 : 23,
                                    color: GREEN,
                                    opacity: Math.max(0.25, rot),
                                }}
                            >
                                rbs_live_9f3c7d…
                            </div>
                        </div>
                    </div>

                    {/* Footer restart & 401 verification strip */}
                    <div
                        style={{
                            borderRadius: RADIUS.xl,
                            border: `1.5px solid ${rest > 0.5 ? "rgba(52,211,153,0.45)" : SURFACE.hairlineStrong}`,
                            background: SURFACE.sheet,
                            padding: tall ? "14px 20px" : "16px 26px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 16,
                            flexWrap: "wrap",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: FONT.mono, fontSize: tall ? 18 : 20 }}>
                            <span style={{ color: GREEN, fontWeight: 600 }}>✓ 1 restart</span>
                            <span style={{ color: INK.muted }}>•</span>
                            <span style={{ color: INK.copy }}>old agent key rejected (401)</span>
                        </div>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontWeight: 600,
                                fontSize: tall ? 16 : 17,
                                padding: "6px 14px",
                                borderRadius: RADIUS.md,
                                border: `1.5px solid ${CORAL}`,
                                background: `rgba(251,80,102,${0.08 + 0.12 * rest})`,
                                color: CORAL,
                            }}
                        >
                            401 UNAUTHORIZED
                        </span>
                    </div>
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const CLAIM: FilmSpec = checkFilm({
    id: "claim",
    number: 1,
    title: "Zero-account agent provisioning",
    accent: ACCENT,
    endCommand: "rebase cloud init --claim",
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "run", at: { line: "run", plus: -16 }, render: Run, roll: 0.32 },
        { id: "locked", at: { line: "locked", plus: 0 }, render: Locked, roll: 0.56, ground: GROUND.deep, reveal: 0.6 },
        { id: "handover", at: { line: "handover", plus: 0 }, render: Handover, roll: 0.72 },
        { id: "rotate", at: { line: "rotate", plus: 0 }, render: Rotate, roll: 0.16, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.5 },
    ],
});
