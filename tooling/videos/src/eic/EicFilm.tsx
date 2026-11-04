import React, { useEffect, useMemo, useRef } from "react";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Code } from "../components/Code";
import { Mark } from "../components/Mark";
import { ENTER, ramp, SHIFT } from "../components/motion";
import { Placeholder, type LiveFeed, type Take } from "../desk/Presenter";
import { authoredTiming, type Script, type Timing } from "../spoken/narration";
import { CHROMA, FONT, FRAME, GROUND, INK, PRIMARY_LIGHT, SURFACE, TRACKING } from "../theme";
import {
    At,
    buildSeries,
    checkFilm,
    Editor,
    Headline,
    Label,
    lines,
    Ribbon,
    Scenes,
    SeriesContext,
    useCue,
    useSeries,
    Window,
    type Box,
    type FilmSpec,
    type SeriesTimeline,
} from "../series/kit";

/**
 * THE EIC FILM — Rebase's pitch for the EIC Accelerator short proposal.
 *
 * Under three minutes, English, burned-in subtitles throughout, two people on
 * camera: Francesco Gatti (CEO) and Marian Moldovan (CTO), side by side in one
 * shot, taking turns. Recorded on the live page like the series
 * (`pnpm live` → ?film=eic): the prompter names whose line is next, and every
 * picture hangs off a spoken word, so the take sets the pace.
 *
 * Built on the series kit (the ribbon, the scene shell, the cue clock) with
 * its own presenter, subtitles, name tags and end card, because two people
 * share the window: wide while both are on camera, cropped to whoever is
 * speaking while it sits in the corner.
 *
 * Every figure on screen is from the application brief and nothing else: the
 * FireCMS project count, MedicalMotion, DearDoc's 100M+ patients, the three
 * production customers, revenue, the BaaS market ($8.4B 2024 → $31.1B 2030)
 * and the ask (€1.5M grant + €1M equity, TRL 9 in 24 months). The rule and the
 * SQL in the breakthrough are the security film's, i.e. what
 * generatePostgresPoliciesDdl printed for that rule.
 */

type Speaker = "francesco" | "marian" | "both";

/** Where each of you sits in the RECORDED picture, as the viewer sees it.
 *  The live page's preview is a mirror, so there it looks the other way
 *  round. If the take has you swapped, flip this and render again. */
const SEAT: Record<"francesco" | "marian", "left" | "right"> = { francesco: "left", marian: "right" };

const PEOPLE = {
    francesco: { name: "Francesco Gatti", role: "Co-founder & CEO, Rebase" },
    marian: { name: "Marian Moldovan", role: "Co-founder & CTO, Rebase" },
} as const;

const SPOKEN: [id: string, speaker: Speaker, text: string][] = [
    ["intro", "francesco", "Hi, I'm Francesco Gatti, co-founder and CEO of Rebase."],
    ["marian", "marian", "And I'm Marian Moldovan, co-founder and CTO."],
    ["firecms", "francesco", "Together we created FireCMS, an open-source CMS used in over ten thousand projects."],
    ["health", "marian", "Between us, we've built the technology behind a certified medical device, and a healthcare platform serving a hundred million patients."],
    ["missing", "francesco", "Today we're building something Europe is missing: its own Supabase or Firebase."],
    ["leak", "francesco", "Every app needs a backend, and most of them leak the same way."],
    ["paths", "francesco", "Access rules live in application code, so cron jobs, scripts, dashboards and AI agents go straight around them."],
    ["forgotten", "francesco", "One forgotten check exposes every customer's data. And the leading platforms are American."],
    ["schema", "marian", "With Rebase, you describe your data in one small schema file."],
    ["generate", "marian", "Rebase generates the whole backend: APIs, a typed SDK, realtime, authentication, storage, and an admin panel."],
    ["breakthrough", "marian", "The breakthrough is where security lives. Your rules compile into native Postgres row-level security."],
    ["every", "marian", "The database enforces them on every path: API, jobs, scripts, admin panel and AI agents."],
    ["policy", "marian", "A table without a policy simply isn't served."],
    ["agents", "marian", "Agents edit one verified file, not thousands of lines, and act through scoped keys and human approval."],
    ["own", "marian", "Rebase is open source and runs on your own Postgres: self-hosted, or on Rebase Cloud on European infrastructure."],
    ["production", "marian", "It's already in production: the full backend of a certified medical device, a retail loyalty programme and a marketplace."],
    ["profitable", "francesco", "And we're profitable and bootstrapped."],
    ["market", "francesco", "Backend-as-a-service is heading for thirty billion dollars, and Europe has no leader."],
    ["scale", "francesco", "Now we need to scale: launch Rebase Cloud across Europe, certify it for health, public sector and finance, and build our sales team."],
    ["eic", "francesco", "That's why we're applying to the EIC."],
    ["help", "marian", "Help us build Europe's sovereign backend."],
    ["thanks", "both", "Thank you."],
];

export const EIC_SCRIPT: Script = lines(SPOKEN.map<[string, string]>(([id, , text]) => [id, text])).map((l, i) => ({ ...l, speaker: SPOKEN[i][1] }));

const SAFE = "#34D399";
const RISK = CHROMA.coral;
const ACCENT = PRIMARY_LIGHT;

/** A cue's scene-local frame, or far in the future while it is unsaid. */
function useAt(line: string, word?: string, plus = 0): number {
    return useCue({ line, word, plus }) ?? 99999;
}

/* ── shared pieces ──────────────────────────────────────────────────── */

const Card: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties; dashed?: boolean }> = ({ at, children, style, dashed }) => {
    const frame = useCurrentFrame();
    const o = ramp(frame, at, 14, ENTER);
    if (o <= 0) return null;
    return (
        <div
            style={{
                padding: "24px 30px",
                borderRadius: 14,
                background: dashed ? "transparent" : SURFACE.sheet,
                border: dashed ? `2px dashed ${INK.rule}` : `1px solid ${SURFACE.hairline}`,
                opacity: o,
                transform: o < 1 ? `translateY(${(1 - o) * 14}px)` : undefined,
                ...style,
            }}
        >
            {children}
        </div>
    );
};

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = INK.muted }) => (
    <div style={{ fontFamily: FONT.mono, fontSize: 16, letterSpacing: TRACKING.eyebrow, textTransform: "uppercase", color }}>{children}</div>
);

const Big: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({ children, color = INK.high, size = 56 }) => (
    <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: size, letterSpacing: TRACKING.display2, lineHeight: 1.05, color, marginTop: 8 }}>{children}</div>
);

const Sub: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({ children, color = INK.copy, size = 24 }) => (
    <div style={{ fontFamily: FONT.body, fontSize: size, lineHeight: 1.35, color, marginTop: 8 }}>{children}</div>
);

const Chip: React.FC<{ at: number; children: React.ReactNode; color?: string; size?: number }> = ({ at, children, color = INK.high, size = 22 }) => {
    const frame = useCurrentFrame();
    const o = ramp(frame, at, 12, ENTER);
    return (
        <span
            style={{
                display: "inline-block",
                fontFamily: FONT.mono,
                fontSize: size,
                padding: "8px 16px",
                borderRadius: 10,
                border: `1px solid ${color === INK.high ? INK.rule : color}`,
                background: SURFACE.sheet,
                color,
                opacity: o,
                transform: o < 1 ? `translateY(${(1 - o) * 8}px)` : undefined,
            }}
        >
            {children}
        </span>
    );
};

/* ── 1 · the team (while both of you are on camera, left) ───────────── */

const TEAM_X = 1196;
const TEAM_W = 628;

const Team: React.FC = () => {
    const fire = useAt("firecms", "FireCMS");
    const device = useAt("health", "certified");
    const patients = useAt("health", "hundred");
    const gap = 18;
    return (
        <At x={TEAM_X} y={200} w={TEAM_W}>
            <div style={{ display: "flex", flexDirection: "column", gap }}>
                <Card at={fire}>
                    <Eyebrow color={ACCENT}>FireCMS · open source</Eyebrow>
                    <Big size={46}>10,000+ projects</Big>
                    <Sub>The CMS we created, used by teams including Microsoft and IKEA</Sub>
                </Card>
                <Card at={device}>
                    <Eyebrow color={ACCENT}>MedicalMotion</Eyebrow>
                    <Big size={46}>Certified medical device</Big>
                    <Sub>A digital medical device, its backend built by us</Sub>
                </Card>
                <Card at={patients}>
                    <Eyebrow color={ACCENT}>DearDoc · EMR integration</Eyebrow>
                    <Big size={46}>100M+ patients</Big>
                    <Sub>The healthcare integration platform Marian built</Sub>
                </Card>
            </div>
        </At>
    );
};

/* ── 2 · paths to the data: the problem, then the fix ───────────────── */

const ROW_Y = 318;
const ROW_H = 68;
const ROW_GAP = 26;
const PILL_X = 120;
const PILL_W = 300;
const DB = { x: 1110, y: 360, w: 330, h: 380 };

function rowCentre(i: number): number {
    return ROW_Y + i * (ROW_H + ROW_GAP) + ROW_H / 2;
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

const Lane: React.FC<{ d: string; at: number; color: string; dashed?: boolean }> = ({ d, at, color, dashed }) => {
    const frame = useCurrentFrame();
    const p = ramp(frame, at, 20, ENTER);
    if (p <= 0) return null;
    return (
        <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={3}
            pathLength={1}
            strokeDasharray={dashed ? undefined : 1}
            strokeDashoffset={dashed ? undefined : 1 - p}
            opacity={dashed ? p : 1}
            style={dashed ? { strokeDasharray: "10 9" } : undefined}
        />
    );
};

const CallerPill: React.FC<{ i: number; at: number; label: string; mark?: "ok" | "no" | null; markAt?: number }> = ({ i, at, label, mark, markAt }) => {
    const frame = useCurrentFrame();
    const o = ramp(frame, at, 12, ENTER);
    const m = markAt === undefined ? 0 : ramp(frame, markAt, 10, ENTER);
    if (o <= 0) return null;
    return (
        <div
            style={{
                position: "absolute",
                left: PILL_X,
                top: rowCentre(i) - ROW_H / 2,
                width: PILL_W,
                height: ROW_H,
                borderRadius: 12,
                background: SURFACE.sheet,
                border: `1px solid ${SURFACE.hairline}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0 22px",
                boxSizing: "border-box",
                opacity: o,
                transform: o < 1 ? `translateX(${(1 - o) * -16}px)` : undefined,
            }}
        >
            <span style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 28, color: INK.high }}>{label}</span>
            {mark && (
                <span
                    style={{
                        width: 34,
                        height: 34,
                        borderRadius: 99,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: mark === "ok" ? SAFE : RISK,
                        color: GROUND.base,
                        fontFamily: FONT.display,
                        fontWeight: 600,
                        fontSize: 22,
                        opacity: m,
                        transform: `scale(${0.6 + 0.4 * m})`,
                    }}
                >
                    {mark === "ok" ? "✓" : "✕"}
                </span>
            )}
        </div>
    );
};

const Database: React.FC<{ at: number; exposed: number; label: string; sub: string; shield?: number }> = ({ at, exposed, label, sub, shield = 0 }) => {
    const frame = useCurrentFrame();
    const o = ramp(frame, at, 14, ENTER);
    const ry = 34;
    const stroke = exposed > 0 ? RISK : "rgba(255,255,255,0.28)";
    const fill = `rgba(251,80,102,${0.16 * exposed})`;
    return (
        <div style={{ position: "absolute", left: DB.x, top: DB.y, width: DB.w, height: DB.h, opacity: o }}>
            <svg width={DB.w} height={DB.h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
                <path
                    d={`M 2 ${ry} L 2 ${DB.h - ry} A ${DB.w / 2 - 2} ${ry} 0 0 0 ${DB.w - 2} ${DB.h - ry} L ${DB.w - 2} ${ry}`}
                    fill={SURFACE.sheet}
                    stroke={stroke}
                    strokeWidth={2}
                />
                <path d={`M 2 ${ry} L 2 ${DB.h - ry} A ${DB.w / 2 - 2} ${ry} 0 0 0 ${DB.w - 2} ${DB.h - ry} L ${DB.w - 2} ${ry}`} fill={fill} />
                <ellipse cx={DB.w / 2} cy={ry} rx={DB.w / 2 - 2} ry={ry - 2} fill={SURFACE.card} stroke={stroke} strokeWidth={2} />
                {shield > 0 && (
                    <rect x={-22} y={ry + 10} width={14} height={DB.h - 2 * ry - 20} rx={7} fill={CHROMA.yellow} opacity={shield} />
                )}
            </svg>
            <div style={{ position: "absolute", left: 0, right: 0, top: DB.h / 2 - 50, textAlign: "center" }}>
                <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 40, color: INK.high }}>{label}</div>
                <div style={{ fontFamily: FONT.mono, fontSize: 20, marginTop: 10, color: exposed > 0.5 ? RISK : INK.copy }}>{sub}</div>
            </div>
        </div>
    );
};

/** The problem: the rules sit in the app, in front of one door. Every other
 *  caller walks around them. */
const Leak: React.FC = () => {
    const frame = useCurrentFrame();
    const api = 10;
    const gate = useAt("paths", "Access");
    const lanes = [api, useAt("paths", "cron"), useAt("paths", "scripts"), useAt("paths", "dashboards"), useAt("paths", "agents")];
    const exposed = ramp(frame, useAt("forgotten", "exposes", -4), 16);
    const labels = ["API", "Cron jobs", "Scripts", "Dashboards", "AI agents"];
    const gateBox = { x: 560, y: rowCentre(0) - 46, w: 320, h: 92 };
    const g = ramp(frame, gate, 14, ENTER);
    const dbIn = (i: number) => DB.y + 90 + i * 50;
    return (
        <>
            <Headline text="Most backends leak the same way." accent={RISK} mark={["leak"]} />
            <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
                <Lane d={curve(PILL_X + PILL_W, rowCentre(0), gateBox.x, rowCentre(0))} at={api} color={SAFE} />
                <Lane d={curve(gateBox.x + gateBox.w, rowCentre(0), DB.x, dbIn(0))} at={gate + 6} color={SAFE} />
                {[1, 2, 3, 4].map((i) => (
                    <Lane key={i} d={curve(PILL_X + PILL_W, rowCentre(i), DB.x, dbIn(i))} at={lanes[i] + 4} color={RISK} />
                ))}
            </svg>
            {labels.map((l, i) => (
                <CallerPill key={l} i={i} at={lanes[i]} label={l} mark={i === 0 ? "ok" : "no"} markAt={i === 0 ? gate + 10 : lanes[i] + 14} />
            ))}
            {g > 0 && (
                <div
                    style={{
                        position: "absolute",
                        left: gateBox.x,
                        top: gateBox.y,
                        width: gateBox.w,
                        height: gateBox.h,
                        borderRadius: 12,
                        border: `2px solid ${SAFE}`,
                        background: SURFACE.sheet,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: g,
                    }}
                >
                    <div style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: TRACKING.eyebrow, color: INK.muted, textTransform: "uppercase" }}>app code</div>
                    <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 26, color: INK.high, marginTop: 4 }}>Access checks</div>
                </div>
            )}
            <Database at={api} exposed={exposed} label="Postgres" sub={exposed > 0.5 ? "every customer's data, exposed" : "every customer's data"} />
        </>
    );
};

/** The same callers with Rebase: every lane ends at the policy, inside the
 *  database. A table without one is not served at all. */
const EveryPath: React.FC = () => {
    const frame = useCurrentFrame();
    const lanes = [useAt("every", "API"), useAt("every", "jobs"), useAt("every", "scripts"), useAt("every", "panel"), useAt("every", "agents")];
    const labels = ["API", "Jobs", "Scripts", "Admin panel", "AI agents"];
    const shield = ramp(frame, useAt("every", "database"), 16);
    const unserved = useAt("policy", "without", -4);
    const u = ramp(frame, unserved, 14, ENTER);
    const dbIn = (i: number) => DB.y + 90 + i * 50;
    return (
        <>
            <Headline text="Enforced in the database. Every path." accent={CHROMA.yellow} mark={["Every"]} />
            <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
                {labels.map((_, i) => (
                    <Lane key={i} d={curve(PILL_X + PILL_W, rowCentre(i), DB.x - 26, dbIn(i))} at={lanes[i] + 4} color={CHROMA.yellow} />
                ))}
            </svg>
            {labels.map((l, i) => (
                <CallerPill key={l} i={i} at={lanes[i]} label={l} mark="ok" markAt={lanes[i] + 16} />
            ))}
            <Database at={0} exposed={0} label="Postgres" sub="row-level security" shield={shield} />
            <div
                style={{
                    position: "absolute",
                    left: DB.x - 40,
                    top: DB.y + DB.h + 36,
                    width: DB.w + 80,
                    padding: "14px 18px",
                    borderRadius: 12,
                    border: `2px solid ${RISK}`,
                    background: SURFACE.sheet,
                    textAlign: "center",
                    opacity: u,
                    transform: u < 1 ? `translateY(${(1 - u) * 12}px)` : undefined,
                }}
            >
                <div style={{ fontFamily: FONT.mono, fontSize: 20, color: INK.copy }}>table without a policy</div>
                <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 30, color: INK.high, marginTop: 2 }}>Not served</div>
            </div>
        </>
    );
};

/** The platforms the problem is built on. */
const American: React.FC = () => (
    <>
        <Headline text="And the platforms are American." accent={RISK} mark={["American"]} />
        <At x={120} y={330} w={1380}>
            <div style={{ display: "flex", gap: 30 }}>
                {[
                    { name: "Supabase", at: 6 },
                    { name: "Firebase", at: 12 },
                ].map((p) => (
                    <Card key={p.name} at={p.at} style={{ width: 400 }}>
                        <Eyebrow>Leading platform</Eyebrow>
                        <Big size={52}>{p.name}</Big>
                        <Sub color={RISK}>US-based</Sub>
                    </Card>
                ))}
                <Card at={20} dashed style={{ width: 440 }}>
                    <Eyebrow>Europe</Eyebrow>
                    <Big size={52}>No equivalent</Big>
                    <Sub>of its own</Sub>
                </Card>
            </div>
        </At>
    </>
);

/* ── 3 · the solution ───────────────────────────────────────────────── */

const ORDERS = `const ordersCollection = defineCollection({
    name: "Orders",
    slug: "orders",
    table: "orders",
    properties: {
        status: { type: "string" },
        total: { type: "number" },
    },
    securityRules: [{
        name: "own_orders",
        operation: "select",
        ownerField: "customer_id",
    }],
});`;

/** One file on the left; on the right, what it becomes: the parts as they
 *  are named, over the generated admin panel running. */
const Schema: React.FC = () => {
    const frame = useCurrentFrame();
    const gen = useAt("generate", "Rebase", -2);
    const parts: [string, number][] = [
        ["REST API", useAt("generate", "APIs")],
        ["Typed SDK", useAt("generate", "SDK")],
        ["Realtime", useAt("generate", "realtime")],
        ["Auth", useAt("generate", "authentication")],
        ["Storage", useAt("generate", "storage")],
        ["Admin panel", useAt("generate", "admin")],
    ];
    const w = ramp(frame, gen, 16, ENTER);
    return (
        <>
            <Headline text="One schema file. The whole backend." accent={ACCENT} mark={["One", "whole"]} />
            <At x={120} y={292} w={600}>
                <Editor file="collections/orders.ts" code={ORDERS} size={19} accent={ACCENT} step={2} />
            </At>
            <At x={760} y={292} w={740}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {parts.map(([p, at]) => (
                        <Chip key={p} at={at} color={p === "Admin panel" ? ACCENT : INK.high} size={20}>
                            {p}
                        </Chip>
                    ))}
                </div>
                {w > 0 && (
                    <div
                        style={{
                            marginTop: 22,
                            width: 740,
                            height: 463,
                            borderRadius: FRAME.radius,
                            border: FRAME.border,
                            overflow: "hidden",
                            background: SURFACE.frame,
                            opacity: w,
                            transform: w < 1 ? `translateY(${(1 - w) * 16}px)` : undefined,
                        }}
                    >
                        <Sequence from={gen} layout="none">
                            <OffthreadVideo src={staticFile("demo/panel.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </Sequence>
                    </div>
                )}
            </At>
        </>
    );
};

const RULE = `securityRules: [
    { name: "own_orders",
      operation: "select",
      ownerField: "customer_id" },
],`;

const POLICY = `ALTER TABLE "public"."orders"
    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_orders" ON "public"."orders"
    AS PERMISSIVE FOR SELECT TO "public"
    USING ((customer_id)::text = (SELECT rebase.uid()));`;

/** The breakthrough, on the claim's blue: the rule, and the native policy
 *  it compiles to. */
const Breakthrough: React.FC = () => {
    const frame = useCurrentFrame();
    const compile = useAt("breakthrough", "compile", -4);
    const a = ramp(frame, compile, 16, ENTER);
    return (
        <>
            <Headline text="Security lives in the database." accent={CHROMA.yellow} mark={["database"]} />
            <At x={120} y={300} w={540}>
                <Editor file="collections/orders.ts" code={RULE} size={22} accent={CHROMA.yellow} step={3} />
            </At>
            <div
                style={{
                    position: "absolute",
                    left: 678,
                    top: 420,
                    fontFamily: FONT.display,
                    fontSize: 56,
                    color: CHROMA.yellow,
                    opacity: a,
                    transform: `translateX(${(1 - a) * -14}px)`,
                }}
            >
                →
            </div>
            {a > 0 && (
                <At x={740} y={300} w={760}>
                    <Window caption="compiled · native Postgres row-level security" accent={INK.high}>
                        <Code code={POLICY} sql size={20} delay={compile + 4} step={3} />
                    </Window>
                </At>
            )}
        </>
    );
};

/** Coding agents and runtime agents, each held by the same rules. */
const Agents: React.FC = () => {
    const coding = useAt("agents", "edit", -2);
    const runtime = useAt("agents", "scoped", -2);
    const approve = useAt("agents", "approval", -2);
    return (
        <>
            <Headline text="Built for AI agents." accent={ACCENT} mark={["agents"]} />
            <At x={120} y={300} w={1380}>
                <div style={{ display: "flex", gap: 30 }}>
                    <Card at={coding} style={{ width: 640, minHeight: 360 }}>
                        <Eyebrow color={ACCENT}>Coding agents</Eyebrow>
                        <Big size={46}>Edit one verified file</Big>
                        <Sub>Not thousands of lines of backend code</Sub>
                        <div style={{ display: "flex", gap: 14, marginTop: 30, alignItems: "center" }}>
                            <Chip at={coding + 10}>collections/orders.ts</Chip>
                            <Chip at={coding + 18} color={SAFE}>
                                ✓ compiler-verified
                            </Chip>
                        </div>
                    </Card>
                    <Card at={runtime} style={{ width: 640, minHeight: 360 }}>
                        <Eyebrow color={ACCENT}>Runtime agents</Eyebrow>
                        <Big size={46}>Scoped keys, human approval</Big>
                        <Sub>They hold only the access you grant</Sub>
                        <div style={{ display: "flex", gap: 14, marginTop: 30, alignItems: "center", flexWrap: "wrap" }}>
                            <Chip at={runtime + 10}>data:read:articles</Chip>
                            <Chip at={approve} color={CHROMA.yellow}>
                                awaiting review
                            </Chip>
                        </div>
                    </Card>
                </div>
            </At>
        </>
    );
};

/* ── 4 · proof ──────────────────────────────────────────────────────── */

const Sovereign: React.FC = () => {
    const open = useAt("own", "open", -2);
    const self = useAt("own", "self-hosted", -2);
    const cloud = useAt("own", "Cloud", -4);
    return (
        <>
            <Headline text="Open source, on your own Postgres." accent={ACCENT} mark={["own"]} />
            <At x={120} y={300} w={1380}>
                <div style={{ display: "flex", gap: 26 }}>
                    <Card at={open} style={{ width: 380 }}>
                        <Eyebrow color={ACCENT}>Licence</Eyebrow>
                        <Big>MIT</Big>
                        <Sub>Open source, built in Madrid</Sub>
                    </Card>
                    <Card at={self} style={{ width: 380 }}>
                        <Eyebrow color={ACCENT}>Self-hosted</Eyebrow>
                        <Big>Your Postgres</Big>
                        <Sub>On your own servers</Sub>
                    </Card>
                    <Card at={cloud} style={{ width: 520 }}>
                        <Eyebrow color={ACCENT}>Rebase Cloud · private beta</Eyebrow>
                        <Big>European infrastructure</Big>
                        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                            <Chip at={cloud + 10} size={19}>Hetzner</Chip>
                            <Chip at={cloud + 14} size={19}>OVHcloud</Chip>
                            <Chip at={cloud + 18} size={19}>Scaleway</Chip>
                        </div>
                    </Card>
                </div>
            </At>
        </>
    );
};

const Production: React.FC = () => {
    const medical = useAt("production", "full", -2);
    const loyalty = useAt("production", "retail", -2);
    const market = useAt("production", "marketplace", -2);
    const company = useAt("profitable", "profitable", -4);
    return (
        <>
            <Headline text="Already in production." accent={SAFE} mark={["production"]} />
            <At x={120} y={300} w={1380}>
                <div style={{ display: "flex", gap: 26 }}>
                    <Card at={medical} style={{ width: 520 }}>
                        <Eyebrow color={SAFE}>MedicalMotion</Eyebrow>
                        <Big size={44}>Certified digital medical device</Big>
                        <Sub>Its full backend runs on Rebase</Sub>
                    </Card>
                    <Card at={loyalty} style={{ width: 380 }}>
                        <Eyebrow color={SAFE}>Unfeigned</Eyebrow>
                        <Big size={44}>Retail loyalty programme</Big>
                    </Card>
                    <Card at={market} style={{ width: 380 }}>
                        <Eyebrow color={SAFE}>SustenTalent</Eyebrow>
                        <Big size={44}>Marketplace</Big>
                    </Card>
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 40, flexWrap: "wrap" }}>
                    <Chip at={company} color={SAFE} size={24}>Profitable</Chip>
                    <Chip at={company + 4} color={SAFE} size={24}>Bootstrapped</Chip>
                    <Chip at={company + 10} size={24}>Revenue €65k in 2025</Chip>
                    <Chip at={company + 14} size={24}>€77k in 2026 to date</Chip>
                </div>
            </At>
        </>
    );
};

/* ── 5 · market and ask ─────────────────────────────────────────────── */

const Market: React.FC = () => {
    const frame = useCurrentFrame();
    const grow = ramp(frame, 10, 40, SHIFT);
    const leader = useAt("market", "Europe", -4);
    const MAX = 430;
    const bars = [
        { year: "2024", value: 8.4, label: "$8.4B" },
        { year: "2030", value: 31.1, label: "$31.1B" },
    ];
    return (
        <>
            <Headline text="A $31 billion market. No European leader." accent={ACCENT} mark={["31", "billion"]} />
            <At x={120} y={330} w={620}>
                <div style={{ display: "flex", gap: 60, alignItems: "flex-end", height: MAX + 60 }}>
                    {bars.map((b, i) => {
                        const h = Math.max(4, (b.value / 31.1) * MAX * (i === 0 ? Math.min(1, grow * 2) : grow));
                        return (
                            <div key={b.year} style={{ width: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                                <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 44, color: INK.high, marginBottom: 12, opacity: ramp(frame, 14 + i * 24, 12) }}>
                                    {b.label}
                                </div>
                                <div style={{ width: 200, height: h, borderRadius: "12px 12px 0 0", background: i === 0 ? "rgba(78,155,255,0.45)" : ACCENT }} />
                            </div>
                        );
                    })}
                </div>
                <div style={{ display: "flex", gap: 60, borderTop: `1px solid ${INK.rule}`, paddingTop: 12 }}>
                    {bars.map((b) => (
                        <div key={b.year} style={{ width: 200, textAlign: "center", fontFamily: FONT.mono, fontSize: 22, color: INK.copy }}>
                            {b.year}
                        </div>
                    ))}
                </div>
                <div style={{ marginTop: 14 }}>
                    <Label at={20}>Backend-as-a-service, market size</Label>
                </div>
            </At>
            <At x={860} y={360} w={640}>
                <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                    <Card at={leader}>
                        <Eyebrow>Leading platforms</Eyebrow>
                        <Big size={44}>Supabase, Firebase</Big>
                        <Sub color={RISK}>Both US-based</Sub>
                    </Card>
                    <Card at={leader + 12} dashed>
                        <Eyebrow>Europe</Eyebrow>
                        <Big size={44}>No leader of its own</Big>
                    </Card>
                </div>
            </At>
        </>
    );
};

const Ask: React.FC = () => {
    const steps: [string, number][] = [
        ["Launch Rebase Cloud across Europe", useAt("scale", "launch", -4)],
        ["Certify it for health, public sector and finance", useAt("scale", "certify", -4)],
        ["Build the sales team", useAt("scale", "build", -4)],
    ];
    const frame = useCurrentFrame();
    return (
        <>
            <Headline text="Rebase to TRL 9, in 24 months." accent={ACCENT} mark={["TRL", "9"]} />
            <At x={120} y={290} w={1380}>
                <div style={{ display: "flex", gap: 26 }}>
                    <Card at={8} style={{ width: 400 }}>
                        <Eyebrow color={ACCENT}>EIC grant</Eyebrow>
                        <Big size={72}>€1.5M</Big>
                    </Card>
                    <Card at={16} style={{ width: 400 }}>
                        <Eyebrow color={ACCENT}>EIC equity</Eyebrow>
                        <Big size={72}>€1M</Big>
                    </Card>
                </div>
                <div style={{ marginTop: 36, display: "flex", flexDirection: "column", gap: 16 }}>
                    {steps.map(([s, at], i) => {
                        const o = ramp(frame, at, 14, ENTER);
                        return (
                            <div key={s} style={{ display: "flex", alignItems: "baseline", gap: 22, opacity: o, transform: o < 1 ? `translateX(${(1 - o) * -14}px)` : undefined }}>
                                <span style={{ fontFamily: FONT.mono, fontSize: 24, color: ACCENT }}>{String(i + 1).padStart(2, "0")}</span>
                                <span style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 40, color: INK.high, letterSpacing: TRACKING.title }}>{s}</span>
                            </div>
                        );
                    })}
                </div>
            </At>
        </>
    );
};

const Nothing: React.FC = () => null;

export const EIC: FilmSpec = checkFilm({
    id: "eic",
    number: 0,
    title: "EIC Accelerator",
    accent: ACCENT,
    script: EIC_SCRIPT,
    toCorner: { line: "leak", plus: -4 },
    close: { line: "eic", plus: -2 },
    scenes: [
        { id: "team", at: { line: "firecms", plus: 2 }, render: Team, roll: 0.62 },
        { id: "leak", at: { line: "leak", plus: 2 }, render: Leak, roll: 0.2 },
        { id: "american", at: { line: "forgotten", word: "platforms", plus: -8 }, render: American, roll: 0.74 },
        { id: "schema", at: { line: "schema", plus: 2 }, render: Schema, roll: 0.34 },
        { id: "breakthrough", at: { line: "breakthrough", plus: 2 }, render: Breakthrough, roll: 0.16, ground: GROUND.claim, reveal: 0.65 },
        { id: "every", at: { line: "every", plus: 2 }, render: EveryPath, roll: 0.5, ground: GROUND.claim, reveal: 0.65 },
        { id: "agents", at: { line: "agents", plus: 2 }, render: Agents, roll: 0.8 },
        { id: "sovereign", at: { line: "own", plus: 2 }, render: Sovereign, roll: 0.28 },
        { id: "production", at: { line: "production", plus: 2 }, render: Production, roll: 0.66 },
        { id: "market", at: { line: "market", plus: 2 }, render: Market, roll: 0.12 },
        { id: "ask", at: { line: "scale", plus: 2 }, render: Ask, roll: 0.46 },
        { id: "close", at: { line: "eic", plus: 0 }, render: Nothing, roll: 0.3 },
    ],
});

/* ── the timeline: the series', with a longer tail for the end card ─── */

/** Frames after the last word: the end card holds about four seconds. */
const TAIL = 110;
/** The end card lands this long after the last word. */
const END_AT = 16;

function buildEic(timing: Timing): SeriesTimeline {
    const s = buildSeries(EIC, timing);
    const last = EIC_SCRIPT[EIC_SCRIPT.length - 1];
    const end = s.cue({ line: last.id, end: true, plus: 0 });
    const duration = end === null ? null : end + TAIL;
    return { ...s, duration, until: duration ?? s.until };
}

function lastWordEnd(series: SeriesTimeline): number | null {
    return series.cue({ line: EIC_SCRIPT[EIC_SCRIPT.length - 1].id, end: true, plus: 0 });
}

/* ── the presenter: two people, one window ──────────────────────────── */

const STAGE = {
    /* Both of you, large: the whole camera frame at 16:9. */
    open: { x: 210, y: 96, w: 1500, h: 844 },
    /* Both of you on the left, your credentials on the right. */
    split: { x: 96, y: 200, w: 1040, h: 585 },
    /* Whoever is speaking: half the frame, cropped to that seat. */
    corner: { x: 1540, y: 660, w: 320, h: 360 },
    close: { x: 300, y: 110, w: 1320, h: 743 },
} satisfies Record<string, Box>;

const EASE = Easing.inOut(Easing.cubic);
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function lerp(a: Box, b: Box, t: number): Box {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

type Stage = keyof typeof STAGE;

interface PresenterState {
    box: Box;
    stage: Stage;
    /** objectPosition x, 0-100: which part of the camera frame is shown. */
    focus: number;
}

function speakerFocus(s: string | undefined): number {
    if (s === "francesco" || s === "marian") return SEAT[s] === "left" ? 0 : 100;
    return 50;
}

function presenterState(frame: number, series: SeriesTimeline): PresenterState {
    const split = series.cue({ line: "firecms", plus: -4 });
    const keys: { at: number | null; stage: Stage; dur: number }[] = [
        { at: split, stage: "split", dur: 30 },
        { at: series.toCorner, stage: "corner", dur: 34 },
        { at: series.closeAt, stage: "close", dur: 44 },
    ];
    let box: Box = STAGE.open;
    let stage: Stage = "open";
    for (const k of keys) {
        if (k.at === null || frame < k.at) break;
        box = lerp(box, STAGE[k.stage], interpolate(frame, [k.at, k.at + k.dur], [0, 1], { ...CLAMP, easing: EASE }));
        stage = k.stage;
    }
    /* Pan the crop to whoever speaks, a few frames before they do. */
    let focus = 50;
    EIC_SCRIPT.forEach((line, k) => {
        const said = series.timing.lines[k];
        if (!said || said.words.length === 0) return;
        const at = said.words[0] - 10;
        if (frame < at) return;
        const p = interpolate(frame, [at, at + 14], [0, 1], { ...CLAMP, easing: EASE });
        focus += (speakerFocus(line.speaker) - focus) * p;
    });
    return { box, stage, focus };
}

/** The camera, live, on the recording page: mirrored as a self-view is, and
 *  cropped like the take will be. */
const LiveCam: React.FC<{ stream: MediaStream; focus: number }> = ({ stream, focus }) => {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const video = ref.current;
        if (!video || video.srcObject === stream) return;
        video.srcObject = stream;
        void video.play().catch(() => undefined);
    }, [stream]);
    return (
        <video
            ref={ref}
            muted
            playsInline
            autoPlay
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${focus}% 50%`, transform: "scaleX(-1)" }}
        />
    );
};

const Presenter: React.FC<{ take?: Take | null; live?: LiveFeed | null }> = ({ take, live }) => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const { box, stage, focus } = presenterState(frame, series);
    const end = lastWordEnd(series);
    const out = end === null ? 0 : ramp(frame, end + END_AT, 14, SHIFT);
    const opacity = ramp(frame, 0, 10) * (1 - out);
    /* Unmounted once the end card covers it, so a take that stops a moment
       after "Thank you" never runs out under the film. */
    if (end !== null && frame > end + END_AT + 30) return null;
    const volume = (f: number) => (end === null ? 1 : 1 - ramp(f, end + END_AT, 24, SHIFT));
    return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
            <div
                style={{
                    position: "absolute",
                    left: Math.round(box.x),
                    top: Math.round(box.y),
                    width: Math.round(box.w),
                    height: Math.round(box.h),
                    borderRadius: FRAME.radius,
                    border: FRAME.border,
                    background: SURFACE.frame,
                    overflow: "hidden",
                    opacity,
                }}
            >
                {live?.stream ? (
                    <LiveCam stream={live.stream} focus={focus} />
                ) : take ? (
                    <OffthreadVideo
                        src={staticFile(take.src)}
                        startFrom={take.startFrom}
                        volume={volume}
                        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${focus}% 50%` }}
                    />
                ) : (
                    <Placeholder stage={stage} />
                )}
            </div>
            <NameTags box={box} stage={stage} focus={focus} />
        </AbsoluteFill>
    );
};

/** Who is who: a lower third under each of you while you introduce
 *  yourselves, then, in the corner, the name of whoever is speaking. */
const NameTags: React.FC<{ box: Box; stage: Stage; focus: number }> = ({ box, stage, focus }) => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const fIn = series.cue({ line: "intro", word: "Francesco", plus: 0 });
    const mIn = series.cue({ line: "marian", word: "Marian", plus: 0 });
    const corner = series.toCorner;
    const close = series.closeAt;
    const tagsOut = corner === null ? 0 : ramp(frame, corner - 10, 12, SHIFT);
    const tag = (who: "francesco" | "marian", at: number | null) => {
        if (at === null) return null;
        const o = ramp(frame, at, 14, ENTER) * (1 - tagsOut);
        if (o <= 0) return null;
        const left = SEAT[who] === "left";
        return (
            <div
                key={who}
                style={{
                    position: "absolute",
                    left: left ? box.x + 28 : undefined,
                    right: left ? undefined : 1920 - (box.x + box.w) + 28,
                    top: box.y + box.h - 110,
                    padding: "12px 20px",
                    borderRadius: 12,
                    background: "rgba(9,10,12,0.78)",
                    border: `1px solid ${SURFACE.hairline}`,
                    opacity: o,
                    transform: o < 1 ? `translateY(${(1 - o) * 10}px)` : undefined,
                    textAlign: left ? "left" : "right",
                }}
            >
                <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: stage === "open" ? 32 : 26, color: INK.high }}>{PEOPLE[who].name}</div>
                <div style={{ fontFamily: FONT.mono, fontSize: stage === "open" ? 18 : 15, color: INK.copy, marginTop: 4 }}>{PEOPLE[who].role}</div>
            </div>
        );
    };
    /* The corner names the speaker; the crop says which seat. */
    let speaker: React.ReactNode = null;
    if (corner !== null && frame >= corner + 20 && (close === null || frame < close)) {
        const who = focus < 50 ? (SEAT.francesco === "left" ? "francesco" : "marian") : SEAT.francesco === "left" ? "marian" : "francesco";
        const o = ramp(frame, corner + 20, 14) * (close === null ? 1 : 1 - ramp(frame, close - 12, 12));
        speaker = (
            <div
                style={{
                    position: "absolute",
                    left: box.x + 14,
                    top: box.y + box.h - 48,
                    padding: "6px 12px",
                    borderRadius: 8,
                    background: "rgba(9,10,12,0.78)",
                    fontFamily: FONT.display,
                    fontWeight: 600,
                    fontSize: 19,
                    color: INK.high,
                    opacity: o,
                }}
            >
                {PEOPLE[who].name}
            </div>
        );
    }
    return (
        <>
            {tag("francesco", fIn)}
            {tag("marian", mIn)}
            {speaker}
        </>
    );
};

/** The brand, small, top left, while you both open. */
const Brand: React.FC = () => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const out = series.toCorner === null ? 0 : ramp(frame, series.toCorner - 10, 14, SHIFT);
    const o = ramp(frame, 6, 16) * (1 - out);
    if (o <= 0) return null;
    return (
        <div style={{ position: "absolute", left: 72, top: 26, display: "flex", alignItems: "center", gap: 14, opacity: o }}>
            <Mark size={44} delay={6} spread={14} />
            <span style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 30, color: INK.high, letterSpacing: TRACKING.title }}>Rebase</span>
            <span style={{ width: 24, height: 1, background: INK.rule, marginLeft: 6 }} />
            <span style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: TRACKING.eyebrow, textTransform: "uppercase", color: INK.copy }}>EIC Accelerator 2026</span>
        </div>
    );
};

/* ── subtitles, throughout ──────────────────────────────────────────── */

/** Most words a subtitle shows at once. */
const CHUNK = 8;

/**
 * Burned-in subtitles for every spoken word, a short phrase at a time,
 * timed from the same Timing as every picture: a take's subtitles are its
 * own words at its own pace. Phrases break at punctuation and at CHUNK
 * words, so a subtitle never runs across the end of a sentence.
 */
const Subtitles: React.FC = () => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const { stage } = presenterState(frame, series);
    let shown: string[] | null = null;
    EIC_SCRIPT.forEach((line, k) => {
        const said = series.timing.lines[k];
        if (!said || said.words.length === 0) return;
        const end = said.end ?? Infinity;
        if (frame < said.words[0] || frame > end + 14) return;
        /* Phrases end at punctuation; a phrase longer than CHUNK splits into
           even parts, so "over ten thousand projects" stays together
           rather than leaving "thousand projects" for the next subtitle. */
        const phrases: number[][] = [];
        let cur: number[] = [];
        line.words.forEach((w, i) => {
            cur.push(i);
            if (/[.,:;?!]$/.test(w)) {
                phrases.push(cur);
                cur = [];
            }
        });
        if (cur.length) phrases.push(cur);
        const chunks: number[][] = [];
        for (const p of phrases) {
            const size = Math.ceil(p.length / Math.ceil(p.length / CHUNK));
            for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
        }
        /* Glue a one-word tail onto the phrase before it: a lone word
           flashing up reads as a glitch. */
        for (let i = chunks.length - 1; i > 0; i--) {
            if (chunks[i].length === 1 && chunks[i - 1].length < CHUNK + 2) {
                chunks[i - 1] = [...chunks[i - 1], ...chunks[i]];
                chunks.splice(i, 1);
            }
        }
        for (const c of chunks) {
            const startAt = said.words[c[0]];
            if (startAt === undefined || frame < startAt - 2) break;
            shown = c.map((i) => line.words[i]);
        }
    });
    if (!shown) return null;
    const words: string[] = shown;
    const corner = stage === "corner";
    return (
        <div
            style={{
                position: "absolute",
                left: 120,
                right: corner ? 420 : 120,
                bottom: corner ? 54 : 40,
                display: "flex",
                justifyContent: corner ? "flex-start" : "center",
                pointerEvents: "none",
            }}
        >
            <div
                style={{
                    fontFamily: FONT.display,
                    fontWeight: 600,
                    fontSize: 40,
                    letterSpacing: "-0.012em",
                    lineHeight: 1.15,
                    padding: "8px 20px",
                    borderRadius: 10,
                    background: "rgba(9,10,12,0.8)",
                    color: INK.high,
                }}
            >
                {words.join(" ").replace(/[,;:]$/, "")}
            </div>
        </div>
    );
};

/* ── the end card ───────────────────────────────────────────────────── */

const EndCard: React.FC = () => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const end = lastWordEnd(series);
    if (end === null) return null;
    const at = end + END_AT;
    if (frame < at - 4) return null;
    const ground = ramp(frame, at, 16, SHIFT);
    const url = ramp(frame, at + 18, 20);
    const firm = ramp(frame, at + 30, 18);
    return (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <AbsoluteFill style={{ background: GROUND.base, opacity: 0.86 * ground }} />
            <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <Mark size={170} delay={at + 2} spread={18} />
                <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 96, letterSpacing: "-0.034em", color: INK.high, marginTop: 30, opacity: ramp(frame, at + 10, 18) }}>
                    Rebase
                </div>
                <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: 44, color: ACCENT, marginTop: 10, opacity: url, transform: `translateY(${(1 - url) * 10}px)` }}>
                    rebase.pro
                </div>
                <div style={{ fontFamily: FONT.mono, fontSize: 22, letterSpacing: "0.08em", color: INK.copy, marginTop: 30, opacity: firm }}>FireCMS S.L. · Madrid, Spain</div>
            </div>
        </AbsoluteFill>
    );
};

/* ── the film ───────────────────────────────────────────────────────── */

export interface EicProps {
    timing?: Timing | null;
    take?: Take | null;
    live?: LiveFeed | null;
    [key: string]: unknown;
}

const AUTHORED = authoredTiming(EIC_SCRIPT);

export function eicDuration(props: EicProps): number {
    return buildEic(props.timing ?? AUTHORED).duration ?? 1;
}

export const EicFilm: React.FC<EicProps> = ({ timing, take, live }) => {
    const t = timing ?? AUTHORED;
    const series = useMemo(() => buildEic(t), [t]);
    return (
        <SeriesContext.Provider value={series}>
            <AbsoluteFill style={{ background: GROUND.base, overflow: "hidden" }}>
                <Ribbon />
                <Scenes />
                <Presenter take={take} live={live} />
                <Brand />
                <Subtitles />
                <EndCard />
            </AbsoluteFill>
        </SeriesContext.Provider>
    );
};
