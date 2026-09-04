import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { pop, ramp, SPRING } from "../components/motion";
import { CHROMA, FONT, INK, TRACKING } from "../theme";

/**
 * CANDIDATE — the schema, drawn.
 *
 * A third layout again: not a column of type beside an object, not a grid of
 * live views, but a GRAPH. Nodes and edges is the one shape the film has never
 * used, and it is the natural shape for the thing being shown — Studio's schema
 * visualiser, which draws the relations that are actually in the database
 * rather than the ones a diagram in a wiki claims are.
 *
 * The build order carries that: the tables land first and unconnected, and the
 * relations are then DRAWN between them. A finished diagram appearing whole
 * reads as documentation. One drawn edge at a time reads as something being
 * discovered — which is what reading a foreign key out of the catalogue is.
 *
 * Domains are coloured, not decorated: the chroma hues group the tables that
 * belong to one another, so the shape of the schema is legible before a single
 * label is read.
 */

interface Node {
    id: string;
    label: string;
    fields: string;
    x: number;
    y: number;
    hue: string;
}

const W = 268;
const H = 92;

const NODES: Node[] = [
    { id: "products", label: "products", fields: "14 fields", x: 214, y: 286, hue: CHROMA.cyan },
    { id: "orders", label: "orders", fields: "12 fields", x: 686, y: 214, hue: CHROMA.cyan },
    { id: "order_items", label: "order_items", fields: "6 fields", x: 686, y: 438, hue: CHROMA.cyan },
    { id: "customers", label: "customers", fields: "9 fields", x: 1158, y: 286, hue: CHROMA.coral },
    { id: "users", label: "users", fields: "7 fields", x: 1478, y: 148, hue: CHROMA.coral },
    { id: "tickets", label: "tickets", fields: "10 fields", x: 1420, y: 452, hue: CHROMA.yellow },
    /* The content cluster is laid out around its EDGES, not on a grid. With
       posts, authors and tags on one row the posts→tags relation ran straight
       through the authors card — a line crossing a node reads as a connection
       to it. tags sits high and authors low so the long edge passes above. */
    { id: "posts", label: "posts", fields: "11 fields", x: 250, y: 620, hue: CHROMA.violet },
    { id: "authors", label: "authors", fields: "6 fields", x: 700, y: 690, hue: CHROMA.violet },
    { id: "tags", label: "tags", fields: "3 fields", x: 1150, y: 560, hue: CHROMA.violet },
];

const byId = (id: string) => NODES.find((n) => n.id === id)!;

interface Edge {
    from: string;
    to: string;
    kind: string;
}

const EDGES: Edge[] = [
    { from: "orders", to: "customers", kind: "belongs to" },
    { from: "order_items", to: "orders", kind: "belongs to" },
    { from: "order_items", to: "products", kind: "belongs to" },
    { from: "tickets", to: "customers", kind: "belongs to" },
    { from: "posts", to: "authors", kind: "belongs to" },
    { from: "posts", to: "tags", kind: "many to many" },
    { from: "customers", to: "users", kind: "belongs to" },
];

const NODE_AT = (i: number) => 14 + i * 7;
const EDGE_AT = (i: number) => 92 + i * 13;

/** Nearest edge-centres, so a line never crosses the card it starts from. */
function anchors(a: Node, b: Node) {
    const ax = a.x + W / 2;
    const bx = b.x + W / 2;
    const from = { x: ax < bx ? a.x + W : a.x, y: a.y + H / 2 };
    const to = { x: ax < bx ? b.x : b.x + W, y: b.y + H / 2 };
    return { from, to };
}

export const Map: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    return (
        <AbsoluteFill>
            <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
                {EDGES.map((e, i) => {
                    const a = byId(e.from);
                    const b = byId(e.to);
                    const { from, to } = anchors(a, b);
                    const draw = ramp(frame, EDGE_AT(i), 20);
                    const mid = (from.x + to.x) / 2;
                    const d = `M ${from.x} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x} ${to.y}`;
                    return (
                        <g key={`${e.from}-${e.to}`}>
                            <path
                                d={d}
                                fill="none"
                                stroke="rgba(255,255,255,0.26)"
                                strokeWidth={1.3}
                                pathLength={1}
                                strokeDasharray={1}
                                strokeDashoffset={1 - draw}
                            />
                            <circle
                                cx={to.x}
                                cy={to.y}
                                r={3.5}
                                fill={b.hue}
                                opacity={draw > 0.98 ? 1 : 0}
                            />
                        </g>
                    );
                })}
            </svg>

            {NODES.map((n, i) => {
                const s = pop(frame, fps, NODE_AT(i), SPRING.card);
                return (
                    <div
                        key={n.id}
                        style={{
                            position: "absolute",
                            left: n.x,
                            top: n.y,
                            width: W,
                            height: H,
                            borderRadius: 14,
                            border: `1px solid ${INK.rule}`,
                            background: "#000",
                            display: "flex",
                            alignItems: "center",
                            gap: 18,
                            paddingLeft: 22,
                            overflow: "hidden",
                            opacity: Math.min(1, s * 1.8),
                        }}
                    >
                        {/* The hue is the domain, not decoration: e-commerce,
                            people, support, content. The shape of the schema is
                            legible before a label is read. */}
                        <span
                            style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: 4,
                                background: n.hue,
                            }}
                        />
                        <div>
                            <div style={{ fontFamily: FONT.mono, fontSize: 21, color: INK.high }}>
                                {n.label}
                            </div>
                            <div
                                style={{
                                    marginTop: 5,
                                    fontFamily: FONT.body,
                                    fontSize: 14,
                                    color: INK.muted,
                                }}
                            >
                                {n.fields}
                            </div>
                        </div>
                    </div>
                );
            })}

            <div
                style={{
                    position: "absolute",
                    left: 214,
                    top: 100,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    opacity: ramp(frame, 4, 16),
                }}
            >
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
                    Studio · schema
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: 14, color: INK.muted }}>
                    · 9 tables · {EDGES.length} relations
                </span>
            </div>

            <div
                style={{
                    position: "absolute",
                    left: 214,
                    top: 848,
                    width: 1500,
                    fontFamily: FONT.display,
                    fontSize: 46,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: INK.high,
                    opacity: ramp(frame, 178, 26),
                }}
            >
                Your schema, as it actually is.
            </div>
        </AbsoluteFill>
    );
};

export const MAP_DURATION = 300;
