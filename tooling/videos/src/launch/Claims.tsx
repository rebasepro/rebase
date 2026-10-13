import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Code } from "../components/Code";
import { pop, ramp, SPRING } from "../components/motion";
import { ALL, MINE, Side } from "../reel/TwoUsers";
import { CHROMA, FONT, INK, RADIUS, SURFACE, TRACKING } from "../theme";
import { useTone } from "../Plane";
import { ACCENT, Callout, Caption, LEAD, ProductWindow, Verb, WINDOW } from "./kit";
import { BAR, BEAT } from "./score";

/**
 * The sections for the claims the product rests on, in docs/PRODUCT.md's
 * ranking: one definition for every surface, security in the database, and
 * agents as first-class callers. Every value on screen is one the product
 * really produces, taken from the long film's vetted scenes (reel/Fanout,
 * reel/TwoUsers, desk/windows/AgentConsole) rather than written again here.
 */

/** A point in frame pixels, as the fraction of WINDOW a callout targets. */
const inFrame = (x: number, y: number): [number, number] => [
    (x - WINDOW.x) / WINDOW.width,
    (y - WINDOW.y) / WINDOW.height,
];

// ─── Define: one file, every surface ────────────────────────────────────────

/* reel/Fanout's collection: it typechecks against defineCollection as
   written, and its one security rule is the one the policy name below is
   compiled from. */
const SOURCE = `export const orders = defineCollection({
    name: "Orders",
    slug: "orders",
    properties: {
        customer_id: { type: "string" },
        total: { type: "number" },
        status: { type: "string" }
    },
    securityRules: [{
        operation: "select",
        ownerField: "customer_id"
    }]
});`;

/* reel/Fanout's outputs, each a real path, call or name: REST is
   /api/data/<slug>, OpenAPI is served at /api/docs, and the policy name is
   getPolicyNamesForRule run on SOURCE's rule. */
const OUTS = [
    { label: "REST", value: "GET /api/data/orders" },
    { label: "Typed SDK", value: "client.data.orders.find()" },
    { label: "OpenAPI", value: "GET /api/docs" },
    { label: "RLS policy", value: "orders_select_a86d19b" },
    { label: "Realtime", value: "client.data.orders.listen(…)" },
    { label: "Admin panel", value: "/c/orders" },
];
const RLS = 3;

const FILE = { x: WINDOW.x, y: 262, width: 580, height: 556 } as const;
const CHIP = { x: 1480, w: 360, h: 66, gap: 14 } as const;
const CHIPS_TOP = 540 - (OUTS.length * CHIP.h + (OUTS.length - 1) * CHIP.gap) / 2;
const FAN = { x: FILE.x + FILE.width, y: 540 } as const;

export const Define: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();
    // The policy chip takes the accent on the last bar: the next section is
    // that policy, running.
    const handoff = ramp(frame, 2 * BAR - LEAD, 20);
    return (
        <AbsoluteFill>
            <Verb word="Define." product="One definition" />
            <Caption label="Every surface" text="Schema, API, SDK, policies and panel, from one file." at={2 * BEAT - LEAD} />

            <ProductWindow rect={FILE}>
                <div
                    style={{
                        height: 48,
                        display: "flex",
                        alignItems: "center",
                        padding: "0 22px",
                        borderBottom: `1px solid ${SURFACE.hairline}`,
                        fontFamily: FONT.mono,
                        fontSize: 16,
                        color: INK.copy,
                    }}
                >
                    collections/orders.ts
                </div>
                <div style={{ padding: "26px 30px", fontVariantLigatures: "none" }}>
                    <Code code={SOURCE} size={20} delay={-40} />
                </div>
            </ProductWindow>

            <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
                {OUTS.map((_, i) => {
                    const land = (2 + i) * BEAT;
                    const cy = CHIPS_TOP + i * (CHIP.h + CHIP.gap) + CHIP.h / 2;
                    const d = `M ${FAN.x} ${FAN.y} C ${FAN.x + 80} ${FAN.y}, ${CHIP.x - 80} ${cy}, ${CHIP.x} ${cy}`;
                    const len = 260;
                    const draw = ramp(frame, land - LEAD - 12, 14);
                    const lit = i === RLS ? handoff : 0;
                    return (
                        <path
                            key={i}
                            d={d}
                            fill="none"
                            stroke={ACCENT}
                            strokeOpacity={0.55 + 0.45 * lit}
                            strokeWidth={2}
                            strokeDasharray={len}
                            strokeDashoffset={(1 - draw) * len}
                        />
                    );
                })}
                <circle cx={FAN.x} cy={FAN.y} r={6} fill={ACCENT} opacity={ramp(frame, 2 * BEAT - LEAD - 14, 10)} />
            </svg>

            {OUTS.map((out, i) => {
                const land = (2 + i) * BEAT;
                const p = pop(frame, fps, land - LEAD, SPRING.card);
                const lit = i === RLS ? handoff : 0;
                return (
                    <div
                        key={out.label}
                        style={{
                            position: "absolute",
                            left: CHIP.x,
                            top: CHIPS_TOP + i * (CHIP.h + CHIP.gap),
                            width: CHIP.w,
                            height: CHIP.h,
                            boxSizing: "border-box",
                            padding: "10px 18px",
                            borderRadius: RADIUS.lg,
                            background: SURFACE.sheet,
                            border: `1px solid ${lit > 0 ? ACCENT : SURFACE.hairlineStrong}`,
                            opacity: Math.min(1, p * 1.5),
                            transform: `translateX(${(1 - p) * -24}px)`,
                        }}
                    >
                        <div
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: 13,
                                textTransform: "uppercase",
                                letterSpacing: TRACKING.eyebrow,
                                color: lit > 0 ? ACCENT : INK.muted,
                            }}
                        >
                            {out.label}
                        </div>
                        <div style={{ marginTop: 6, fontFamily: FONT.mono, fontSize: 19, color: INK.high }}>{out.value}</div>
                    </div>
                );
            })}
        </AbsoluteFill>
    );
};

// ─── Secure: the same query, two users ──────────────────────────────────────

const QUERY = "await client.data.orders.find()";
const PANEL = { y: 300, w: 524, gap: 32 } as const;
const LEFT = WINDOW.x;
const RIGHT = WINDOW.x + PANEL.w + PANEL.gap;

export const Secure: React.FC = () => {
    const frame = useCurrentFrame();
    const tone = useTone();
    const typed = Math.round(ramp(frame, 0, 30, (t) => t) * QUERY.length);
    return (
        <AbsoluteFill>
            <Verb word="Secure." product="Row-level security" />
            <div
                style={{
                    position: "absolute",
                    left: LEFT,
                    top: 214,
                    fontFamily: FONT.mono,
                    fontSize: 28,
                    color: tone.high,
                    fontVariantLigatures: "none",
                }}
            >
                {QUERY.slice(0, typed)}
                <span style={{ opacity: typed < QUERY.length || frame % 32 < 16 ? 1 : 0, color: CHROMA.cyan }}>▌</span>
            </div>

            <Side x={LEFT} y={PANEL.y} w={PANEL.w} accent={CHROMA.cyan} who="Robert" role="customer" count="2 rows" rows={MINE} delay={BEAT + 4} />
            <Side x={RIGHT} y={PANEL.y} w={PANEL.w} accent={CHROMA.yellow} who="Dana" role="support" count="48 rows" rows={ALL} delay={BEAT + 4} />

            <Callout
                label="Enforced in Postgres"
                text="One query. Each user gets only their rows."
                // The edge of Robert's panel, level with the label.
                target={inFrame(LEFT, 552)}
                at={3 * BEAT - LEAD}
                until={2 * BAR - 4}
            />
            <Callout
                label="Fail-closed"
                text="Rows no policy grants are never returned."
                // The empty half of Robert's panel: the rows that are not there.
                target={inFrame(LEFT + 240, 640)}
                at={2 * BAR + 14}
            />
        </AbsoluteFill>
    );
};

// ─── Agents: an MCP session under a scoped key ──────────────────────────────

interface Line {
    kind: "call" | "key" | "ok" | "err" | "note" | "boot" | "gap";
    text: string;
    at: number;
}

/* desk/windows/AgentConsole's session: the tool names are packages/mcp's own
   and the refusal is the one the API returns for a key used outside its
   scope, with the first sentence of its message. */
const SESSION: Line[] = [
    // The server starting, and five of its real tools (packages/mcp): context
    // that also sets the two lines the callouts point at level with them.
    { kind: "boot", text: "$ pnpm exec rebase-mcp", at: -40 },
    { kind: "boot", text: "tools   list_documents · get_document · create_document · delete_document · …", at: -40 },
    { kind: "gap", text: "", at: -40 },
    { kind: "key", text: "api key   acme-support · customers: read, write", at: -40 },
    { kind: "call", text: "list_documents   customers · where status = active", at: 14 },
    { kind: "ok", text: "← 48 documents", at: 44 },
    { kind: "call", text: "delete_document  customers · 3f9a2c7e-…", at: BAR - LEAD - 16 },
    { kind: "err", text: "← 403 SCOPE_MISSING", at: BAR + 10 },
    { kind: "note", text: 'This credential does not hold "data:delete" for collection "customers".', at: BAR + 22 },
];

const COLOUR: Record<Line["kind"], string> = {
    boot: "#5B6068",
    gap: INK.muted,
    call: INK.high,
    key: INK.muted,
    ok: "#34D399",
    err: CHROMA.coral,
    note: INK.copy,
};

const CONSOLE = { head: 54, top: 54 + 44, pad: 44, line: 62 } as const;
const lineY = (i: number) => WINDOW.y + CONSOLE.top + i * CONSOLE.line + 16;

export const Agents: React.FC = () => {
    const frame = useCurrentFrame();
    return (
        <AbsoluteFill>
            <Verb word="Delegate." product="Agent-native" />
            <ProductWindow>
                <div style={{ position: "absolute", inset: 0, background: SURFACE.well, fontVariantLigatures: "none" }}>
                    <div
                        style={{
                            height: CONSOLE.head,
                            display: "flex",
                            alignItems: "center",
                            gap: 9,
                            padding: "0 22px",
                            borderBottom: `1px solid ${SURFACE.hairline}`,
                            fontFamily: FONT.mono,
                            fontSize: 17,
                            color: INK.muted,
                        }}
                    >
                        {[0, 1, 2].map((k) => (
                            <div key={k} style={{ width: 11, height: 11, borderRadius: 6, background: "rgba(255,255,255,0.14)" }} />
                        ))}
                        <span style={{ marginLeft: 14, color: INK.copy }}>MCP session</span>
                        <span style={{ marginLeft: "auto" }}>rebase-mcp</span>
                    </div>
                    {SESSION.map((l, i) => {
                        if (frame < l.at) return null;
                        // Calls are typed; answers arrive whole.
                        const n = l.kind === "call" ? Math.round(ramp(frame, l.at, 18, (t) => t) * l.text.length) : l.text.length;
                        const t = ramp(frame, l.at, 10);
                        return (
                            <div
                                key={i}
                                style={{
                                    position: "absolute",
                                    left: CONSOLE.pad,
                                    top: CONSOLE.top + i * CONSOLE.line,
                                    fontFamily: FONT.mono,
                                    fontSize: l.kind === "note" || l.kind === "boot" ? 19 : 23,
                                    whiteSpace: "pre",
                                    color: COLOUR[l.kind],
                                    opacity: t,
                                }}
                            >
                                {l.text.slice(0, n)}
                            </div>
                        );
                    })}
                </div>
            </ProductWindow>
            <Callout
                label="MCP server"
                text="Agents use your backend through real tools."
                target={inFrame(WINDOW.x + 20, lineY(4))}
                at={BEAT - LEAD}
                until={BAR - 4}
            />
            <Callout
                label="Scoped keys"
                text="Same rules as your users. Out of scope is a 403."
                target={inFrame(WINDOW.x + 20, lineY(7))}
                at={BAR + 14}
            />
        </AbsoluteFill>
    );
};
