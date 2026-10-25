import React from "react";
import { OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, SURFACE } from "../../theme";
import { checkFilm, Editor, Headline, lines, Log, Prompt, useBodyFor, useCue, useStage, Window, type FilmSpec } from "../kit";

/**
 * 10 — BRING THE DATABASE YOU HAVE.
 *
 * Its device: a scanner. The database you already run is a list of tables; a
 * read-only beam passes down it, and for each table a collection file lands
 * in your repo. Nothing on the database side moves.
 *
 * Real: `init --database-url … --introspect` and the introspector's own lines
 * (server-postgres/src/schema/introspect-db.ts — "Connected to database",
 * "Introspecting schema 'public'...", "Found N tables.", the roles summary,
 * "✓ <file>", "✓ Introspected N tables — generated M collection(s)."); it
 * runs SELECTs only. The example shop's six tables classify as four entities,
 * one join table (folded into relations) and one owned table, which is five
 * collections. The panel clip is the demo's orders table (render-demo.mjs). Not claimed:
 * that the database is never written — `db push` later adds the rebase schema
 * and policies, and the script says only that introspection reads.
 */

const ACCENT = CHROMA.cyan;
const GREEN = "#34D399";

const SCRIPT = lines([
    ["hook", "You already have a database. Moving it somewhere new is the last thing you want."],
    ["point", "Rebase doesn't ask you to. You point it at the Postgres you have, and it maps the schema."],
    ["read", "Introspection only reads. Your tables and your rows stay exactly where they are."],
    ["files", "Each table becomes a typed collection file in your repo, with its relations included."],
    ["surface", "From those files you get the API, the typed SDK and an admin panel, on the data you already have."],
    ["close", "Rebase is open source. Keep your database, and add the backend."],
]);

const TABLES = [
    { name: "customers", rows: "18,204", kind: "entity" },
    { name: "orders", rows: "96,511", kind: "entity" },
    { name: "order_items", rows: "241,870", kind: "owned" },
    { name: "products", rows: "1,312", kind: "entity" },
    { name: "categories", rows: "24", kind: "entity" },
    { name: "product_categories", rows: "2,640", kind: "join" },
];

/* ── scenes ─────────────────────────────────────────────────────────── */

const H_POINT = "Point it at the Postgres you have.";
const Point: React.FC = () => {
    const { x, y, w, format } = useBodyFor(H_POINT);
    const tall = format === "tall";
    const cmd = useCue({ line: "point", word: "point", plus: -4 }) ?? 9999;
    const reads = useCue({ line: "point", word: "maps", plus: -4 }) ?? 9999;
    const size = tall ? 21 : 25;
    return (
        <>
            <Headline text={H_POINT} accent={ACCENT} mark={["you", "have."]} />
            <div style={{ position: "absolute", left: x, top: y, width: tall ? w : 1300 }}>
                <Window title="zsh">
                    <Prompt command={tall ? "rebase init shop \\\n  --database-url postgresql://… \\\n  --introspect" : "rebase init shop --database-url postgresql://… --introspect"} at={cmd} size={tall ? 24 : 27} rate={0.35} />
                    <Log
                        size={size}
                        lines={[
                            { text: "Connected to database: db.internal:5432", at: reads },
                            { text: "Introspecting schema 'public'...", at: reads + 8 },
                            { text: "Found 6 tables.", at: reads + 18, color: "#4E9BFF" },
                            {
                                text: tall
                                    ? "  4 entities, 1 join tables (folded into relations),\n  0 code lists, 1 owned by another table"
                                    : "  4 entities, 1 join tables (folded into relations), 0 code lists,\n  1 owned by another table (hidden from navigation).",
                                at: reads + 24,
                            },
                        ]}
                    />
                </Window>
            </div>
        </>
    );
};

/** The database, scanned. Its table list with a beam passing down it; the
 *  beam never writes, and the badge says so. */
const H_READ = "Introspection only reads.";
const Read: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_READ);
    const tall = format === "tall";
    const W = tall ? w : 900;
    const rowH = tall ? 62 : 64;
    const start = 10;
    const scan = ramp(frame, start, 70, (t) => t);
    const stay = useCue({ line: "read", word: "stay", plus: -4 }) ?? 9999;
    return (
        <>
            <Headline text={H_READ} accent={ACCENT} mark={["reads."]} />
            <div style={{ position: "absolute", left: x, top: y, width: W }}>
                <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: `1px solid ${SURFACE.hairline}`, background: SURFACE.sheet }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 22px", borderBottom: `1px solid ${SURFACE.hairline}`, fontFamily: FONT.mono, fontSize: 16, letterSpacing: "0.14em", color: INK.muted }}>
                        <span>YOUR DATABASE · PUBLIC</span>
                        <span>ROWS</span>
                    </div>
                    {TABLES.map((t, i) => {
                        const seen = scan * TABLES.length > i + 0.5;
                        return (
                            <div key={t.name} style={{ height: rowH, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px", borderBottom: i < TABLES.length - 1 ? `1px solid ${SURFACE.hairline}` : undefined, fontFamily: FONT.mono, fontSize: tall ? 24 : 26 }}>
                                <span style={{ color: seen ? INK.high : INK.copy }}>{t.name}</span>
                                <span style={{ color: INK.muted }}>{t.rows}</span>
                            </div>
                        );
                    })}
                    {/* the beam */}
                    {scan > 0 && scan < 1 && (
                        <div style={{ position: "absolute", left: 0, right: 0, top: 50 + scan * TABLES.length * rowH - 30, height: 60, background: `linear-gradient(180deg, rgba(54,204,214,0) 0%, rgba(54,204,214,0.22) 50%, rgba(54,204,214,0) 100%)`, borderBottom: `2px solid ${ACCENT}` }} />
                    )}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 20, flexWrap: "wrap" }}>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 22 : 24, color: GROUND.base, background: ACCENT, padding: "8px 16px", borderRadius: 8, opacity: ramp(frame, start, 10) }}>READ ONLY · SELECT</span>
                    <span style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 26 : 28, color: GREEN, padding: "6px 4px", opacity: ramp(frame, stay, 12) }}>0 rows changed · 0 tables moved</span>
                </div>
            </div>
        </>
    );
};

/** A file for each table; the join table folds into a relation instead. */
const H_FILES = "A typed collection for each table.";
const COLLECTION = `const ordersCollection = defineCollection({
    slug: "orders",
    table: "orders",
    properties: {
        customer: {
            type: "relation",
            // mapped from foreign key: customer_id -> customers(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => customersCollection,
                localKey: "customer_id"
            }
        },
    },
});`;

const Files: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_FILES);
    const tall = format === "tall";
    const files = TABLES.filter((t) => t.kind !== "join");
    const rel = useCue({ line: "files", word: "relations", plus: -4 }) ?? 9999;
    const list = (
        <div style={{ width: tall ? w : 470, flexShrink: 0 }}>
            <Log
                size={tall ? 20 : 21}
                lines={[
                    ...(tall ? [] : files.map((t, i) => ({ text: `  ✓ …/collections/${t.name}.ts`, at: 6 + i * 6, color: GREEN }))),
                    { text: "✓ Introspected 6 tables — generated 5 collection(s).", at: tall ? 8 : 6 + files.length * 6 + 6, color: INK.high },
                ]}
            />
            <div style={{ marginTop: 14, fontFamily: FONT.mono, fontSize: tall ? 19 : 20, color: INK.muted, opacity: ramp(frame, rel, 10) }}>
                product_categories → folded into a relation
            </div>
        </div>
    );
    return (
        <>
            <Headline text={H_FILES} accent={ACCENT} mark={["typed"]} />
            <div style={{ position: "absolute", left: x, top: y, width: tall ? w : 1300, display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 20 : 30 }}>
                {list}
                <div style={{ flex: 1, opacity: ramp(frame, 30, 12, ENTER) }}>
                    <Editor file="config/collections/orders.ts · excerpt" code={COLLECTION} size={tall ? 18 : 18} accent={ACCENT} at={34} step={1} />
                </div>
            </div>
        </>
    );
};

/** What the files give you, over the data that was already there. */
const H_SURFACE = "Your data, with a backend on top.";
const Surface: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(H_SURFACE);
    const tall = format === "tall";
    const ats = ["API,", "SDK", "admin"].map((wd) => useCue({ line: "surface", word: wd, plus: -4 }) ?? 9999);
    const W = tall ? w : 1300;
    const card = (i: number, title: string, body: React.ReactNode) => {
        const o = ramp(frame, ats[i], 12, ENTER);
        return (
            <div key={title} style={{ flex: tall ? 1 : undefined, padding: tall ? "12px 14px" : "18px 22px", borderRadius: 13, background: SURFACE.sheet, border: `1px solid ${SURFACE.hairline}`, opacity: o, transform: `translateY(${(1 - o) * 12}px)` }}>
                <div style={{ fontFamily: FONT.mono, fontSize: 16, letterSpacing: "0.14em", color: ACCENT }}>{title}</div>
                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 22, color: INK.high, marginTop: 6 }}>{body}</div>
            </div>
        );
    };
    const clipO = ramp(frame, ats[2], 14, ENTER);
    return (
        <>
            <Headline text={H_SURFACE} accent={ACCENT} mark={["backend"]} />
            <div style={{ position: "absolute", left: x, top: y, width: W, display: "flex", flexDirection: tall ? "column" : "row", gap: 20 }}>
                <div style={{ width: tall ? W : 520, display: "flex", flexDirection: tall ? "row" : "column", gap: 14 }}>
                    {card(0, "REST API", "GET /api/data/orders")}
                    {card(1, "TYPED SDK", "client.data.orders.find()")}
                    {card(2, "ADMIN PANEL", "your orders, as they are")}
                </div>
                <div style={{ flex: tall ? undefined : 1, height: tall ? 430 : 392, borderRadius: 13, overflow: "hidden", border: `1px solid ${SURFACE.hairline}`, opacity: clipO, transform: `scale(${0.97 + 0.03 * clipO})` }}>
                    <Sequence from={Math.min(ats[2], 9000)} layout="none">
                        <OffthreadVideo src={staticFile("demo/orders.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </Sequence>
                </div>
            </div>
        </>
    );
};

const Close: React.FC = () => null;

export const EXISTING: FilmSpec = checkFilm({
    id: "existing",
    number: 10,
    title: "Bring the database you have",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 4 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "point", at: { line: "point", plus: 2 }, render: Point, roll: 0.3 },
        { id: "read", at: { line: "read", plus: 2 }, render: Read, roll: 0.18, ground: GROUND.claim, reveal: 0.6 },
        { id: "files", at: { line: "files", plus: 2 }, render: Files, roll: 0.56 },
        { id: "surface", at: { line: "surface", plus: 2 }, render: Surface, roll: 0.72 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.44 },
    ],
});
