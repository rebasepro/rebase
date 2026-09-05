import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Frame } from "../components/Frame";
import { DisplayLine, DISPLAY } from "../components/Type";
import { STAGE_INSET } from "../components/Scene";
import { ramp } from "../components/motion";
import { CHROMA, FONT, INK, TRACKING } from "../theme";

/**
 * CANDIDATE — the wire.
 *
 * No headline column, no artifact beside it: the whole frame is the thing.
 * The film has one scene that fills its own frame (the bento) and it is the
 * one that reads as different; this is the other kind of full-bleed — not a
 * grid of surfaces but a single surface moving.
 *
 * What it shows is the realtime feed: every write to the database arriving on
 * the socket, tagged with the table it touched and the row it produced. It is
 * the only place in the film where the product is shown WORKING rather than
 * shown existing.
 *
 * IN A WINDOW. The feed used to be painted straight onto the ground — rows,
 * hairlines and badges across the full 1520 measure with no edge — and at a
 * glance it was a server log, which is the one thing in this film that does
 * not look like a product. The same rows inside the frame every other
 * surface in the film gets read as a panel of the product, because that is
 * what they are. The latency column went with the change: a number nobody
 * can act on, in a film that is asking to be read at three words a second.
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
}

/* Deterministic and finite — no clock, no randomness, so the scene renders the
   same on every worker. Tables and shapes are the demo's own. */
const EVENTS: Ev[] = [
    { op: "insert", table: "orders", row: "ORD-2026-0188 · $412.00" },
    { op: "update", table: "products", row: "stock 197 → 196" },
    { op: "insert", table: "order_items", row: "SKU-57032 × 1" },
    { op: "update", table: "orders", row: "status paid → shipped" },
    { op: "insert", table: "tickets", row: "TK-2026-0061 · high" },
    { op: "update", table: "customers", row: "lifetime_value 8,426" },
    { op: "insert", table: "orders", row: "ORD-2026-0189 · $79.90" },
    { op: "delete", table: "order_items", row: "SKU-28880 × 2" },
    { op: "update", table: "posts", row: "status draft → published" },
    { op: "insert", table: "customers", row: "karen.thomas@example.com" },
    { op: "update", table: "tickets", row: "column open → in progress" },
    { op: "insert", table: "orders", row: "ORD-2026-0190 · $1,204.50" },
    { op: "update", table: "products", row: "price 28.90 → 26.40" },
    { op: "insert", table: "exercises", row: "Barbell Row · published" },
    { op: "update", table: "orders", row: "tracking DHL-991827" },
    { op: "delete", table: "tickets", row: "TK-2026-0042 · resolved" },
    { op: "insert", table: "order_items", row: "SKU-36050 × 3" },
    { op: "update", table: "authors", row: "handle @camiladuarte" },
];

const ROW_H = 52;
const VISIBLE = 12;
/** One arrival every six frames — fast enough to feel live, slow enough that a
 *  single row can still be read on its way past. */
const EVERY = 6;
const START = 22;

const FRAME_TOP = 108;
const FRAME_AT = 6;

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
            <div style={{ position: "absolute", left: STAGE_INSET, top: FRAME_TOP, width: 1520 }}>
                <Frame
                    title="realtime · subscribed to 8 collections"
                    delay={FRAME_AT}
                    bodyStyle={{ padding: "0 26px", height: VISIBLE * ROW_H, position: "relative", overflow: "hidden" }}
                    meta={
                        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span
                                style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 999,
                                    background: CHROMA.cyan,
                                    display: "block",
                                    opacity: interpolate(frame % 60, [0, 30, 60], [1, 0.25, 1]),
                                }}
                            />
                            <span style={{ letterSpacing: TRACKING.eyebrow, textTransform: "uppercase", fontSize: 12 }}>
                                connected
                            </span>
                        </span>
                    }
                >
                    {rows.map(({ ev, i }) => {
                        const age = arrived - i;
                        /* Integer y. Nothing here is ever at a fractional position. */
                        const y = (VISIBLE - 1 - age) * ROW_H;
                        const born = ramp(frame, START + i * EVERY, 5);
                        /* Rows fade as they RISE, so the top of the window is never
                           a hard cut through a line of type. */
                        const rise = Math.max(0, Math.min(1, 1 - (age - (VISIBLE - 4)) / 3));
                        const flash = 1 - ramp(frame, START + i * EVERY, 22);
                        const colour = OP_COLOUR[ev.op];
                        return (
                            <div
                                key={i}
                                style={{
                                    position: "absolute",
                                    left: 0,
                                    right: 0,
                                    top: y,
                                    height: ROW_H,
                                    padding: "0 26px",
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
                            </div>
                        );
                    })}
                </Frame>
            </div>

            {/* The line arrives once the feed has been running long enough to
                be believed — at the split tier, on the film's own measure, where
                a 46px one-off used to sit. */}
            <div style={{ position: "absolute", left: STAGE_INSET, top: 852, width: 1520 }}>
                <DisplayLine size={DISPLAY.split} delay={140}>
                    Every change, the moment it happens.
                </DisplayLine>
            </div>
        </AbsoluteFill>
    );
};

export const STREAM_DURATION = 300;
