import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
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
 * 06 — PROVE PERMISSIONS BEFORE PROD (`rls-simulate`).
 *
 * Stop eyeballing raw Postgres CREATE POLICY SQL and hoping buyers cannot
 * read someone else's invoices. Run `rebase rls simulate` or enable Studio's
 * `<Rebase simulateAccess>` switcher to inspect exact per-table visibility
 * across every role, user, and scoped agent key, and let `rebase verify`
 * catch `rls-policy-recursion` (42P17) loops before deploy.
 */

const ACCENT = CHROMA.cyan;
const CORAL = CHROMA.coral;
const GREEN = "#34D399";
const AMBER = "#F59E0B";

const SCRIPT = lines([
    ["hook", "Almost nobody tests row-level security across five roles and fifteen tables, because doing it by hand takes days."],
    ["guess", "So teams eyeball the SQL, push to production, and hope one buyer can't read someone else's invoices."],
    ["sim", "With Rebase, run the simulator from the terminal, or turn on Simulate Access inside Studio."],
    ["matrix", "Pick any person, role, or scoped agent key, and see, across every table, what Postgres serves and what comes back forbidden."],
    ["loop", "Before you deploy, the verifier also catches policies that reference each other in a loop, which would otherwise crash with infinite recursion."],
    ["close", "Stop guessing what your rules allow. Prove it before launch."],
]);

/* ── inline icons (no emojis) ───────────────────────────────────────── */

const SearchAlertIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="9" cy="9" r="6" stroke={color} strokeWidth="1.7" />
        <path d="M13.6 13.6L17.5 17.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9 6.3V9.5M9 11.7V11.8" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
);

const EyeIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <path
            d="M2.2 10C3.8 6.7 6.7 4.8 10 4.8C13.3 4.8 16.2 6.7 17.8 10C16.2 13.3 13.3 15.2 10 15.2C6.7 15.2 3.8 13.3 2.2 10Z"
            stroke={color}
            strokeWidth="1.6"
        />
        <circle cx="10" cy="10" r="2.4" stroke={color} strokeWidth="1.6" />
    </svg>
);

const WrenchCheckIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="10" cy="10" r="7.5" stroke={color} strokeWidth="1.6" />
        <path d="M7 10.2L9 12.2L13.3 7.9" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/* ── scene 1: guess ─────────────────────────────────────────────────── */

const TANGLED_SQL = `CREATE POLICY orders_buyer_read ON public.orders
  FOR SELECT TO rebase_user
  USING (customer_id = current_setting('app.uid', true));

CREATE POLICY invoices_buyer_read ON public.invoices
  FOR SELECT TO rebase_user
  USING (status <> 'draft' OR issued_at IS NOT NULL);

CREATE POLICY customers_staff_read ON public.customers
  FOR SELECT TO rebase_user
  USING (current_setting('app.role', true) IN ('admin', 'support'));`;

const H_GUESS = "Eyeballing SQL hides leaks.";

const Guess: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_GUESS);
    const tall = format === "tall";

    const atPray = useCue({ line: "guess", word: "hope", plus: -4 }) ?? 22;
    const leakO = ramp(frame, Math.max(6, atPray), 12, ENTER);
    const pulse = 0.65 + 0.35 * Math.sin(frame * 0.22);

    const codeSize = tall ? 17 : 21;
    const lineH = codeSize * 1.65;
    // Lines 5..7 (0-indexed: 4..6) are the leaky invoices policy
    const leakBandTop = lineH * 4;
    const leakBandHeight = lineH * 3;

    return (
        <>
            <Headline text={H_GUESS} at={0} accent={CORAL} mark={["hides", "leaks."]} />
            <At x={x} y={y} w={w}>
                <div style={{ position: "relative" }}>
                    <Editor
                        file="migrations/0014_rls_policies.sql"
                        code={TANGLED_SQL}
                        size={codeSize}
                        at={0}
                        step={2}
                        accent={CORAL}
                        sql
                    >
                        {/* Glowing coral highlight across the leaky invoices policy */}
                        <div
                            style={{
                                position: "absolute",
                                left: -10,
                                right: 14,
                                top: leakBandTop - 3,
                                height: leakBandHeight + 6,
                                borderRadius: RADIUS.lg,
                                background: `rgba(251,80,102,${(0.12 + 0.06 * pulse) * leakO})`,
                                border: `1.5px solid rgba(251,80,102,${0.85 * leakO})`,
                                boxShadow: `0 0 24px rgba(251,80,102,${0.25 * leakO})`,
                                pointerEvents: "none",
                            }}
                        />
                    </Editor>

                    {/* Magnifying callout card */}
                    <div
                        style={{
                            position: tall ? "relative" : "absolute",
                            right: tall ? undefined : 24,
                            bottom: tall ? undefined : -38,
                            marginTop: tall ? 16 : 0,
                            width: tall ? w : 520,
                            padding: tall ? "15px 18px" : "18px 22px",
                            borderRadius: RADIUS.xl,
                            background: SURFACE.well,
                            border: `2px solid ${CORAL}`,
                            boxShadow: `0 0 32px rgba(251,80,102,${0.26 * pulse})`,
                            opacity: 0.3 + 0.7 * leakO,
                            transform: leakO < 1 ? `translateY(${(1 - leakO) * 14}px)` : undefined,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <SearchAlertIcon color={CORAL} size={20} />
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, letterSpacing: "0.14em", color: CORAL, fontWeight: 600 }}>
                                    SILENT CROSS-TENANT LEAK
                                </span>
                            </div>
                            <span
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: 12,
                                    color: GROUND.base,
                                    background: CORAL,
                                    padding: "2px 8px",
                                    borderRadius: RADIUS.md,
                                    fontWeight: 600,
                                }}
                            >
                                LINES 5–7
                            </span>
                        </div>
                        <div style={{ fontFamily: FONT.mono, fontSize: tall ? 18 : 21, color: INK.high, fontWeight: 600 }}>
                            invoices · missing tenant check
                        </div>
                        <div style={{ fontFamily: FONT.body, fontSize: tall ? 15 : 17, color: INK.copy, marginTop: 4 }}>
                            No customer_id = rebase.uid() filter — every buyer reads all invoices.
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 2: sim ───────────────────────────────────────────────────── */

const H_SIM = "Simulate from CLI or Studio.";

const Sim: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_SIM);
    const tall = format === "tall";

    const atStudio = useCue({ line: "sim", word: "Studio", plus: -10 }) ?? 30;
    const studioPop = ramp(frame, Math.max(8, atStudio), 12, ENTER);

    return (
        <>
            <Headline text={H_SIM} at={0} accent={ACCENT} mark={["CLI", "Studio."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        gap: tall ? 18 : 24,
                        alignItems: "stretch",
                    }}
                >
                    {/* Top/Left: Terminal */}
                    <div style={{ flex: 1 }}>
                        <Window title="zsh — rebase rls" at={-2} pad={tall ? "15px 18px" : "20px 24px"}>
                            <Prompt command="rebase rls simulate --user alice@acme.io" at={2} size={tall ? 18 : 20} rate={0.38} />
                            <Log
                                size={tall ? 15 : 18}
                                lines={[
                                    { text: "", at: 18 },
                                    { text: "  As alice@acme.io   roles: buyer", at: 18, color: INK.high },
                                    { text: "  orders      1 of 42 rows", at: 24, color: GREEN },
                                    { text: "  invoices    1 of 42 rows", at: 28, color: GREEN },
                                    { text: "  customers   1 of 18 rows", at: 32, color: GREEN },
                                    { text: "  audit_logs  0 of 904 rows  (policies hide every row)", at: 36, color: CORAL },
                                ]}
                            />
                        </Window>
                    </div>

                    {/* Bottom/Right: Studio Simulate Access bar */}
                    <div
                        style={{
                            flex: 1,
                            borderRadius: RADIUS.xl,
                            border: `1.5px solid ${studioPop > 0.5 ? ACCENT : SURFACE.hairlineStrong}`,
                            background: SURFACE.well,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                            justifyContent: "space-between",
                            opacity: 0.45 + 0.55 * studioPop,
                            transform: studioPop < 1 ? `translateY(${(1 - studioPop) * 10}px)` : undefined,
                        }}
                    >
                        {/* Studio top bar */}
                        <div
                            style={{
                                padding: tall ? "12px 16px" : "15px 20px",
                                background: SURFACE.sheet,
                                borderBottom: `1px solid ${SURFACE.hairline}`,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 10,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ width: 6, height: 6, borderRadius: 99, background: ACCENT, flexShrink: 0 }} />
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, letterSpacing: "0.08em", color: INK.copy }}>
                                    Rebase Studio
                                </span>
                            </div>

                            {/* Active Simulate Access pill */}
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: tall ? "6px 12px" : "7px 14px",
                                    borderRadius: 99,
                                    background: "rgba(54,204,214,0.16)",
                                    border: `1.5px solid ${ACCENT}`,
                                }}
                            >
                                <EyeIcon color={ACCENT} size={16} />
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 15, color: INK.high, fontWeight: 600 }}>
                                    Simulating: <span style={{ color: ACCENT }}>buyer</span> · alice@acme.io
                                </span>
                            </div>
                        </div>

                        {/* Body inside Studio card */}
                        <div style={{ padding: tall ? "14px 18px" : "20px 22px", display: "flex", flexDirection: "column", gap: tall ? 10 : 14 }}>
                            <div
                                style={{
                                    padding: tall ? "10px 14px" : "12px 16px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.sheet,
                                    border: `1px solid ${SURFACE.hairline}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}
                            >
                                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 19, color: ACCENT, fontWeight: 600 }}>
                                    {`<Rebase simulateAccess />`}
                                </span>
                                <span
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: 12,
                                        color: GREEN,
                                        padding: "3px 9px",
                                        borderRadius: RADIUS.md,
                                        background: "rgba(52,211,153,0.14)",
                                    }}
                                >
                                    ACTIVE
                                </span>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                {[
                                    { label: "MODE", val: "Read-only preview", tone: INK.high },
                                    { label: "AUTH", val: "Admin session only", tone: AMBER },
                                ].map((item) => (
                                    <div
                                        key={item.label}
                                        style={{
                                            padding: tall ? "9px 12px" : "11px 14px",
                                            borderRadius: RADIUS.lg,
                                            background: SURFACE.card,
                                            border: `1px solid ${SURFACE.hairline}`,
                                        }}
                                    >
                                        <div style={{ fontFamily: FONT.mono, fontSize: 12, letterSpacing: "0.14em", color: INK.muted }}>
                                            {item.label}
                                        </div>
                                        <div style={{ fontFamily: FONT.body, fontSize: tall ? 14 : 16, color: item.tone, fontWeight: 600, marginTop: 3 }}>
                                            {item.val}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 15, color: INK.copy }}>
                                ✓ Same <span style={{ color: INK.high }}>/api/admin/rls-simulator</span> engine as the CLI
                            </div>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 3: matrix ────────────────────────────────────────────────── */

interface MatrixCell {
    text: string;
    kind: "own" | "all" | "denied";
}

interface MatrixRow {
    table: string;
    cells: [MatrixCell, MatrixCell, MatrixCell, MatrixCell];
}

const COLUMNS = [
    { name: "anon", sub: "signed out" },
    { name: "buyer (alice)", sub: "user session" },
    { name: "support", sub: "staff role" },
    { name: "rk_live_bot", sub: "scoped key" },
] as const;

const MATRIX: MatrixRow[] = [
    {
        table: "orders",
        cells: [
            { text: "0 · FORBIDDEN", kind: "denied" },
            { text: "1 row", kind: "own" },
            { text: "42 rows", kind: "all" },
            { text: "42 rows", kind: "all" },
        ],
    },
    {
        table: "invoices",
        cells: [
            { text: "0 · FORBIDDEN", kind: "denied" },
            { text: "1 row", kind: "own" },
            { text: "42 rows", kind: "all" },
            { text: "0 · FORBIDDEN", kind: "denied" },
        ],
    },
    {
        table: "customers",
        cells: [
            { text: "0 · FORBIDDEN", kind: "denied" },
            { text: "1 row", kind: "own" },
            { text: "18 rows", kind: "all" },
            { text: "0 · FORBIDDEN", kind: "denied" },
        ],
    },
    {
        table: "audit_logs",
        cells: [
            { text: "0 · FORBIDDEN", kind: "denied" },
            { text: "0 · FORBIDDEN", kind: "denied" },
            { text: "0 · FORBIDDEN", kind: "denied" },
            { text: "0 · FORBIDDEN", kind: "denied" },
        ],
    },
];

const H_MATRIX = "Every table. Every identity.";

const Matrix: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_MATRIX);
    const tall = format === "tall";

    const atPerson = useCue({ line: "matrix", word: "person", plus: -4 }) ?? 12;
    const atRole = useCue({ line: "matrix", word: "role", plus: -4 }) ?? 22;
    const atAgent = useCue({ line: "matrix", word: "agent", plus: -4 }) ?? 34;

    const colStarts = [
        2,
        Math.max(8, atPerson),
        Math.max(16, atRole),
        Math.max(24, atAgent),
    ];

    const tableColW = tall ? 164 : 240;

    return (
        <>
            <Headline text={H_MATRIX} at={0} accent={ACCENT} mark={["Every", "identity."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: RADIUS.xl,
                        background: SURFACE.well,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        overflow: "hidden",
                        opacity: ramp(frame, 0, 10, ENTER),
                    }}
                >
                    {/* Matrix header bar */}
                    <div
                        style={{
                            padding: tall ? "12px 18px" : "15px 24px",
                            background: SURFACE.sheet,
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 99, background: ACCENT, flexShrink: 0 }} />
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, letterSpacing: "0.14em", color: INK.high, fontWeight: 600 }}>
                                LIVE PERMISSION MATRIX
                            </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 12 : 14, color: GREEN }}>
                                ✓ rows served
                            </span>
                            <span style={{ fontFamily: FONT.mono, fontSize: tall ? 12 : 14, color: CORAL }}>
                                × 0 · FORBIDDEN
                            </span>
                        </div>
                    </div>

                    {/* Column headers */}
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: `${tableColW}px repeat(4, 1fr)`,
                            borderBottom: `1px solid ${SURFACE.hairlineStrong}`,
                            background: SURFACE.card,
                        }}
                    >
                        <div
                            style={{
                                padding: tall ? "12px 14px" : "14px 20px",
                                fontFamily: FONT.mono,
                                fontSize: tall ? 13 : 14,
                                letterSpacing: "0.12em",
                                color: INK.muted,
                                display: "flex",
                                alignItems: "center",
                            }}
                        >
                            TABLE
                        </div>
                        {COLUMNS.map((col, ci) => {
                            const co = ramp(frame, colStarts[ci], 10, ENTER);
                            return (
                                <div
                                    key={col.name}
                                    style={{
                                        padding: tall ? "10px 8px" : "12px 14px",
                                        borderLeft: `1px solid ${SURFACE.hairline}`,
                                        textAlign: "center",
                                        opacity: 0.35 + 0.65 * co,
                                    }}
                                >
                                    <div style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 17, color: INK.high, fontWeight: 600 }}>
                                        {col.name}
                                    </div>
                                    <div style={{ fontFamily: FONT.body, fontSize: tall ? 12 : 13, color: INK.muted, marginTop: 2 }}>
                                        {col.sub}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Matrix rows */}
                    {MATRIX.map((row, ri) => (
                        <div
                            key={row.table}
                            style={{
                                display: "grid",
                                gridTemplateColumns: `${tableColW}px repeat(4, 1fr)`,
                                borderBottom: ri < MATRIX.length - 1 ? `1px solid ${SURFACE.hairline}` : undefined,
                            }}
                        >
                            <div
                                style={{
                                    padding: tall ? "18px 14px" : "20px 20px",
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 16 : 20,
                                    color: INK.high,
                                    fontWeight: 600,
                                    display: "flex",
                                    alignItems: "center",
                                }}
                            >
                                {row.table}
                            </div>
                            {row.cells.map((cell, ci) => {
                                const o = ramp(frame, colStarts[ci] + ri * 3, 10, ENTER);
                                const isDenied = cell.kind === "denied";
                                const isOwn = cell.kind === "own";
                                const fg = isDenied ? CORAL : isOwn ? GREEN : ACCENT;
                                const bg = isDenied
                                    ? "rgba(251,80,102,0.14)"
                                    : isOwn
                                      ? "rgba(52,211,153,0.14)"
                                      : "rgba(54,204,214,0.14)";
                                const bd = isDenied
                                    ? "rgba(251,80,102,0.48)"
                                    : isOwn
                                      ? "rgba(52,211,153,0.48)"
                                      : "rgba(54,204,214,0.48)";
                                return (
                                    <div
                                        key={`${row.table}-${ci}`}
                                        style={{
                                            padding: tall ? "12px 6px" : "14px 12px",
                                            borderLeft: `1px solid ${SURFACE.hairline}`,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontFamily: FONT.mono,
                                                fontSize: tall ? 13 : 16,
                                                fontWeight: 600,
                                                color: fg,
                                                background: bg,
                                                border: `1.5px solid ${bd}`,
                                                borderRadius: RADIUS.lg,
                                                padding: tall ? "6px 8px" : "7px 14px",
                                                whiteSpace: "nowrap",
                                                opacity: o,
                                                transform: o < 1 ? `translateY(${(1 - o) * 8}px)` : undefined,
                                            }}
                                        >
                                            {cell.text}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    ))}

                    {/* Footer */}
                    <div
                        style={{
                            padding: tall ? "11px 18px" : "13px 24px",
                            background: SURFACE.sheet,
                            borderTop: `1px solid ${SURFACE.hairline}`,
                            display: "flex",
                            justifyContent: "space-between",
                            fontFamily: FONT.mono,
                            fontSize: tall ? 13 : 15,
                            color: INK.copy,
                        }}
                    >
                        <span>Evaluated live by Postgres RLS</span>
                        <span style={{ color: ACCENT }}>0 rows modified</span>
                    </div>
                </div>
            </At>
        </>
    );
};

/* ── scene 4: loop (bright payoff) ──────────────────────────────────── */

const H_LOOP = "Catch recursion before deploy.";

const Loop: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_LOOP);
    const tall = format === "tall";

    const atLoop = useCue({ line: "loop", word: "loop", plus: -4 }) ?? 22;
    const atStopping = useCue({ line: "loop", word: "crash", plus: -2 }) ?? 38;

    const diagO = ramp(frame, 0, 10, ENTER);
    const loopLit = ramp(frame, Math.max(4, atLoop - 6), 12, ENTER);
    const fixO = ramp(frame, Math.max(22, atStopping), 12, ENTER);
    const pruneO = ramp(frame, Math.max(28, atStopping + 8), 12, ENTER);
    const dashOffset = -frame * 1.6;

    const cycleCard = (
        <div
            style={{
                width: tall ? w : 490,
                flexShrink: 0,
                borderRadius: RADIUS.xl,
                background: SURFACE.well,
                border: `1.5px solid rgba(251,80,102,${0.45 + 0.45 * loopLit})`,
                padding: tall ? "14px 18px" : "20px 22px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                opacity: diagO,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: tall ? 8 : 12 }}>
                <span style={{ fontFamily: FONT.mono, fontSize: 13, letterSpacing: "0.14em", color: CORAL, fontWeight: 600 }}>
                    • POLICY CYCLE GRAPH
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
                    42P17 LOOP
                </span>
            </div>

            {/* Inline SVG cycle diagram: projects policy <-> members policy */}
            <svg
                viewBox="0 0 440 180"
                style={{ width: "100%", height: tall ? 134 : 210, display: "block" }}
            >
                <defs>
                    <marker id="arrow-coral" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M 1 1 L 9 5 L 1 9 z" fill={CORAL} />
                    </marker>
                </defs>

                {/* Top arc: projects -> members */}
                <path
                    d="M 118 58 C 170 12, 270 12, 322 58"
                    fill="none"
                    stroke={CORAL}
                    strokeWidth="2.6"
                    strokeDasharray="8 6"
                    strokeDashoffset={dashOffset}
                    markerEnd="url(#arrow-coral)"
                    opacity={0.4 + 0.6 * loopLit}
                />
                {/* Bottom arc: members -> projects */}
                <path
                    d="M 322 122 C 270 168, 170 168, 118 122"
                    fill="none"
                    stroke={CORAL}
                    strokeWidth="2.6"
                    strokeDasharray="8 6"
                    strokeDashoffset={dashOffset}
                    markerEnd="url(#arrow-coral)"
                    opacity={0.4 + 0.6 * loopLit}
                />

                {/* Left node: projects */}
                <rect x="14" y="58" width="144" height="64" rx="10" fill={SURFACE.sheet} stroke={CORAL} strokeWidth="1.8" />
                <text x="86" y="84" textAnchor="middle" fill={INK.high} fontFamily={FONT.mono} fontSize="16" fontWeight="600">
                    projects
                </text>
                <text x="86" y="106" textAnchor="middle" fill={INK.copy} fontFamily={FONT.mono} fontSize="12">
                    SELECT members
                </text>

                {/* Right node: members */}
                <rect x="282" y="58" width="144" height="64" rx="10" fill={SURFACE.sheet} stroke={CORAL} strokeWidth="1.8" />
                <text x="354" y="84" textAnchor="middle" fill={INK.high} fontFamily={FONT.mono} fontSize="16" fontWeight="600">
                    members
                </text>
                <text x="354" y="106" textAnchor="middle" fill={INK.copy} fontFamily={FONT.mono} fontSize="12">
                    SELECT projects
                </text>

                {/* Center pill */}
                <rect x="174" y="74" width="92" height="32" rx="16" fill="rgba(251,80,102,0.18)" stroke={CORAL} strokeWidth="1.5" />
                <text x="220" y="95" textAnchor="middle" fill={CORAL} fontFamily={FONT.mono} fontSize="13" fontWeight="600">
                    INFINITE
                </text>
            </svg>

            {!tall && (
                <div style={{ fontFamily: FONT.mono, fontSize: 14, color: INK.copy, textAlign: "center", marginTop: 8 }}>
                    Postgres refuses every query on both tables at runtime
                </div>
            )}
        </div>
    );

    const terminalAndFix = (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: tall ? 12 : 16 }}>
            <Window title="zsh — rebase verify" at={-2} pad={tall ? "13px 18px" : "18px 24px"} accent={CORAL}>
                <Prompt command="rebase verify" at={2} size={tall ? 19 : 23} rate={0.45} />
                <Log
                    size={tall ? 15 : 18}
                    lines={[
                        { text: "", at: 12 },
                        { text: "  × error  rls-policy-recursion  [projects]", at: 12, color: CORAL },
                        { text: '    "projects" (select) reads members → projects', at: 17, color: INK.high },
                        { text: "    42P17 infinite recursion detected in policy", at: 22, color: CORAL },
                        { text: "    1 error · deploy blocked before production", at: 27, color: INK.muted },
                    ]}
                />
            </Window>

            {/* Fix banner */}
            <div
                style={{
                    padding: tall ? "12px 16px" : "16px 22px",
                    borderRadius: RADIUS.xl,
                    background: "rgba(52,211,153,0.10)",
                    border: `1px solid ${GREEN}`,
                    opacity: 0.35 + 0.65 * fixO,
                    transform: fixO < 1 ? `translateY(${(1 - fixO) * 10}px)` : undefined,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 5 }}>
                    <WrenchCheckIcon color={GREEN} size={18} />
                    <span
                        style={{
                            fontFamily: FONT.mono,
                            fontSize: 12,
                            color: GROUND.base,
                            background: GREEN,
                            padding: "2px 8px",
                            borderRadius: RADIUS.md,
                            fontWeight: 600,
                        }}
                    >
                        REMEDY
                    </span>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 18, color: INK.high, fontWeight: 600 }}>
                        Move lookup into SECURITY DEFINER function
                    </span>
                </div>
                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 15, color: INK.copy }}>
                    CREATE FUNCTION public.can_access(…) LANGUAGE sql STABLE SECURITY DEFINER
                </div>
            </div>

            {/* Secondary pill: --prune-policies */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: tall ? "9px 16px" : "11px 18px",
                    borderRadius: RADIUS.lg,
                    background: SURFACE.sheet,
                    border: `1px solid ${SURFACE.hairlineStrong}`,
                    opacity: 0.35 + 0.65 * pruneO,
                    transform: pruneO < 1 ? `translateY(${(1 - pruneO) * 8}px)` : undefined,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: ACCENT, flexShrink: 0 }} />
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 14 : 15, color: INK.high, fontWeight: 600 }}>
                        rebase db push --prune-policies
                    </span>
                </div>
                <span style={{ fontFamily: FONT.mono, fontSize: tall ? 12 : 14, color: INK.muted, whiteSpace: "nowrap" }}>
                    drops orphaned policies no table declares
                </span>
            </div>
        </div>
    );

    return (
        <>
            <Headline text={H_LOOP} at={0} accent={CORAL} mark={["recursion"]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "flex",
                        flexDirection: tall ? "column" : "row",
                        gap: tall ? 16 : 24,
                        alignItems: "stretch",
                    }}
                >
                    {cycleCard}
                    {terminalAndFix}
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const RLS_SIMULATE: FilmSpec = checkFilm({
    id: "rls-simulate",
    number: 6,
    title: "Prove permissions before prod",
    accent: ACCENT,
    endCommand: "rebase rls simulate",
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "guess", at: { line: "guess", plus: -26 }, render: Guess, roll: 0.34 },
        { id: "sim", at: { line: "sim", plus: 0 }, render: Sim, roll: 0.62 },
        { id: "matrix", at: { line: "matrix", plus: 0 }, render: Matrix, roll: 0.2 },
        { id: "loop", at: { line: "loop", plus: 0 }, render: Loop, roll: 0.78, bright: true },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.48 },
    ],
});
