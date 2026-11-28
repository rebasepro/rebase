import React from "react";
import { Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { ENTER, ramp, SHIFT } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, RADIUS, SURFACE, TONE } from "../../theme";
import { At, checkFilm, Editor, Headline, Label, lines, Log, Prompt, useBodyFor, useCue, useStage, Window, type FilmSpec } from "../kit";

/**
 * 00 — REBASE PRODUCT INTRODUCTION.
 *
 * The flagship ~75-second introduction to Rebase (MIT open source) and
 * Rebase Cloud (private beta). Replaces the old "desk film" with a crisp,
 * modern 2026 narrative:
 *   1. Real `rls-check 0.18.1` audit of an agent-built Postgres database.
 *   2. One `defineTable` file compiling into real Postgres RLS + clean scan.
 *   3. Real HD footage of Rebase CMS (`demo/panel.mp4`) and Rebase Studio
 *      (`demo/studio.mp4`) running under the same `rebase_user` policies.
 *   4. Agents as first-class callers: scoped keys, staged review queue, and
 *      real Claude MCP App screenshots (`claude/1-table.png`, `2-edit-plan.png`).
 *   5. MIT self-hosting on any Postgres vs. Rebase Cloud (dedicated Postgres,
 *      hardware pricing, €0/seat CMS, same-day `pg_dump` + `rebase eject`).
 */

const CYAN = CHROMA.cyan;
const CORAL = CHROMA.coral;
const GREEN = "#34D399";
const AMBER = "#F59E0B";

const SCRIPT = lines([
    ["hook", "A coding agent builds your backend in twenty minutes, and it ships with every table wide open."],
    ["problem", "That happens all the time now: writing the code got fast, and trusting it in production stayed hard."],
    ["schema", "Rebase, an open source backend for Postgres, puts security inside the database, so there is nothing to forget."],
    ["panel", "One definition gives you a typed REST API, realtime, auth, storage, functions, and an admin panel on day one, Rebase CMS for your team and Studio for developers, with every click obeying row-level security."],
    ["agents", "Agents are first-class callers. They get scoped keys, their writes are staged for human approval, and the real admin table even opens inside Claude, where nothing saves until you confirm."],
    ["cloud", "MIT licensed, it self-hosts on any Postgres you already have. But here's the catch: Rebase Cloud is in private beta, so you request access. We run the exact same image on dedicated hardware, no per-seat pricing, clean exit anytime."],
    ["close", "Fast was solved; trust is the product. Start free, or request Cloud access, at rebase dot pro."],
]);

/* ── icons (inline SVG, zero emojis) ───────────────────────────────── */

const ShieldIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
    </svg>
);

const AlertIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

/* ── Scene 1: problem — real rls-check audit ───────────────────────── */

const H_PROBLEM = "Fast code. Wide-open tables.";

const OPEN_TABLES = [
    { name: "public.orders", grants: "SELECT, INSERT, UPDATE, DELETE" },
    { name: "public.customers", grants: "SELECT, INSERT, UPDATE, DELETE" },
    { name: "public.authors", grants: "SELECT, INSERT, UPDATE, DELETE" },
    { name: "public.order_items", grants: "SELECT, INSERT, UPDATE, DELETE" },
];

const Problem: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_PROBLEM);
    const tall = format === "tall";

    const atAudit = useCue({ line: "problem", word: "writing", plus: -4 }) ?? 18;
    const atOpen = useCue({ line: "problem", word: "trusting", plus: -4 }) ?? 48;

    const termO = ramp(frame, 0, 10, ENTER);
    const tallyO = ramp(frame, atAudit + 10, 12, ENTER);
    const alertO = ramp(frame, atOpen, 12, ENTER);

    return (
        <>
            <Headline text={H_PROBLEM} at={2} accent={CORAL} mark={["Wide-open", "tables"]} />
            <At x={x} y={y} w={w} style={{ opacity: termO }}>
                <Window title="zsh · rls-check 0.18.1" at={0} accent={CORAL} pad={tall ? "16px 20px" : "20px 26px"}>
                    <Prompt command="npx @rebasepro/rls-check" at={2} size={tall ? 21 : 25} rate={0.45} />
                    <div style={{ height: 10 }} />
                    <Log
                        size={tall ? 17 : 20}
                        lines={[
                            { text: "Database  localhost:5432/acme  ·  PostgreSQL 18.4", at: 18, color: INK.muted },
                            { text: "Scanned   2 schemas · 9 tables · 0 policies · 15 checks", at: 24, color: INK.copy },
                        ]}
                    />

                    {/* Critical tally bar */}
                    <div
                        style={{
                            marginTop: tall ? 16 : 20,
                            padding: tall ? "12px 16px" : "14px 20px",
                            borderRadius: RADIUS.lg,
                            border: `1.5px solid rgba(251,80,102,${0.3 + 0.5 * alertO})`,
                            background: `rgba(251,80,102,${0.08 + 0.08 * alertO})`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            opacity: tallyO,
                            transform: `translateY(${(1 - tallyO) * 8}px)`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <AlertIcon color={CORAL} size={tall ? 20 : 22} />
                            <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 20 : 23, color: CORAL }}>
                                CRITICAL · 9 findings
                            </span>
                        </div>
                        <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 17, color: INK.high }}>
                            0 tables protected
                        </span>
                    </div>

                    {/* Exposed table rows */}
                    <div style={{ display: "flex", flexDirection: "column", gap: tall ? 8 : 10, marginTop: tall ? 14 : 16 }}>
                        {OPEN_TABLES.map((t, i) => {
                            const o = ramp(frame, atAudit + 14 + i * 5, 10, ENTER);
                            return (
                                <div
                                    key={t.name}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        padding: tall ? "10px 14px" : "11px 18px",
                                        borderRadius: RADIUS.md,
                                        background: SURFACE.sheet,
                                        border: `1px solid ${SURFACE.hairline}`,
                                        opacity: o,
                                        transform: `translateY(${(1 - o) * 8}px)`,
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                        <span
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 13 : 14,
                                                padding: "3px 8px",
                                                borderRadius: 5,
                                                background: "rgba(251,80,102,0.16)",
                                                color: CORAL,
                                            }}
                                        >
                                            rls-disabled
                                        </span>
                                        <span style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: tall ? 17 : 20, color: INK.high }}>
                                            {t.name}
                                        </span>
                                    </div>
                                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 15, color: INK.muted }}>
                                        {tall ? "anon + authenticated" : `${t.grants} · anon`}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    <div
                        style={{
                            marginTop: tall ? 12 : 14,
                            display: "flex",
                            justifyContent: "space-between",
                            fontFamily: FONT.mono,
                            fontSize: tall ? 14 : 16,
                            color: INK.muted,
                            opacity: alertO,
                        }}
                    >
                        <span>+ 5 more tables granted to anon &amp; authenticated</span>
                        <span style={{ color: CORAL }}>exit 1</span>
                    </div>
                </Window>
            </At>
        </>
    );
};

/* ── Scene 2: schema — defineTable -> real Postgres RLS + clean scan ─ */

const H_SCHEMA = "Security lives in Postgres.";

const TABLE_CODE = `export const orders = defineTable("orders", {
  columns: {
    id:          col.uuid().primaryKey().defaultRandom(),
    customer_id: col.text().notNull(),
    status:      col.enum(["open", "paid", "shipped"]),
    total:       col.numeric({ precision: 10, scale: 2 }),
  },
  rls: [
    { name: "own_orders", operation: "select",
      ownerField: "customer_id" },
  ],
});`;

const POLICY_SQL = `ALTER TABLE "public"."orders"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_orders" ON "public"."orders"
  FOR SELECT TO rebase_user
  USING ((customer_id)::text = (SELECT rebase.uid()));`;

const Schema: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_SCHEMA);
    const tall = format === "tall";

    const atDeclare = useCue({ line: "schema", word: "Rebase,", plus: -4 }) ?? 18;
    const atPush = useCue({ line: "schema", word: "security", plus: -4 }) ?? 55;
    const atEnforces = useCue({ line: "schema", word: "database,", plus: -4 }) ?? 70;

    const sqlO = ramp(frame, Math.min(atPush, 45), 14, ENTER);
    const cleanO = ramp(frame, atEnforces, 14, ENTER);

    return (
        <>
            <Headline text={H_SCHEMA} at={2} accent={CYAN} mark={["Postgres"]} />
            <At x={x} y={y} w={w}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 10 : 24, alignItems: "stretch" }}>
                    {/* Left: TypeScript table definition */}
                    <div style={{ flex: tall ? undefined : 1.05 }}>
                        <Editor
                            file="backend/schema/orders.ts"
                            code={TABLE_CODE}
                            size={tall ? 14 : 17}
                            at={Math.min(4, atDeclare)}
                            step={1.5}
                            accent={CYAN}
                        />
                    </div>

                    {/* Right: Compiled Postgres policy + clean scan */}
                    <div style={{ flex: tall ? undefined : 1, display: "flex", flexDirection: "column", gap: tall ? 10 : 18 }}>
                        <div style={{ opacity: sqlO, transform: `translateY(${(1 - sqlO) * 10}px)` }}>
                            <Editor
                                file="compiled · postgres policy"
                                code={POLICY_SQL}
                                size={tall ? 14 : 17}
                                at={Math.min(atPush, 45) + 4}
                                step={2}
                                accent={GREEN}
                                sql
                            />
                        </div>

                        {/* rls-check flip card */}
                        <div
                            style={{
                                borderRadius: RADIUS.xl,
                                border: `1.5px solid ${cleanO > 0.5 ? GREEN : TONE.claim.cardBorder}`,
                                background: cleanO > 0.5 ? "rgba(8,9,10,0.86)" : "rgba(8,9,10,0.65)",
                                padding: tall ? "10px 18px" : "20px 24px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                opacity: ramp(frame, 8, 12, ENTER),
                            }}
                        >
                            <div>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, letterSpacing: "0.14em", color: INK.muted }}>
                                    REBASE DB PUSH → RLS-CHECK
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: tall ? 17 : 20,
                                            color: CORAL,
                                            textDecoration: cleanO > 0.5 ? "line-through" : "none",
                                            opacity: cleanO > 0.5 ? 0.55 : 1,
                                        }}
                                    >
                                        9 critical
                                    </span>
                                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 18 : 20, color: INK.muted, opacity: cleanO }}>→</span>
                                    <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 20 : 24, color: GREEN, opacity: cleanO }}>
                                        0 critical · clean
                                    </span>
                                </div>
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "8px 14px",
                                    borderRadius: 99,
                                    background: "rgba(52,211,153,0.16)",
                                    border: `1px solid ${GREEN}`,
                                    opacity: cleanO,
                                }}
                            >
                                <ShieldIcon color={GREEN} size={18} />
                                <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 14 : 16, color: GREEN }}>
                                    ENFORCED
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── Scene 3: panel — real HD CMS + Studio video footage ───────────── */

const H_PANEL = "API and panel from one file.";

const SURFACES = ["REST API", "Typed SDK", "Realtime", "Auth", "Storage", "Functions"] as const;

const Panel: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_PANEL);
    const tall = format === "tall";

    const atStudio = useCue({ line: "panel", word: "Studio,", plus: -6 }) ?? 90;
    const atRls = useCue({ line: "panel", word: "obeying", plus: -4 }) ?? 115;

    const studioBlend = ramp(frame, atStudio, 14, SHIFT);
    const rlsO = ramp(frame, atRls, 12, ENTER);
    const frameH = tall ? 520 : 480;

    return (
        <>
            <Headline text={H_PANEL} at={2} accent={CYAN} mark={["one", "file"]} />
            <At x={x} y={y} w={w}>
                {/* Backend surface pills */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: tall ? 8 : 12, marginBottom: tall ? 14 : 18 }}>
                    {SURFACES.map((s, i) => {
                        const o = ramp(frame, 2 + i * 3, 10, ENTER);
                        return (
                            <div
                                key={s}
                                style={{
                                    padding: tall ? "7px 13px" : "8px 16px",
                                    borderRadius: 99,
                                    border: `1px solid ${SURFACE.hairlineStrong}`,
                                    background: SURFACE.sheet,
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 15 : 17,
                                    color: INK.high,
                                    opacity: o,
                                    transform: `translateY(${(1 - o) * 6}px)`,
                                }}
                            >
                                <span style={{ color: CYAN, marginRight: 8 }}>•</span>
                                {s}
                            </div>
                        );
                    })}
                </div>

                {/* Real 2x retina product footage: CMS -> Studio */}
                <div
                    style={{
                        position: "relative",
                        width: "100%",
                        height: frameH,
                        borderRadius: RADIUS.xl,
                        overflow: "hidden",
                        border: `1.5px solid ${SURFACE.hairlineStrong}`,
                        background: SURFACE.well,
                        opacity: ramp(frame, 0, 10, ENTER),
                    }}
                >
                    {/* Top browser/mode bar */}
                    <div
                        style={{
                            position: "relative",
                            zIndex: 3,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "10px 18px",
                            background: SURFACE.sheet,
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontWeight: 600,
                                    fontSize: tall ? 14 : 16,
                                    padding: "4px 12px",
                                    borderRadius: 6,
                                    background: studioBlend < 0.5 ? "rgba(54,204,214,0.16)" : "transparent",
                                    color: studioBlend < 0.5 ? CYAN : INK.muted,
                                }}
                            >
                                Rebase CMS
                            </span>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontWeight: 600,
                                    fontSize: tall ? 14 : 16,
                                    padding: "4px 12px",
                                    borderRadius: 6,
                                    background: studioBlend >= 0.5 ? "rgba(54,204,214,0.16)" : "transparent",
                                    color: studioBlend >= 0.5 ? CYAN : INK.muted,
                                }}
                            >
                                Rebase Studio
                            </span>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "4px 12px",
                                borderRadius: 99,
                                background: "rgba(52,211,153,0.14)",
                                border: `1px solid ${GREEN}`,
                                opacity: 0.4 + 0.6 * rlsO,
                            }}
                        >
                            <ShieldIcon color={GREEN} size={15} />
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: GREEN }}>
                                rebase_user · RLS enforced
                            </span>
                        </div>
                    </div>

                    {/* Video layer */}
                    <div style={{ position: "relative", width: "100%", height: frameH - 46 }}>
                        <div style={{ position: "absolute", inset: 0, opacity: 1 - studioBlend }}>
                            <OffthreadVideo
                                src={staticFile("demo/panel.mp4")}
                                muted
                                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left" }}
                            />
                        </div>
                        {frame >= Math.max(0, atStudio - 4) && (
                            <div style={{ position: "absolute", inset: 0, opacity: studioBlend }}>
                                <Sequence from={Math.max(0, atStudio - 4)} layout="none">
                                    <OffthreadVideo
                                        src={staticFile("demo/studio.mp4")}
                                        muted
                                        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left" }}
                                    />
                                </Sequence>
                            </div>
                        )}
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── Scene 4: agents — scoped keys, review queue & real Claude UI ──── */

const H_AGENTS = "Agents play by your rules.";

const Agents: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_AGENTS);
    const tall = format === "tall";

    const atKey = useCue({ line: "agents", word: "scoped", plus: -4 }) ?? 18;
    const atStage = useCue({ line: "agents", word: "staged", plus: -4 }) ?? 40;
    const atClaude = useCue({ line: "agents", word: "Claude", plus: -6 }) ?? 66;
    const atConfirm = useCue({ line: "agents", word: "confirm.", plus: -4 }) ?? 84;

    const keyO = ramp(frame, Math.min(4, atKey), 12, ENTER);
    const stageO = ramp(frame, Math.min(atStage, 42), 12, ENTER);
    const planBlend = ramp(frame, atConfirm, 12, SHIFT);

    return (
        <>
            <Headline text={H_AGENTS} at={2} accent={AMBER} mark={["your", "rules"]} />
            <At x={x} y={y} w={w}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 14 : 22, alignItems: "stretch" }}>
                    {/* Left: Scoped key + Review queue cards */}
                    <div style={{ width: tall ? "100%" : 470, display: "flex", flexDirection: tall ? "row" : "column", gap: tall ? 12 : 16 }}>
                        <div
                            style={{
                                flex: 1,
                                borderRadius: RADIUS.xl,
                                border: `1px solid ${SURFACE.hairlineStrong}`,
                                background: SURFACE.sheet,
                                padding: tall ? "14px 16px" : "20px 22px",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                opacity: keyO,
                            }}
                        >
                            <div>
                                <Label at={0} color={CYAN} size={tall ? 13 : 14}>SCOPED AGENT KEY</Label>
                                <div style={{ marginTop: 12, fontFamily: FONT.mono, fontSize: tall ? 16 : 19, color: INK.high }}>
                                    data:read:articles
                                </div>
                            </div>
                            <div
                                style={{
                                    marginTop: 10,
                                    padding: "8px 12px",
                                    borderRadius: RADIUS.md,
                                    background: "rgba(251,80,102,0.12)",
                                    border: `1px solid rgba(251,80,102,0.35)`,
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 13 : 15,
                                    color: CORAL,
                                }}
                            >
                                WRITE → 403 SCOPE_MISSING
                            </div>
                        </div>

                        <div
                            style={{
                                flex: 1,
                                borderRadius: RADIUS.xl,
                                border: `1px solid ${SURFACE.hairlineStrong}`,
                                background: SURFACE.sheet,
                                padding: tall ? "14px 16px" : "20px 22px",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                opacity: stageO,
                                transform: `translateY(${(1 - stageO) * 8}px)`,
                            }}
                        >
                            <div>
                                <Label at={Math.min(atStage, 42)} color={AMBER} size={tall ? 13 : 14}>REVIEW QUEUE</Label>
                                <div style={{ marginTop: 12, fontFamily: FONT.mono, fontSize: tall ? 16 : 19, color: INK.high }}>
                                    status: <span style={{ color: CORAL, textDecoration: "line-through" }}>paid</span>{" "}
                                    <span style={{ color: INK.muted }}>→</span> <span style={{ color: AMBER }}>refunded</span>
                                </div>
                            </div>
                            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
                                <span
                                    style={{
                                        padding: "4px 10px",
                                        borderRadius: 6,
                                        background: "rgba(245,158,11,0.16)",
                                        color: AMBER,
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 12 : 14,
                                    }}
                                >
                                    staged_changes
                                </span>
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 12 : 14, color: GREEN }}>
                                    → Human approves
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Right: Real Claude MCP App screenshot */}
                    <div
                        style={{
                            flex: 1,
                            borderRadius: RADIUS.xl,
                            border: `1.5px solid ${planBlend > 0.5 ? GREEN : SURFACE.hairlineStrong}`,
                            background: SURFACE.well,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            opacity: ramp(frame, 4, 12, ENTER),
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "10px 16px",
                                background: SURFACE.sheet,
                                borderBottom: `1px solid ${SURFACE.hairline}`,
                            }}
                        >
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: INK.high }}>
                                claude.ai · <span style={{ color: CYAN }}>app.rebase.pro/mcp</span>
                            </span>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontWeight: 600,
                                    fontSize: tall ? 12 : 14,
                                    padding: "3px 10px",
                                    borderRadius: 99,
                                    background: planBlend > 0.5 ? "rgba(52,211,153,0.16)" : "rgba(54,204,214,0.14)",
                                    color: planBlend > 0.5 ? GREEN : CYAN,
                                }}
                            >
                                {planBlend > 0.5 ? "PLAN → CONFIRM TO SAVE" : "show_collection · LIVE"}
                            </span>
                        </div>
                        <div style={{ position: "relative", width: "100%", height: tall ? 400 : 410, background: "#0D0F12" }}>
                            <Img
                                src={staticFile("claude/1-table.png")}
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    objectPosition: "top left",
                                    opacity: 1 - planBlend,
                                }}
                            />
                            <Img
                                src={staticFile("claude/2-edit-plan.png")}
                                style={{
                                    position: "absolute",
                                    inset: 0,
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    objectPosition: "top left",
                                    opacity: planBlend,
                                }}
                            />
                            <div
                                style={{
                                    position: "absolute",
                                    left: 14,
                                    bottom: 12,
                                    padding: "6px 12px",
                                    borderRadius: 8,
                                    background: "rgba(9,10,12,0.86)",
                                    border: `1px solid ${SURFACE.hairlineStrong}`,
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 12 : 14,
                                    color: INK.copy,
                                    opacity: ramp(frame, Math.min(atClaude, 50), 10, ENTER),
                                }}
                            >
                                OAuth 2.1 · acts as your account · no service key
                            </div>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── Scene 5: cloud — MIT self-host vs Rebase Cloud (bright payoff) ── */

const H_CLOUD = "Self-host MIT, or Cloud.";

const Cloud: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_CLOUD);
    const tall = format === "tall";

    const atCloud = useCue({ line: "cloud", word: "Cloud", plus: -4 }) ?? 34;
    const atExit = useCue({ line: "cloud", word: "exit", plus: -4 }) ?? 78;

    const ossO = ramp(frame, 0, 12, ENTER);
    const cloudO = ramp(frame, Math.min(atCloud, 38), 14, ENTER);
    const exitO = ramp(frame, atExit, 12, ENTER);

    const bullet = (text: string, color: string) => (
        <div key={text} style={{ display: "flex", alignItems: "baseline", gap: 10, fontFamily: FONT.body, fontSize: tall ? 20 : 21, color: INK.high }}>
            <span style={{ fontFamily: FONT.mono, color, fontWeight: 600 }}>✓</span>
            <span>{text}</span>
        </div>
    );

    return (
        <>
            <Headline text={H_CLOUD} at={2} accent={GREEN} mark={["Cloud"]} />
            <At x={x} y={y} w={w}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 16 : 24 }}>
                    {/* Left: MIT Self-Host */}
                    <div
                        style={{
                            flex: 1,
                            borderRadius: RADIUS.xl,
                            border: `1px solid ${SURFACE.hairlineStrong}`,
                            background: "rgba(17,19,22,0.88)",
                            padding: tall ? "20px 22px" : "28px 30px",
                            opacity: ossO,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottom: `1px solid ${SURFACE.hairline}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ width: 6, height: 6, borderRadius: 99, background: CYAN }} />
                                <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 15 : 17, letterSpacing: "0.14em", color: INK.high }}>
                                    SELF-HOST · MIT
                                </span>
                            </div>
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: INK.muted }}>
                                github.com/rebasepro
                            </span>
                        </div>
                        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: tall ? 10 : 14 }}>
                            {bullet("Keep your Postgres · boot from DATABASE_URL", CYAN)}
                            {bullet("Built-in PGlite locally & standalone Studio at /_studio", CYAN)}
                            {bullet("Full backend, defineRpc, CMS, Studio & MCP — 100% MIT", CYAN)}
                        </div>
                    </div>

                    {/* Right: Rebase Cloud */}
                    <div
                        style={{
                            flex: 1,
                            borderRadius: RADIUS.xl,
                            border: `1px solid ${cloudO > 0.5 ? "rgba(52,211,153,0.45)" : SURFACE.hairlineStrong}`,
                            background: "rgba(17,19,22,0.92)",
                            padding: tall ? "20px 22px" : "28px 30px",
                            opacity: 0.35 + 0.65 * cloudO,
                            transform: `translateY(${(1 - cloudO) * 10}px)`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottom: `1px solid ${SURFACE.hairline}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ width: 6, height: 6, borderRadius: 99, background: GREEN }} />
                                <span style={{ fontFamily: FONT.mono, fontWeight: 600, fontSize: tall ? 15 : 17, letterSpacing: "0.14em", color: INK.high }}>
                                    REBASE CLOUD
                                </span>
                            </div>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 13 : 14,
                                    padding: "3px 10px",
                                    borderRadius: 99,
                                    background: "rgba(52,211,153,0.14)",
                                    color: GREEN,
                                }}
                            >
                                PRIVATE BETA
                            </span>
                        </div>
                        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: tall ? 10 : 14 }}>
                            {bullet("Dedicated Postgres + automated backups", GREEN)}
                            {bullet("Priced per resource · €0 per CMS seat", GREEN)}
                            {bullet("Deploy from CLI, previews, or roll back in Claude", GREEN)}
                        </div>
                    </div>
                </div>

                {/* Same-day exit strip */}
                <div
                    style={{
                        marginTop: tall ? 16 : 22,
                        padding: tall ? "14px 18px" : "16px 24px",
                        borderRadius: RADIUS.xl,
                        border: `1px solid ${exitO > 0.5 ? "rgba(52,211,153,0.4)" : SURFACE.hairlineStrong}`,
                        background: "rgba(17,19,22,0.92)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        opacity: 0.4 + 0.6 * exitO,
                    }}
                >
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 18, color: INK.high }}>
                        pg_dump <span style={{ color: INK.muted }}>+</span> rebase eject{" "}
                        <span style={{ color: GREEN }}>→ same MIT image on your own server</span>
                    </span>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 15, color: GREEN }}>ZERO LOCK-IN</span>
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const INTRO_FILM: FilmSpec = checkFilm({
    id: "intro",
    number: 0,
    title: "Rebase — Product Introduction",
    accent: CYAN,
    backdrop: "dark",
    endCommand: "pnpm dlx @rebasepro/cli init",
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "problem", at: { line: "problem", plus: -26 }, render: Problem, roll: 0.24 },
        { id: "schema", at: { line: "schema", plus: 0 }, render: Schema, roll: 0.52, ground: GROUND.claim, reveal: 0.65 },
        { id: "panel", at: { line: "panel", plus: 0 }, render: Panel, roll: 0.72 },
        { id: "agents", at: { line: "agents", plus: 0 }, render: Agents, roll: 0.36 },
        { id: "cloud", at: { line: "cloud", plus: 0 }, render: Cloud, roll: 0.16, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.48 },
    ],
});
