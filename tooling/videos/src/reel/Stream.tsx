import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { ramp } from "../components/motion";
import { CHROMA, FONT, INK, TRACKING } from "../theme";

/**
 * CANDIDATE — the wire.
 *
 * No headline column, no artifact beside it, no code frame: the whole frame is
 * the thing. The film has one scene that fills its own frame (the bento) and it
 * is the one that reads as different; this is the other kind of full-bleed —
 * not a grid of surfaces but a single surface moving.
 *
 * What it shows is the realtime feed: every write to the database arriving on
 * the socket, tagged with the table it touched and the row it produced. It is
 * the only place in the film where the product is shown WORKING rather than
 * shown existing.
 *
 * The rows STEP by whole row-heights rather than scrolling continuously. A
 * smooth scroll would put every glyph on a new sub-pixel offset each frame and
 * the whole wall would shimmer — the same mistake that made the code frames
 * vibrate. A log prints line by line anyway; stepping is what it really does.
 */

type Op = "insert" | "update" | "delete";

const OP_COLOUR: Record<Op, string> = {
    insert: CHROMA.cyan,
    update: CHROMA.yellow,
    delete: CHROMA.coral,
};

interface Ev {
    op: Op;
    table: string;
    row: string;
    ms: number;
}

/* Deterministic and finite — no clock, no randomness, so the scene renders the
   same on every worker. Tables and shapes are the demo's own. */
const EVENTS: Ev[] = [
    { op: "insert", table: "orders", row: "ORD-2026-0188 · $412.00", ms: 6 },
    { op: "update", table: "products", row: "stock 197 → 196", ms: 4 },
    { op: "insert", table: "order_items", row: "SKU-57032 × 1", ms: 5 },
    { op: "update", table: "orders", row: "status paid → shipped", ms: 7 },
    { op: "insert", table: "tickets", row: "TK-2026-0061 · high", ms: 5 },
    { op: "update", table: "customers", row: "lifetime_value 8,426", ms: 4 },
    { op: "insert", table: "orders", row: "ORD-2026-0189 · $79.90", ms: 6 },
    { op: "delete", table: "order_items", row: "SKU-28880 × 2", ms: 3 },
    { op: "update", table: "posts", row: "status draft → published", ms: 8 },
    { op: "insert", table: "customers", row: "karen.thomas@example.com", ms: 5 },
    { op: "update", table: "tickets", row: "column open → in progress", ms: 4 },
    { op: "insert", table: "orders", row: "ORD-2026-0190 · $1,204.50", ms: 7 },
    { op: "update", table: "products", row: "price 28.90 → 26.40", ms: 5 },
    { op: "insert", table: "exercises", row: "Barbell Row · published", ms: 6 },
    { op: "update", table: "orders", row: "tracking DHL-991827", ms: 4 },
    { op: "delete", table: "tickets", row: "TK-2026-0042 · resolved", ms: 3 },
    { op: "insert", table: "order_items", row: "SKU-36050 × 3", ms: 5 },
    { op: "update", table: "authors", row: "handle @camiladuarte", ms: 6 },
];

const ROW_H = 52;
const TOP = 118;
const VISIBLE = 14;
/** One arrival every six frames — fast enough to feel live, slow enough that a
 *  single row can still be read on its way past. */
const EVERY = 6;
const START = 12;

export const Stream: React.FC = () => {
    const frame = useCurrentFrame();
    const arrived = Math.max(0, Math.floor((frame - START) / EVERY));

    const rows: { ev: Ev; i: number }[] = [];
    for (let k = 0; k < VISIBLE; k++) {
        const i = arrived - k;
        if (i < 0) continue;
        rows.push({ ev: EVENTS[i % EVENTS.length], i });
    }

    return (
        <AbsoluteFill>
            {rows.map(({ ev, i }) => {
                const age = arrived - i;
                /* Integer y. Nothing here is ever at a fractional position. */
                const y = TOP + (VISIBLE - 1 - age) * ROW_H;
                const born = ramp(frame, START + i * EVERY, 5);
                /* Rows fade as they RISE, rather than walking into an overlay.
                   The overlay was a #08090A gradient painted across the top of
                   the frame, which in the film would have covered the shared
                   Neat plane and left a dead band exactly where the ribbon
                   reads. Nothing in this scene paints ground any more. */
                const rise = Math.max(0, Math.min(1, 1 - (age - (VISIBLE - 5)) / 4));
                const flash = 1 - ramp(frame, START + i * EVERY, 22);
                const colour = OP_COLOUR[ev.op];
                return (
                    <div
                        key={i}
                        style={{
                            position: "absolute",
                            left: 200,
                            top: y,
                            width: 1520,
                            height: ROW_H,
                            display: "flex",
                            alignItems: "center",
                            gap: 26,
                            opacity: born * rise,
                            background: `rgba(255,255,255,${0.05 * flash})`,
                            borderBottom: `1px solid ${INK.ruleSoft}`,
                        }}
                    >
                        <span style={{ fontFamily: FONT.mono, fontSize: 15, color: INK.muted, width: 96 }}>
                            {`+${String(i * 37 + 12).padStart(4, "0")}ms`}
                        </span>
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: 13,
                                textTransform: "uppercase",
                                letterSpacing: TRACKING.eyebrow,
                                color: colour,
                                background: `${colour}1F`,
                                border: `1px solid ${colour}44`,
                                borderRadius: 6,
                                padding: "5px 10px",
                                width: 82,
                                textAlign: "center",
                            }}
                        >
                            {ev.op}
                        </span>
                        <span style={{ fontFamily: FONT.mono, fontSize: 21, color: INK.high, width: 220 }}>
                            {ev.table}
                        </span>
                        <span style={{ fontFamily: FONT.mono, fontSize: 18, color: INK.copy }}>{ev.row}</span>
                        <span
                            style={{
                                marginLeft: "auto",
                                fontFamily: FONT.mono,
                                fontSize: 16,
                                color: INK.muted,
                            }}
                        >
                            {ev.ms}ms
                        </span>
                    </div>
                );
            })}

            <div
                style={{
                    position: "absolute",
                    left: 200,
                    top: 78,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    opacity: ramp(frame, 4, 16),
                }}
            >
                <span
                    style={{
                        width: 9,
                        height: 9,
                        borderRadius: 999,
                        background: CHROMA.cyan,
                        display: "block",
                        opacity: interpolate(frame % 60, [0, 30, 60], [1, 0.25, 1]),
                    }}
                />
                <span
                    style={{
                        fontFamily: FONT.body,
                        fontSize: 14,
                        fontWeight: 600,
                        color: INK.muted,
                        textTransform: "uppercase",
                        letterSpacing: TRACKING.eyebrow,
                    }}
                >
                    Realtime · subscribed to 8 collections
                </span>
            </div>

            <div
                style={{
                    position: "absolute",
                    left: 200,
                    top: 878,
                    width: 1520,
                    fontFamily: FONT.display,
                    fontSize: 46,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: INK.high,
                    opacity: ramp(frame, 150, 26),
                }}
            >
                Every write, on the socket, as it happens.
            </div>

            <div
                style={{
                    position: "absolute",
                    left: 200,
                    top: 946,
                    width: 1520,
                    fontFamily: FONT.body,
                    fontSize: 24,
                    color: INK.copy,
                    opacity: ramp(frame, 168, 26),
                }}
            >
                You subscribed to a collection, not a channel — and the rows you
                are not allowed to see never arrive.
            </div>
        </AbsoluteFill>
    );
};

export const STREAM_DURATION = 300;
