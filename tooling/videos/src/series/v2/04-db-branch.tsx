import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { ENTER, ramp, SHIFT } from "../../components/motion";
import { CHROMA, FONT, FRAME, GROUND, INK, RADIUS, SURFACE, TONE } from "../../theme";
import { At, checkFilm, Headline, lines, Log, Prompt, useBodyFor, useCue, useSeries, useStage, Window, type FilmSpec } from "../kit";

/**
 * 04 — SUB-SECOND DATABASE BRANCHES.
 *
 * Before letting an agent run a risky migration or backfill ten thousand rows,
 * clone Postgres in under a second with `rebase db branch create`. Under the
 * hood, `DatabasePoolManager` evicts idle pools and Postgres executes
 * `CREATE DATABASE "rb_<name>" TEMPLATE "<source>";` straight on disk.
 *
 * A persistent bottom git-branch track (`BranchGraphLayer`) runs across every
 * scene: `main (rebase)` stays calm while `rb_agent_backfill` forks off in
 * emerald, absorbs agent writes, diffs cleanly, and merges verified rows back.
 */

const EMERALD = "#34D399";
const AMBER = "#F59E0B";
const CYAN = CHROMA.cyan;

const SCRIPT = lines([
    ["hook", "Before you let an agent run a risky migration or backfill ten thousand rows, clone the database."],
    ["clone", "One CLI command gives you a full copy in under a second, including every table, index, row, and security policy."],
    ["how", "Postgres copies the underlying files straight on disk through native templates right after Rebase evicts idle connection pools."],
    ["wild", "Point your coding agent at that isolated copy and let it go wild while production feels nothing."],
    ["merge", "Inspect every changed record in the terminal diff, then merge back only the row updates that look right."],
    ["close", "Instant database branches without moving your Postgres to a proprietary vendor."],
]);

/* ── persistent bottom branch graph layer ───────────────────────────── */

const BranchGraphLayer: React.FC = () => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const { x, y, w, h, format } = useStage();
    const tall = format === "tall";

    const cloneStart = series.starts[0];
    if (cloneStart === null) return null;

    const howStart = series.starts[1] ?? 99999;
    const wildStart = series.starts[2] ?? 99999;
    const mergeStart = series.starts[3] ?? 99999;
    const mergeWordAt = series.cue({ line: "merge", word: "merge", plus: -2 }) ?? mergeStart + 45;
    const closeAt = series.closeAt ?? 99999;

    const enter = ramp(frame, cloneStart, 12, ENTER);
    const exit = ramp(frame, closeAt, 14, SHIFT);
    const opacity = Math.min(enter, 1 - exit);
    if (opacity <= 0.01) return null;

    const forkP = ramp(frame, cloneStart + 14, 18, ENTER);
    const templateP = ramp(frame, howStart + 6, 16, ENTER);
    const wildP = ramp(frame, wildStart + 4, 34, ENTER);
    const diffP = ramp(frame, mergeStart + 8, 16, ENTER);
    const mergeP = ramp(frame, mergeWordAt, 22, ENTER);

    const barH = tall ? 96 : 100;
    const barY = tall ? y + h - barH - 12 : y + h - barH; // wide: 810..910, tall: 912..1008

    const phaseLabel =
        mergeP > 0.5 ? "MERGED ✓" : diffP > 0.3 ? "DIFFING" : wildP > 0.2 ? "AGENT ISOLATED" : templateP > 0.3 ? "TEMPLATE COPY" : "BRANCH FORKED";
    const phaseColor = mergeP > 0.5 ? EMERALD : wildP > 0.2 && diffP < 0.3 ? AMBER : EMERALD;

    // SVG coordinate space: 920 x 72
    const mainY = 50;
    const branchY = 18;
    const forkStartX = 110;
    const forkEndX = 195;
    const mergeStartX = 720;
    const mergeEndX = 815;

    const branchDashLen = 640;
    const branchDrawn =
        forkP * 115 +
        templateP * 145 +
        wildP * 240 +
        diffP * 140;
    const branchDashOffset = Math.max(0, branchDashLen - branchDrawn);

    const mergeCurveLen = 130;
    const mergeDashOffset = mergeCurveLen * (1 - mergeP);

    const writeDots = [430, 485, 540, 595];

    return (
        <div
            style={{
                position: "absolute",
                left: x,
                top: barY,
                width: w,
                height: barH,
                borderRadius: FRAME.radius,
                border: `1px solid ${SURFACE.hairlineStrong}`,
                background: "rgba(17,19,22,0.94)",
                padding: tall ? "10px 16px" : "12px 24px",
                display: "flex",
                alignItems: "center",
                gap: tall ? 14 : 22,
                opacity,
            }}
        >
            {/* Left legend */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, width: tall ? 156 : 196, flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: EMERALD, opacity: 0.35 + 0.65 * forkP }} />
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 15, color: forkP > 0.2 ? EMERALD : INK.muted, whiteSpace: "nowrap" }}>
                        rb_agent_backfill
                    </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: CYAN }} />
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 15, color: INK.high, whiteSpace: "nowrap" }}>
                        main (rebase)
                    </span>
                </div>
            </div>

            {/* Inline SVG git-style database branch graph */}
            <div style={{ flex: 1, height: 72, minWidth: 0 }}>
                <svg width="100%" height="72" viewBox="0 0 920 72" preserveAspectRatio="none" aria-hidden="true">
                    {/* Main trunk — steady throughout */}
                    <line x1="20" y1={mainY} x2="900" y2={mainY} stroke="rgba(54,204,214,0.38)" strokeWidth="3" strokeLinecap="round" />
                    <circle cx="32" cy={mainY} r="5.5" fill={CYAN} />
                    <circle cx={forkStartX} cy={mainY} r="6" fill={CYAN} />
                    <circle cx="510" cy={mainY} r="4.5" fill="rgba(54,204,214,0.55)" />

                    {/* Fork + branch rail in emerald */}
                    <path
                        d={`M ${forkStartX} ${mainY} C ${forkStartX + 42} ${mainY}, ${forkEndX - 42} ${branchY}, ${forkEndX} ${branchY} L ${mergeStartX} ${branchY}`}
                        fill="none"
                        stroke={EMERALD}
                        strokeWidth="3.2"
                        strokeLinecap="round"
                        strokeDasharray={branchDashLen}
                        strokeDashoffset={branchDashOffset}
                    />

                    {/* Fork node */}
                    <circle cx={forkEndX} cy={branchY} r={5.5 * forkP} fill={EMERALD} />
                    {/* Template copy node */}
                    <circle cx="330" cy={branchY} r={5.5 * templateP} fill={EMERALD} />

                    {/* Agent write pulses along branch */}
                    {writeDots.map((cx, i) => {
                        const dotP = ramp(frame, wildStart + 8 + i * 7, 10, ENTER);
                        const activePulse = wildP > 0 && diffP < 0.5 ? 1 + 0.25 * Math.sin(frame / 4 + i) : 1;
                        return <circle key={cx} cx={cx} cy={branchY} r={5 * dotP * activePulse} fill={AMBER} />;
                    })}

                    {/* Diff checkpoint node */}
                    <circle cx={mergeStartX} cy={branchY} r={6 * diffP} fill={EMERALD} />

                    {/* Merge curve back to main */}
                    <path
                        d={`M ${mergeStartX} ${branchY} C ${mergeStartX + 48} ${branchY}, ${mergeEndX - 44} ${mainY}, ${mergeEndX} ${mainY}`}
                        fill="none"
                        stroke={EMERALD}
                        strokeWidth="3.4"
                        strokeLinecap="round"
                        strokeDasharray={mergeCurveLen}
                        strokeDashoffset={mergeDashOffset}
                    />

                    {/* Final merged commit on main */}
                    <circle cx={mergeEndX} cy={mainY} r={7.5 * mergeP} fill={EMERALD} />
                    <circle cx={mergeEndX} cy={mainY} r={13 * mergeP} fill="none" stroke="rgba(52,211,153,0.4)" strokeWidth="2" />
                </svg>
            </div>

            {/* Right phase badge */}
            <div
                style={{
                    flexShrink: 0,
                    fontFamily: FONT.mono,
                    fontSize: tall ? 13 : 14,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    padding: tall ? "6px 10px" : "7px 14px",
                    borderRadius: RADIUS.md,
                    color: phaseColor,
                    background: phaseColor === AMBER ? "rgba(245,158,11,0.14)" : "rgba(52,211,153,0.14)",
                    border: `1px solid ${phaseColor === AMBER ? "rgba(245,158,11,0.4)" : "rgba(52,211,153,0.4)"}`,
                    whiteSpace: "nowrap",
                }}
            >
                {phaseLabel}
            </div>
        </div>
    );
};

/* ── scenes ─────────────────────────────────────────────────────────── */

/** Sub-second branch creation from the CLI + full fidelity badges. */
const Clone: React.FC = () => {
    const frame = useCurrentFrame();
    const H = "Full database copy in <1s.";
    const { x, y, w, format } = useBodyFor(H);
    const tall = format === "tall";

    const tableCue = useCue({ line: "clone", word: "table,", plus: -4 }) ?? 48;
    const indexCue = useCue({ line: "clone", word: "index,", plus: -4 }) ?? 58;
    const rowCue = useCue({ line: "clone", word: "row,", plus: -4 }) ?? 68;
    const rlsCue = useCue({ line: "clone", word: "security", plus: -4 }) ?? 78;

    const badges = [
        { label: "TABLES", value: "14 copied", at: tableCue },
        { label: "INDEXES", value: "38 intact", at: indexCue },
        { label: "ROWS", value: "420,910", at: rowCue },
        { label: "RLS POLICIES", value: "29 active", at: rlsCue },
    ];

    return (
        <>
            <Headline text={H} at={0} accent={EMERALD} mark={["<1s."]} />
            <At x={x} y={y} w={w}>
                <Window title="zsh" at={0} pad={tall ? "18px 20px" : "22px 28px"}>
                    <Prompt command="rebase db branch create agent_backfill" at={2} size={tall ? 23 : 28} rate={0.42} />
                    <div style={{ height: 10 }} />
                    <Log
                        size={tall ? 20 : 23}
                        lines={[
                            { text: '  Evicting idle pools on "rebase"...', at: 20, color: INK.muted },
                            { text: "  ✓ Branch rb_agent_backfill created in 0.42s", at: 28, color: EMERALD },
                            { text: "  Parent: rebase  ·  Database: rb_agent_backfill", at: 36, color: INK.copy },
                        ]}
                    />
                </Window>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: tall ? "1fr 1fr" : "repeat(4, 1fr)",
                        gap: tall ? 14 : 18,
                        marginTop: tall ? 18 : 24,
                    }}
                >
                    {badges.map((b, i) => {
                        const appear = ramp(frame, 8 + i * 4, 10, ENTER);
                        const lit = ramp(frame, b.at, 10, ENTER);
                        return (
                            <div
                                key={b.label}
                                style={{
                                    borderRadius: RADIUS.xl,
                                    background: lit > 0.4 ? "rgba(52,211,153,0.10)" : SURFACE.sheet,
                                    border: `1.5px solid ${lit > 0.4 ? EMERALD : SURFACE.hairline}`,
                                    padding: tall ? "14px 16px" : "18px 20px",
                                    opacity: appear,
                                    transform: appear < 1 ? `translateY(${(1 - appear) * 10}px)` : undefined,
                                }}
                            >
                                <div style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.14em", color: lit > 0.4 ? EMERALD : INK.muted }}>
                                    {b.label}
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 23 : 26, color: INK.high, marginTop: 6 }}>
                                    {b.value}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </At>
        </>
    );
};

/** Native Postgres template copy + 3-step mechanism on GROUND.claim. */
const How: React.FC = () => {
    const frame = useCurrentFrame();
    const H = "Native Postgres templates.";
    const { x, y, w, format } = useBodyFor(H);
    const tall = format === "tall";

    const diskCue = useCue({ line: "how", word: "disk", plus: -4 }) ?? 28;
    const nativeCue = useCue({ line: "how", word: "native", plus: -4 }) ?? 44;
    const evictsCue = useCue({ line: "how", word: "evicts", plus: -4 }) ?? 72;

    const sqlIn = ramp(frame, 0, 12, ENTER);
    const evictLit = ramp(frame, evictsCue, 12, ENTER);

    const steps = [
        {
            num: "01",
            title: "DatabasePoolManager",
            detail: "Evicts idle pools on source DB",
            at: 4,
            highlight: evictLit > 0.4,
        },
        {
            num: "02",
            title: "Filesystem template copy",
            detail: "Copies data files straight on disk",
            at: Math.min(18, diskCue),
            highlight: ramp(frame, diskCue, 10, ENTER) > 0.4,
        },
        {
            num: "03",
            title: "Full-fidelity database",
            detail: "Isolated schema, rows & RLS",
            at: Math.min(32, nativeCue),
            highlight: ramp(frame, nativeCue, 10, ENTER) > 0.4,
        },
    ];

    return (
        <>
            <Headline text={H} at={0} accent={EMERALD} mark={["templates."]} />
            <At x={x} y={y} w={w}>
                {/* Crisp SQL card */}
                <div
                    style={{
                        borderRadius: FRAME.radius,
                        border: `1.5px solid ${TONE.claim.cardBorder}`,
                        background: SURFACE.well,
                        padding: tall ? "18px 20px" : "24px 30px",
                        opacity: sqlIn,
                        transform: sqlIn < 1 ? `translateY(${(1 - sqlIn) * 12}px)` : undefined,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <span style={{ fontFamily: FONT.mono, fontSize: 14, letterSpacing: "0.14em", color: INK.muted }}>
                            BRANCHSERVICE · POSTGRESQL
                        </span>
                        <span style={{ fontFamily: FONT.mono, fontSize: 14, color: EMERALD }}>
                            Zero SQL dump · Zero reload
                        </span>
                    </div>
                    <div style={{ fontFamily: FONT.mono, fontSize: tall ? 22 : 30, lineHeight: 1.45, color: INK.high, wordBreak: "break-word" }}>
                        <span style={{ color: CYAN }}>CREATE DATABASE</span>{" "}
                        <span style={{ color: EMERALD, fontWeight: 600 }}>&quot;rb_agent_backfill&quot;</span>{" "}
                        <span style={{ color: CYAN }}>TEMPLATE</span>{" "}
                        <span style={{ color: INK.high }}>&quot;rebase&quot;</span>;
                    </div>
                </div>

                {/* 3-step pipeline */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        alignItems: "stretch",
                        gap: tall ? 12 : 16,
                        marginTop: tall ? 18 : 26,
                    }}
                >
                    {steps.map((step, i) => {
                        const o = ramp(frame, step.at, 12, ENTER);
                        return (
                            <React.Fragment key={step.num}>
                                <div
                                    style={{
                                        flex: 1,
                                        borderRadius: RADIUS.xl,
                                        background: SURFACE.sheet,
                                        border: `1.5px solid ${step.highlight ? EMERALD : TONE.claim.cardBorder}`,
                                        padding: tall ? "14px 18px" : "20px 22px",
                                        opacity: o,
                                        transform: o < 1 ? `translateY(${(1 - o) * 10}px)` : undefined,
                                        display: "flex",
                                        flexDirection: tall ? "row" : "column",
                                        alignItems: tall ? "center" : "flex-start",
                                        gap: tall ? 16 : 8,
                                    }}
                                >
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: tall ? 18 : 20,
                                            fontWeight: 600,
                                            color: step.highlight ? GROUND.base : EMERALD,
                                            background: step.highlight ? EMERALD : "rgba(52,211,153,0.14)",
                                            padding: "4px 10px",
                                            borderRadius: RADIUS.md,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {step.num}
                                    </span>
                                    <div>
                                        <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 20 : 22, color: INK.high }}>
                                            {step.title}
                                        </div>
                                        <div style={{ fontFamily: FONT.body, fontSize: tall ? 16 : 17, color: INK.copy, marginTop: 4 }}>
                                            {step.detail}
                                        </div>
                                    </div>
                                </div>
                                {!tall && i < steps.length - 1 && (
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            fontFamily: FONT.mono,
                                            fontSize: 28,
                                            color: TONE.claim.high,
                                            opacity: o,
                                        }}
                                    >
                                        →
                                    </div>
                                )}
                            </React.Fragment>
                        );
                    })}
                </div>
            </At>
        </>
    );
};

/** Split live dashboard: agent hammering `rb_agent_backfill` vs. flat emerald heartbeat on production. */
const Wild: React.FC = () => {
    const frame = useCurrentFrame();
    const H = "Agents go wild. Prod safe.";
    const { x, y, w, format } = useBodyFor(H);
    const tall = format === "tall";

    const wildCue = useCue({ line: "wild", word: "wild", plus: -8 }) ?? 34;
    const prodCue = useCue({ line: "wild", word: "production", plus: -4 }) ?? 56;

    const leftIn = ramp(frame, 0, 12, ENTER);
    const rightIn = ramp(frame, 4, 12, ENTER);
    const writeProgress = ramp(frame, 4, Math.max(46, wildCue + 24), ENTER);
    const writeCount = Math.round(interpolate(writeProgress, [0, 1], [128, 10042]));
    const prodLit = ramp(frame, prodCue, 12, ENTER);

    // Animated jagged sparkline for agent writes
    const sparkPoints = Array.from({ length: 24 }, (_, i) => {
        const px = (i / 23) * 320;
        const active = i / 23 <= 0.25 + 0.75 * writeProgress;
        const amp = active ? 10 + 22 * Math.abs(Math.sin(i * 1.45 + frame * 0.22)) : 2;
        const py = 46 - amp;
        return `${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(" ");

    // Flat calm radar dot sweeping along production baseline
    const radarX = ((frame * 5.5) % 300) + 10;

    return (
        <>
            <Headline text={H} at={0} accent={EMERALD} mark={["Prod", "safe."]} />
            <At x={x} y={y} w={w}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 16 : 24, alignItems: "stretch" }}>
                    {/* Left: Agent hammering the branch */}
                    <div
                        style={{
                            flex: 1.15,
                            borderRadius: FRAME.radius,
                            border: `1.5px solid rgba(245,158,11,0.6)`,
                            background: SURFACE.sheet,
                            padding: tall ? "16px 18px" : "22px 24px",
                            opacity: leftIn,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                        }}
                    >
                        <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span
                                        style={{
                                            width: 9,
                                            height: 9,
                                            borderRadius: 99,
                                            background: AMBER,
                                            opacity: 0.45 + 0.55 * Math.sin(frame / 3),
                                        }}
                                    />
                                    <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 16 : 18, color: INK.high }}>
                                        rb_agent_backfill
                                    </span>
                                </div>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontWeight: 600,
                                        fontSize: tall ? 15 : 17,
                                        color: AMBER,
                                        padding: "4px 10px",
                                        borderRadius: RADIUS.md,
                                        background: "rgba(245,158,11,0.14)",
                                    }}
                                >
                                    {writeCount.toLocaleString()} writes
                                </span>
                            </div>

                            <div
                                style={{
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid ${SURFACE.hairline}`,
                                    padding: tall ? "12px 14px" : "14px 18px",
                                }}
                            >
                                <Log
                                    size={tall ? 16 : 18}
                                    lines={[
                                        { text: "ALTER TABLE orders ADD COLUMN tier text;", at: 2, color: CYAN },
                                        { text: "UPDATE orders SET tier = 'vip' WHERE total > 500;", at: 14, color: AMBER },
                                        { text: "  → 4,218 rows updated", at: 22, color: INK.copy },
                                        { text: "UPDATE orders SET normalized = true;", at: 32, color: AMBER },
                                        { text: "  → 5,824 rows backfilled", at: 42, color: EMERALD },
                                    ]}
                                />
                            </div>
                        </div>

                        {/* Live write activity pulse */}
                        <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                            <span style={{ fontFamily: FONT.mono, fontSize: 13, color: INK.muted }}>WRITE LOAD</span>
                            <svg width={tall ? 260 : 320} height="48" viewBox="0 0 320 48" aria-hidden="true">
                                <line x1="0" y1="45" x2="320" y2="45" stroke={SURFACE.hairline} strokeWidth="1" />
                                <polyline points={sparkPoints} fill="none" stroke={AMBER} strokeWidth="2.4" strokeLinejoin="round" />
                            </svg>
                        </div>
                    </div>

                    {/* Right: Production flatline — completely isolated */}
                    <div
                        style={{
                            flex: 0.85,
                            borderRadius: FRAME.radius,
                            border: `1.5px solid ${prodLit > 0.4 ? EMERALD : "rgba(52,211,153,0.45)"}`,
                            background: SURFACE.sheet,
                            padding: tall ? "16px 18px" : "22px 24px",
                            opacity: rightIn,
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                        }}
                    >
                        <div>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ width: 9, height: 9, borderRadius: 99, background: EMERALD }} />
                                    <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 16 : 18, color: INK.high }}>
                                        production (rebase)
                                    </span>
                                </div>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: 13,
                                        fontWeight: 600,
                                        color: EMERALD,
                                        padding: "4px 10px",
                                        borderRadius: RADIUS.md,
                                        background: "rgba(52,211,153,0.14)",
                                    }}
                                >
                                    ISOLATED
                                </span>
                            </div>

                            {/* Flat emerald heartbeat */}
                            <div
                                style={{
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid ${SURFACE.hairline}`,
                                    padding: tall ? "14px 16px" : "18px 20px",
                                    marginBottom: tall ? 12 : 16,
                                }}
                            >
                                <div style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.12em", color: INK.muted, marginBottom: 10 }}>
                                    AGENT MUTATIONS ON PROD
                                </div>
                                <svg width="100%" height={tall ? 44 : 64} viewBox="0 0 320 56" preserveAspectRatio="none" aria-hidden="true">
                                    <line x1="0" y1="28" x2="320" y2="28" stroke="rgba(52,211,153,0.28)" strokeWidth="2" />
                                    <line x1="0" y1="28" x2={radarX} y2="28" stroke={EMERALD} strokeWidth="2.8" />
                                    <circle cx={radarX} cy="28" r="5" fill={EMERALD} />
                                    <circle cx={radarX} cy="28" r="10" fill="none" stroke="rgba(52,211,153,0.4)" strokeWidth="1.5" />
                                </svg>
                            </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div style={{ padding: tall ? "10px 12px" : "14px 16px", borderRadius: RADIUS.lg, background: SURFACE.well, border: `1px solid ${SURFACE.hairline}` }}>
                                <div style={{ fontFamily: FONT.mono, fontSize: 12, color: INK.muted }}>AGENT WRITES</div>
                                <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 26 : 32, color: EMERALD, marginTop: 4 }}>0</div>
                            </div>
                            <div style={{ padding: tall ? "10px 12px" : "14px 16px", borderRadius: RADIUS.lg, background: SURFACE.well, border: `1px solid ${SURFACE.hairline}` }}>
                                <div style={{ fontFamily: FONT.mono, fontSize: 12, color: INK.muted }}>STATUS</div>
                                <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 20 : 22, color: INK.high, marginTop: 8 }}>untouched</div>
                            </div>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/** Inspect terminal diff and merge verified rows back with fingerprint confirmation. */
const Merge: React.FC = () => {
    const frame = useCurrentFrame();
    const H = "Diff first. Merge clean.";
    const { x, y, w, format } = useBodyFor(H);
    const tall = format === "tall";

    const mergeCue = useCue({ line: "merge", word: "merge", plus: -6 }) ?? 52;
    const rightCue = useCue({ line: "merge", word: "right.", plus: -6 }) ?? 88;
    const cmdSize = tall ? 21 : 26;
    const logSize = tall ? 18 : 22;

    const mergedLit = ramp(frame, rightCue, 12, ENTER);

    return (
        <>
            <Headline text={H} at={0} accent={EMERALD} mark={["Merge", "clean."]} />
            <At x={x} y={y} w={w}>
                <Window title="zsh" at={0} pad={tall ? "16px 18px" : "22px 28px"}>
                    <Prompt command="rebase db branch diff agent_backfill" at={2} size={cmdSize} rate={0.38} />
                    <div style={{ height: 8 }} />
                    <Log
                        size={logSize}
                        lines={[
                            { text: "  public.orders   +42 updated   0 deleted   2 skipped", at: 20, color: INK.high },
                            { text: "  fingerprint     sha256:9f4c…e81a", at: 28, color: INK.muted },
                        ]}
                    />

                    <div style={{ height: tall ? 16 : 20 }} />

                    <Prompt command="rebase db branch merge agent_backfill" at={mergeCue} size={cmdSize} rate={0.38} />
                    <div style={{ height: 8 }} />
                    <Log
                        size={logSize}
                        lines={[
                            { text: "  ✓ Diff fingerprint verified (9f4c…e81a) · single transaction", at: mergeCue + 20, color: INK.copy },
                            { text: '  ✓ Merged 42 verified rows onto "rebase"', at: mergeCue + 28, color: EMERALD },
                        ]}
                    />
                </Window>

                <div style={{ display: "flex", flexWrap: "wrap", gap: tall ? 10 : 14, marginTop: tall ? 16 : 20 }}>
                    {[
                        { label: "+42 updated", color: EMERALD },
                        { label: "2 conflicts skipped", color: AMBER },
                        { label: "Fingerprint locked", color: CYAN },
                        { label: "Standard Postgres", color: mergedLit > 0.4 ? EMERALD : INK.copy },
                    ].map((chip, i) => {
                        const o = ramp(frame, 10 + i * 5, 10, ENTER);
                        return (
                            <span
                                key={chip.label}
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 15 : 17,
                                    padding: "7px 14px",
                                    borderRadius: RADIUS.md,
                                    background: SURFACE.sheet,
                                    border: `1px solid ${SURFACE.hairlineStrong}`,
                                    color: chip.color,
                                    opacity: o,
                                }}
                            >
                                {chip.label}
                            </span>
                        );
                    })}
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const DB_BRANCH: FilmSpec = checkFilm({
    id: "db-branch",
    number: 4,
    title: "Sub-second database branches",
    accent: EMERALD,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    endCommand: "rebase db branch create experiment",
    layer: BranchGraphLayer,
    scenes: [
        { id: "clone", at: { line: "clone", plus: -16 }, render: Clone, roll: 0.28 },
        { id: "how", at: { line: "how", plus: 0 }, render: How, roll: 0.54, ground: GROUND.claim },
        { id: "wild", at: { line: "wild", plus: 0 }, render: Wild, roll: 0.72 },
        { id: "merge", at: { line: "merge", plus: 0 }, render: Merge, roll: 0.36, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.5 },
    ],
});
