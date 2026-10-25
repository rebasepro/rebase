import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, SURFACE } from "../../theme";
import { At, checkFilm, Editor, Headline, lines, useBody, useCue, useStage, type FilmSpec, type Format } from "../kit";

/**
 * 05 — ONE DEFINITION, EVERY SURFACE.
 *
 * The same table is usually written down three or four times — the DDL, a
 * validator, a type, the docs — and they drift. In Rebase one collection file
 * is the source, and the rest is generated from it.
 *
 * Its device: a constellation. The collection sits in the middle; each thing
 * generated from it lights up around it as it is named; then one field
 * changes and the change runs out along every line.
 *
 * Real: the collection shape (defineCollection, enum as an object, a
 * `securityRules` entry); the Drizzle enum name `orders_status` (schema
 * generate); the route `/api/data/orders` and operationId `listOrders`
 * (openapi-generator.ts — enum values land in the schema); the SDK's
 * `status?: "pending" | "shipped"` (generate-sdk). The three-files hook is a
 * generic illustration of the problem, not Rebase code.
 */

const ACCENT = CHROMA.violet;
const LINK = "#C9B8FF";
const GREEN = "#34D399";

const SCRIPT = lines([
    ["hook", "How many times have you described the same table? Once for the database, once for the API, and once more for the types."],
    ["once", "In Rebase you describe it once, in one TypeScript file."],
    ["becomes", "That file becomes the Drizzle schema, the REST routes, the OpenAPI spec, the typed SDK and the Postgres policies."],
    ["panel", "If you want one, the same file also renders an admin panel."],
    ["change", "Change a field, and every surface follows, because there is no second model to keep in sync."],
    ["close", "Rebase is open source. You write the table down once, and the rest is generated."],
]);

const ORDERS = `export const ordersCollection = defineCollection({
    name: "Orders",
    slug: "orders",
    table: "orders",
    properties: {
        status: { type: "string",
                  enum: { pending: "Pending", shipped: "Shipped" } },
        total: { type: "number", validation: { required: true } },
    },
    securityRules: [{ operation: "select", access: "public" }],
});`;

/* ── the hook: the same table, three times ──────────────────────────── */

const THRICE = [
    { file: "schema.sql", code: `CREATE TABLE orders (\n  status text,\n  total numeric NOT NULL\n);`, word: "database," },
    { file: "validate.ts", code: `const Order = z.object({\n  status: z.string(),\n  total: z.number(),\n});`, word: "API," },
    { file: "types.ts", code: `interface Order {\n  status: string;\n  total: number;\n}`, word: "types." },
];

const Thrice: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(useStage().format === "tall" ? 2 : 1);
    const tall = format === "tall";
    const ats = THRICE.map((t) => useCue({ line: "hook", word: t.word, plus: -4 }) ?? 9999);
    return (
        <>
            <Headline text="The same table, written three times." accent={CHROMA.coral} mark={["three"]} />
            <At x={x} y={y} w={tall ? w : 1360}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 14 : 22 }}>
                    {THRICE.map((t, i) => {
                        const o = ramp(frame, ats[i], 12, ENTER);
                        return (
                            <div key={t.file} style={{ flex: 1, opacity: o, transform: `translateY(${(1 - o) * 14}px) rotate(${(i - 1) * (tall ? 0 : 1.2)}deg)` }}>
                                <Editor file={t.file} code={t.code} size={tall ? 20 : 22} at={0} step={0} accent={CHROMA.coral} />
                            </div>
                        );
                    })}
                </div>
            </At>
        </>
    );
};

/* ── the source ─────────────────────────────────────────────────────── */

const Once: React.FC = () => {
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    return (
        <>
            <Headline text="Describe it once." accent={ACCENT} mark={["once."]} />
            <At x={x} y={y} w={tall ? w : 1240}>
                <Editor file="config/collections/orders.ts" code={ORDERS} size={tall ? 18 : 24} accent={ACCENT} step={1.5} />
            </At>
        </>
    );
};

/* ── the constellation ──────────────────────────────────────────────── */

interface Star {
    label: string;
    value: string;
    /** What it shows once the field has changed. */
    after: string;
    /** The word of the script that names it. */
    word: string;
    line: "becomes" | "panel";
}

const STARS: Star[] = [
    { label: "DRIZZLE SCHEMA", value: `pgEnum("orders_status", …)`, after: `+ "refunded"`, word: "Drizzle", line: "becomes" },
    { label: "REST ROUTES", value: "GET /api/data/orders", after: "?status=eq.refunded", word: "REST", line: "becomes" },
    { label: "OPENAPI SPEC", value: "operationId: listOrders", after: `enum + "refunded"`, word: "OpenAPI", line: "becomes" },
    { label: "TYPED SDK", value: `status?: "pending" | "shipped"`, after: `| "refunded"`, word: "SDK", line: "becomes" },
    { label: "POSTGRES POLICIES", value: `FOR SELECT … USING (true)`, after: "✓ still applied", word: "policies.", line: "becomes" },
    { label: "ADMIN PANEL", value: "Orders · status", after: `+ "Refunded" option`, word: "admin", line: "panel" },
];

interface Place {
    x: number;
    y: number;
    w: number;
}

/** Where the source and each star sit, in stage coordinates. */
function layout(format: Format): { box: Place & { h: number }; core: Place & { h: number }; stars: Place[]; starH: number } {
    if (format === "tall") {
        const box = { x: 72, y: 400, w: 936, h: 600 };
        const core = { x: 228, y: 0, w: 480, h: 112 };
        const cw = 448;
        const stars = [0, 1, 2, 3, 4, 5].map((i) => ({ x: (i % 2) * (cw + 40), y: 196 + Math.floor(i / 2) * 140, w: cw }));
        return { box, core, stars, starH: 120 };
    }
    const box = { x: 120, y: 290, w: 1380, h: 600 };
    const core = { x: 480, y: 220, w: 420, h: 150 };
    const cw = 450;
    const stars = [
        { x: 0, y: 0, w: cw },
        { x: 0, y: 220, w: cw },
        { x: 0, y: 440, w: cw },
        { x: 930, y: 0, w: cw },
        { x: 930, y: 220, w: cw },
        { x: 930, y: 440, w: cw },
    ];
    return { box, core, stars, starH: 136 };
}

/** The source in the middle, the generated surfaces around it. `lit[i]` is
 *  the frame star i lights (scene-local); `changed` the frame the field
 *  changes, if it does in this scene. */
const Constellation: React.FC<{ lit: number[]; changed?: number }> = ({ lit, changed = 9999 }) => {
    const frame = useCurrentFrame();
    const format = useStage().format;
    const tall = format === "tall";
    const { box, core, stars, starH } = layout(format);
    const c = ramp(frame, changed, 10, ENTER);
    const coreMid = { x: core.x + core.w / 2, y: core.y + core.h / 2 };
    return (
        <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h }}>
            <svg width={box.w} height={box.h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
                {stars.map((s, i) => {
                    const l = ramp(frame, lit[i], 16, ENTER);
                    const sx = tall ? s.x + s.w / 2 : s.x < core.x ? s.x + s.w : s.x;
                    const sy = tall ? s.y : s.y + starH / 2;
                    const fx = tall ? coreMid.x : s.x < core.x ? core.x : core.x + core.w;
                    const fy = tall ? core.y + core.h : coreMid.y;
                    const len = Math.hypot(sx - fx, sy - fy);
                    /* the change runs out from the source as a bright pulse */
                    const pulse = ramp(frame, changed + 4, 18);
                    return (
                        <g key={i}>
                            <line x1={fx} y1={fy} x2={sx} y2={sy} stroke={LINK} strokeOpacity={0.55} strokeWidth={2} strokeDasharray={len} strokeDashoffset={len * (1 - l)} />
                            {pulse > 0 && pulse < 1 && <circle cx={fx + (sx - fx) * pulse} cy={fy + (sy - fy) * pulse} r={7} fill={GREEN} />}
                        </g>
                    );
                })}
            </svg>
            {/* the source */}
            <div
                style={{
                    position: "absolute",
                    left: core.x,
                    top: core.y,
                    width: core.w,
                    height: core.h,
                    borderRadius: 14,
                    background: ACCENT,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    padding: "0 26px",
                    boxShadow: `0 0 ${40 + c * 40}px rgba(139,106,230,0.55)`,
                }}
            >
                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 26 : 28, color: INK.high }}>orders.ts</div>
                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 19 : 20, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>
                    {c > 0.5 ? (
                        <>
                            enum: {"{"} … <span style={{ color: INK.high, background: "rgba(52,211,153,0.35)", padding: "0 4px", borderRadius: 4 }}>refunded</span> {"}"}
                        </>
                    ) : (
                        "defineCollection({ … })"
                    )}
                </div>
            </div>
            {/* the surfaces */}
            {STARS.map((st, i) => {
                const p = stars[i];
                const l = ramp(frame, lit[i] + 8, 12, ENTER);
                const a = ramp(frame, changed + 22 + i * 3, 10, ENTER);
                return (
                    <div
                        key={st.label}
                        style={{
                            position: "absolute",
                            left: p.x,
                            top: p.y,
                            width: p.w,
                            height: starH,
                            borderRadius: 13,
                            background: SURFACE.sheet,
                            border: `1.5px solid ${a > 0.5 ? GREEN : l > 0.5 ? LINK : SURFACE.hairline}`,
                            padding: tall ? "14px 18px" : "16px 22px",
                            opacity: 0.25 + 0.75 * l,
                            boxSizing: "border-box",
                        }}
                    >
                        <div style={{ fontFamily: FONT.mono, fontSize: tall ? 15 : 16, letterSpacing: "0.14em", color: l > 0.5 ? LINK : INK.muted }}>{st.label}</div>
                        <div style={{ fontFamily: FONT.mono, fontSize: tall ? 21 : 23, color: INK.high, marginTop: 8, whiteSpace: "nowrap" }}>{st.value}</div>
                        <div style={{ fontFamily: FONT.mono, fontSize: tall ? 21 : 23, color: GREEN, marginTop: 4, opacity: a, whiteSpace: "nowrap" }}>{st.after}</div>
                    </div>
                );
            })}
        </div>
    );
};

const ALL_LIT = [0, 0, 0, 0, 0, 0];

const Becomes: React.FC = () => {
    const ats = STARS.map((s) => (s.line === "becomes" ? useCue({ line: "becomes", word: s.word, plus: -2 }) ?? 9999 : 9999));
    return (
        <>
            <Headline text="One file, everything generated." accent={LINK} mark={["everything"]} />
            <Constellation lit={ats} />
        </>
    );
};

const Panel: React.FC = () => {
    const panel = useCue({ line: "panel", word: "admin", plus: -4 }) ?? 9999;
    return (
        <>
            <Headline text="The admin panel, if you want it." accent={LINK} mark={["admin", "panel,"]} />
            <Constellation lit={[0, 0, 0, 0, 0, panel]} />
        </>
    );
};

const Change: React.FC = () => {
    const changed = useCue({ line: "change", word: "field,", plus: -2 }) ?? 9999;
    return (
        <>
            <Headline text="Change a field. Everything follows." accent={GREEN} mark={["follows."]} />
            <Constellation lit={ALL_LIT} changed={changed} />
        </>
    );
};

const Close: React.FC = () => null;

export const ONE_DEFINITION: FilmSpec = checkFilm({
    id: "one-definition",
    number: 5,
    title: "One definition, every surface",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", word: "Once", plus: -4 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "thrice", at: { line: "hook", word: "Once", plus: 2 }, render: Thrice, roll: 0.7 },
        { id: "once", at: { line: "once", plus: 2 }, render: Once, roll: 0.28 },
        { id: "becomes", at: { line: "becomes", plus: 2 }, render: Becomes, roll: 0.5, ground: GROUND.deep, reveal: 0.55 },
        { id: "panel", at: { line: "panel", plus: 2 }, render: Panel, roll: 0.52, ground: GROUND.deep, reveal: 0.55 },
        { id: "change", at: { line: "change", plus: 2 }, render: Change, roll: 0.56, ground: GROUND.deep, reveal: 0.55 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.3 },
    ],
});
