import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, FRAME, GROUND, INK, PRIMARY_LIGHT, RADIUS, SURFACE, TONE, TRACKING } from "../../theme";
import { At, checkFilm, Headline, lines, useBodyFor, useCue, type FilmSpec } from "../kit";

/**
 * 09 — ONE AGENT-SAFE CLI FOR EVERYTHING.
 *
 * One CLI drives a running Rebase app (data, logs, storage, remote SQL),
 * routes Cloud project calls through the Console Studio Proxy so the service
 * key never enters local memory, stops non-interactive destructive commands
 * with `confirmation_required`, and mints 90-day capability-scoped tokens
 * whose ceiling keeps token management and DB restore with a signed-in human.
 */

const AMBER = "#F59E0B";
const EMERALD = "#34D399";
const CORAL = CHROMA.coral;
const CYAN = CHROMA.cyan;

const SCRIPT = lines([
    ["hook", "Agents are incredible in a terminal right up until a piped script misreads a flag and deletes production."],
    ["reach", "The Rebase CLI drives your whole running app: query rows as JSON or CSV, tail logs, run crons, upload files, or run remote SQL directly."],
    ["proxy", "Target any Cloud project by slug, and requests route through our Studio proxy so your live service key never enters local memory."],
    ["guard", "Pipe a destructive command with no terminal attached, and it stops cold with confirmation-required unless you explicitly approve."],
    ["token", "For CI and background bots, mint a ninety-day token narrowed to deploys and logs, unable to create new keys or overwrite live backups."],
    ["close", "One CLI built for humans at a keyboard and agents in a shell."],
]);

/* ── shared inline icons (clean 1.5-stroke SVGs, zero emojis) ───────── */

const ShieldCheckIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <path
            d="M12 2.8L4.5 5.8v5.5c0 4.9 3.2 9.1 7.5 10.2 4.3-1.1 7.5-5.3 7.5-10.2V5.8L12 2.8z"
            stroke={color}
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path d="M8.8 12.2l2.2 2.2 4.4-4.6" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const LockIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" stroke={color} strokeWidth="1.6" />
        <path d="M8 10.5V7.5a4 4 0 018 0v3" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
);

const TerminalIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <rect x="3" y="4" width="18" height="16" rx="2.5" stroke={color} strokeWidth="1.6" />
        <path d="M7.5 9.5L10.5 12l-3 2.5M12.5 14.5h4" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const ServerIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <rect x="3.5" y="4" width="17" height="6.5" rx="2" stroke={color} strokeWidth="1.6" />
        <rect x="3.5" y="13.5" width="17" height="6.5" rx="2" stroke={color} strokeWidth="1.6" />
        <circle cx="7.5" cy="7.25" r="1" fill={color} />
        <circle cx="7.5" cy="16.75" r="1" fill={color} />
    </svg>
);

const StopOctagonIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <path
            d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3L8.3 3z"
            stroke={color}
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path d="M12 8v5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="16.2" r="1" fill={color} />
    </svg>
);

/* ── scene 1: reach — multi-command terminal cascade ────────────────── */

interface ReachCommand {
    tag: string;
    color: string;
    cmd: string;
    out: string;
}

const REACH_COMMANDS: readonly ReachCommand[] = [
    {
        tag: "DATA",
        color: AMBER,
        cmd: "rebase data query orders --format csv --cloud",
        out: "id,status,total · 1,420 rows streamed (csv)",
    },
    {
        tag: "LOGS",
        color: CYAN,
        cmd: "rebase logs -f --level error --project shop",
        out: "[error] webhook.stripe timeout · pod shop-7f9b · 204ms",
    },
    {
        tag: "STORAGE",
        color: EMERALD,
        cmd: "rebase storage cp ./banner.webp :media/banner.webp",
        out: "✓ uploaded 84 KB through storage policies",
    },
    {
        tag: "SQL",
        color: PRIMARY_LIGHT,
        cmd: 'rebase cloud db query "select count(*) from orders"',
        out: "count: 48219 · tunnel closed (zero local psql)",
    },
];

const Reach: React.FC = () => {
    const frame = useCurrentFrame();
    const headline = "One CLI for the whole app.";
    const { x, y, w, format } = useBodyFor(headline);
    const tall = format === "tall";

    const logsAt = useCue({ line: "reach", word: "tail", plus: -4 }) ?? 9999;
    const storageAt = useCue({ line: "reach", word: "upload", plus: -4 }) ?? 9999;
    const sqlAt = useCue({ line: "reach", word: "SQL", plus: -6 }) ?? 9999;
    const triggers = [2, logsAt, storageAt, sqlAt];

    const shellIn = ramp(frame, 0, 10, ENTER);

    return (
        <>
            <Headline text={headline} at={0} accent={AMBER} mark={["whole", "app."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.well,
                        overflow: "hidden",
                        opacity: shellIn,
                        transform: shellIn < 1 ? `translateY(${(1 - shellIn) * 12}px)` : undefined,
                    }}
                >
                    {/* Terminal chrome */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: tall ? "12px 18px" : "13px 22px",
                            background: SURFACE.sheet,
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {["#F43F5E", "#FBBF24", "#34D399"].map((c) => (
                                <span key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c, opacity: 0.6 }} />
                            ))}
                            <span style={{ marginLeft: 10, fontFamily: FONT.mono, fontSize: tall ? 15 : 16, color: INK.muted }}>
                                zsh · rebase-cli
                            </span>
                        </div>
                        <div
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
                            local • --url • --project • --cloud
                        </div>
                    </div>

                    {/* 4-command cascade */}
                    <div style={{ padding: tall ? "16px 18px" : "18px 24px", display: "flex", flexDirection: "column", gap: tall ? 12 : 13 }}>
                        {REACH_COMMANDS.map((item, i) => {
                            const startAt = triggers[i];
                            const appear = ramp(frame, startAt, 12, ENTER);
                            const nextStart = i < triggers.length - 1 ? triggers[i + 1] : Infinity;
                            const isActive = frame >= startAt && frame < nextStart;
                            const typed = Math.round(ramp(frame, startAt + 2, 18, (t) => t) * item.cmd.length);
                            const outIn = ramp(frame, startAt + 14, 10, ENTER);

                            return (
                                <div
                                    key={item.tag}
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        gap: tall ? 14 : 18,
                                        padding: tall ? "13px 16px" : "14px 20px",
                                        borderRadius: RADIUS.lg,
                                        background: isActive ? "rgba(255,255,255,0.055)" : "rgba(255,255,255,0.02)",
                                        border: `1px solid ${isActive ? `${item.color}66` : SURFACE.hairline}`,
                                        borderLeft: `3px solid ${appear > 0.1 ? item.color : SURFACE.hairline}`,
                                        opacity: 0.16 + 0.84 * appear,
                                        transform: appear < 1 ? `translateY(${(1 - appear) * 8}px)` : undefined,
                                    }}
                                >
                                    <div
                                        style={{
                                            minWidth: tall ? 86 : 96,
                                            textAlign: "center",
                                            padding: "5px 10px",
                                            borderRadius: RADIUS.md,
                                            fontFamily: FONT.mono,
                                            fontWeight: 600,
                                            fontSize: tall ? 14 : 15,
                                            letterSpacing: "0.1em",
                                            color: item.color,
                                            background: `${item.color}18`,
                                            border: `1px solid ${item.color}44`,
                                            marginTop: 2,
                                        }}
                                    >
                                        {item.tag}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 20 : 24,
                                                lineHeight: 1.35,
                                                color: INK.high,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }}
                                        >
                                            <span style={{ color: item.color, marginRight: 10 }}>$</span>
                                            {frame >= startAt ? item.cmd.slice(0, typed) : item.cmd}
                                            {isActive && typed < item.cmd.length && (
                                                <span style={{ color: item.color, marginLeft: 2 }}>▌</span>
                                            )}
                                        </div>
                                        <div
                                            style={{
                                                marginTop: 6,
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 16 : 18,
                                                color: i === 2 ? EMERALD : INK.copy,
                                                opacity: outIn,
                                            }}
                                        >
                                            → {item.out}
                                        </div>
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

/* ── scene 2: proxy — Studio proxy security flow (claim ground) ─────── */

interface ProxyNode {
    step: string;
    title: string;
    pill: string;
    detail: string;
    accent: string;
    icon: React.ReactNode;
}

const Proxy: React.FC = () => {
    const frame = useCurrentFrame();
    const headline = "Service key stays in Cloud.";
    const { x, y, w, format } = useBodyFor(headline);
    const tall = format === "tall";

    const proxyAt = useCue({ line: "proxy", word: "route", plus: -4 }) ?? 9999;
    const runtimeAt = useCue({ line: "proxy", word: "proxy", plus: 2 }) ?? 9999;
    const shieldAt = useCue({ line: "proxy", word: "never", plus: -6 }) ?? 9999;

    const nodes: readonly ProxyNode[] = [
        {
            step: "01",
            title: "CLI (--project shop)",
            pill: "user session · no key",
            detail: "Sends signed command by project slug",
            accent: CYAN,
            icon: <TerminalIcon color={CYAN} size={22} />,
        },
        {
            step: "02",
            title: "Console Studio Proxy",
            pill: "control plane · holds key",
            detail: "Checks org role & attaches service key",
            accent: EMERALD,
            icon: <LockIcon color={EMERALD} size={22} />,
        },
        {
            step: "03",
            title: "App Runtime",
            pill: "shop.rebase.website",
            detail: "Executes request under live policies",
            accent: PRIMARY_LIGHT,
            icon: <ServerIcon color={PRIMARY_LIGHT} size={22} />,
        },
    ];

    const nodeStarts = [0, proxyAt, runtimeAt];
    const arrow1 = ramp(frame, proxyAt - 4, 14, ENTER);
    const arrow2 = ramp(frame, runtimeAt - 4, 14, ENTER);
    const shieldIn = ramp(frame, shieldAt, 14, ENTER);

    return (
        <>
            <Headline text={headline} at={0} accent={EMERALD} mark={["Cloud."]} />
            <At x={x} y={y} w={w}>
                {tall ? (
                    /* Vertical 3-step pipeline for 9:16 */
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {nodes.map((node, i) => {
                            const o = ramp(frame, nodeStarts[i], 12, ENTER);
                            const arrowProg = i === 0 ? arrow1 : arrow2;
                            return (
                                <React.Fragment key={node.step}>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 16,
                                            padding: "18px 22px",
                                            borderRadius: FRAME.radius,
                                            background: i === 1 ? "rgba(9,10,12,0.92)" : "rgba(9,10,12,0.82)",
                                            border: `1.5px solid ${i === 1 ? `${EMERALD}99` : TONE.claim.cardBorder}`,
                                            opacity: 0.25 + 0.75 * o,
                                            transform: o < 1 ? `translateY(${(1 - o) * 10}px)` : undefined,
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                                            <div
                                                style={{
                                                    width: 46,
                                                    height: 46,
                                                    borderRadius: RADIUS.lg,
                                                    background: `${node.accent}1A`,
                                                    border: `1px solid ${node.accent}55`,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                            >
                                                {node.icon}
                                            </div>
                                            <div>
                                                <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 24, color: INK.high }}>
                                                    {node.title}
                                                </div>
                                                <div style={{ fontFamily: FONT.body, fontSize: 18, color: TONE.claim.copy, marginTop: 4 }}>
                                                    {node.detail}
                                                </div>
                                            </div>
                                        </div>
                                        <div
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontSize: 15,
                                                color: node.accent,
                                                padding: "6px 12px",
                                                borderRadius: RADIUS.md,
                                                background: `${node.accent}18`,
                                                border: `1px solid ${node.accent}44`,
                                                whiteSpace: "nowrap",
                                            }}
                                        >
                                            {node.pill}
                                        </div>
                                    </div>
                                    {i < 2 && (
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 10,
                                                height: 28,
                                                opacity: 0.25 + 0.75 * arrowProg,
                                            }}
                                        >
                                            <span style={{ fontFamily: FONT.mono, fontSize: 18, color: EMERALD }}>↓</span>
                                            <span style={{ fontFamily: FONT.mono, fontSize: 15, color: TONE.claim.copy, letterSpacing: "0.08em" }}>
                                                {i === 0 ? "HTTPS · project slug only" : "internal · key injected on control plane"}
                                            </span>
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                ) : (
                    /* Horizontal 3-node security flow for 16:9 */
                    <div style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
                        {nodes.map((node, i) => {
                            const o = ramp(frame, nodeStarts[i], 12, ENTER);
                            const arrowProg = i === 0 ? arrow1 : arrow2;
                            return (
                                <React.Fragment key={node.step}>
                                    <div
                                        style={{
                                            flex: 1,
                                            padding: "24px 24px",
                                            borderRadius: FRAME.radius,
                                            background: i === 1 ? "rgba(9,10,12,0.92)" : "rgba(9,10,12,0.82)",
                                            border: `1.5px solid ${i === 1 ? `${EMERALD}AA` : TONE.claim.cardBorder}`,
                                            display: "flex",
                                            flexDirection: "column",
                                            justifyContent: "space-between",
                                            minHeight: 248,
                                            opacity: 0.25 + 0.75 * o,
                                            transform: o < 1 ? `translateY(${(1 - o) * 12}px)` : undefined,
                                        }}
                                    >
                                        <div>
                                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                                                <div
                                                    style={{
                                                        width: 44,
                                                        height: 44,
                                                        borderRadius: RADIUS.lg,
                                                        background: `${node.accent}1A`,
                                                        border: `1px solid ${node.accent}55`,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                    }}
                                                >
                                                    {node.icon}
                                                </div>
                                                <span style={{ fontFamily: FONT.mono, fontSize: 14, color: TONE.claim.muted, letterSpacing: TRACKING.eyebrow }}>
                                                    STEP {node.step}
                                                </span>
                                            </div>
                                            <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 26, color: INK.high, lineHeight: 1.2 }}>
                                                {node.title}
                                            </div>
                                            <div style={{ fontFamily: FONT.body, fontSize: 19, color: TONE.claim.copy, marginTop: 10, lineHeight: 1.45 }}>
                                                {node.detail}
                                            </div>
                                        </div>
                                        <div
                                            style={{
                                                marginTop: 18,
                                                fontFamily: FONT.mono,
                                                fontSize: 15,
                                                color: node.accent,
                                                padding: "7px 12px",
                                                borderRadius: RADIUS.md,
                                                background: `${node.accent}18`,
                                                border: `1px solid ${node.accent}44`,
                                                alignSelf: "flex-start",
                                            }}
                                        >
                                            {node.pill}
                                        </div>
                                    </div>
                                    {i < 2 && (
                                        <div
                                            style={{
                                                width: 74,
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 8,
                                                opacity: 0.2 + 0.8 * arrowProg,
                                            }}
                                        >
                                            <svg width="58" height="24" viewBox="0 0 58 24" fill="none">
                                                <line
                                                    x1="2"
                                                    y1="12"
                                                    x2="48"
                                                    y2="12"
                                                    stroke={EMERALD}
                                                    strokeWidth="2"
                                                    strokeDasharray="4 4"
                                                />
                                                <path d="M44 6l8 6-8 6" stroke={EMERALD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: TONE.claim.copy }}>
                                                {i === 0 ? "slug" : "key"}
                                            </span>
                                        </div>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </div>
                )}

                {/* Bright emerald shield badge */}
                <div
                    style={{
                        marginTop: tall ? 22 : 30,
                        padding: tall ? "20px 22px" : "22px 28px",
                        borderRadius: FRAME.radius,
                        background: "rgba(9, 26, 20, 0.92)",
                        border: `2px solid ${EMERALD}`,
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        alignItems: tall ? "flex-start" : "center",
                        justifyContent: "space-between",
                        gap: tall ? 12 : 20,
                        opacity: shieldIn,
                        transform: shieldIn < 1 ? `translateY(${(1 - shieldIn) * 14}px)` : undefined,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <div
                            style={{
                                width: 46,
                                height: 46,
                                borderRadius: 99,
                                background: "rgba(52,211,153,0.18)",
                                border: `1.5px solid ${EMERALD}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                            }}
                        >
                            <ShieldCheckIcon color={EMERALD} size={24} />
                        </div>
                        <div>
                            <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 21 : 25, color: INK.high }}>
                                <span style={{ color: EMERALD }}>REBASE_SERVICE_KEY</span> never enters local memory
                            </div>
                            <div style={{ fontFamily: FONT.body, fontSize: tall ? 17 : 19, color: TONE.claim.copy, marginTop: 4 }}>
                                Stays on the control plane · verified against your organization role on every call
                            </div>
                        </div>
                    </div>
                    <div
                        style={{
                            fontFamily: FONT.mono,
                            fontWeight: 600,
                            fontSize: tall ? 16 : 17,
                            color: GROUND.base,
                            background: EMERALD,
                            padding: "8px 16px",
                            borderRadius: 99,
                            whiteSpace: "nowrap",
                        }}
                    >
                        0 secrets on disk
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 3: guard — piped destructive delete blocked ──────────────── */

const Guard: React.FC = () => {
    const frame = useCurrentFrame();
    const headline = "Piped deletes stop cold.";
    const { x, y, w, format } = useBodyFor(headline);
    const tall = format === "tall";

    const slamAt = useCue({ line: "guard", word: "stops", plus: -4 }) ?? 9999;
    const approveAt = useCue({ line: "guard", word: "approve", plus: -8 }) ?? 9999;

    const cmd = `rebase data delete orders --where 'status=="draft"' --json`;
    const shellIn = ramp(frame, 0, 10, ENTER);
    const typed = Math.round(ramp(frame, 2, 24, (t) => t) * cmd.length);
    const metaIn = ramp(frame, 22, 10, ENTER);
    const slam = ramp(frame, slamAt, 10, ENTER);
    const footerIn = ramp(frame, approveAt, 12, ENTER);

    return (
        <>
            <Headline text={headline} at={0} accent={CORAL} mark={["stop", "cold."]} />
            <At x={x} y={y} w={w}>
                {/* Agent shell card */}
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.well,
                        overflow: "hidden",
                        opacity: shellIn,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: tall ? "12px 18px" : "13px 22px",
                            background: SURFACE.sheet,
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <TerminalIcon color={AMBER} size={18} />
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, color: INK.high }}>
                                agent-shell · non-interactive
                            </span>
                        </div>
                        <div style={{ display: "flex", gap: 10 }}>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 14 : 15,
                                    color: AMBER,
                                    padding: "4px 10px",
                                    borderRadius: RADIUS.md,
                                    background: "rgba(245,158,11,0.14)",
                                    border: "1px solid rgba(245,158,11,0.38)",
                                }}
                            >
                                TTY: none (piped)
                            </span>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 14 : 15,
                                    color: INK.copy,
                                    padding: "4px 10px",
                                    borderRadius: RADIUS.md,
                                    background: "rgba(255,255,255,0.05)",
                                    border: `1px solid ${SURFACE.hairline}`,
                                }}
                            >
                                --yes: absent
                            </span>
                        </div>
                    </div>

                    <div style={{ padding: tall ? "18px 20px" : "22px 26px" }}>
                        <div
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: tall ? 21 : 26,
                                lineHeight: 1.5,
                                color: INK.high,
                                wordBreak: "break-word",
                            }}
                        >
                            <span style={{ color: AMBER, marginRight: 12 }}>$</span>
                            {cmd.slice(0, typed)}
                            {typed < cmd.length && <span style={{ color: AMBER, marginLeft: 2 }}>▌</span>}
                        </div>
                        <div
                            style={{
                                marginTop: 12,
                                fontFamily: FONT.mono,
                                fontSize: tall ? 16 : 18,
                                color: INK.muted,
                                opacity: metaIn,
                            }}
                        >
                            • matched 1,204 rows in orders · awaiting interactive confirmation
                        </div>
                    </div>
                </div>

                {/* Coral gate banner */}
                <div
                    style={{
                        marginTop: tall ? 20 : 24,
                        borderRadius: FRAME.radius,
                        background: "rgba(38, 12, 18, 0.94)",
                        border: `2px solid ${CORAL}`,
                        overflow: "hidden",
                        opacity: slam,
                        transform: slam < 1 ? `translateY(${(1 - slam) * 20}px) scale(${0.98 + 0.02 * slam})` : undefined,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: tall ? "13px 18px" : "14px 24px",
                            background: "rgba(251, 80, 102, 0.16)",
                            borderBottom: `1px solid rgba(251, 80, 102, 0.35)`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <StopOctagonIcon color={CORAL} size={22} />
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontWeight: 600,
                                    fontSize: tall ? 16 : 18,
                                    letterSpacing: "0.1em",
                                    color: CORAL,
                                }}
                            >
                                REFUSED · EXIT CODE 1
                            </span>
                        </div>
                        <div
                            style={{
                                fontFamily: FONT.mono,
                                fontWeight: 600,
                                fontSize: tall ? 16 : 18,
                                color: GROUND.base,
                                background: EMERALD,
                                padding: "5px 14px",
                                borderRadius: 99,
                            }}
                        >
                            0 rows deleted
                        </div>
                    </div>

                    <div style={{ padding: tall ? "18px 20px" : "22px 26px", fontFamily: FONT.mono, fontSize: tall ? 21 : 25, lineHeight: 1.55 }}>
                        <div style={{ color: INK.copy }}>{"{"}</div>
                        <div style={{ paddingLeft: 26 }}>
                            <span style={{ color: CYAN }}>&quot;error&quot;</span>
                            <span style={{ color: INK.muted }}>: </span>
                            <span style={{ color: CORAL, fontWeight: 600 }}>&quot;confirmation_required&quot;</span>
                            <span style={{ color: INK.muted }}>,</span>
                        </div>
                        <div style={{ paddingLeft: 26 }}>
                            <span style={{ color: CYAN }}>&quot;hint&quot;</span>
                            <span style={{ color: INK.muted }}>: </span>
                            <span style={{ color: INK.high }}>&quot;pass --yes&quot;</span>
                        </div>
                        <div style={{ color: INK.copy }}>{"}"}</div>
                    </div>
                </div>

                {/* Explicit approval footer */}
                <div
                    style={{
                        marginTop: tall ? 18 : 20,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 14,
                        padding: tall ? "13px 18px" : "14px 22px",
                        borderRadius: RADIUS.lg,
                        background: SURFACE.sheet,
                        border: `1px solid ${SURFACE.hairline}`,
                        opacity: footerIn,
                        transform: footerIn < 1 ? `translateY(${(1 - footerIn) * 8}px)` : undefined,
                    }}
                >
                    <span style={{ fontFamily: FONT.body, fontSize: tall ? 18 : 20, color: INK.copy }}>
                        Destructive writes require an interactive prompt or explicit{" "}
                        <span style={{ fontFamily: FONT.mono, color: INK.high, fontWeight: 600 }}>--yes</span>
                    </span>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, color: EMERALD, whiteSpace: "nowrap" }}>
                        safe by default
                    </span>
                </div>
            </At>
        </>
    );
};

/* ── scene 4: token — scoped 90-day tokens + human-only ceiling ─────── */

interface CapabilityChip {
    name: string;
    allowed: boolean;
    detail: string;
}

const CAPABILITIES: readonly CapabilityChip[] = [
    { name: "deploy", allowed: true, detail: "deploy · --preview · rollbacks" },
    { name: "logs", allowed: true, detail: "runtime logs · cron · metrics" },
    { name: "tokens create", allowed: false, detail: "cannot mint new tokens" },
    { name: "db restore", allowed: false, detail: "cannot overwrite live database" },
];

const Token: React.FC = () => {
    const frame = useCurrentFrame();
    const headline = "Scoped tokens. Hard cap.";
    const { x, y, w, format } = useBodyFor(headline);
    const tall = format === "tall";

    const deployAt = useCue({ line: "token", word: "deploys", plus: -4 }) ?? 9999;
    const logsAt = useCue({ line: "token", word: "logs", plus: -2 }) ?? 9999;
    const keysAt = useCue({ line: "token", word: "keys", plus: -6 }) ?? 9999;
    const backupsAt = useCue({ line: "token", word: "backups", plus: -8 }) ?? 9999;
    const ceilingAt = useCue({ line: "token", word: "overwrite", plus: -4 }) ?? 9999;

    const chipStarts = [deployAt, logsAt, keysAt, backupsAt];
    const cmd = "rebase cloud tokens create --project shop --can deploy,logs --expires-in 90";
    const shellIn = ramp(frame, 0, 10, ENTER);
    const typed = Math.round(ramp(frame, 2, 26, (t) => t) * cmd.length);
    const exportIn = ramp(frame, 24, 10, ENTER);
    const ceilingIn = ramp(frame, ceilingAt, 12, ENTER);

    return (
        <>
            <Headline text={headline} at={0} accent={EMERALD} mark={["Scoped", "tokens."]} />
            <At x={x} y={y} w={w}>
                {/* Token creation terminal */}
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.well,
                        overflow: "hidden",
                        opacity: shellIn,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: tall ? "11px 18px" : "12px 22px",
                            background: SURFACE.sheet,
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {["#F43F5E", "#FBBF24", "#34D399"].map((c) => (
                                <span key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c, opacity: 0.6 }} />
                            ))}
                            <span style={{ marginLeft: 8, fontFamily: FONT.mono, fontSize: tall ? 15 : 16, color: INK.muted }}>
                                zsh · ci / bot token
                            </span>
                        </div>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: tall ? 14 : 15,
                                color: AMBER,
                                padding: "3px 10px",
                                borderRadius: 99,
                                background: "rgba(245,158,11,0.14)",
                                border: "1px solid rgba(245,158,11,0.35)",
                            }}
                        >
                            TTL: 90 days · project: shop
                        </span>
                    </div>
                    <div style={{ padding: tall ? "16px 18px" : "18px 24px" }}>
                        <div
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: tall ? 19 : 23,
                                lineHeight: 1.45,
                                color: INK.high,
                                wordBreak: "break-word",
                            }}
                        >
                            <span style={{ color: EMERALD, marginRight: 10 }}>$</span>
                            {cmd.slice(0, typed)}
                            {typed < cmd.length && <span style={{ color: EMERALD, marginLeft: 2 }}>▌</span>}
                        </div>
                        <div
                            style={{
                                marginTop: 10,
                                fontFamily: FONT.mono,
                                fontSize: tall ? 16 : 18,
                                color: EMERALD,
                                opacity: exportIn,
                            }}
                        >
                            export REBASE_TOKEN=rk_live_shop_90d_••••••••
                        </div>
                    </div>
                </div>

                {/* 4 crisp capability chips */}
                <div
                    style={{
                        marginTop: tall ? 18 : 22,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: tall ? 14 : 18,
                    }}
                >
                    {CAPABILITIES.map((cap, i) => {
                        const o = ramp(frame, chipStarts[i], 12, ENTER);
                        const hue = cap.allowed ? EMERALD : CORAL;
                        return (
                            <div
                                key={cap.name}
                                style={{
                                    padding: tall ? "16px 18px" : "18px 22px",
                                    borderRadius: FRAME.radius,
                                    background: cap.allowed ? "rgba(12, 30, 24, 0.88)" : "rgba(34, 14, 18, 0.88)",
                                    border: `1.5px solid ${hue}`,
                                    opacity: 0.2 + 0.8 * o,
                                    transform: o < 1 ? `translateY(${(1 - o) * 10}px)` : undefined,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                    <div
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontWeight: 600,
                                            fontSize: tall ? 22 : 26,
                                            color: INK.high,
                                        }}
                                    >
                                        {cap.name}{" "}
                                        <span style={{ color: hue }}>{cap.allowed ? "✓" : "×"}</span>
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            fontFamily: FONT.mono,
                                            fontWeight: 600,
                                            fontSize: tall ? 13 : 14,
                                            letterSpacing: "0.08em",
                                            color: cap.allowed ? GROUND.base : hue,
                                            background: cap.allowed ? EMERALD : "rgba(251,80,102,0.16)",
                                            border: cap.allowed ? "none" : `1px solid ${CORAL}66`,
                                            padding: "4px 10px",
                                            borderRadius: 99,
                                        }}
                                    >
                                        {!cap.allowed && <LockIcon color={CORAL} size={13} />}
                                        {cap.allowed ? "ALLOWED" : "LOCKED"}
                                    </div>
                                </div>
                                <div
                                    style={{
                                        marginTop: 8,
                                        fontFamily: FONT.body,
                                        fontSize: tall ? 16 : 18,
                                        color: INK.copy,
                                    }}
                                >
                                    {cap.detail}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Human-only ceiling bar */}
                <div
                    style={{
                        marginTop: tall ? 16 : 20,
                        padding: tall ? "13px 18px" : "14px 22px",
                        borderRadius: RADIUS.lg,
                        background: SURFACE.sheet,
                        border: `1px solid rgba(251,80,102,0.4)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 14,
                        opacity: ceilingIn,
                        transform: ceilingIn < 1 ? `translateY(${(1 - ceilingIn) * 8}px)` : undefined,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <LockIcon color={CORAL} size={20} />
                        <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 18 : 20, color: INK.high }}>
                            Token minting &amp; database restores always stay with a signed-in human
                        </span>
                    </div>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: CORAL, whiteSpace: "nowrap" }}>
                        rebase cloud login
                    </span>
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const ONE_CLI: FilmSpec = checkFilm({
    id: "one-cli",
    number: 9,
    title: "One agent-safe CLI",
    accent: AMBER,
    endCommand: "pnpm dlx @rebasepro/cli init",
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "reach", at: { line: "reach", plus: -16 }, render: Reach, roll: 0.24 },
        { id: "proxy", at: { line: "proxy", plus: 2 }, render: Proxy, roll: 0.58, ground: GROUND.claim, reveal: 0.65 },
        { id: "guard", at: { line: "guard", plus: 2 }, render: Guard, roll: 0.78 },
        { id: "token", at: { line: "token", plus: 2 }, render: Token, roll: 0.36, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.5 },
    ],
});
