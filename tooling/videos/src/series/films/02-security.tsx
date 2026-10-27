import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Code } from "../../components/Code";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, SURFACE } from "../../theme";
import { At, checkFilm, Editor, Headline, lines, Log, useBody, useCue, useStage, Window, type FilmSpec } from "../kit";

/**
 * 02 — SECURITY LIVES IN THE DATABASE.
 *
 * Middleware is a check someone has to remember to call. In Rebase the rule
 * sits in the collection, compiles to a real Postgres policy, and every
 * caller — the app, the panel, an agent — reaches the rows as the same
 * restricted role, under that policy. If a table cannot be protected, it is
 * locked rather than served.
 *
 * On screen, all real: the rule is `{ name, operation, ownerField }`; the SQL
 * is what generatePostgresPoliciesDdl printed for exactly that rule
 * (2026-10-25); the role is `rebase_user` (rls-enforcement.ts); the lock line
 * is PostgresBootstrapper's own. The middleware file in the hook is a
 * generic illustration of the problem, not Rebase code, and says so.
 *
 * Its look: a vault — the policy on the blue field, every caller funnelled
 * through one door.
 */

const ACCENT = CHROMA.coral;
const SAFE = "#34D399";

const SCRIPT = lines([
    ["hook", "Most apps keep their access rules in middleware. Miss one check, and the data is open."],
    ["rule", "Rebase puts the rule in the collection, right next to the table it protects."],
    ["policy", "Then it becomes a real Postgres policy, and the database checks it on every request."],
    ["everyone", "Your app, your admin panel and your agents all reach the data through those policies."],
    ["lock", "If a table can't get row-level security, Rebase locks it rather than serve it unprotected."],
    ["close", "Rebase is open source. Your rules live in Postgres, where nobody can forget to call them."],
]);

const ROUTES = `app.get("/orders", requireUser, listOrders);
app.get("/orders/:id", getOrder);
app.patch("/orders/:id", requireUser, updateOrder);`;

const RULE = `const ordersCollection = defineCollection({
    name: "Orders",
    slug: "orders",
    table: "orders",
    securityRules: [
        { name: "own_orders", operation: "select",
          ownerField: "customer_id" },
    ],
    properties: { /* … */ },
});`;

const POLICY = `ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_orders" ON "public"."orders"
    AS PERMISSIVE FOR SELECT TO "public"
    USING ((customer_id)::text = (SELECT rebase.uid()));`;

/* ── scenes ─────────────────────────────────────────────────────────── */

/** The problem, as everyone has written it: one route without its check. */
const Middleware: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    const open = useCue({ line: "hook", word: "open.", plus: -4 }) ?? 9999;
    const r = ramp(frame, open, 10);
    const size = tall ? 24 : 30;
    return (
        <>
            <Headline text="One missing check is all it takes." accent={ACCENT} mark={["missing"]} />
            <At x={x} y={y + (tall ? 70 : 0)} w={tall ? w : 1240}>
                <Editor file="routes.ts · the usual way" code={ROUTES} size={size} accent={ACCENT}>
                    <div
                        style={{
                            position: "absolute",
                            left: -10,
                            right: 10,
                            top: size * 1.65 - 4,
                            height: size * 1.65 + 8,
                            borderRadius: 6,
                            background: `rgba(251,80,102,${0.18 * r})`,
                            border: `1px solid rgba(251,80,102,${0.7 * r})`,
                        }}
                    />
                </Editor>
                <div style={{ marginTop: 18, fontFamily: FONT.mono, fontSize: tall ? 24 : 26, color: ACCENT, opacity: r }}>
                    GET /orders/:id → anyone's order, to anyone
                </div>
            </At>
        </>
    );
};

const Rule: React.FC = () => {
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    return (
        <>
            <Headline text="The rule lives with the table." accent={ACCENT} mark={["table."]} />
            <At x={x} y={y} w={tall ? w : 1180}>
                <Editor file="config/collections/orders.ts" code={RULE} size={tall ? 24 : 26} accent={ACCENT} step={2} />
            </At>
        </>
    );
};

const Policy: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(format2(useStage().format));
    const tall = format === "tall";
    const check = useCue({ line: "policy", word: "every", plus: -4 }) ?? 9999;
    return (
        <>
            <Headline text="Postgres checks it. Every request." mark={["Every"]} accent={CHROMA.yellow} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Window caption="generated by rebase db push" accent={INK.high}>
                    <Code code={POLICY} sql size={tall ? 23 : 28} delay={10} step={3} />
                </Window>
                <div style={{ marginTop: 22, display: "flex", gap: 14, alignItems: "center", opacity: ramp(frame, check, 12) }}>
                    <span style={{ width: 14, height: 14, borderRadius: 99, background: SAFE }} />
                    <span style={{ fontFamily: FONT.body, fontSize: tall ? 26 : 30, color: INK.high }}>
                        Enforced by the database, not by code you have to remember
                    </span>
                </div>
            </At>
        </>
    );
};

function format2(f: "wide" | "tall"): number {
    return f === "tall" ? 2 : 1;
}

/** Every caller, one door: three sources converge on rebase_user, then the
 *  policy, then the table. */
const Everyone: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(format2(useStage().format));
    const tall = format === "tall";
    const sources = [
        { name: "Your app", code: "client.data.orders.find()", at: 8 },
        { name: "Admin panel", code: "the same API", at: useCue({ line: "everyone", word: "admin", plus: 0 }) ?? 9999 },
        { name: "Agents", code: "an API key", at: useCue({ line: "everyone", word: "agents", plus: 0 }) ?? 9999 },
    ];
    const door = (useCue({ line: "everyone", word: "policies.", plus: -10 }) ?? 9999) - 6;
    const W = tall ? w : 1300;
    const colW = tall ? W : 400;
    const flow = ramp(frame, door, 24, ENTER);
    return (
        <>
            <Headline text="Every caller goes through the same door." accent={CHROMA.yellow} mark={["same"]} />
            <At x={x} y={y} w={W}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 12 : 24 }}>
                    {sources.map((s) => {
                        const o = ramp(frame, s.at, 12, ENTER);
                        return (
                            <div
                                key={s.name}
                                style={{
                                    width: colW,
                                    padding: tall ? "14px 20px" : "26px 30px",
                                    borderRadius: 13,
                                    background: SURFACE.sheet,
                                    border: `1px solid ${SURFACE.hairline}`,
                                    opacity: o,
                                    transform: o < 1 ? `translateY(${(1 - o) * 12}px)` : undefined,
                                }}
                            >
                                <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: tall ? 30 : 42, color: INK.high }}>{s.name}</div>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 20 : 24, color: INK.copy, marginTop: 6 }}>{s.code}</div>
                            </div>
                        );
                    })}
                </div>
                {/* the funnel */}
                <div style={{ height: tall ? 70 : 130, position: "relative" }}>
                    <svg width={W} height={tall ? 70 : 130} style={{ position: "absolute", left: 0, top: 0 }}>
                        {[0, 1, 2].map((i) => {
                            const x0 = tall ? W / 2 : colW / 2 + i * (colW + 24);
                            const x1 = W / 2;
                            const len = Math.hypot(x1 - x0, tall ? 70 : 130);
                            return (
                                <line
                                    key={i}
                                    x1={x0}
                                    y1={0}
                                    x2={x1}
                                    y2={tall ? 70 : 130}
                                    stroke={CHROMA.yellow}
                                    strokeWidth={2}
                                    strokeDasharray={len}
                                    strokeDashoffset={len * (1 - flow)}
                                />
                            );
                        })}
                    </svg>
                </div>
                <div style={{ display: "flex", justifyContent: "center", gap: 18, alignItems: "center", opacity: ramp(frame, door + 14, 12) }}>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 28 : 40, color: GROUND.base, background: CHROMA.yellow, padding: "10px 20px", borderRadius: 10 }}>
                        rebase_user
                    </span>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 26 : 36, color: INK.high }}>→ RLS policies → orders</span>
                </div>
            </At>
        </>
    );
};

const Lock: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(format2(useStage().format));
    const tall = format === "tall";
    const at = useCue({ line: "lock", word: "locks", plus: -6 }) ?? 9999;
    return (
        <>
            <Headline text="Can't protect a table? Nobody gets it." accent={ACCENT} mark={["Nobody"]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Window title="rebase · boot">
                    <Log
                        size={tall ? 22 : 27}
                        lines={[
                            { text: `🔐 [rls] Could not enable row-level security on "orders": …`, at, color: CHROMA.yellow },
                            { text: "Its privileges have been revoked from rebase_user,", at: at + 8, color: INK.high },
                            { text: "so the table is unreachable rather than unprotected.", at: at + 14, color: INK.high },
                        ]}
                    />
                </Window>
                <div
                    style={{
                        marginTop: 26,
                        fontFamily: FONT.display,
                        fontWeight: 600,
                        fontSize: tall ? 40 : 46,
                        color: SAFE,
                        opacity: ramp(frame, at + 24, 14),
                        transform: `scale(${interpolate(ramp(frame, at + 24, 14, ENTER), [0, 1], [0.96, 1])})`,
                        transformOrigin: "left center",
                    }}
                >
                    Fail closed. By default.
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const SECURITY: FilmSpec = checkFilm({
    id: "security",
    number: 2,
    title: "Security lives in the database",
    accent: ACCENT,
    script: SCRIPT,
    /* The problem is shown, not just said: the presenter leaves the middle
       as "Miss one check" begins, and the route without its check appears. */
    toCorner: { line: "hook", word: "Miss", plus: -4 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "middleware", at: { line: "hook", word: "Miss", plus: 2 }, render: Middleware, roll: 0.72 },
        { id: "rule", at: { line: "rule", plus: 2 }, render: Rule, roll: 0.3 },
        { id: "policy", at: { line: "policy", plus: 2 }, render: Policy, roll: 0.22, ground: GROUND.claim, reveal: 0.65 },
        { id: "everyone", at: { line: "everyone", plus: 2 }, render: Everyone, roll: 0.58, ground: GROUND.claim, reveal: 0.65 },
        { id: "lock", at: { line: "lock", plus: 2 }, render: Lock, roll: 0.16 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.46 },
    ],
});
