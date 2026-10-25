import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, SURFACE } from "../../theme";
import { At, checkFilm, Editor, Headline, lines, useBody, useCue, useStage, type FilmSpec } from "../kit";

/**
 * 07 — REALTIME THAT RESPECTS YOUR RULES.
 *
 * Its device: two phones, two people. Robert and Dana both watch "my pending
 * orders". A new order of Robert's lands: Robert's list grows, Dana's does
 * not move — not because the client filtered it, but because her query ran
 * again as her and the row was never sent.
 *
 * Real: the `.where().orderBy().limit().listen()` chain (client); the
 * database's trigger announces the changed row's keys on `rebase_cdc`, never
 * its values; the server re-runs each subscription's query as its subscriber
 * under their policies, debounced, and sends nothing when the result did not
 * change (server-postgres realtime). Not claimed: "instant", the WAL.
 */

const ACCENT = CHROMA.coral;
const GREEN = "#34D399";

const SCRIPT = lines([
    ["hook", "Realtime is easy to demo, and hard to secure."],
    ["listen", "In Rebase, a client listens to a query, and gets new results whenever the data changes."],
    ["keys", "When a row is written, the database announces which row it was, never what's in it."],
    ["rerun", "Then each subscriber's query runs again, as that subscriber, under their own policies."],
    ["hidden", "So a row someone isn't allowed to see never reaches their screen."],
    ["nothing", "The rules are the same Postgres policies as before, so realtime needs no rules of its own."],
    ["close", "Rebase is open source. Live data, under the same rules as every other request."],
]);

const LISTEN = `const unsubscribe = client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "desc")
    .limit(20)
    .listen((res) => render(res.data));`;

/* ── scenes ─────────────────────────────────────────────────────────── */

const Listen: React.FC = () => {
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    return (
        <>
            <Headline text="Listen to a query." accent={ACCENT} mark={["query."]} />
            <At x={x} y={y} w={tall ? w : 1200}>
                <Editor file="src/orders.ts" code={LISTEN} size={tall ? 25 : 30} accent={ACCENT} step={3} />
            </At>
        </>
    );
};

/** The change, and what the database says about it: the keys, not the row. */
const Keys: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(format2(useStage().format));
    const tall = format === "tall";
    const insert = 10;
    const announce = useCue({ line: "keys", word: "announces", plus: -4 }) ?? 9999;
    const never = useCue({ line: "keys", word: "never", plus: -2 }) ?? 9999;
    const a = ramp(frame, announce, 14, ENTER);
    const n = ramp(frame, never, 12, ENTER);
    const cell = { fontFamily: FONT.mono, fontSize: tall ? 22 : 24, padding: "10px 16px" } as const;
    const table = (
        <div style={{ borderRadius: 13, overflow: "hidden", border: `1px solid ${SURFACE.hairline}`, background: SURFACE.sheet, width: tall ? w : 620 }}>
            <div style={{ ...cell, fontSize: tall ? 16 : 16, letterSpacing: "0.14em", color: INK.muted, borderBottom: `1px solid ${SURFACE.hairline}` }}>TABLE · ORDERS</div>
            {[
                ["1038", "robert", "pending", "€18.50"],
                ["1042", "robert", "pending", "€64.00"],
            ].map((r, i) => {
                const o = i === 1 ? ramp(frame, insert, 12, ENTER) : 1;
                return (
                    <div key={r[0]} style={{ display: "flex", background: i === 1 ? `rgba(52,211,153,${0.16 * o})` : undefined, opacity: o }}>
                        {r.map((c, j) => (
                            <div key={j} style={{ ...cell, flex: j === 0 ? 0.7 : 1, color: j === 0 ? INK.high : INK.copy }}>
                                {c}
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
    const note = (
        <div style={{ opacity: a, transform: `translate${tall ? "Y" : "X"}(${(1 - a) * -30}px)`, width: tall ? w : 560 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 16, letterSpacing: "0.14em", color: ACCENT, marginBottom: 10 }}>THE DATABASE ANNOUNCES</div>
            <div style={{ borderRadius: 13, border: `2px solid ${ACCENT}`, padding: tall ? "16px 22px" : "18px 24px", background: SURFACE.well }}>
                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 26 : 28, color: INK.high }}>orders · id 1042 changed</div>
                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 22 : 22, color: INK.muted, marginTop: 10, opacity: n }}>
                    customer, status, total: <span style={{ color: ACCENT }}>not included</span>
                </div>
            </div>
        </div>
    );
    return (
        <>
            <Headline text="It names the row. Nothing else." accent={ACCENT} mark={["Nothing"]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 30 : 50, alignItems: tall ? "stretch" : "center" }}>
                    {table}
                    <div style={{ fontFamily: FONT.mono, fontSize: 40, color: ACCENT, opacity: a, textAlign: "center" }}>{tall ? "↓" : "→"}</div>
                    {note}
                </div>
            </At>
        </>
    );
};

/* ── the phones ─────────────────────────────────────────────────────── */

interface Order {
    id: string;
    total: string;
}

const ROBERT: Order[] = [
    { id: "#1038", total: "€18.50" },
    { id: "#1031", total: "€42.00" },
];
const DANA: Order[] = [{ id: "#1029", total: "€120.00" }];
const NEW: Order = { id: "#1042", total: "€64.00" };

/** One person's phone, watching their pending orders. */
const Phone: React.FC<{ who: string; orders: Order[]; incoming?: number; rerun?: number; quiet?: number; left: number; top: number; width: number; height: number }> = ({
    who,
    orders,
    incoming = 9999,
    rerun = 9999,
    quiet = 9999,
    left,
    top,
    width,
    height,
}) => {
    const frame = useCurrentFrame();
    const tall = useStage().format === "tall";
    const inc = ramp(frame, incoming, 14, ENTER);
    const r = ramp(frame, rerun, 10, ENTER);
    const q = ramp(frame, quiet, 10, ENTER);
    const fs = tall ? 24 : 24;
    const rowH = tall ? 74 : 70;
    const row = (o: Order, highlight: number) => (
        <div
            key={o.id}
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                height: rowH,
                padding: "0 20px",
                margin: "0 14px 10px",
                borderRadius: 12,
                background: highlight > 0 ? `rgba(52,211,153,${0.2 * highlight})` : SURFACE.card,
                border: `1px solid ${highlight > 0.5 ? GREEN : SURFACE.hairline}`,
                fontFamily: FONT.body,
                fontSize: fs,
                color: INK.high,
            }}
        >
            <span style={{ fontFamily: FONT.mono }}>{o.id}</span>
            <span style={{ color: INK.copy }}>{o.total}</span>
        </div>
    );
    return (
        <div style={{ position: "absolute", left, top, width, height, borderRadius: 40, border: `2px solid ${SURFACE.hairlineStrong}`, background: SURFACE.sheet, overflow: "hidden" }}>
            <div style={{ height: 30, display: "flex", justifyContent: "center", alignItems: "center" }}>
                <div style={{ width: 90, height: 8, borderRadius: 9, background: SURFACE.raised }} />
            </div>
            <div style={{ padding: "8px 26px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 99, background: who === "Robert" ? CHROMA.cyan : CHROMA.yellow, color: GROUND.base, fontFamily: FONT.display, fontWeight: 700, fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {who[0]}
                </div>
                <div>
                    <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: tall ? 28 : 28, color: INK.high }}>{who}</div>
                    <div style={{ fontFamily: FONT.body, fontSize: 18, color: INK.muted }}>My pending orders</div>
                </div>
            </div>
            <div style={{ height: inc * (rowH + 10), overflow: "hidden" }}>{row(NEW, inc * (1 - ramp(frame, incoming + 40, 30)))}</div>
            {orders.map((o) => row(o, 0))}
            {/* what happened on the server, for this phone */}
            <div style={{ position: "absolute", left: 14, right: 14, bottom: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ opacity: r, fontFamily: FONT.mono, fontSize: tall ? 18 : 18, color: INK.copy, padding: "10px 14px", borderRadius: 10, background: SURFACE.well, border: `1px solid ${SURFACE.hairline}` }}>
                    query re-run as <span style={{ color: INK.high }}>{who.toLowerCase()}</span>
                </div>
                <div style={{ opacity: Math.max(inc, q), fontFamily: FONT.mono, fontSize: tall ? 18 : 18, padding: "10px 14px", borderRadius: 10, color: q > 0 ? INK.muted : GREEN, border: `1px solid ${q > 0 ? SURFACE.hairline : GREEN}` }}>
                    {q > 0 ? "no change · nothing sent" : "1 new row · sent"}
                </div>
            </div>
        </div>
    );
};

const Phones: React.FC<{ rerun?: number; deliver?: number }> = ({ rerun, deliver }) => {
    const { x, y, format } = useBody(format2(useStage().format));
    const tall = format === "tall";
    const width = tall ? 440 : 440;
    const height = tall ? 590 : 640;
    const gap = tall ? 56 : 90;
    const top = tall ? y : y - 10;
    return (
        <>
            <Phone who="Robert" orders={ROBERT} rerun={rerun} incoming={deliver} left={x} top={top} width={width} height={height} />
            <Phone who="Dana" orders={DANA} rerun={rerun} quiet={deliver} left={x + width + gap} top={top} width={width} height={height} />
        </>
    );
};

function format2(f: "wide" | "tall"): number {
    return f === "tall" ? 2 : 1;
}

const Rerun: React.FC = () => {
    const rerun = useCue({ line: "rerun", word: "again,", plus: -4 }) ?? 9999;
    return (
        <>
            <Headline text="Each query runs again, as its subscriber." accent={ACCENT} mark={["as", "its"]} />
            <Phones rerun={rerun} />
        </>
    );
};

const Hidden: React.FC = () => {
    const deliver = useCue({ line: "hidden", word: "never", plus: -14 }) ?? 9999;
    return (
        <>
            <Headline text="Dana never sees Robert's order." accent={ACCENT} mark={["never"]} />
            <Phones rerun={-100} deliver={deliver} />
        </>
    );
};

/** One set of rules, two ways to read: a request and a subscription. */
const Nothing: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    const sub = useCue({ line: "nothing", word: "realtime", plus: -4 }) ?? 9999;
    const box = (label: string, code: string, at: number) => {
        const o = ramp(frame, at, 12, ENTER);
        return (
            <div style={{ flex: 1, padding: tall ? "18px 22px" : "22px 26px", borderRadius: 13, background: SURFACE.sheet, border: `1px solid ${SURFACE.hairline}`, opacity: o, transform: `translateY(${(1 - o) * 12}px)` }}>
                <div style={{ fontFamily: FONT.mono, fontSize: 16, letterSpacing: "0.14em", color: INK.muted }}>{label}</div>
                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 22 : 24, color: INK.high, marginTop: 8 }}>{code}</div>
            </div>
        );
    };
    const p = ramp(frame, sub + 14, 14, ENTER);
    return (
        <>
            <Headline text="No separate rules for realtime." accent={ACCENT} mark={["No"]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: 18 }}>
                    {box("A REQUEST", "client.data.orders.find()", 6)}
                    {box("A SUBSCRIPTION", "client.data.orders.listen(…)", sub)}
                </div>
                <div style={{ textAlign: "center", fontFamily: FONT.mono, fontSize: 40, color: ACCENT, margin: "14px 0", opacity: p }}>↓</div>
                <div style={{ opacity: p, padding: tall ? "18px 22px" : "22px 26px", borderRadius: 13, border: `2px solid ${ACCENT}`, background: SURFACE.well, fontFamily: FONT.mono, fontSize: tall ? 22 : 24, color: INK.high }}>
                    <span style={{ color: INK.muted }}>the same policy · </span>USING ((customer_id)::text = (SELECT rebase.uid()))
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const REALTIME: FilmSpec = checkFilm({
    id: "realtime",
    number: 7,
    title: "Realtime that respects your rules",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 4 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "listen", at: { line: "listen", plus: 2 }, render: Listen, roll: 0.36 },
        { id: "keys", at: { line: "keys", plus: 2 }, render: Keys, roll: 0.6 },
        { id: "rerun", at: { line: "rerun", plus: 2 }, render: Rerun, roll: 0.2, ground: GROUND.claim, reveal: 0.6 },
        { id: "hidden", at: { line: "hidden", plus: 2 }, render: Hidden, roll: 0.24, ground: GROUND.claim, reveal: 0.6 },
        { id: "nothing", at: { line: "nothing", plus: 2 }, render: Nothing, roll: 0.44 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.48 },
    ],
});
