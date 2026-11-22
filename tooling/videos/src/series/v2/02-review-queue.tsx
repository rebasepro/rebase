import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { ENTER, ramp, SHIFT } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, PRIMARY, RADIUS, SURFACE, TONE, TRACKING } from "../../theme";
import { At, checkFilm, Editor, Headline, lines, useBodyFor, useCue, type FilmSpec } from "../kit";

/**
 * 02 — AGENTS PROPOSE, HUMANS APPROVE (`review-queue`).
 *
 * `@rebasepro/plugin-review` removes direct `data:write` scopes from runtime
 * agents. Agents only hold `functions:invoke:review`, routing proposals into
 * `rebase.staged_changes` where regular end-user roles cannot read them. Ops
 * inspects the cell-level diff (`diffStagedChange`) in the admin panel and
 * clicks Approve — applying the mutation inside a single Postgres transaction
 * under the human reviewer's own row-level security.
 */

const ACCENT = "#F59E0B";
const GREEN = "#34D399";
const CORAL = CHROMA.coral;
const CYAN = CHROMA.cyan;

const SCRIPT = lines([
    ["hook", "Giving a support agent direct write access to your orders table is how you wake up to four hundred accidental refunds."],
    ["stage", "With the Rebase review plugin, agents never hold write scopes. Instead, their key can only propose changes."],
    ["hold", "Every insert, update, or delete lands in a staged table that regular users cannot even see."],
    ["diff", "Your ops team opens the admin panel, checks a cell-level diff of what the bot wants to edit, and clicks approve."],
    ["apply", "Postgres runs that mutation inside one transaction under the human reviewer's own row-level security."],
    ["close", "Agents do the legwork, people make the call, on self-hosted Rebase or Rebase Cloud."],
]);

const REVIEW_CONFIG_CODE = `import type { ReviewConfig } from "@rebasepro/plugin-review/config";

export const review: ReviewConfig = {
  collections: {
    orders: {
      mode: "staged-table",
      agentRoles: ["agent"],
      reviewerRoles: ["ops"],
    },
  },
};`;

/* ── inline icons ───────────────────────────────────────────────────── */

const KeyIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="12" r="4" />
        <path d="M12 12h9M17 12v4M20 12v3" />
    </svg>
);

const ShieldCheckIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
    </svg>
);

const EyeOffIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3l18 18" />
        <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M9.9 5.1A10.4 10.4 0 0 1 12 5c5 0 9 4 10 7a13 13 0 0 1-3 4.3" />
        <path d="M6.6 6.6A13.6 13.6 0 0 0 2 12c1 3 5 7 10 7 1.6 0 3.1-.4 4.4-1" />
    </svg>
);

const DatabaseIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
        <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
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

/* ── scenes ─────────────────────────────────────────────────────────── */

const STAGE_HEADLINE = "Agents propose, never write.";

const Stage: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(STAGE_HEADLINE);
    const tall = format === "tall";
    const neverAt = useCue({ line: "stage", word: "never", plus: -4 }) ?? 9999;
    const proposeAt = useCue({ line: "stage", word: "propose", plus: -4 }) ?? 9999;

    const enterO = ramp(frame, 0, 10, ENTER);
    const strike = ramp(frame, neverAt, 12, ENTER);
    const allow = ramp(frame, proposeAt, 12, ENTER);

    return (
        <>
            <Headline text={STAGE_HEADLINE} at={2} accent={ACCENT} mark={["propose,"]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: tall ? "1fr" : "490px 1fr",
                        gap: tall ? 16 : 24,
                        alignItems: "stretch",
                        opacity: enterO,
                        transform: enterO < 1 ? `translateY(${(1 - enterO) * 12}px)` : undefined,
                    }}
                >
                    {/* Split credential comparison card */}
                    <div
                        style={{
                            borderRadius: RADIUS.xl,
                            border: `1px solid ${SURFACE.hairlineStrong}`,
                            background: SURFACE.sheet,
                            padding: tall ? "18px 20px" : "24px 24px",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            gap: tall ? 14 : 18,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <KeyIcon size={20} color={ACCENT} />
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, letterSpacing: TRACKING.eyebrow, color: INK.muted }}>
                                    AGENT KEY SCOPES
                                </span>
                            </div>
                            <span style={{ fontFamily: FONT.mono, fontSize: 15, color: INK.copy }}>rk_live_7c2…</span>
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: tall ? "1fr 1fr" : "1fr",
                                gap: tall ? 14 : 16,
                                flex: 1,
                            }}
                        >
                            {/* Forbidden write scope */}
                            <div
                                style={{
                                    borderRadius: RADIUS.lg,
                                    border: `1.5px solid ${strike > 0.4 ? "rgba(251,80,102,0.65)" : SURFACE.hairline}`,
                                    background: strike > 0.4 ? "rgba(251,80,102,0.08)" : SURFACE.well,
                                    padding: tall ? "14px 16px" : "18px 20px",
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: "space-between",
                                    gap: 10,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                    <span style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.1em", color: CORAL }}>
                                        DIRECT WRITE
                                    </span>
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontWeight: 600,
                                            fontSize: 14,
                                            padding: "3px 10px",
                                            borderRadius: RADIUS.md,
                                            background: strike > 0.4 ? CORAL : "transparent",
                                            border: `1px solid ${CORAL}`,
                                            color: strike > 0.4 ? GROUND.base : CORAL,
                                        }}
                                    >
                                        × REMOVED
                                    </span>
                                </div>
                                <div style={{ position: "relative", display: "inline-block", alignSelf: "flex-start" }}>
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontWeight: 600,
                                            fontSize: tall ? 20 : 24,
                                            color: strike > 0.4 ? INK.muted : INK.high,
                                        }}
                                    >
                                        data:write:orders
                                    </span>
                                    <div
                                        style={{
                                            position: "absolute",
                                            left: 0,
                                            top: "52%",
                                            height: 3,
                                            width: `${strike * 100}%`,
                                            background: CORAL,
                                            borderRadius: 2,
                                        }}
                                    />
                                </div>
                                <div style={{ fontFamily: FONT.body, fontSize: tall ? 15 : 17, color: INK.muted }}>
                                    No direct table mutation allowed
                                </div>
                            </div>

                            {/* Allowed review proposal scope */}
                            <div
                                style={{
                                    borderRadius: RADIUS.lg,
                                    border: `1.5px solid ${allow > 0.4 ? GREEN : SURFACE.hairline}`,
                                    background: allow > 0.4 ? "rgba(52,211,153,0.10)" : SURFACE.well,
                                    padding: tall ? "14px 16px" : "18px 20px",
                                    display: "flex",
                                    flexDirection: "column",
                                    justifyContent: "space-between",
                                    gap: 10,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                    <span style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.1em", color: GREEN }}>
                                        PROPOSE ONLY
                                    </span>
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontWeight: 600,
                                            fontSize: 14,
                                            padding: "3px 10px",
                                            borderRadius: RADIUS.md,
                                            background: allow > 0.4 ? GREEN : "transparent",
                                            border: `1px solid ${GREEN}`,
                                            color: allow > 0.4 ? GROUND.base : GREEN,
                                        }}
                                    >
                                        ✓ GRANTED
                                    </span>
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 20 : 24, color: allow > 0.4 ? GREEN : INK.high }}>
                                    functions:invoke:review
                                </div>
                                <div style={{ fontFamily: FONT.body, fontSize: tall ? 15 : 17, color: allow > 0.4 ? INK.copy : INK.muted }}>
                                    Routes changes to review queue
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Real ReviewConfig editor */}
                    <Editor
                        file="backend/review.ts"
                        code={REVIEW_CONFIG_CODE}
                        size={tall ? 18 : 21}
                        at={2}
                        step={1.5}
                        accent={ACCENT}
                    />
                </div>
            </At>
        </>
    );
};

const HOLD_HEADLINE = "Staged out of reach of users.";

const Hold: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(HOLD_HEADLINE);
    const tall = format === "tall";
    const stagedAt = useCue({ line: "hold", word: "staged", plus: -4 }) ?? 9999;
    const hiddenAt = useCue({ line: "hold", word: "regular", plus: -4 }) ?? 9999;

    const enterO = ramp(frame, 0, 10, ENTER);
    const staged = ramp(frame, stagedAt, 14, ENTER);
    const hidden = ramp(frame, hiddenAt, 12, ENTER);
    const travel = (frame % 48) / 48;

    const agentCard = (
        <div
            style={{
                borderRadius: RADIUS.xl,
                border: `1.5px solid ${SURFACE.hairlineStrong}`,
                background: SURFACE.sheet,
                padding: tall ? "16px 20px" : "24px 24px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: tall ? 10 : 16,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 20 : 22, color: INK.high }}>
                    support-agent
                </span>
                <span
                    style={{
                        fontFamily: FONT.mono,
                        fontSize: 15,
                        padding: "4px 10px",
                        borderRadius: RADIUS.md,
                        background: SURFACE.well,
                        border: `1px solid ${SURFACE.hairline}`,
                        color: INK.copy,
                    }}
                >
                    rk_live_7c2…
                </span>
            </div>

            <div
                style={{
                    padding: tall ? "10px 14px" : "14px 16px",
                    borderRadius: RADIUS.lg,
                    background: SURFACE.well,
                    border: `1px solid ${SURFACE.hairline}`,
                    fontFamily: FONT.mono,
                    fontSize: tall ? 17 : 18,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                }}
            >
                <div>
                    <span style={{ color: ACCENT, fontWeight: 600 }}>PATCH</span>{" "}
                    <span style={{ color: INK.high }}>/api/functions/review</span>
                </div>
                <div style={{ color: INK.copy, fontSize: tall ? 15 : 16 }}>
                    {`{ collection: "orders", id: 1042, status: "refunded" }`}
                </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(["INSERT", "UPDATE", "DELETE"] as const).map((op) => {
                    const active = op === "UPDATE";
                    return (
                        <span
                            key={op}
                            style={{
                                fontFamily: FONT.mono,
                                fontWeight: 600,
                                fontSize: 14,
                                padding: "5px 11px",
                                borderRadius: RADIUS.md,
                                border: `1px solid ${active ? ACCENT : SURFACE.hairline}`,
                                background: active ? "rgba(245,158,11,0.16)" : SURFACE.well,
                                color: active ? ACCENT : INK.muted,
                            }}
                        >
                            {op}
                        </span>
                    );
                })}
            </div>
        </div>
    );

    const connector = tall ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 64 }}>
            <svg width={520} height={64} viewBox="0 0 520 64" fill="none">
                {/* Active route down-left to staged_changes */}
                <path d="M 260 4 L 260 28 L 130 28 L 130 58" stroke={ACCENT} strokeWidth="2.5" />
                <polygon points="124,52 136,52 130,62" fill={ACCENT} />
                <circle
                    cx={travel < 0.35 ? 260 : travel < 0.75 ? interpolate(travel, [0.35, 0.75], [260, 130]) : 130}
                    cy={travel < 0.35 ? interpolate(travel, [0, 0.35], [6, 28]) : travel < 0.75 ? 28 : interpolate(travel, [0.75, 1], [28, 56])}
                    r="5"
                    fill={ACCENT}
                />
                {/* Blocked route down-right to public.orders */}
                <path d="M 260 28 L 390 28 L 390 56" stroke={CORAL} strokeWidth="2" strokeDasharray="6 6" opacity={0.75} />
                <circle cx="325" cy="28" r="10" fill={GROUND.base} stroke={CORAL} strokeWidth="2" />
                <path d="M 321 24 L 329 32 M 329 24 L 321 32" stroke={CORAL} strokeWidth="2" strokeLinecap="round" />
            </svg>
        </div>
    ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width={150} height={360} viewBox="0 0 150 360" fill="none">
                {/* Active route to staged_changes (top right) */}
                <path d="M 4 180 L 66 180 L 66 92 L 140 92" stroke={ACCENT} strokeWidth="2.5" />
                <polygon points="134,86 146,92 134,98" fill={ACCENT} />
                <circle
                    cx={travel < 0.35 ? interpolate(travel, [0, 0.35], [8, 66]) : travel < 0.65 ? 66 : interpolate(travel, [0.65, 1], [66, 136])}
                    cy={travel < 0.35 ? 180 : travel < 0.65 ? interpolate(travel, [0.35, 0.65], [180, 92]) : 92}
                    r="5.5"
                    fill={ACCENT}
                />
                {/* Blocked route to public.orders (bottom right) */}
                <path d="M 66 180 L 66 272 L 138 272" stroke={CORAL} strokeWidth="2" strokeDasharray="6 6" opacity={0.75} />
                <circle cx="96" cy="272" r="12" fill={GROUND.base} stroke={CORAL} strokeWidth="2" />
                <path d="M 91 267 L 101 277 M 101 267 L 91 277" stroke={CORAL} strokeWidth="2" strokeLinecap="round" />
            </svg>
        </div>
    );

    const stagedTable = (
        <div
            style={{
                borderRadius: RADIUS.xl,
                border: `1.5px solid ${staged > 0.3 ? ACCENT : SURFACE.hairlineStrong}`,
                background: staged > 0.3 ? "rgba(245,158,11,0.08)" : SURFACE.sheet,
                padding: tall ? "16px 20px" : "22px 26px",
                display: "flex",
                flexDirection: "column",
                gap: tall ? 10 : 12,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <DatabaseIcon size={20} color={ACCENT} />
                    <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 20 : 23, color: INK.high }}>
                        rebase.staged_changes
                    </span>
                </div>
                <span
                    style={{
                        fontFamily: FONT.mono,
                        fontWeight: 600,
                        fontSize: 15,
                        padding: "5px 12px",
                        borderRadius: RADIUS.md,
                        border: `1.5px solid ${ACCENT}`,
                        background: staged > 0.3 ? ACCENT : "transparent",
                        color: staged > 0.3 ? GROUND.base : ACCENT,
                    }}
                >
                    PENDING · 1 ROW
                </span>
            </div>

            <div
                style={{
                    padding: tall ? "10px 14px" : "12px 16px",
                    borderRadius: RADIUS.lg,
                    background: SURFACE.well,
                    border: `1px solid ${SURFACE.hairline}`,
                    fontFamily: FONT.mono,
                    fontSize: tall ? 16 : 18,
                    color: INK.copy,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                }}
            >
                <span>
                    <span style={{ color: ACCENT }}>UPDATE</span> orders #1042
                </span>
                <span style={{ color: INK.high }}>status → "refunded"</span>
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontFamily: FONT.mono,
                    fontSize: tall ? 15 : 16,
                    color: hidden > 0.4 ? CYAN : INK.muted,
                }}
            >
                <EyeOffIcon size={18} color={hidden > 0.4 ? CYAN : INK.muted} />
                <span>OWNER SCHEMA ONLY · END-USER ROLES CANNOT READ</span>
            </div>
        </div>
    );

    const liveTable = (
        <div
            style={{
                borderRadius: RADIUS.xl,
                border: `1.5px solid rgba(52,211,153,0.45)`,
                background: SURFACE.sheet,
                padding: tall ? "16px 20px" : "22px 26px",
                display: "flex",
                flexDirection: "column",
                gap: tall ? 10 : 12,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <ShieldCheckIcon size={21} color={GREEN} />
                    <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 20 : 23, color: INK.high }}>
                        public.orders
                    </span>
                </div>
                <span
                    style={{
                        fontFamily: FONT.mono,
                        fontWeight: 600,
                        fontSize: 15,
                        padding: "5px 12px",
                        borderRadius: RADIUS.md,
                        border: `1.5px solid ${GREEN}`,
                        background: "rgba(52,211,153,0.14)",
                        color: GREEN,
                    }}
                >
                    ✓ UNTOUCHED · 0 ROWS MUTATED
                </span>
            </div>

            <div
                style={{
                    padding: tall ? "10px 14px" : "12px 16px",
                    borderRadius: RADIUS.lg,
                    background: SURFACE.well,
                    border: `1px solid ${SURFACE.hairline}`,
                    fontFamily: FONT.mono,
                    fontSize: tall ? 16 : 18,
                    color: INK.copy,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                }}
            >
                <span>#1042 · acme_buyer</span>
                <span>
                    status: <span style={{ color: GREEN }}>"paid"</span> · refund: <span style={{ color: INK.high }}>€0.00</span>
                </span>
            </div>
        </div>
    );

    return (
        <>
            <Headline text={HOLD_HEADLINE} at={2} accent={ACCENT} mark={["Staged"]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: tall ? "flex" : "grid",
                        flexDirection: tall ? "column" : undefined,
                        gridTemplateColumns: tall ? undefined : "400px 150px 1fr",
                        alignItems: tall ? "stretch" : "center",
                        opacity: enterO,
                        transform: enterO < 1 ? `translateY(${(1 - enterO) * 12}px)` : undefined,
                    }}
                >
                    {agentCard}
                    {connector}
                    <div style={{ display: "flex", flexDirection: "column", gap: tall ? 14 : 20 }}>
                        {stagedTable}
                        {liveTable}
                    </div>
                </div>
            </At>
        </>
    );
};

const DIFF_HEADLINE = "Inspect the diff. Click approve.";

interface DiffRow {
    field: string;
    before: string;
    proposed: string;
}

const DIFF_ROWS: readonly DiffRow[] = [
    { field: "status", before: "paid", proposed: "refunded" },
    { field: "refund_amount", before: "€0.00", proposed: "€149.00" },
];

const Diff: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(DIFF_HEADLINE);
    const tall = format === "tall";
    const tone = TONE.claim;
    const diffAt = useCue({ line: "diff", word: "diff", plus: -4 }) ?? 9999;
    const approveAt = useCue({ line: "diff", word: "approve", plus: -4 }) ?? 9999;

    const enterO = ramp(frame, 0, 10, ENTER);
    const diffLit = ramp(frame, diffAt, 12, ENTER);
    const cursorMove = ramp(frame, approveAt - 18, 18, ENTER);
    const pressDown = ramp(frame, approveAt + 1, 4, ENTER) * (1 - ramp(frame, approveAt + 6, 5, SHIFT));
    const approved = ramp(frame, approveAt + 4, 10, ENTER);
    const cursorFade = 1 - ramp(frame, approveAt + 22, 10, SHIFT);

    return (
        <>
            <Headline text={DIFF_HEADLINE} at={2} accent={GREEN} mark={["approve."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: RADIUS.xl,
                        border: `1.5px solid ${approved > 0.5 ? GREEN : tone.cardBorder}`,
                        background: SURFACE.sheet,
                        overflow: "hidden",
                        opacity: enterO,
                        transform: enterO < 1 ? `translateY(${(1 - enterO) * 14}px)` : undefined,
                        position: "relative",
                    }}
                >
                    {/* CMS top bar */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: tall ? "12px 20px" : "14px 26px",
                            background: SURFACE.well,
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ width: 9, height: 9, borderRadius: 99, background: approved > 0.5 ? GREEN : ACCENT }} />
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 18, color: INK.copy }}>
                                Rebase CMS <span style={{ color: INK.muted }}>/</span>{" "}
                                <span style={{ color: INK.high, fontWeight: 600 }}>Review Queue</span>
                            </span>
                        </div>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontWeight: 600,
                                fontSize: tall ? 15 : 16,
                                padding: "5px 12px",
                                borderRadius: RADIUS.md,
                                border: `1px solid ${approved > 0.5 ? GREEN : ACCENT}`,
                                background: approved > 0.5 ? "rgba(52,211,153,0.16)" : "rgba(245,158,11,0.14)",
                                color: approved > 0.5 ? GREEN : ACCENT,
                            }}
                        >
                            {approved > 0.5 ? "✓ 0 PENDING" : "1 PENDING"}
                        </span>
                    </div>

                    {/* Proposal metadata strip */}
                    <div
                        style={{
                            padding: tall ? "16px 20px" : "20px 26px",
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 14,
                            flexWrap: "wrap",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontWeight: 600,
                                    fontSize: tall ? 15 : 16,
                                    padding: "5px 11px",
                                    borderRadius: RADIUS.md,
                                    background: "rgba(245,158,11,0.18)",
                                    color: ACCENT,
                                }}
                            >
                                UPDATE
                            </span>
                            <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 22 : 25, color: INK.high }}>
                                orders #1042
                            </span>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "6px 14px",
                                borderRadius: RADIUS.lg,
                                background: SURFACE.card,
                                border: `1px solid ${SURFACE.hairlineStrong}`,
                                fontFamily: FONT.mono,
                                fontSize: tall ? 16 : 17,
                                color: INK.copy,
                            }}
                        >
                            <KeyIcon size={17} color={CYAN} />
                            <span>
                                <span style={{ color: INK.high }}>rk_live_7c2</span> · support-agent
                            </span>
                        </div>
                    </div>

                    {/* Cell-level diff table */}
                    <div style={{ padding: tall ? "16px 20px" : "22px 26px" }}>
                        <div
                            style={{
                                borderRadius: RADIUS.lg,
                                border: `1px solid ${diffLit > 0.5 ? "rgba(245,158,11,0.45)" : SURFACE.hairline}`,
                                background: SURFACE.well,
                                overflow: "hidden",
                            }}
                        >
                            {/* Table header */}
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: tall ? "1.05fr 1fr 34px 1fr" : "1.1fr 1fr 44px 1fr",
                                    padding: tall ? "10px 16px" : "12px 20px",
                                    borderBottom: `1px solid ${SURFACE.hairline}`,
                                    fontFamily: FONT.mono,
                                    fontSize: 14,
                                    letterSpacing: TRACKING.eyebrow,
                                    color: INK.muted,
                                }}
                            >
                                <span>FIELD</span>
                                <span>BEFORE</span>
                                <span />
                                <span>PROPOSED</span>
                            </div>

                            {DIFF_ROWS.map((row, idx) => (
                                <div
                                    key={row.field}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: tall ? "1.05fr 1fr 34px 1fr" : "1.1fr 1fr 44px 1fr",
                                        alignItems: "center",
                                        padding: tall ? "14px 16px" : "18px 20px",
                                        borderBottom: idx === 0 ? `1px solid ${SURFACE.hairline}` : undefined,
                                        background: diffLit > 0.4 ? `rgba(255,255,255,${0.025 * diffLit})` : undefined,
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 20 : 23,
                                    }}
                                >
                                    <span style={{ color: INK.high, fontWeight: 500 }}>{row.field}</span>
                                    <span>
                                        <span
                                            style={{
                                                display: "inline-block",
                                                padding: "4px 12px",
                                                borderRadius: RADIUS.md,
                                                background: "rgba(251,80,102,0.14)",
                                                color: CORAL,
                                                textDecoration: "line-through",
                                            }}
                                        >
                                            {row.before}
                                        </span>
                                    </span>
                                    <span style={{ color: INK.muted, textAlign: "center" }}>→</span>
                                    <span>
                                        <span
                                            style={{
                                                display: "inline-block",
                                                padding: "4px 12px",
                                                borderRadius: RADIUS.md,
                                                background: approved > 0.5 ? "rgba(52,211,153,0.18)" : "rgba(245,158,11,0.16)",
                                                border: `1px solid ${approved > 0.5 ? GREEN : ACCENT}`,
                                                color: approved > 0.5 ? GREEN : ACCENT,
                                                fontWeight: 600,
                                            }}
                                        >
                                            {row.proposed}
                                        </span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Footer actions */}
                    <div
                        style={{
                            padding: tall ? "14px 20px 18px" : "16px 26px 22px",
                            borderTop: `1px solid ${SURFACE.hairline}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 16,
                            position: "relative",
                        }}
                    >
                        <div style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, color: INK.muted }}>
                            {tall ? "a approve · r reject" : "j / k move  •  a approve  •  r reject"}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
                            <div
                                style={{
                                    padding: tall ? "11px 20px" : "12px 24px",
                                    borderRadius: RADIUS.lg,
                                    border: `1px solid ${SURFACE.hairlineStrong}`,
                                    background: SURFACE.card,
                                    fontFamily: FONT.body,
                                    fontWeight: 500,
                                    fontSize: tall ? 19 : 20,
                                    color: INK.copy,
                                    opacity: approved > 0.5 ? 0.45 : 1,
                                }}
                            >
                                Reject
                            </div>
                            <div
                                style={{
                                    padding: tall ? "11px 24px" : "12px 28px",
                                    borderRadius: RADIUS.lg,
                                    background: approved > 0.5 ? GREEN : PRIMARY,
                                    color: approved > 0.5 ? GROUND.base : "#FFFFFF",
                                    fontFamily: FONT.body,
                                    fontWeight: 600,
                                    fontSize: tall ? 19 : 21,
                                    transform: `scale(${1 - pressDown * 0.05})`,
                                }}
                            >
                                {approved > 0.5 ? "✓ Approved" : "Approve"}
                            </div>

                            {cursorMove > 0 && cursorFade > 0 && (
                                <div
                                    style={{
                                        position: "absolute",
                                        left: interpolate(cursorMove, [0, 1], [290, 178]),
                                        top: interpolate(cursorMove, [0, 1], [76, 20]),
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
                                                border: `2px solid ${GREEN}`,
                                                opacity: pressDown,
                                            }}
                                        />
                                    )}
                                    <PointerCursor size={28} pressed={pressDown} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

const APPLY_HEADLINE = "One transaction. Your RLS.";

interface SqlStep {
    num: string;
    sql: string;
    tag: string;
    accent: string;
}

const SQL_STEPS: readonly SqlStep[] = [
    { num: "01", sql: "BEGIN;", tag: "ATOMIC", accent: INK.high },
    { num: "02", sql: "SET LOCAL ROLE rebase_user;  -- ops reviewer", tag: "RLS ACTIVE", accent: CYAN },
    { num: "03", sql: "UPDATE public.orders SET status = 'refunded', refund_amount = 14900 WHERE id = 1042;", tag: "1 ROW", accent: GREEN },
    { num: "04", sql: "UPDATE rebase.staged_changes SET status = 'approved' WHERE id = $1;", tag: "LOGGED", accent: ACCENT },
    { num: "05", sql: "COMMIT;", tag: "APPLIED", accent: GREEN },
];

const Apply: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(APPLY_HEADLINE);
    const tall = format === "tall";
    const txAt = useCue({ line: "apply", word: "transaction", plus: -6 }) ?? 9999;
    const rlsAt = useCue({ line: "apply", word: "reviewer's", plus: -6 }) ?? 9999;
    const secAt = useCue({ line: "apply", word: "security", plus: -4 }) ?? 9999;

    const enterO = ramp(frame, 0, 10, ENTER);
    const midAt = rlsAt < 9000 && secAt < 9000 ? Math.round((rlsAt + secAt) / 2) : 9999;
    const stepTimes = [2, txAt, rlsAt, midAt, secAt];
    const committed = ramp(frame, secAt, 10, ENTER);

    return (
        <>
            <Headline text={APPLY_HEADLINE} at={2} accent={GREEN} mark={["Your", "RLS"]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: RADIUS.xl,
                        border: `1.5px solid ${committed > 0.5 ? GREEN : SURFACE.hairlineStrong}`,
                        background: SURFACE.well,
                        overflow: "hidden",
                        opacity: enterO,
                        transform: enterO < 1 ? `translateY(${(1 - enterO) * 12}px)` : undefined,
                    }}
                >
                    {/* Header */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: tall ? "12px 18px" : "14px 24px",
                            background: SURFACE.sheet,
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <DatabaseIcon size={19} color={committed > 0.5 ? GREEN : CYAN} />
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 17, letterSpacing: TRACKING.eyebrow, color: INK.copy }}>
                                POSTGRES · SINGLE TRANSACTION
                            </span>
                        </div>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontWeight: 600,
                                fontSize: tall ? 14 : 16,
                                padding: "4px 12px",
                                borderRadius: RADIUS.md,
                                border: `1.5px solid ${committed > 0.5 ? GREEN : ACCENT}`,
                                background: committed > 0.5 ? GREEN : "rgba(245,158,11,0.14)",
                                color: committed > 0.5 ? GROUND.base : ACCENT,
                            }}
                        >
                            {committed > 0.5 ? "✓ COMMITTED" : "EXECUTING"}
                        </span>
                    </div>

                    {/* Statements */}
                    <div style={{ padding: tall ? "12px 16px" : "18px 24px", display: "flex", flexDirection: "column", gap: tall ? 8 : 10 }}>
                        {SQL_STEPS.map((step, i) => {
                            const lit = ramp(frame, stepTimes[i], 10, ENTER);
                            const active = lit > 0.35;
                            const sqlText = tall && i === 2
                                ? "UPDATE public.orders SET status='refunded', refund_amount=14900 WHERE id=1042;"
                                : tall && i === 3
                                    ? "UPDATE rebase.staged_changes SET status='approved';"
                                    : step.sql;

                            return (
                                <div
                                    key={step.num}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 14,
                                        padding: tall ? "10px 14px" : "13px 18px",
                                        borderRadius: RADIUS.lg,
                                        border: `1px solid ${active ? step.accent : SURFACE.hairline}`,
                                        background: active ? "rgba(255,255,255,0.04)" : "transparent",
                                        opacity: 0.36 + 0.64 * lit,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
                                        <span
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontWeight: 600,
                                                fontSize: tall ? 15 : 16,
                                                color: active ? step.accent : INK.muted,
                                                flexShrink: 0,
                                            }}
                                        >
                                            {active ? "✓" : step.num}
                                        </span>
                                        <span
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 16 : 20,
                                                color: active ? INK.high : INK.copy,
                                                lineHeight: 1.35,
                                                wordBreak: "break-word",
                                            }}
                                        >
                                            {sqlText}
                                        </span>
                                    </div>
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontWeight: 600,
                                            fontSize: tall ? 13 : 14,
                                            padding: "4px 10px",
                                            borderRadius: RADIUS.md,
                                            border: `1px solid ${active ? step.accent : SURFACE.hairline}`,
                                            color: active ? step.accent : INK.muted,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {step.tag}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div
                    style={{
                        marginTop: tall ? 12 : 16,
                        padding: tall ? "10px 16px" : "12px 22px",
                        borderRadius: RADIUS.lg,
                        border: `1px solid ${SURFACE.hairline}`,
                        background: SURFACE.sheet,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        fontFamily: FONT.body,
                        fontSize: tall ? 17 : 19,
                        color: INK.copy,
                        opacity: enterO,
                    }}
                >
                    <ShieldCheckIcon size={20} color={GREEN} />
                    <span>If reviewer RLS rejects the write, Postgres rolls back and the proposal stays pending.</span>
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const REVIEW_QUEUE: FilmSpec = checkFilm({
    id: "review-queue",
    number: 2,
    title: "Agents propose, humans approve",
    accent: ACCENT,
    endCommand: "pnpm add @rebasepro/plugin-review",
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "stage", at: { line: "stage", plus: -16 }, render: Stage, roll: 0.28 },
        { id: "hold", at: { line: "hold", plus: 0 }, render: Hold, roll: 0.52 },
        { id: "diff", at: { line: "diff", plus: 0 }, render: Diff, roll: 0.72, ground: GROUND.claim, reveal: 0.6 },
        { id: "apply", at: { line: "apply", plus: 0 }, render: Apply, roll: 0.16, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.5 },
    ],
});
