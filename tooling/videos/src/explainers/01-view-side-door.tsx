import React from "react";
import { useCurrentFrame } from "remotion";
import { tokenize } from "../components/Code";
import { ENTER, ramp, SHIFT } from "../components/motion";
import { CHROMA, FONT, INK, SURFACE } from "../theme";
import type { Cue } from "../spoken/narration";
import { checkFilm, Headline, lines, useCue, useSceneEnd, useSeries, useStage, type FilmSpec, type Format } from "../series/kit";

/**
 * EXPLAINER 01 — YOUR VIEW IS A SIDE DOOR AROUND ROW-LEVEL SECURITY.
 *
 * Not about Rebase: a Postgres lesson for anyone using row-level security.
 * A view checks permissions as its owner unless it is `security_invoker`
 * (Postgres 15+), and the owner is usually the table's owner, which RLS
 * skips — so a view granted to users hands them every row. Materialized
 * views have the same hole and no switch.
 *
 * Its device: a FLOOR PLAN. The table is a room with its rows inside; the
 * policy is a checkpoint at the front door; a person (alice) walks in. The
 * view is a corridor someone built through the wall behind the checkpoint,
 * and she walks it straight to every row. The fix puts a checkpoint at the
 * corridor's end; the materialized view is a copy room outside the walls with
 * no door at all. The plan is one drawing for the whole lesson (FilmSpec
 * `layer`), so it never cuts: each scene changes its state, and the psql
 * beside it shows the real statement and its real result.
 *
 * Every statement and result in the psql panels is printed by
 * scripts/proof/view-side-door.sql on a throwaway PostgreSQL 18.4, and
 * `pnpm lint:film view-side-door` fails if one stops matching
 * scripts/proof/view-side-door.expected (whitespace aside: statements are
 * re-wrapped to the panel). The plan is an illustration of those results.
 */

const CYAN = CHROMA.cyan;
const CORAL = CHROMA.coral;
const ACCENT = CYAN;
const NEVER = 1e9;

const SCRIPT = lines([
    ["hook", "A view over a table with row-level security can show every row to anyone allowed to query it."],
    ["table", "Here's a table of orders, with a policy that lets each customer see only their own. When Alice selects from it, she gets one row."],
    ["view", "The same migration then creates a view of that table and grants Alice access. She queries the view, and all three orders come back."],
    [
        "why",
        "By default, a view reads its tables with its owner's rights, not those of the person asking. That owner is usually the migration role that created the table, and row-level security skips a table's owner unless you force it.",
    ],
    ["door", "So the policy still guards the table, and the view walks right around it."],
    ["fix", "On Postgres 15 or later, the fix is a single option. Alter the view and set security invoker to true."],
    ["after", "Now the view checks the policy as whoever runs the query, and Alice is back to her one order. For new views, write the option into the create statement."],
    [
        "matview",
        "Materialized views have the same problem, and no such option. They store whatever their owner could read at refresh time, so keep them away from the roles your users connect as.",
    ],
    ["check", "To find these in your own database, run one query against the catalog. It lists every view and materialized view that reads a protected table without security invoker."],
    ["close", "We build Rebase, an open-source backend for Postgres."],
]);

/* ── what psql printed (scripts/proof/view-side-door.expected) ────────── */

const ONE_ROW = ` id | customer | total
----+----------+-------
  1 | alice    | 18.50
(1 row)`;

const SQL = {
    policy: "CREATE POLICY own_orders ON orders FOR SELECT USING (customer = current_user);",
    selectOrders: "SELECT * FROM orders;",
    createView: "CREATE VIEW order_list AS SELECT id, customer, total FROM orders;",
    grant: "GRANT SELECT ON order_list TO alice, bob;",
    selectView: "SELECT * FROM order_list;",
    owners: "SELECT relname, relowner::regrole AS owner\nFROM pg_class\nWHERE relname IN ('orders', 'order_list')\nORDER BY 1 DESC;",
    counts: "SELECT (SELECT count(*) FROM orders) AS via_table,\n       (SELECT count(*) FROM order_list) AS via_view;",
    alter: "ALTER VIEW order_list SET (security_invoker = true);",
    createNew: "CREATE VIEW my_orders\n  WITH (security_invoker = true)\n  AS SELECT id, customer, total\n  FROM orders;",
    selectNew: "SELECT * FROM my_orders;",
    selectTotals: "SELECT * FROM order_totals;",
    alterTotals: "ALTER MATERIALIZED VIEW order_totals SET (security_invoker = true);",
    check: `SELECT DISTINCT v.oid::regclass AS view,
       t.oid::regclass AS rls_table
FROM pg_class v
JOIN pg_rewrite r ON r.ev_class = v.oid
JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass
                AND d.objid = r.oid
                AND d.refclassid = 'pg_class'::regclass
JOIN pg_class t ON t.oid = d.refobjid AND t.relrowsecurity
WHERE v.relkind IN ('v', 'm')
  AND NOT coalesce((SELECT option_value::bool
                    FROM pg_options_to_table(v.reloptions)
                    WHERE option_name = 'security_invoker'), false);`,
} as const;

const OUT = {
    one: ONE_ROW,
    three: ` id | customer | total
----+----------+--------
  1 | alice    |  18.50
  2 | bob      |  64.00
  3 | carol    | 120.00
(3 rows)`,
    owners: `  relname   | owner
------------+-------
 orders     | app
 order_list | app
(2 rows)`,
    counts: ` via_table | via_view
-----------+----------
         1 |        3
(1 row)`,
    totals: ` customer | spent
----------+--------
 alice    |  18.50
 bob      |  64.00
 carol    | 120.00
(3 rows)`,
    noSwitch: `ERROR:  unrecognized parameter "security_invoker"`,
    check: `     view     | rls_table
--------------+-----------
 order_totals | orders
(1 row)`,
} as const;

/** Every SQL statement and result the film shows — what the lint holds
 *  against the proof's expected output. */
export const SHOWN: readonly string[] = [...Object.values(SQL), ...Object.values(OUT)];

/* ── layout ─────────────────────────────────────────────────────────── */

/** The plan's drawing space. */
const VB = { w: 1000, h: 580 };

interface Layout {
    plan: { x: number; y: number; w: number };
    term: { x: number; y: number; w: number; h: number };
    /** The whole stage under the headline, for the scene without the plan. */
    full: { x: number; y: number; w: number; h: number };
    font: number;
    lh: number;
}

/** Fixed per format — the plan never moves, so neither does the psql
 *  beside it. One headline line above both (every headline is set to fit
 *  one line at ~30 characters, the tall shape's measure). */
function layout(format: Format): Layout {
    if (format === "tall") {
        const y = 337;
        const planW = 640;
        const termY = y + Math.round((planW * VB.h) / VB.w) + 16;
        return {
            plan: { x: (1080 - planW) / 2, y, w: planW },
            term: { x: 72, y: termY, w: 936, h: 1020 - termY },
            full: { x: 72, y, w: 936, h: 1020 - y },
            font: 18,
            lh: 26,
        };
    }
    return {
        plan: { x: 120, y: 282, w: 700 },
        term: { x: 860, y: 282, w: 640, h: 406 },
        full: { x: 120, y: 282, w: 1380, h: 600 },
        font: 20,
        lh: 28,
    };
}

function useLayout(): Layout {
    return layout(useStage().format);
}

/* ── psql ───────────────────────────────────────────────────────────── */

type Role = "alice" | "app" | "postgres";
const ROLE_COLOR: Record<Role, string> = { alice: CYAN, app: "#4E9BFF", postgres: INK.copy };

interface Entry {
    role: Role;
    sql: string;
    /** Scene-local frame the statement LANDS on (it fades in just before). */
    at: number;
    out?: string;
    outAt?: number;
}

const EXTRA_KEYWORDS = new Set(["view", "materialized", "grant", "distinct", "join", "in", "order", "by", "true", "false", "set", "is"]);
const SQL_COLOR = { keyword: "#4E9BFF", string: "#34D399", number: "#34D399", punctuation: "#8A9099", plain: "#E7E9EB" } as const;

function colourFor(kind: string, text: string): string {
    if (kind === "keyword" || (kind === "plain" && EXTRA_KEYWORDS.has(text.toLowerCase()))) return SQL_COLOR.keyword;
    if (kind === "string") return SQL_COLOR.string;
    if (kind === "number") return SQL_COLOR.number;
    if (kind === "punctuation") return SQL_COLOR.punctuation;
    return SQL_COLOR.plain;
}

/** Word-wraps a line to `cols` (monospace: JetBrains Mono advances 0.6em),
 *  continuation lines indented two spaces. Existing newlines are kept. */
function wrap(text: string, cols: number): string[] {
    const out: string[] = [];
    for (const raw of text.split("\n")) {
        let line = raw;
        let indent = "";
        while (line.length > cols) {
            let cut = line.lastIndexOf(" ", cols);
            if (cut <= indent.length) cut = cols;
            out.push(line.slice(0, cut));
            indent = (raw.match(/^\s*/)?.[0] ?? "") + "  ";
            line = indent + line.slice(cut).trimStart();
        }
        out.push(line);
    }
    return out;
}

interface Row {
    text: string;
    kind: "sql" | "out" | "error";
    role?: Role;
    at: number;
}

const GUTTER = 112;
const PAD_X = 20;
const HEADER = 34;

/** A psql session: each statement under the role that ran it (an annotation
 *  — the proof sets the role with SET ROLE), then what it printed. Lines
 *  print top-down; when the panel is full, it scrolls a whole line at a
 *  time, as a terminal does. Opaque: it sits over the field. */
const Psql: React.FC<{ entries: Entry[]; box: { x: number; y: number; w: number; h: number } }> = ({ entries, box }) => {
    const frame = useCurrentFrame();
    const { font, lh } = useLayout();
    const cols = Math.floor((box.w - 2 * PAD_X - GUTTER) / (font * 0.6));
    const outCols = Math.floor((box.w - 2 * PAD_X) / (font * 0.6));
    const capacity = Math.floor((box.h - HEADER - 20) / lh);
    const rows: Row[] = [];
    for (const e of entries) {
        wrap(e.sql, cols).forEach((text, i) => rows.push({ text, kind: "sql", role: i === 0 ? e.role : undefined, at: e.at }));
        if (e.out !== undefined) {
            for (const text of e.out.split("\n").flatMap((l) => wrap(l.trimEnd(), outCols))) {
                rows.push({ text, kind: text.startsWith("ERROR") ? "error" : "out", at: e.outAt ?? e.at + 8 });
            }
        }
    }
    const shown = rows.filter((r) => frame >= r.at - 6);
    const visible = shown.slice(Math.max(0, shown.length - capacity));
    return (
        <div
            style={{
                position: "absolute",
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                borderRadius: 13,
                border: `1px solid ${SURFACE.hairlineStrong}`,
                background: SURFACE.well,
                overflow: "hidden",
            }}
        >
            <div
                style={{
                    height: HEADER,
                    display: "flex",
                    alignItems: "center",
                    padding: `0 ${PAD_X}px`,
                    borderBottom: `1px solid ${SURFACE.hairline}`,
                    background: SURFACE.sheet,
                    fontFamily: FONT.mono,
                    fontSize: 15,
                    letterSpacing: "0.14em",
                    color: INK.muted,
                    textTransform: "uppercase",
                }}
            >
                psql · PostgreSQL 18.4
            </div>
            <div style={{ padding: `10px ${PAD_X}px`, fontFamily: FONT.mono, fontSize: font, lineHeight: `${lh}px`, fontVariantLigatures: "none", whiteSpace: "pre" }}>
                {visible.map((r, i) => (
                    <div key={`${rows.indexOf(r)}-${i}`} style={{ display: "flex", height: lh, opacity: ramp(frame, r.at - 6, 6) }}>
                        {r.kind === "sql" ? (
                            <>
                                <span style={{ width: GUTTER, flex: "none", color: r.role ? ROLE_COLOR[r.role] : undefined, fontSize: font * 0.8 }}>{r.role ? `${r.role} ›` : ""}</span>
                                <span>
                                    {tokenize(r.text, true)
                                        .flatMap((t) => (t.kind === "plain" ? t.text.split(/(\s+)/).map((text) => ({ kind: t.kind, text })) : [t]))
                                        .map((t, j) => (
                                            <span key={j} style={{ color: colourFor(t.kind, t.text) }}>
                                                {t.text}
                                            </span>
                                        ))}
                                </span>
                            </>
                        ) : (
                            <span style={{ color: r.kind === "error" ? CORAL : INK.copy }}>{r.text}</span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

/* ── the floor plan ─────────────────────────────────────────────────── */

type Pt = [number, number];

function lengthOf(pts: Pt[]): number {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return l;
}

function pointAt(pts: Pt[], t: number): Pt {
    let d = Math.max(0, Math.min(1, t)) * lengthOf(pts);
    for (let i = 1; i < pts.length; i++) {
        const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (d <= seg || i === pts.length - 1) {
            const k = seg === 0 ? 0 : Math.min(1, d / seg);
            return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
        }
        d -= seg;
    }
    return pts[pts.length - 1];
}

const ptsAttr = (pts: Pt[]) => pts.map((p) => p.join(",")).join(" ");

const ROOM = { x: 280, y: 160, w: 380, h: 290 };
const DOOR = { y0: 380, y1: 440 };
const GAP = { x0: 500, x1: 540 };
const ROWS_Y = [218, 282, 346];
const ROW = { x: 302, w: 336, h: 52 };
const MAT = { x: 765, y: 215, w: 220, h: 235, gap0: 807, gap1: 863 };
const HOME: Pt = [145, 410];
const FRONT: Pt[] = [HOME, [236, 410]];
const SIDE: Pt[] = [HOME, [145, 75], [520, 75], [520, 124]];
const TO_COPY: Pt[] = [HOME, [145, 566], [835, 566], [835, 492]];
const PEOPLE = [
    ["alice", "18.50"],
    ["bob", "64.00"],
    ["carol", "120.00"],
] as const;

const WALL = INK.copy;
const LABEL = 30;

/** The drawing's state, all from the narration: absolute frames. */
function usePlanClock() {
    const series = useSeries();
    const c = (cue: Cue) => series.cue(cue) ?? NEVER;
    const sceneStart = (id: string) => {
        const i = series.spec.scenes.findIndex((s) => s.id === id);
        return series.starts[i] ?? NEVER;
    };
    const WALK_FRONT = 22;
    const WALK_SIDE = 40;
    return {
        in: sceneStart("table"),
        out: sceneStart("check"),
        guard: c({ line: "table", word: "policy", plus: 0 }),
        tokenIn: c({ line: "table", word: "When", plus: 0 }),
        frontWalk: c({ line: "table", word: "one", plus: 0 }) - WALK_FRONT,
        WALK_FRONT,
        corridor: c({ line: "view", word: "view", plus: 0 }),
        backHome: c({ line: "view", word: "She", plus: -10 }),
        sideWalk: c({ line: "view", word: "three", plus: 0 }) - WALK_SIDE,
        WALK_SIDE,
        asOwner: c({ line: "why", word: "owner,", plus: 0 }),
        ownerTag: c({ line: "why", word: "created", plus: 0 }),
        flowFrom: sceneStart("door"),
        flowTo: sceneStart("fix"),
        checkpoint: c({ line: "fix", word: "true.", plus: 0 }),
        backToOne: c({ line: "after", word: "Alice", plus: 0 }),
        copyRoom: c({ line: "matview", word: "views", plus: 0 }),
        copyWalk: c({ line: "matview", word: "problem,", plus: 0 }) - WALK_SIDE,
        refresh: c({ line: "matview", word: "refresh", plus: 0 }),
    };
}

/** Lands at `at`: 0 → 1 over the `dur` frames before it. */
const land = (frame: number, at: number, dur = 12) => ramp(frame, at - dur, dur, ENTER);

const Tag: React.FC<{ x: number; y: number; text: string; color: string; o: number }> = ({ x, y, text, color, o }) => {
    if (o <= 0) return null;
    const w = text.length * 26 * 0.6 + 24;
    return (
        <g opacity={o}>
            <rect x={x - w / 2} y={y - 20} width={w} height={40} rx={8} fill={color} />
            <text x={x} y={y + 9} textAnchor="middle" fontFamily={FONT.mono} fontSize={26} fill="#08090A">
                {text}
            </text>
        </g>
    );
};

const Shield: React.FC<{ x: number; y: number; color: string; o: number }> = ({ x, y, color, o }) =>
    o <= 0 ? null : (
        <g opacity={o} transform={`translate(${x} ${y}) scale(${0.85 + 0.15 * o})`}>
            <path d="M0,-24 L19,-16 L19,2 C19,14 10,21 0,26 C-10,21 -19,14 -19,2 L-19,-16 Z" fill={color} />
            <path d="M-8,1 L-2,8 L9,-6" fill="none" stroke="#08090A" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        </g>
    );

/** The film-wide layer: the plan, on its own opaque sheet. */
const FloorPlan: React.FC = () => {
    const frame = useCurrentFrame();
    const format = useStage().format;
    const { plan } = layout(format);
    const t = usePlanClock();
    const enter = ramp(frame, t.in, 16, ENTER);
    const exit = ramp(frame, t.out, 14, SHIFT);
    const o = Math.min(enter, 1 - exit);
    if (o <= 0) return null;

    const guard = land(frame, t.guard);
    const corridor = land(frame, t.corridor, 16);
    const checkpoint = land(frame, t.checkpoint);
    const copy = land(frame, t.copyRoom, 16);
    const clearForCopy = 1 - land(frame, t.copyRoom, 12);

    /* alice: where she is, and what she is wearing */
    const front = ramp(frame, t.frontWalk, t.WALK_FRONT, SHIFT);
    const side = ramp(frame, t.sideWalk, t.WALK_SIDE, SHIFT);
    const toCopy = ramp(frame, t.copyWalk, t.WALK_SIDE, SHIFT);
    let pos: Pt = HOME;
    let tokenO = land(frame, t.tokenIn, 10);
    if (frame < t.backHome) pos = pointAt(FRONT, front);
    else if (frame < t.copyRoom - 10) {
        /* off the front door, back on at home, then down the corridor */
        const off = ramp(frame, t.backHome, 8);
        const on = ramp(frame, t.backHome + 10, 8);
        tokenO *= frame < t.backHome + 10 ? 1 - off : on;
        pos = frame < t.backHome + 10 ? pointAt(FRONT, 1) : pointAt(SIDE, side);
    } else {
        const off = ramp(frame, t.copyRoom - 10, 8);
        const on = ramp(frame, t.copyRoom, 8);
        tokenO *= frame < t.copyRoom ? 1 - off : on;
        pos = frame < t.copyRoom ? pointAt(SIDE, 1) : pointAt(TO_COPY, toCopy);
    }
    const asApp = frame >= t.asOwner && frame < t.backToOne && frame < t.copyRoom;
    const tokenColor = asApp ? CORAL : CYAN;
    const tokenText = asApp ? "as app" : "alice";

    /* what she gets */
    const frontDone = frame >= t.frontWalk + t.WALK_FRONT ? 1 : 0;
    const sideLit = ramp(frame, t.sideWalk + t.WALK_SIDE - 2, 8);
    const fixed = ramp(frame, t.backToOne - 8, 8);
    const copyLit = ramp(frame, t.copyWalk + t.WALK_SIDE - 2, 8);
    const rowLit = (i: number): { color: string; a: number } => {
        if (frame >= t.copyRoom) return { color: i === 0 ? CYAN : CORAL, a: (i === 0 ? 1 : sideLit * (1 - fixed)) * clearForCopy };
        if (i === 0) return { color: sideLit > 0 && fixed < 1 ? CORAL : CYAN, a: frontDone };
        return { color: CORAL, a: sideLit * (1 - fixed) };
    };
    const sideColor = fixed >= 1 || frame >= t.backToOne ? CYAN : CORAL;

    /* the traffic, while the side door is the point */
    const flowing = frame >= t.flowFrom && frame < t.flowTo + 8;
    const flowO = Math.min(ramp(frame, t.flowFrom, 10), 1 - ramp(frame, t.flowTo, 8));

    const h = Math.round((plan.w * VB.h) / VB.w);
    const L = (pts: Pt[]) => lengthOf(pts);
    const label = { fontFamily: FONT.mono, fontSize: LABEL } as const;
    const eyebrow = { fontFamily: FONT.mono, fontSize: 20, letterSpacing: "0.16em" } as const;

    return (
        <div
            style={{
                position: "absolute",
                left: plan.x,
                top: plan.y,
                width: plan.w,
                height: h,
                borderRadius: 13,
                border: `1px solid ${SURFACE.hairlineStrong}`,
                background: SURFACE.sheet,
                overflow: "hidden",
                opacity: o,
                transform: enter < 1 ? `translateY(${(1 - enter) * 18}px)` : exit > 0 ? `scale(${1 - exit * 0.02})` : undefined,
            }}
        >
            <svg viewBox={`0 0 ${VB.w} ${VB.h}`} width={plan.w} height={h} style={{ display: "block", fontVariantLigatures: "none" }}>
                {/* the corridor: the view, built through the wall */}
                {corridor > 0 && (
                    <g opacity={corridor}>
                        {/* the vestibule (its door at the bottom), then the corridor
                            to the gap in the table's wall */}
                        <path d={`M 230 55 V 45 H 60 V 105 H 120 M 170 105 H 230 V 95`} fill="none" stroke={WALL} strokeWidth={4} />
                        <path d={`M 230 55 H ${GAP.x1} V ${ROOM.y} M 230 95 H ${GAP.x0} V ${ROOM.y}`} fill="none" stroke={WALL} strokeWidth={4} />
                        <text x={60} y={32} {...eyebrow} fill={INK.muted}>
                            VIEW <tspan {...label} letterSpacing={0} fill={INK.high}>order_list</tspan>
                        </text>
                    </g>
                )}
                {/* what the corridor runs as */}
                <text x={236} y={138} {...label} fontSize={22} fill={CORAL} opacity={land(frame, t.asOwner) * (1 - checkpoint)}>
                    runs as app
                </text>
                <text x={236} y={138} {...label} fontSize={22} fill={CYAN} opacity={checkpoint}>
                    security_invoker
                </text>

                {/* the room: the table */}
                <path
                    d={`M ${ROOM.x} ${DOOR.y0} V ${ROOM.y} H ${GAP.x0} M ${GAP.x1} ${ROOM.y} H ${ROOM.x + ROOM.w} V ${ROOM.y + ROOM.h} H ${ROOM.x} V ${DOOR.y1}`}
                    fill="none"
                    stroke={WALL}
                    strokeWidth={6}
                />
                {/* the wall where the corridor will break through */}
                <line x1={GAP.x0} y1={ROOM.y} x2={GAP.x1} y2={ROOM.y} stroke={WALL} strokeWidth={6} opacity={1 - corridor} />
                <text x={ROOM.x + 22} y={ROOM.y + 40} {...eyebrow} fill={INK.muted}>
                    TABLE <tspan {...label} letterSpacing={0} fill={INK.high}>orders</tspan>
                </text>
                <text x={ROOM.x + ROOM.w - 22} y={ROOM.y + ROOM.h - 18} textAnchor="end" {...label} fontSize={24} fill={CORAL} opacity={land(frame, t.ownerTag)}>
                    owner app
                </text>
                {PEOPLE.map(([who, total], i) => {
                    const lit = rowLit(i);
                    return (
                        <g key={who}>
                            <rect x={ROW.x} y={ROWS_Y[i]} width={ROW.w} height={ROW.h} rx={9} fill={SURFACE.card} />
                            {lit.a > 0 && <rect x={ROW.x} y={ROWS_Y[i]} width={ROW.w} height={ROW.h} rx={9} fill="none" stroke={lit.color} strokeWidth={4} opacity={lit.a} />}
                            <text x={ROW.x + 20} y={ROWS_Y[i] + 35} {...label} fill={INK.high}>
                                {i + 1}
                            </text>
                            <text x={ROW.x + 66} y={ROWS_Y[i] + 35} {...label} fill={INK.high}>
                                {who}
                            </text>
                            <text x={ROW.x + ROW.w - 20} y={ROWS_Y[i] + 35} textAnchor="end" {...label} fill={INK.copy}>
                                {total}
                            </text>
                        </g>
                    );
                })}

                {/* the policy at the front door */}
                <Shield x={ROOM.x} y={(DOOR.y0 + DOOR.y1) / 2} color={CYAN} o={guard} />
                <g opacity={guard}>
                    <text x={170} y={490} {...eyebrow} fill={INK.muted}>
                        POLICY <tspan {...label} letterSpacing={0} fill={CYAN}>own_orders</tspan>
                    </text>
                    <text x={170} y={526} {...label} fontSize={26} fill={INK.copy}>
                        customer = current_user
                    </text>
                </g>
                {/* and, once the view checks as its caller, at the corridor's end */}
                <Shield x={(GAP.x0 + GAP.x1) / 2} y={ROOM.y} color={CYAN} o={checkpoint} />

                {/* the copy room: a materialized view, outside the walls */}
                {copy > 0 && (
                    <g opacity={copy}>
                        <path d={`M ${MAT.gap0} ${MAT.y + MAT.h} H ${MAT.x} V ${MAT.y} H ${MAT.x + MAT.w} V ${MAT.y + MAT.h} H ${MAT.gap1}`} fill="none" stroke={WALL} strokeWidth={6} />
                        <text x={MAT.x} y={MAT.y - 44} {...eyebrow} fill={INK.muted}>
                            MATERIALIZED
                        </text>
                        <text x={MAT.x} y={MAT.y - 14} {...label} fill={INK.high}>
                            order_totals
                        </text>
                        {PEOPLE.map(([who, total], i) => (
                            <g key={who}>
                                <rect x={MAT.x + 12} y={ROWS_Y[i]} width={MAT.w - 24} height={ROW.h} rx={9} fill={SURFACE.card} />
                                {copyLit > 0 && <rect x={MAT.x + 12} y={ROWS_Y[i]} width={MAT.w - 24} height={ROW.h} rx={9} fill="none" stroke={CORAL} strokeWidth={4} opacity={copyLit} />}
                                <text x={MAT.x + 28} y={ROWS_Y[i] + 35} {...label} fontSize={22} fill={INK.high}>
                                    {who}
                                </text>
                                <text x={MAT.x + MAT.w - 28} y={ROWS_Y[i] + 35} textAnchor="end" {...label} fontSize={22} fill={INK.copy}>
                                    {total}
                                </text>
                            </g>
                        ))}
                        {/* refreshed from the room, as its owner */}
                        <line x1={ROOM.x + ROOM.w + 8} y1={316} x2={MAT.x - 12} y2={316} stroke={frame >= t.refresh ? CORAL : WALL} strokeWidth={3} strokeDasharray="6 6" />
                        <path d={`M ${MAT.x - 22} 308 L ${MAT.x - 10} 316 L ${MAT.x - 22} 324`} fill="none" stroke={frame >= t.refresh ? CORAL : WALL} strokeWidth={3} />
                        <text x={(ROOM.x + ROOM.w + MAT.x) / 2} y={298} textAnchor="middle" {...label} fontSize={20} fill={frame >= t.refresh ? CORAL : INK.copy}>
                            refresh
                        </text>
                        <text x={(ROOM.x + ROOM.w + MAT.x) / 2} y={348} textAnchor="middle" {...label} fontSize={20} fill={frame >= t.refresh ? CORAL : INK.copy}>
                            as app
                        </text>
                    </g>
                )}

                {/* the trails she left */}
                <polyline points={ptsAttr(FRONT)} fill="none" stroke={CYAN} strokeWidth={3} strokeDasharray={L(FRONT)} strokeDashoffset={L(FRONT) * (1 - front)} opacity={clearForCopy} />
                {frame >= t.sideWalk && (
                    <polyline points={ptsAttr(SIDE)} fill="none" stroke={sideColor} strokeWidth={3} strokeDasharray={L(SIDE)} strokeDashoffset={L(SIDE) * (1 - side)} opacity={clearForCopy} />
                )}
                {frame >= t.copyWalk && <polyline points={ptsAttr(TO_COPY)} fill="none" stroke={CORAL} strokeWidth={3} strokeDasharray={L(TO_COPY)} strokeDashoffset={L(TO_COPY) * (1 - toCopy)} />}

                {/* what she got, each way in */}
                <Tag x={196} y={360} text="1 row" color={CYAN} o={frontDone * clearForCopy} />
                <Tag x={652} y={124} text={frame >= t.backToOne ? "1 row" : "3 rows"} color={sideColor} o={sideLit * clearForCopy} />
                <Tag x={680} y={502} text="3 rows" color={CORAL} o={copyLit} />

                {/* traffic on both ways in */}
                {flowing &&
                    [0, 1, 2, 3].map((k) => {
                        const p = (((frame - t.flowFrom) / 60 + k / 4) % 1 + 1) % 1;
                        const a = pointAt(FRONT, p);
                        const b = pointAt(SIDE, p);
                        return (
                            <g key={k} opacity={flowO}>
                                <circle cx={a[0]} cy={a[1]} r={6} fill={CYAN} />
                                <circle cx={b[0]} cy={b[1]} r={6} fill={CORAL} />
                            </g>
                        );
                    })}

                {/* alice */}
                {tokenO > 0 && (
                    <g opacity={tokenO} transform={`translate(${pos[0]} ${pos[1]})`}>
                        <rect x={-62} y={-22} width={124} height={44} rx={22} fill={tokenColor} />
                        <text x={0} y={9} textAnchor="middle" fontFamily={FONT.mono} fontSize={26} fill="#08090A">
                            {tokenText}
                        </text>
                    </g>
                )}
            </svg>
        </div>
    );
};

/* ── scenes ─────────────────────────────────────────────────────────── */

/** A cue in the current scene's frames; never if unsaid. */
function useAt(line: string, word?: string, plus = 0): number {
    return useCue(word === undefined ? { line, plus } : { line, word, plus }) ?? NEVER;
}
function useEnd(line: string, plus = 0): number {
    return useCue({ line, end: true, plus }) ?? NEVER;
}

/** The scene's headline, gone just before the scene hands over: the next
 *  headline rises in the same place, and two sets of words dissolving
 *  through each other read as one garbled line. */
const Title: React.FC<{ text: string; mark: string[]; color: string }> = ({ text, mark, color }) => {
    const frame = useCurrentFrame();
    const end = useSceneEnd();
    const o = end === null ? 1 : 1 - ramp(frame, end - 8, 8, SHIFT);
    if (o <= 0) return null;
    return (
        <div style={{ position: "absolute", inset: 0, opacity: o }}>
            <Headline text={text} accent={color} mark={mark} />
        </div>
    );
};

const Beside: React.FC<{ headline: string; mark: string[]; color?: string; entries: Entry[] }> = ({ headline, mark, color = CORAL, entries }) => {
    const { term } = useLayout();
    return (
        <>
            <Title text={headline} color={color} mark={mark} />
            <Psql entries={entries} box={term} />
        </>
    );
};

const Table: React.FC = () => (
    <Beside
        headline="The policy guards the table."
        mark={["policy"]}
        color={CYAN}
        entries={[
            { role: "app", sql: SQL.policy, at: useAt("table", "policy") },
            { role: "alice", sql: SQL.selectOrders, at: useAt("table", "selects"), out: OUT.one, outAt: useAt("table", "one") },
        ]}
    />
);

const View: React.FC = () => (
    <Beside
        headline="The view returns every row."
        mark={["every"]}
        entries={[
            { role: "app", sql: SQL.createView, at: useAt("view", "view") },
            { role: "app", sql: SQL.grant, at: useAt("view", "grants") },
            { role: "alice", sql: SQL.selectView, at: useAt("view", "queries"), out: OUT.three, outAt: useAt("view", "three") },
        ]}
    />
);

const Why: React.FC = () => (
    <Beside
        headline="A view reads as its owner."
        mark={["owner."]}
        entries={[{ role: "postgres", sql: SQL.owners, at: useAt("why", "owner,"), out: OUT.owners, outAt: useAt("why", "created") }]}
    />
);

const Door: React.FC = () => (
    <Beside
        headline="The view walks around it."
        mark={["around"]}
        entries={[{ role: "alice", sql: SQL.counts, at: useAt("door", "guards"), out: OUT.counts, outAt: useAt("door", "walks") }]}
    />
);

const Fix: React.FC = () => (
    <Beside
        headline="One option closes the door."
        mark={["One", "option"]}
        color={CYAN}
        entries={[
            { role: "app", sql: SQL.alter, at: useAt("fix", "Alter") },
            { role: "alice", sql: SQL.selectView, at: useAt("after", "Now"), out: OUT.one, outAt: useAt("after", "Alice") },
        ]}
    />
);

const New: React.FC = () => (
    <Beside
        headline="Write it into new views."
        mark={["new"]}
        color={CYAN}
        entries={[
            { role: "app", sql: SQL.createNew, at: useAt("after", "write") },
            { role: "alice", sql: SQL.selectNew, at: useAt("after", "create"), out: OUT.one, outAt: useEnd("after", -2) },
        ]}
    />
);

const Matview: React.FC = () => (
    <Beside
        headline="A snapshot has no switch."
        mark={["no", "switch."]}
        entries={[
            { role: "alice", sql: SQL.selectTotals, at: useAt("matview", "same"), out: OUT.totals, outAt: useAt("matview", "problem,") },
            { role: "app", sql: SQL.alterTotals, at: useAt("matview", "no"), out: OUT.noSwitch, outAt: useAt("matview", "option.") },
        ]}
    />
);

/** The one query to run on your own database: the whole stage. */
const Check: React.FC = () => {
    const { full } = useLayout();
    return (
        <>
            <Title text="Find them in your catalog." color={CYAN} mark={["catalog."]} />
            <Psql box={full} entries={[{ role: "postgres", sql: SQL.check, at: useAt("check", "run"), out: OUT.check, outAt: useAt("check", "lists") }]} />
        </>
    );
};

const Close: React.FC = () => null;

/** Scenes enter over 16 frames (the kit's shell), so each starts 16 before
 *  its word: the entrance LANDS on the cue. */
const ON = -16;

export const VIEW_SIDE_DOOR: FilmSpec = checkFilm({
    id: "view-side-door",
    number: 1,
    title: "Views and row-level security",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    layer: FloorPlan,
    endCommand: null,
    scenes: [
        { id: "table", at: { line: "table", plus: ON }, render: Table, roll: 0.3 },
        { id: "view", at: { line: "view", plus: ON }, render: View, roll: 0.36 },
        { id: "why", at: { line: "why", plus: ON }, render: Why, roll: 0.42 },
        { id: "door", at: { line: "door", plus: ON }, render: Door, roll: 0.62 },
        { id: "fix", at: { line: "fix", plus: ON }, render: Fix, roll: 0.24 },
        { id: "new", at: { line: "after", word: "For", plus: ON }, render: New, roll: 0.3 },
        { id: "matview", at: { line: "matview", plus: ON }, render: Matview, roll: 0.7 },
        { id: "check", at: { line: "check", plus: ON }, render: Check, roll: 0.5 },
        /* The last scene holds until the presenter has grown back: its exit
           and the close overlap, so the frame is never bare between them. */
        { id: "close", at: { line: "close", plus: 24 }, render: Close, roll: 0.46 },
    ],
});
