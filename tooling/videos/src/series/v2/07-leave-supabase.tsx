import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, RADIUS, SURFACE } from "../../theme";
import { At, checkFilm, Headline, lines, Prompt, useBodyFor, useCue, type FilmSpec } from "../kit";

/**
 * 07 — ONE-COMMAND SUPABASE ESCAPE.
 *
 * Moving off Supabase by hand fails on the first statement because schema
 * dumps depend on `auth.uid()`, `auth.users`, and proprietary roles. One
 * `rebase schema introspect --from supabase` command translates every table
 * and policy into clean Rebase TypeScript, and writes everything outside
 * tables into a SQL file you can execute directly on Rebase Cloud.
 *
 * Real: every command, conversion rule, and filename matches
 * website/src/content/docs/docs/recipes/migrate-from-supabase.md.
 */

const ACCENT = "#34D399";
const CORAL = CHROMA.coral;
const CYAN = CHROMA.cyan;
const AMBER = "#F59E0B";

const SCRIPT = lines([
    ["hook", "Move off Supabase by hand, and the first migration fails on proprietary auth functions before a single table loads."],
    ["why", "Your schema is tangled up with custom Postgres roles, UUID user links, and service-role shortcuts."],
    ["cmd", "Point the Rebase schema introspector at your live Supabase connection string. It takes one flag."],
    ["translate", "It rewrites user defaults into server hooks, turns authenticated and anon rules into clean policies, and drops the service-role backdoors."],
    ["honest", "Here's the catch: triggers, custom SQL functions, and check constraints aren't translated. They're saved to a file you can run directly on Rebase Cloud."],
    ["close", "Every user ID carries over, the stack is yours, and lock-in stays behind."],
]);

/* ── inline glyphs (zero emojis) ────────────────────────────────────── */

const AlertGlyph: React.FC<{ color: string; size?: number }> = ({ color, size = 20 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <path d="M10 2.5 L18 16.5 H2 Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M10 8 V11.8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="10" cy="14.2" r="1" fill={color} />
    </svg>
);

const LinkGlyph: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <path d="M8.5 11.5 L11.5 8.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M11 6 L13 4 C14.6 2.4 17.2 5 15.6 6.6 L13.8 8.4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9 14 L7 16 C5.4 17.6 2.8 15 4.4 13.4 L6.2 11.6" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
);

const FileGlyph: React.FC<{ color: string; size?: number }> = ({ color, size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0 }}>
        <path d="M5 2.5 H12 L16 6.5 V17.5 H5 Z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M12 2.5 V6.5 H16" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: badgeColor, flexShrink: 0 }} />
            <span style={{ fontFamily: FONT.mono, fontSize: 14, letterSpacing: "0.08em", color: INK.copy }}>{title}</span>
        </div>
        {badge && (
            <span
                style={{
                    fontFamily: FONT.mono,
                    fontSize: 12,
                    letterSpacing: "0.1em",
                    color: badgeColor,
                    padding: "3px 10px",
                    borderRadius: RADIUS.md,
                    border: `1px solid ${badgeColor}44`,
                    background: `${badgeColor}12`,
                }}
            >
                {badge}
            </span>
        )}
    </div>
);

/* ── scene 1: why raw migration dies ────────────────────────────────── */

const H_WHY = "Tangled in proprietary SQL.";

interface TangledChip {
    code: string;
    label: string;
}

const TANGLED: readonly TangledChip[] = [
    { code: "TO authenticated / anon", label: "custom Postgres roles" },
    { code: "references auth.users(id)", label: "UUID user links" },
    { code: "TO service_role", label: "service-role shortcuts" },
];

const Why: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_WHY);
    const tall = format === "tall";
    const cRoles = useCue({ line: "why", word: "roles", plus: -4 }) ?? 9999;
    const cLinks = useCue({ line: "why", word: "links", plus: -4 }) ?? 9999;
    const cShort = useCue({ line: "why", word: "shortcuts", plus: -4 }) ?? 9999;
    const chipAts = [cRoles, cLinks, cShort];

    const shellO = ramp(frame, 0, 8, ENTER);
    const errO = ramp(frame, 6, 10, ENTER);
    const monoSz = tall ? 19 : 23;

    return (
        <>
            <Headline text={H_WHY} at={0} accent={CORAL} mark={["proprietary"]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: RADIUS.xl,
                        border: `1px solid rgba(251,80,102,0.34)`,
                        background: SURFACE.well,
                        overflow: "hidden",
                        opacity: shellO,
                        transform: shellO < 1 ? `translateY(${(1 - shellO) * 10}px)` : undefined,
                    }}
                >
                    <TerminalBar title='psql "$DATABASE_URL" -f dump.sql' badge="EXIT 1" badgeColor={CORAL} />
                    <div style={{ padding: tall ? "18px 20px" : "22px 26px", fontFamily: FONT.mono, fontSize: monoSz, lineHeight: 1.55 }}>
                        <div style={{ color: INK.muted }}>
                            <span style={{ color: INK.high }}>CREATE TABLE</span> public.projects (
                        </div>
                        <div style={{ color: INK.copy, paddingLeft: tall ? 14 : 24 }}>
                            id uuid primary key,
                        </div>
                        <div style={{ color: INK.high, paddingLeft: tall ? 14 : 24 }}>
                            owner_id uuid{" "}
                            <span
                                style={{
                                    color: CORAL,
                                    background: "rgba(251,80,102,0.16)",
                                    borderBottom: `2px solid ${CORAL}`,
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                }}
                            >
                                default auth.uid()
                            </span>
                        </div>
                        <div style={{ color: INK.muted }}>);</div>

                        <div
                            style={{
                                marginTop: tall ? 14 : 18,
                                padding: tall ? "12px 14px" : "14px 18px",
                                borderRadius: RADIUS.lg,
                                background: "rgba(251,80,102,0.12)",
                                border: `1px solid rgba(251,80,102,0.45)`,
                                display: "flex",
                                alignItems: "flex-start",
                                gap: 12,
                                opacity: errO,
                                transform: errO < 1 ? `translateY(${(1 - errO) * 8}px)` : undefined,
                            }}
                        >
                            <div style={{ marginTop: 3 }}>
                                <AlertGlyph color={CORAL} size={tall ? 20 : 22} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ color: CORAL, fontWeight: 600, fontSize: tall ? 20 : 23 }}>
                                    ERROR: schema &quot;auth&quot; does not exist
                                </div>
                                <div style={{ color: "rgba(251,80,102,0.82)", fontSize: tall ? 16 : 18, marginTop: 3 }}>
                                    LINE 3: owner_id uuid default auth.uid()
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: tall ? "1fr" : "repeat(3, 1fr)",
                        gap: tall ? 12 : 16,
                        marginTop: tall ? 18 : 22,
                    }}
                >
                    {TANGLED.map((item, i) => {
                        const o = ramp(frame, chipAts[i], 10, ENTER);
                        return (
                            <div
                                key={item.code}
                                style={{
                                    padding: tall ? "13px 18px" : "16px 20px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.sheet,
                                    border: `1px solid ${o > 0.4 ? "rgba(251,80,102,0.42)" : SURFACE.hairline}`,
                                    display: "flex",
                                    flexDirection: tall ? "row" : "column",
                                    alignItems: tall ? "center" : "flex-start",
                                    justifyContent: tall ? "space-between" : "flex-start",
                                    gap: tall ? 12 : 8,
                                    opacity: 0.18 + 0.82 * o,
                                    transform: o < 1 ? `translateY(${(1 - o) * 10}px)` : undefined,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <LinkGlyph color={CORAL} size={18} />
                                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 19 : 20, color: INK.high, fontWeight: 600 }}>
                                        {item.code}
                                    </span>
                                </div>
                                <span style={{ fontFamily: FONT.body, fontSize: tall ? 17 : 18, color: INK.muted }}>
                                    {item.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </At>
        </>
    );
};

/* ── scene 2: one introspect command ────────────────────────────────── */

const H_CMD = "One flag reads Supabase.";

const GENERATED_FILES = ["profiles.ts", "projects.ts", "tasks.ts", "members.ts", "invoices.ts", "+3 tables"];

const Cmd: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_CMD);
    const tall = format === "tall";

    const cConn = useCue({ line: "cmd", word: "connection", plus: -4 }) ?? 9999;
    const cFlag = useCue({ line: "cmd", word: "flag", plus: -6 }) ?? 9999;

    const shellO = ramp(frame, 0, 8, ENTER);
    const connectedAt = Math.min(cConn, 28);
    const translateAt = connectedAt + 12;
    const foundAt = translateAt + 10;
    const doneAt = Math.max(translateAt + 24, Math.min(cFlag + 6, translateAt + 30));

    const command = tall
        ? 'rebase schema introspect \\\n  --database-url "$SUPABASE_DB_URL" \\\n  --from supabase'
        : 'rebase schema introspect --database-url "$SUPABASE_DB_URL" --from supabase';

    const logSz = tall ? 19 : 22;

    return (
        <>
            <Headline text={H_CMD} at={0} accent={ACCENT} mark={["One", "flag"]} />
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
                    <TerminalBar title="zsh · ~/app" badge="--from supabase" badgeColor={ACCENT} />
                    <div style={{ padding: tall ? "20px 22px" : "24px 28px" }}>
                        <Prompt command={command} at={2} size={tall ? 20 : 24} rate={0.28} />

                        <div style={{ marginTop: tall ? 18 : 22, display: "flex", flexDirection: "column", gap: 10, fontFamily: FONT.mono, fontSize: logSz }}>
                            {/* The driver's own lines (server-postgres schema/introspect-db.ts) */}
                            <div style={{ color: INK.muted, opacity: ramp(frame, connectedAt, 8, ENTER) }}>
                                Connected to database: db.acme.supabase.co:5432/postgres
                            </div>
                            <div style={{ color: INK.muted, opacity: ramp(frame, translateAt, 8, ENTER) }}>
                                Introspecting schema &apos;public&apos;...
                            </div>
                            <div style={{ color: CYAN, opacity: ramp(frame, foundAt, 8, ENTER) }}>Found 8 tables.</div>
                            <div style={{ color: ACCENT, fontWeight: 600, opacity: ramp(frame, doneAt, 10, ENTER) }}>
                                ✓ Introspected 8 tables — generated 8 table(s).
                            </div>
                        </div>
                    </div>
                </div>

                {/* Generated files strip */}
                <div
                    style={{
                        display: tall ? "grid" : "flex",
                        gridTemplateColumns: tall ? "repeat(3, 1fr)" : undefined,
                        flexWrap: "wrap",
                        gap: tall ? 10 : 12,
                        marginTop: tall ? 18 : 22,
                    }}
                >
                    {GENERATED_FILES.map((file, i) => {
                        const o = ramp(frame, doneAt + 3 + i * 3, 10, ENTER);
                        const isMore = file.startsWith("+");
                        return (
                            <div
                                key={file}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: tall ? "9px 14px" : "10px 16px",
                                    borderRadius: RADIUS.lg,
                                    background: isMore ? "rgba(52,211,153,0.12)" : SURFACE.sheet,
                                    border: `1px solid ${isMore ? `${ACCENT}66` : SURFACE.hairline}`,
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 18 : 20,
                                    color: isMore ? ACCENT : INK.high,
                                    opacity: o,
                                    transform: o < 1 ? `translateY(${(1 - o) * 8}px)` : undefined,
                                }}
                            >
                                {!isMore && <span style={{ color: ACCENT }}>✓</span>}
                                <span>{file}</span>
                            </div>
                        );
                    })}
                </div>
            </At>
        </>
    );
};

/* ── scene 3: animated 2-column translation board (bright: true) ────── */

const H_TRANSLATE = "Supabase SQL, translated.";

interface TranslationRow {
    from: string;
    to: string;
    dropped?: boolean;
}

const TRANSLATIONS: readonly TranslationRow[] = [
    { from: "default auth.uid()", to: "col.text().onCreateUser().userId()" },
    { from: "auth.uid() in policy", to: "rebase.uid()" },
    { from: "TO authenticated / anon", to: "signed-in / signed-out rule" },
    { from: "TO service_role only", to: "dropped (server context)", dropped: true },
];

const Translate: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_TRANSLATE);
    const tall = format === "tall";

    const cHooks = useCue({ line: "translate", word: "hooks", plus: -6 }) ?? 9999;
    const cAuth = useCue({ line: "translate", word: "authenticated", plus: -6 }) ?? 9999;
    const cDrops = useCue({ line: "translate", word: "drops", plus: -4 }) ?? 9999;
    const rowAts = [4, Math.min(cHooks, 42), Math.min(cAuth, 78), Math.min(cDrops, 118)];

    const boardO = ramp(frame, 0, 8, ENTER);
    const codeSz = tall ? 18 : 23;

    return (
        <>
            <Headline text={H_TRANSLATE} at={0} accent={ACCENT} mark={["translated."]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        borderRadius: RADIUS.xl,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        background: "rgba(11,13,16,0.88)",
                        overflow: "hidden",
                        opacity: boardO,
                        transform: boardO < 1 ? `translateY(${(1 - boardO) * 10}px)` : undefined,
                    }}
                >
                    {/* Column headers */}
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: tall ? "1fr 34px 1.28fr" : "1fr 56px 1.35fr",
                            alignItems: "center",
                            padding: tall ? "12px 18px" : "14px 26px",
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                            background: SURFACE.sheet,
                            fontFamily: FONT.mono,
                            fontSize: tall ? 14 : 15,
                            letterSpacing: "0.14em",
                            textTransform: "uppercase",
                        }}
                    >
                        <span style={{ color: INK.muted }}>IN SUPABASE</span>
                        <span style={{ textAlign: "center", color: ACCENT }}>→</span>
                        <span style={{ color: ACCENT }}>WRITTEN AS REBASE</span>
                    </div>

                    {/* Four translation rows */}
                    <div style={{ padding: tall ? "10px 18px 14px" : "12px 26px 16px", display: "flex", flexDirection: "column", gap: tall ? 10 : 12 }}>
                        {TRANSLATIONS.map((row, i) => {
                            const enterO = ramp(frame, i === 0 ? 0 : Math.max(0, rowAts[i] - 8), 10, ENTER);
                            const sweep = ramp(frame, rowAts[i], 16, ENTER);
                            const active = sweep > 0.05;
                            const rightColor = row.dropped ? AMBER : ACCENT;

                            return (
                                <div
                                    key={row.from}
                                    style={{
                                        position: "relative",
                                        display: "grid",
                                        gridTemplateColumns: tall ? "1fr 34px 1.28fr" : "1fr 56px 1.35fr",
                                        alignItems: "center",
                                        padding: tall ? "14px 14px" : "18px 20px",
                                        borderRadius: RADIUS.lg,
                                        background: active ? "rgba(52,211,153,0.06)" : SURFACE.card,
                                        border: `1px solid ${active ? `${rightColor}55` : SURFACE.hairline}`,
                                        overflow: "hidden",
                                        opacity: 0.25 + 0.75 * enterO,
                                    }}
                                >
                                    {/* Left → Right sweep highlight */}
                                    <div
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            width: `${Math.round(sweep * 100)}%`,
                                            background: `linear-gradient(90deg, transparent 70%, ${rightColor}18 100%)`,
                                            pointerEvents: "none",
                                        }}
                                    />

                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: codeSz,
                                            color: row.dropped && sweep > 0.6 ? INK.muted : INK.copy,
                                            textDecoration: row.dropped && sweep > 0.6 ? "line-through" : "none",
                                            textDecorationColor: CORAL,
                                            position: "relative",
                                        }}
                                    >
                                        {row.from}
                                    </span>

                                    <span
                                        style={{
                                            textAlign: "center",
                                            fontFamily: FONT.mono,
                                            fontSize: tall ? 20 : 24,
                                            color: active ? rightColor : INK.muted,
                                            transform: `translateX(${(1 - sweep) * -10}px)`,
                                            opacity: 0.3 + 0.7 * sweep,
                                            position: "relative",
                                        }}
                                    >
                                        →
                                    </span>

                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: codeSz,
                                            fontWeight: 600,
                                            color: rightColor,
                                            opacity: sweep,
                                            transform: sweep < 1 ? `translateX(${(1 - sweep) * 14}px)` : undefined,
                                            position: "relative",
                                        }}
                                    >
                                        {row.to}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Footer note explaining why user-id columns become text */}
                <div
                    style={{
                        marginTop: tall ? 14 : 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        fontFamily: FONT.mono,
                        fontSize: tall ? 16 : 18,
                        color: INK.copy,
                        opacity: ramp(frame, 18, 12, ENTER),
                    }}
                >
                    <span style={{ color: ACCENT }}>•</span>
                    <span>User-id columns become text so every policy compares cleanly with rebase.uid().</span>
                </div>
            </At>
        </>
    );
};

/* ── scene 4: honest report + Supabase migration tools ──────────────── */

const H_HONEST = "Nothing silently skipped.";

const LEFT_BEHIND = [
    { kind: "triggers", detail: "CREATE TRIGGER on_project_insert …", short: "on_project_insert" },
    { kind: "functions", detail: "CREATE FUNCTION get_public_proposal …", short: "get_public_proposal" },
    { kind: "CHECKs", detail: "ADD CONSTRAINT positive_total CHECK …", short: "positive_total CHECK" },
] as const;

const Honest: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_HONEST);
    const tall = format === "tall";

    const cTrig = useCue({ line: "honest", word: "triggers", plus: -4 }) ?? 9999;
    const cFunc = useCue({ line: "honest", word: "functions", plus: -4 }) ?? 9999;
    const cCheck = useCue({ line: "honest", word: "check", plus: -4 }) ?? 9999;
    const cRun = useCue({ line: "honest", word: "run", plus: -6 }) ?? 9999;

    const itemAts = [Math.min(cTrig, 16), Math.min(cFunc, 34), Math.min(cCheck, 52)];
    const runAt = Math.min(cRun, 76);

    const cardO = ramp(frame, 0, 8, ENTER);
    const cliActive = ramp(frame, runAt, 12, ENTER);
    const doneAt = runAt + 20;
    const rpcO = ramp(frame, doneAt + 4, 12, ENTER);
    const usersO = ramp(frame, doneAt + 16, 12, ENTER);

    const cloudCmd = "rebase cloud db query --file backend/sql/_introspected-left-behind.sql";

    return (
        <>
            <Headline text={H_HONEST} at={0} accent={ACCENT} mark={["silently"]} />
            <At x={x} y={y} w={w}>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: tall ? "1fr" : "0.78fr 1.22fr",
                        gap: tall ? 14 : 22,
                        alignItems: "stretch",
                        opacity: cardO,
                        transform: cardO < 1 ? `translateY(${(1 - cardO) * 10}px)` : undefined,
                    }}
                >
                    {/* Left / Top: Honest report file */}
                    <div
                        style={{
                            borderRadius: RADIUS.xl,
                            border: `1px solid ${SURFACE.hairlineStrong}`,
                            background: SURFACE.well,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 10,
                                padding: tall ? "10px 16px" : "11px 18px",
                                borderBottom: `1px solid ${SURFACE.hairline}`,
                                background: SURFACE.sheet,
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <FileGlyph color={AMBER} size={16} />
                                <span style={{ fontFamily: FONT.mono, fontSize: 14, letterSpacing: "0.08em", color: AMBER, fontWeight: 600 }}>
                                    Not carried over
                                </span>
                            </div>
                            <span style={{ fontFamily: FONT.mono, fontSize: 12, letterSpacing: "0.1em", color: INK.muted }}>
                                SAVED TO FILE
                            </span>
                        </div>

                        <div
                            style={{
                                padding: tall ? "12px 16px" : "16px 18px",
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "space-between",
                                gap: tall ? 10 : 12,
                                flex: 1,
                            }}
                        >
                            <div style={{ display: "flex", flexDirection: "column", gap: tall ? 9 : 12 }}>
                                <div
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 14 : 15,
                                        color: INK.high,
                                        padding: tall ? "7px 12px" : "8px 12px",
                                        borderRadius: RADIUS.md,
                                        background: SURFACE.sheet,
                                        border: `1px solid ${SURFACE.hairline}`,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                    }}
                                >
                                    backend/sql/_introspected-left-behind.sql
                                </div>

                                <div
                                    style={{
                                        display: tall ? "grid" : "flex",
                                        gridTemplateColumns: tall ? "repeat(3, 1fr)" : undefined,
                                        flexDirection: tall ? undefined : "column",
                                        gap: tall ? 8 : 10,
                                    }}
                                >
                                    {LEFT_BEHIND.map((item, i) => {
                                        const o = ramp(frame, itemAts[i], 10, ENTER);
                                        return (
                                            <div
                                                key={item.kind}
                                                style={{
                                                    display: "flex",
                                                    flexDirection: tall ? "column" : "row",
                                                    alignItems: tall ? "flex-start" : "center",
                                                    gap: tall ? 3 : 10,
                                                    padding: tall ? "8px 11px" : "14px 14px",
                                                    borderRadius: RADIUS.lg,
                                                    background: SURFACE.sheet,
                                                    border: `1px solid ${o > 0.5 ? `${AMBER}44` : SURFACE.hairline}`,
                                                    opacity: 0.35 + 0.65 * o,
                                                    minWidth: 0,
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontFamily: FONT.mono,
                                                        fontSize: tall ? 14 : 15,
                                                        fontWeight: 600,
                                                        color: AMBER,
                                                        minWidth: tall ? undefined : 86,
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    {item.kind}
                                                </span>
                                                <span
                                                    style={{
                                                        fontFamily: FONT.mono,
                                                        fontSize: tall ? 13 : 14,
                                                        color: INK.copy,
                                                        whiteSpace: "nowrap",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        width: tall ? "100%" : undefined,
                                                    }}
                                                >
                                                    {tall ? item.short : item.detail}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {!tall && (
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        paddingTop: 10,
                                        borderTop: `1px solid ${SURFACE.hairline}`,
                                        fontFamily: FONT.mono,
                                        fontSize: 13,
                                        color: INK.muted,
                                    }}
                                >
                                    <span>3 objects extracted</span>
                                    <span style={{ color: AMBER }}>0 silent drops</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right / Bottom: Three Nov 23 Supabase migration tools */}
                    <div
                        style={{
                            borderRadius: RADIUS.xl,
                            border: `1px solid ${cliActive > 0.3 ? `${ACCENT}55` : SURFACE.hairlineStrong}`,
                            background: SURFACE.well,
                            overflow: "hidden",
                            display: "flex",
                            flexDirection: "column",
                        }}
                    >
                        <TerminalBar title="supabase migration toolkit" badge="3 BUILT-IN TOOLS" badgeColor={ACCENT} />
                        <div
                            style={{
                                padding: tall ? "12px 16px" : "16px 18px",
                                display: "flex",
                                flexDirection: "column",
                                gap: tall ? 10 : 12,
                                flex: 1,
                            }}
                        >
                            {/* 1. Cloud DB query */}
                            <div
                                style={{
                                    padding: tall ? "10px 14px" : "12px 16px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.sheet,
                                    border: `1px solid ${cliActive > 0.3 ? `${ACCENT}44` : SURFACE.hairline}`,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 5,
                                    opacity: 0.35 + 0.65 * cliActive,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                    <span style={{ fontFamily: FONT.mono, fontSize: 12, letterSpacing: "0.12em", color: INK.muted }}>
                                        01 · RUN LEFT-BEHIND SQL
                                    </span>
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: 11,
                                            letterSpacing: "0.08em",
                                            color: ACCENT,
                                            padding: "2px 8px",
                                            borderRadius: RADIUS.md,
                                            background: "rgba(52,211,153,0.12)",
                                            border: "1px solid rgba(52,211,153,0.3)",
                                        }}
                                    >
                                        NO LOCAL PSQL
                                    </span>
                                </div>
                                <Prompt command={cloudCmd} at={Math.max(4, runAt)} size={tall ? 15 : 15} rate={0.2} />
                                <div
                                    style={{
                                        fontFamily: FONT.mono,
                                        fontSize: tall ? 13 : 14,
                                        color: ACCENT,
                                        opacity: ramp(frame, doneAt, 10, ENTER),
                                    }}
                                >
                                    <span style={{ display: "flex", gap: 18 }}>
                                        <span>CREATE TRIGGER</span>
                                        <span>CREATE FUNCTION</span>
                                        <span>ALTER TABLE</span>
                                    </span>
                                </div>
                            </div>

                            {/* 2. defineRpc */}
                            <div
                                style={{
                                    padding: tall ? "10px 14px" : "12px 16px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.sheet,
                                    border: `1px solid ${rpcO > 0.3 ? `${CYAN}44` : SURFACE.hairline}`,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 5,
                                    opacity: 0.35 + 0.65 * rpcO,
                                    transform: rpcO < 1 ? `translateY(${(1 - rpcO) * 6}px)` : undefined,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                    <span style={{ fontFamily: FONT.mono, fontSize: 12, letterSpacing: "0.12em", color: INK.muted }}>
                                        02 · EXPOSE SQL FUNCTIONS
                                    </span>
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: 11,
                                            letterSpacing: "0.08em",
                                            color: CYAN,
                                            padding: "2px 8px",
                                            borderRadius: RADIUS.md,
                                            background: "rgba(54,204,214,0.12)",
                                            border: "1px solid rgba(54,204,214,0.3)",
                                        }}
                                    >
                                        UNDER RLS
                                    </span>
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, color: INK.high, fontWeight: 600 }}>
                                    defineRpc(&quot;get_public_proposal&quot;, …){" "}
                                    <span style={{ color: CYAN }}>→ POST /api/rpc/…</span>
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: INK.copy }}>
                                    Ports supabase.rpc() with zero handler boilerplate
                                </div>
                            </div>

                            {/* 3. rebase users import */}
                            <div
                                style={{
                                    padding: tall ? "10px 14px" : "12px 16px",
                                    borderRadius: RADIUS.lg,
                                    background: SURFACE.sheet,
                                    border: `1px solid ${usersO > 0.3 ? `${ACCENT}44` : SURFACE.hairline}`,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 5,
                                    opacity: 0.35 + 0.65 * usersO,
                                    transform: usersO < 1 ? `translateY(${(1 - usersO) * 6}px)` : undefined,
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                                    <span style={{ fontFamily: FONT.mono, fontSize: 12, letterSpacing: "0.12em", color: INK.muted }}>
                                        03 · IMPORT USER ACCOUNTS
                                    </span>
                                    <span
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: 11,
                                            letterSpacing: "0.08em",
                                            color: ACCENT,
                                            padding: "2px 8px",
                                            borderRadius: RADIUS.md,
                                            background: "rgba(52,211,153,0.12)",
                                            border: "1px solid rgba(52,211,153,0.3)",
                                        }}
                                    >
                                        SAME USER IDS
                                    </span>
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, color: INK.high, fontWeight: 600 }}>
                                    <span style={{ color: INK.muted, marginRight: 8 }}>$</span>
                                    rebase users import users.csv
                                </div>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 13 : 14, color: INK.copy }}>
                                    Creates each account under its Supabase id · sends no email
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const LEAVE_SUPABASE: FilmSpec = checkFilm({
    id: "leave-supabase",
    number: 7,
    title: "One-command Supabase escape",
    accent: ACCENT,
    backdrop: "dark",
    endCommand: "rebase schema introspect --from supabase",
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "why", at: { line: "why", plus: -26 }, render: Why, roll: 0.22 },
        { id: "cmd", at: { line: "cmd", plus: 0 }, render: Cmd, roll: 0.46 },
        { id: "translate", at: { line: "translate", plus: 0 }, render: Translate, roll: 0.68, bright: true },
        { id: "honest", at: { line: "honest", plus: 0 }, render: Honest, roll: 0.34 },
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.5 },
    ],
});
