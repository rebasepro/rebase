import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { ENTER, ramp, SHIFT } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, RADIUS, SURFACE } from "../../theme";
import {
    At,
    checkFilm,
    Editor,
    Headline,
    lines,
    Log,
    Prompt,
    useBodyFor,
    useCue,
    Window,
    type FilmSpec,
} from "../kit";

/**
 * 05 — BUILT-IN ROW UNDO (`time-machine`).
 *
 * When a runtime agent script with a bad filter corrupts customer records,
 * Rebase already has the full before/after timeline in `rebase.entity_history`
 * (`REBASE_HISTORY=true` by default on managed runtime, `history: true` per
 * table), enforces the table's exact RLS policy without embedding related
 * rows, and lets you inspect and rewind via `rebase data history` and
 * `rebase data revert`.
 */

const ACCENT = CHROMA.cyan;
const CORAL = CHROMA.coral;
const GREEN = "#34D399";
const AMBER = "#F59E0B";

const SCRIPT = lines([
    ["hook", "Sooner or later, an agent script with a bad filter deletes the wrong customer records. What matters is whether you can undo it."],
    ["on", "In Rebase, entity history is on out of the box. Every create, update, and delete records what changed, who did it, and what was there before."],
    ["privacy", "Reading that audit trail checks the exact policy protecting the record, and never leaks columns from related tables."],
    ["cli", "Open a terminal, pull the timeline for the broken order, and compare every version in seconds."],
    ["revert", "One revert command writes the previous values back through the API, with hooks and permissions intact."],
    ["close", "Mistakes happen faster with agents. Ship a backend with undo built in."],
]);

/* ── inline icons (no emojis) ───────────────────────────────────────── */

const HistoryIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="10" cy="10" r="7.5" stroke={color} strokeWidth="1.6" />
        <path d="M10 6V10L13 12" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const ShieldCheckIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <path
            d="M10 2.5L16.5 5.2V9.8C16.5 13.7 13.7 16.6 10 17.8C6.3 16.6 3.5 13.7 3.5 9.8V5.2L10 2.5Z"
            stroke={color}
            strokeWidth="1.6"
            strokeLinejoin="round"
        />
        <path d="M7.2 10.2L9.1 12.1L13.1 8.1" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const BlockIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 22 }) => (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="11" cy="11" r="8.5" stroke={color} strokeWidth="1.8" />
        <path d="M7.8 7.8L14.2 14.2M14.2 7.8L7.8 14.2" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
);

const KeyBotIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="6" cy="9" r="3.5" stroke={color} strokeWidth="1.5" />
        <path d="M9.5 9H16M13.5 9V12M15.5 9V11.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
);

const RewindIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <path d="M10 15L4.5 10L10 5V15Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M16 15L10.5 10L16 5V15Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
);

/* ── scene 1: on ────────────────────────────────────────────────────── */

const ORDERS_SCHEMA = `export const orders = defineTable("orders", {
  columns: {
    status: col.enum(["open", "paid", "cancelled"]),
    total:  col.numeric({ precision: 10, scale: 2 }),
  },
  history: true,
});`;

const H_ON = "Entity history, on by default.";

const On: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_ON);
    const tall = format === "tall";

    const atCreate = useCue({ line: "on", word: "create", plus: -4 }) ?? 22;
    const atWhat = useCue({ line: "on", word: "what", plus: -4 }) ?? 34;
    const atWho = useCue({ line: "on", word: "who", plus: -4 }) ?? 48;
    const atBefore = useCue({ line: "on", word: "before", plus: -6 }) ?? 62;

    const cardO = ramp(frame, 1, 10, ENTER);
    const badgeO = ramp(frame, 4, 12, ENTER);
    const rowAction = ramp(frame, Math.max(4, atCreate), 10, ENTER);
    const rowFields = ramp(frame, Math.max(8, atWhat), 10, ENTER);
    const rowPrev = ramp(frame, Math.max(12, atBefore), 10, ENTER);
    const rowVals = ramp(frame, Math.max(10, atWhat + 6), 10, ENTER);
    const rowUser = ramp(frame, Math.max(10, atWho), 10, ENTER);

    const monoSm = tall ? 15 : 17;
    const monoMd = tall ? 16 : 19;

    const editorPanel = (
        <div style={{ width: tall ? w : 680, flexShrink: 0 }}>
            <Editor
                file="backend/schema/orders.ts"
                code={ORDERS_SCHEMA}
                size={tall ? 17 : 18}
                at={0}
                step={2}
                accent={ACCENT}
            />
            <div
                style={{
                    marginTop: tall ? 12 : 18,
                    padding: tall ? "11px 16px" : "14px 20px",
                    borderRadius: RADIUS.lg,
                    background: SURFACE.sheet,
                    border: "1px solid rgba(54,204,214,0.34)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    opacity: badgeO,
                    transform: badgeO < 1 ? `translateY(${(1 - badgeO) * 10}px)` : undefined,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: 99,
                            background: ACCENT,
                            boxShadow: `0 0 10px ${ACCENT}`,
                            flexShrink: 0,
                        }}
                    />
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 17, color: INK.high }}>
                        <span style={{ color: ACCENT, fontWeight: 600 }}>REBASE_HISTORY=true</span> by default
                    </span>
                </div>
                {!tall && (
                    <span
                        style={{
                            fontFamily: FONT.mono,
                            fontSize: 13,
                            color: INK.copy,
                            padding: "4px 10px",
                            borderRadius: RADIUS.md,
                            background: SURFACE.card,
                            border: `1px solid ${SURFACE.hairline}`,
                            whiteSpace: "nowrap",
                        }}
                    >
                        90d retention
                    </span>
                )}
            </div>
        </div>
    );

    const snapshotCard = (
        <div
            style={{
                flex: 1,
                borderRadius: RADIUS.xl,
                border: "1px solid rgba(54,204,214,0.32)",
                background: SURFACE.well,
                overflow: "hidden",
                opacity: cardO,
                transform: cardO < 1 ? `translateY(${(1 - cardO) * 12}px)` : undefined,
            }}
        >
            {/* header */}
            <div
                style={{
                    padding: tall ? "11px 18px" : "14px 22px",
                    background: SURFACE.sheet,
                    borderBottom: `1px solid ${SURFACE.hairline}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <HistoryIcon color={ACCENT} size={tall ? 16 : 18} />
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 17, color: INK.high, fontWeight: 600 }}>
                        rebase.entity_history
                    </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {(["create", "update", "delete"] as const).map((act) => {
                        const active = act === "update";
                        return (
                            <span
                                key={act}
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 12 : 13,
                                    padding: "3px 9px",
                                    borderRadius: RADIUS.md,
                                    background: active ? "rgba(251,80,102,0.18)" : SURFACE.card,
                                    border: `1px solid ${active ? CORAL : SURFACE.hairline}`,
                                    color: active ? CORAL : INK.muted,
                                    fontWeight: active ? 600 : 400,
                                }}
                            >
                                {act}
                            </span>
                        );
                    })}
                </div>
            </div>

            {/* snapshot rows */}
            <div style={{ padding: tall ? "12px 18px" : "18px 22px", display: "flex", flexDirection: "column", gap: tall ? 9 : 13 }}>
                {/* row 1: action + entity */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: tall ? "8px 12px" : "10px 14px",
                        borderRadius: RADIUS.lg,
                        background: SURFACE.sheet,
                        border: `1px solid ${SURFACE.hairline}`,
                        opacity: 0.35 + 0.65 * rowAction,
                    }}
                >
                    <span style={{ fontFamily: FONT.mono, fontSize: monoSm, color: INK.muted }}>action</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontFamily: FONT.mono, fontSize: monoSm, color: INK.copy }}>orders / ord_8841</span>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: monoSm,
                                color: CORAL,
                                fontWeight: 600,
                                padding: "2px 10px",
                                borderRadius: RADIUS.md,
                                background: "rgba(251,80,102,0.15)",
                            }}
                        >
                            &quot;update&quot;
                        </span>
                    </div>
                </div>

                {/* row 2: changed_fields */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: tall ? "8px 12px" : "10px 14px",
                        borderRadius: RADIUS.lg,
                        background: SURFACE.sheet,
                        border: `1px solid ${SURFACE.hairline}`,
                        opacity: 0.35 + 0.65 * rowFields,
                    }}
                >
                    <span style={{ fontFamily: FONT.mono, fontSize: monoSm, color: INK.muted }}>changed_fields</span>
                    <div style={{ display: "flex", gap: 8 }}>
                        {["status", "total"].map((f) => (
                            <span
                                key={f}
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: monoSm,
                                    color: ACCENT,
                                    padding: "2px 10px",
                                    borderRadius: RADIUS.md,
                                    background: "rgba(54,204,214,0.13)",
                                    border: "1px solid rgba(54,204,214,0.3)",
                                }}
                            >
                                &quot;{f}&quot;
                            </span>
                        ))}
                    </div>
                </div>

                {/* row 3: previous_values */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: tall ? "8px 12px" : "10px 14px",
                        borderRadius: RADIUS.lg,
                        background: "rgba(52,211,153,0.08)",
                        border: "1px solid rgba(52,211,153,0.28)",
                        opacity: 0.35 + 0.65 * rowPrev,
                    }}
                >
                    <span style={{ fontFamily: FONT.mono, fontSize: monoSm, color: GREEN }}>previous_values</span>
                    <span style={{ fontFamily: FONT.mono, fontSize: monoMd, color: INK.high }}>
                        {`{ status: "paid", total: "149.00" }`}
                    </span>
                </div>

                {/* row 4: values */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: tall ? "8px 12px" : "10px 14px",
                        borderRadius: RADIUS.lg,
                        background: "rgba(251,80,102,0.09)",
                        border: "1px solid rgba(251,80,102,0.3)",
                        opacity: 0.35 + 0.65 * rowVals,
                    }}
                >
                    <span style={{ fontFamily: FONT.mono, fontSize: monoSm, color: CORAL }}>values</span>
                    <span style={{ fontFamily: FONT.mono, fontSize: monoMd, color: INK.high }}>
                        {`{ status: "cancelled", total: "0.00" }`}
                    </span>
                </div>

                {/* row 5: updated_by */}
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: tall ? "8px 12px" : "10px 14px",
                        borderRadius: RADIUS.lg,
                        background: SURFACE.sheet,
                        border: `1px solid ${SURFACE.hairline}`,
                        opacity: 0.35 + 0.65 * rowUser,
                    }}
                >
                    <span style={{ fontFamily: FONT.mono, fontSize: monoSm, color: INK.muted }}>updated_by</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <KeyBotIcon color={AMBER} size={16} />
                        <span style={{ fontFamily: FONT.mono, fontSize: monoMd, color: AMBER, fontWeight: 600 }}>
                            &quot;rk_live_agent&quot;
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <>
            <Headline text={H_ON} at={0} accent={ACCENT} mark={["on", "by", "default."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        gap: tall ? 14 : 26,
                        alignItems: tall ? "stretch" : "flex-start",
                    }}
                >
                    {editorPanel}
                    {snapshotCard}
                </div>
            </At>
        </>
    );
};

/* ── scene 2: privacy ───────────────────────────────────────────────── */

const H_PRIVACY = "Same RLS. No leaked joins.";

const Privacy: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_PRIVACY);
    const tall = format === "tall";

    const atPolicy = useCue({ line: "privacy", word: "policy", plus: -4 }) ?? 18;
    const atNever = useCue({ line: "privacy", word: "never", plus: -4 }) ?? 36;

    const topO = ramp(frame, 0, 10, ENTER);
    const leftO = ramp(frame, 2, 10, ENTER);
    const policyPop = ramp(frame, Math.max(4, atPolicy), 10, ENTER);
    const blockO = ramp(frame, Math.max(6, atNever), 12, ENTER);

    const rowFont = tall ? 17 : 21;
    const labelFont = tall ? 13 : 14;

    return (
        <>
            <Headline text={H_PRIVACY} at={0} accent={ACCENT} mark={["No", "leaked", "joins."]} />
            <At x={x} y={y} w={w}>
                {/* Policy check bar */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        alignItems: tall ? "flex-start" : "center",
                        justifyContent: "space-between",
                        gap: tall ? 10 : 18,
                        padding: tall ? "14px 18px" : "16px 24px",
                        borderRadius: RADIUS.xl,
                        background: SURFACE.well,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        marginBottom: tall ? 18 : 26,
                        opacity: topO,
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <ShieldCheckIcon color={GREEN} size={22} />
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 19, color: INK.high }}>
                            GET /api/data/orders/ord_8841/history
                        </span>
                    </div>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: tall ? "6px 14px" : "7px 16px",
                            borderRadius: 99,
                            background: "rgba(52,211,153,0.16)",
                            border: `1.5px solid ${GREEN}`,
                            opacity: 0.45 + 0.55 * policyPop,
                        }}
                    >
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 16, color: GREEN, fontWeight: 600 }}>
                            ✓ same RLS policy as orders
                        </span>
                    </div>
                </div>

                {/* Audit-trail shield diagram */}
                <div
                    style={{
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        alignItems: "stretch",
                        gap: tall ? 14 : 20,
                    }}
                >
                    {/* Left: orders.history entry */}
                    <div
                        style={{
                            flex: 1,
                            borderRadius: RADIUS.xl,
                            background: SURFACE.well,
                            border: "1.5px solid rgba(54,204,214,0.55)",
                            overflow: "hidden",
                            opacity: leftO,
                        }}
                    >
                        <div
                            style={{
                                padding: tall ? "11px 18px" : "14px 22px",
                                background: SURFACE.sheet,
                                borderBottom: `1px solid ${SURFACE.hairline}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                            }}
                        >
                            <span style={{ fontFamily: FONT.mono, fontSize: labelFont, letterSpacing: "0.14em", color: ACCENT, fontWeight: 600 }}>
                                • ORDERS.HISTORY ENTRY
                            </span>
                            <span style={{ fontFamily: FONT.mono, fontSize: labelFont, color: GREEN }}>
                                ✓ STORED
                            </span>
                        </div>
                        <div style={{ padding: tall ? "14px 18px" : "20px 22px", display: "flex", flexDirection: "column", gap: tall ? 8 : 12 }}>
                            {[
                                { k: "id", v: '"ord_8841"', fk: false },
                                { k: "status", v: '"paid"', fk: false },
                                { k: "total", v: '"149.00"', fk: false },
                                { k: "customer_id", v: '"cust_42"', fk: true },
                            ].map((r) => (
                                <div
                                    key={r.k}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        padding: r.fk ? (tall ? "9px 14px" : "12px 16px") : tall ? "4px 14px" : "6px 16px",
                                        borderRadius: RADIUS.lg,
                                        background: r.fk ? "rgba(54,204,214,0.14)" : "transparent",
                                        border: r.fk ? `1.5px solid ${ACCENT}` : "1px solid transparent",
                                    }}
                                >
                                    <span style={{ fontFamily: FONT.mono, fontSize: rowFont, color: r.fk ? ACCENT : INK.muted }}>
                                        {r.k}
                                    </span>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                        <span style={{ fontFamily: FONT.mono, fontSize: rowFont, color: INK.high, fontWeight: r.fk ? 600 : 400 }}>
                                            {r.v}
                                        </span>
                                        {r.fk && (
                                            <span
                                                style={{
                                                    fontFamily: FONT.mono,
                                                    fontSize: 12,
                                                    color: GROUND.base,
                                                    background: ACCENT,
                                                    padding: "2px 8px",
                                                    borderRadius: RADIUS.md,
                                                    fontWeight: 600,
                                                }}
                                            >
                                                FK ONLY
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Center barrier */}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: tall ? "row" : "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 8,
                            padding: tall ? "4px 0" : "0 4px",
                            opacity: 0.45 + 0.55 * blockO,
                        }}
                    >
                        <div
                            style={{
                                width: tall ? 38 : 48,
                                height: tall ? 38 : 48,
                                borderRadius: 99,
                                background: SURFACE.well,
                                border: `2px solid ${CORAL}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <BlockIcon color={CORAL} size={tall ? 20 : 24} />
                        </div>
                        <span style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.14em", color: INK.high, fontWeight: 600 }}>
                            NO JOIN
                        </span>
                    </div>

                    {/* Right: blocked related table card */}
                    <div
                        style={{
                            flex: 1,
                            borderRadius: RADIUS.xl,
                            background: SURFACE.well,
                            border: `1.5px solid ${CORAL}`,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            opacity: 0.4 + 0.6 * blockO,
                            transform: blockO < 1 ? `translate${tall ? "Y" : "X"}(${(1 - blockO) * 14}px)` : undefined,
                        }}
                    >
                        <div
                            style={{
                                padding: tall ? "11px 18px" : "14px 22px",
                                background: "rgba(251,80,102,0.16)",
                                borderBottom: "1px solid rgba(251,80,102,0.35)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                            }}
                        >
                            <span style={{ fontFamily: FONT.mono, fontSize: labelFont, letterSpacing: "0.12em", color: CORAL, fontWeight: 600 }}>
                                × RELATED · CUSTOMERS
                            </span>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: 12,
                                    color: GROUND.base,
                                    background: CORAL,
                                    padding: "3px 9px",
                                    borderRadius: RADIUS.md,
                                    fontWeight: 600,
                                }}
                            >
                                NEVER EMBEDDED
                            </span>
                        </div>
                        <div style={{ flex: 1, padding: tall ? "14px 18px" : "20px 22px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: tall ? 8 : 12 }}>
                            {[
                                { k: "customers.email", v: '"alice@acme.io"' },
                                { k: "customers.billing_card", v: '"•••• 4242"' },
                                { k: "customers.tax_id", v: '"EU-991827"' },
                            ].map((r) => (
                                <div
                                    key={r.k}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        padding: tall ? "7px 12px" : "10px 14px",
                                        borderRadius: RADIUS.lg,
                                        background: "rgba(251,80,102,0.07)",
                                        border: "1px dashed rgba(251,80,102,0.4)",
                                    }}
                                >
                                    <span style={{ fontFamily: FONT.mono, fontSize: rowFont - 1, color: INK.muted, textDecoration: "line-through" }}>
                                        {r.k}
                                    </span>
                                    <span style={{ fontFamily: FONT.mono, fontSize: rowFont - 1, color: CORAL, fontWeight: 600 }}>
                                        ×
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 3: cli ───────────────────────────────────────────────────── */

interface HistoryLine {
    id: string;
    action: "create" | "update";
    bad?: boolean;
}

/* `rebase data history` prints one line an entry — its id (a uuid) and its
   action — newest first, then how to put one back (packages/cli/src/commands/data.ts). */
const GOOD_ID = "7c1e4b20-5d3a-4f8e-9b61-2a0d7e93c4f5";
const HISTORY_LINES: HistoryLine[] = [
    { id: "e3b4f1a2-9c07-4d5e-8a61-0f2c7d94b8e3", action: "update", bad: true },
    { id: GOOD_ID, action: "update" },
    { id: "1a9f0c3d-62b8-4e17-a4d0-5be81f2c9a76", action: "create" },
];

const H_CLI = "Inspect every version in CLI.";

const Cli: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_CLI);
    const tall = format === "tall";

    const atCompare = useCue({ line: "cli", word: "compare", plus: -6 }) ?? 48;
    const diffO = ramp(frame, Math.max(24, atCompare), 12, ENTER);

    return (
        <>
            <Headline text={H_CLI} at={0} accent={ACCENT} mark={["every", "version"]} />
            <At x={x} y={y} w={w}>
                <Window title="zsh — production" at={-2} pad={tall ? "16px 20px" : "20px 26px"}>
                    <Prompt command="rebase data history orders ord_8841" at={2} size={tall ? 20 : 24} rate={0.4} />
                    <div style={{ marginTop: tall ? 10 : 14, display: "flex", flexDirection: "column", gap: tall ? 6 : 8 }}>
                        {HISTORY_LINES.map((row, idx) => {
                            const rowO = ramp(frame, 14 + idx * 8, 10, ENTER);
                            return (
                                <div
                                    key={row.id}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: tall ? 14 : 20,
                                        padding: tall ? "8px 12px" : "10px 16px",
                                        borderRadius: RADIUS.lg,
                                        background: row.bad ? "rgba(251,80,102,0.14)" : SURFACE.sheet,
                                        border: row.bad ? `1.5px solid ${CORAL}` : `1px solid ${SURFACE.hairline}`,
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 16 : 20,
                                        opacity: rowO,
                                        transform: rowO < 1 ? `translateX(${(1 - rowO) * -14}px)` : undefined,
                                    }}
                                >
                                    <span style={{ color: row.bad ? CORAL : INK.high, fontWeight: 600 }}>{row.id}</span>
                                    <span style={{ color: row.bad ? CORAL : INK.muted }}>{row.action}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ marginTop: tall ? 10 : 12 }}>
                        <Log
                            size={tall ? 15 : 18}
                            lines={[{ text: "  Put one back with: rebase data revert orders ord_8841 <historyId>", at: 40, color: INK.muted }]}
                        />
                    </div>
                </Window>

                {/* Side-by-side diff bar */}
                <div
                    style={{
                        marginTop: tall ? 16 : 20,
                        padding: tall ? "14px 18px" : "16px 24px",
                        borderRadius: RADIUS.xl,
                        background: SURFACE.sheet,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        opacity: diffO,
                        transform: diffO < 1 ? `translateY(${(1 - diffO) * 12}px)` : undefined,
                    }}
                >
                    <div
                        style={{
                            fontFamily: FONT.mono,
                            fontSize: tall ? 13 : 14,
                            letterSpacing: "0.14em",
                            color: INK.muted,
                            marginBottom: tall ? 10 : 12,
                            display: "flex",
                            justifyContent: "space-between",
                        }}
                    >
                        <span>PREVIOUS_VALUES → VALUES</span>
                        <span style={{ color: CORAL }}>UPDATED_BY rk_live_agent</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 10 : 20 }}>
                        {[
                            { field: "total", before: "€149.00", after: "€0.00" },
                            { field: "status", before: "paid", after: "cancelled" },
                        ].map((d) => (
                            <div
                                key={d.field}
                                style={{
                                    flex: 1,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    padding: tall ? "9px 14px" : "11px 18px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.well,
                                    border: `1px solid ${SURFACE.hairline}`,
                                }}
                            >
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 18, color: INK.muted }}>
                                    {d.field}
                                </span>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 19, color: GREEN, fontWeight: 600 }}>
                                        {d.before}
                                    </span>
                                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 18, color: INK.muted }}>→</span>
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: tall ? 16 : 19,
                                            color: CORAL,
                                            fontWeight: 600,
                                            textDecoration: "line-through",
                                        }}
                                    >
                                        {d.after}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 4: revert (bright payoff) ────────────────────────────────── */

const H_REVERT = "One command rewinds it.";

const Revert: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_REVERT);
    const tall = format === "tall";

    const atWrites = useCue({ line: "revert", word: "writes", plus: -2 }) ?? 22;
    const atHooks = useCue({ line: "revert", word: "hooks", plus: -4 }) ?? 48;

    const rewindStart = Math.max(20, atWrites);
    const rewind = ramp(frame, rewindStart, 22, SHIFT);
    const settled = rewind >= 0.72;
    const scrubberX = interpolate(rewind, [0, 1], [86, 50]);
    const hooksO = ramp(frame, Math.max(rewindStart + 14, atHooks), 12, ENTER);

    return (
        <>
            <Headline text={H_REVERT} at={0} accent={GREEN} mark={["rewinds"]} />
            <At x={x} y={y} w={w}>
                <Window title="zsh — production" at={-2} pad={tall ? "16px 20px" : "20px 26px"}>
                    <Prompt command={`rebase data revert orders ord_8841 ${GOOD_ID} --yes`} at={2} size={tall ? 17 : 22} rate={0.3} />
                    <Log
                        size={tall ? 15 : 19}
                        lines={[
                            { text: `  ✓ Reverted orders/ord_8841 to ${GOOD_ID}; the revert is a new history entry.`, at: rewindStart + 4, color: GREEN },
                        ]}
                    />
                </Window>

                {/* Animated time-rewind scrubber + record badge */}
                <div
                    style={{
                        marginTop: tall ? 18 : 24,
                        padding: tall ? "18px 20px" : "22px 28px",
                        borderRadius: RADIUS.xl,
                        background: SURFACE.well,
                        border: `1.5px solid ${settled ? GREEN : "rgba(251,80,102,0.55)"}`,
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: tall ? 14 : 18,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <RewindIcon color={settled ? GREEN : CORAL} size={20} />
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 16, letterSpacing: "0.14em", color: INK.copy }}>
                                TIMELINE SCRUBBER · orders / ord_8841
                            </span>
                        </div>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: tall ? 13 : 15,
                                fontWeight: 600,
                                color: settled ? GREEN : CORAL,
                            }}
                        >
                            {settled ? "✓ RESTORED TO v2" : "REWINDING v3 → v2"}
                        </span>
                    </div>

                    {/* Track */}
                    <div style={{ position: "relative", height: 48, marginBottom: tall ? 14 : 18 }}>
                        <div
                            style={{
                                position: "absolute",
                                left: "14%",
                                right: "14%",
                                top: 18,
                                height: 4,
                                borderRadius: 99,
                                background: SURFACE.raised,
                            }}
                        />
                        {/* Active rewind arc between v2 and v3 */}
                        <div
                            style={{
                                position: "absolute",
                                left: `${scrubberX}%`,
                                width: `${86 - scrubberX}%`,
                                top: 18,
                                height: 4,
                                borderRadius: 99,
                                background: settled ? GREEN : CORAL,
                            }}
                        />
                        {[
                            { label: "v1 · open", left: 14, color: INK.muted },
                            { label: "v2 · €149.00 paid", left: 50, color: GREEN },
                            { label: "v3 · €0.00 cancelled", left: 86, color: CORAL },
                        ].map((tick) => (
                            <div
                                key={tick.label}
                                style={{
                                    position: "absolute",
                                    left: `${tick.left}%`,
                                    top: 12,
                                    transform: "translateX(-50%)",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: 8,
                                }}
                            >
                                <span
                                    style={{
                                        width: 14,
                                        height: 14,
                                        borderRadius: 99,
                                        background: SURFACE.well,
                                        border: `2.5px solid ${tick.color}`,
                                    }}
                                />
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 15, color: tick.color, whiteSpace: "nowrap" }}>
                                    {tick.label}
                                </span>
                            </div>
                        ))}
                        {/* Playhead */}
                        <div
                            style={{
                                position: "absolute",
                                left: `${scrubberX}%`,
                                top: 8,
                                transform: "translateX(-50%)",
                                width: 22,
                                height: 22,
                                borderRadius: 99,
                                background: settled ? GREEN : CORAL,
                                boxShadow: `0 0 18px ${settled ? GREEN : CORAL}`,
                                border: `3px solid ${SURFACE.well}`,
                            }}
                        />
                    </div>

                    {/* Live record state transition */}
                    <div
                        style={{
                            display: "flex",
                            flexDirection: tall ? "column" : "row",
                            alignItems: tall ? "stretch" : "center",
                            justifyContent: "space-between",
                            gap: tall ? 12 : 18,
                            padding: tall ? "12px 14px" : "14px 18px",
                            borderRadius: RADIUS.lg,
                            background: settled ? "rgba(52,211,153,0.12)" : "rgba(251,80,102,0.12)",
                            border: `1.5px solid ${settled ? GREEN : CORAL}`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 15 : 17,
                                    fontWeight: 600,
                                    padding: "4px 10px",
                                    borderRadius: RADIUS.md,
                                    background: settled ? GREEN : CORAL,
                                    color: GROUND.base,
                                }}
                            >
                                {settled ? "v2" : "v3"}
                            </span>
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 18 : 22, color: INK.high, fontWeight: 600 }}>
                                {settled ? "€149.00 · paid" : "€0.00 · cancelled"}
                            </span>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                opacity: 0.4 + 0.6 * hooksO,
                            }}
                        >
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 14 : 16,
                                    color: ACCENT,
                                    padding: "5px 12px",
                                    borderRadius: 99,
                                    background: SURFACE.sheet,
                                    border: "1px solid rgba(54,204,214,0.4)",
                                }}
                            >
                                REST API · hooks &amp; RLS intact
                            </span>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const TIME_MACHINE: FilmSpec = checkFilm({
    id: "time-machine",
    number: 5,
    title: "Built-in row undo",
    accent: ACCENT,
    backdrop: "dark",
    endCommand: "rebase data revert orders <id> <historyId>",
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "on", at: { line: "on", plus: -16 }, render: On, roll: 0.34 },
        { id: "privacy", at: { line: "privacy", plus: 0 }, render: Privacy, roll: 0.62 },
        { id: "cli", at: { line: "cli", plus: 0 }, render: Cli, roll: 0.18 },
        { id: "revert", at: { line: "revert", plus: 0 }, render: Revert, roll: 0.78, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.48 },
    ],
});
