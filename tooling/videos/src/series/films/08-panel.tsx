import React from "react";
import { OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, SURFACE } from "../../theme";
import { At, checkFilm, Editor, Headline, lines, Log, Prompt, useBody, useBodyFor, useCue, useStage, Window, type FilmSpec } from "../kit";

/**
 * 08 — THE PANEL IS OPTIONAL.
 *
 * Its device: a switch. "Admin panel" sits OFF over the first half and ON over
 * the second, and under it the stack — your app, the API, Postgres — never
 * changes shape; the panel only joins it as one more caller of the same API.
 *
 * Real: `rebase init --headless` and the choice it stands for ("Backend only —
 * headless API over your database. No collections, no UI"; commands/init.ts);
 * the headless rebase.json; the panel's React tree (<Rebase>, <RebaseAuth>,
 * <RebaseCMS>, <RebaseShell>); its data source is client.data over the same
 * /api/data routes as the app (it also has admin routes, so "only the public
 * API" is not claimed). The views are captures of the demo (render-demo.mjs).
 */

const ACCENT = CHROMA.cyan;
const GREEN = "#34D399";

const SCRIPT = lines([
    ["hook", "Some projects need an admin panel. Plenty of them never will."],
    ["headless", "So Rebase can start without one. With one flag, you get an API over your database and no UI at all."],
    ["add", "When you do want a panel, it's a React app that sits on top of the same backend."],
    ["same", "Its data goes through the same API as your app, under the same policies."],
    ["views", "It gives you tables, cards, kanban boards, and views you write yourself in React."],
    ["close", "Rebase is open source. Add the panel, or skip it. Your API doesn't change either way."],
]);

/* ── the switch ─────────────────────────────────────────────────────── */

/** "Admin panel" with its switch, top right of the stage; it flips at `flip`
 *  (scene-local) from `from`. */
const Switch: React.FC<{ from: boolean; flip?: number }> = ({ from, flip = 9999 }) => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useStage();
    const tall = format === "tall";
    const t = ramp(frame, flip, 12, ENTER);
    const on = from ? 1 - t : t;
    const s = tall ? 1 : 1.1;
    return (
        <div style={{ position: "absolute", left: tall ? x + w - 330 : x + 1380 - 340, top: y - (tall ? 64 : 82), display: "flex", alignItems: "center", gap: 16, transform: `scale(${s})`, transformOrigin: "right center" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: 18, letterSpacing: "0.14em", color: INK.muted }}>ADMIN PANEL</span>
            <div style={{ width: 84, height: 44, borderRadius: 99, background: on > 0.5 ? ACCENT : SURFACE.raised, border: `1px solid ${SURFACE.hairlineStrong}`, position: "relative" }}>
                <div style={{ position: "absolute", top: 4, left: 4 + on * 40, width: 34, height: 34, borderRadius: 99, background: INK.high }} />
            </div>
            <span style={{ fontFamily: FONT.mono, fontSize: 20, color: on > 0.5 ? ACCENT : INK.muted, width: 40 }}>{on > 0.5 ? "ON" : "OFF"}</span>
        </div>
    );
};

/* ── the stack ──────────────────────────────────────────────────────── */

const Block: React.FC<{ title: string; sub: string; tone?: string; o?: number; dashed?: boolean; tall: boolean }> = ({ title, sub, tone, o = 1, dashed, tall }) => (
    <div
        style={{
            flex: 1,
            padding: tall ? "16px 20px" : "20px 24px",
            borderRadius: 13,
            background: dashed ? "transparent" : SURFACE.sheet,
            border: `${tone ? 2 : 1}px ${dashed ? "dashed" : "solid"} ${tone ?? SURFACE.hairline}`,
            opacity: o,
        }}
    >
        <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: tall ? 30 : 34, color: INK.high }}>{title}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: tall ? 19 : 21, color: INK.copy, marginTop: 4 }}>{sub}</div>
    </div>
);

/** Callers on top, then the API, then Postgres. `panel` is how present the
 *  panel is (0 = an empty slot). */
const Stack: React.FC<{ panel: number; policies?: number }> = ({ panel, policies = 0 }) => {
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    const arrow = <div style={{ textAlign: "center", fontFamily: FONT.mono, fontSize: 32, color: INK.muted, margin: "6px 0" }}>↓</div>;
    return (
        <At x={x} y={y} w={tall ? w : 1300}>
            <div style={{ display: "flex", gap: 18 }}>
                <Block title="Your app" sub="client.data.orders" tall={tall} />
                {panel > 0.02 ? <Block title="Admin panel" sub="client.data.orders" tone={ACCENT} o={panel} tall={tall} /> : <Block title="—" sub="no panel" dashed tall={tall} o={0.5} />}
            </div>
            {arrow}
            <Block title="The API" sub="/api/data/orders · the same routes" tall={tall} />
            <div style={{ height: 0, overflow: "visible", position: "relative" }}>
                <div style={{ position: "absolute", right: 20, top: 10, opacity: policies, fontFamily: FONT.mono, fontSize: tall ? 18 : 20, color: GROUND.base, background: CHROMA.yellow, padding: "6px 14px", borderRadius: 8 }}>
                    rebase_user · your policies
                </div>
            </div>
            {arrow}
            <Block title="Postgres" sub="your tables" tall={tall} />
        </At>
    );
};

/* ── scenes ─────────────────────────────────────────────────────────── */

const REBASE_JSON = `{
  "rebase": "^1",
  "apps": {
    "backend": { "type": "backend", "runtime": "managed" }
  }
}`;

const Headless: React.FC = () => {
    const { x, y, w, format } = useBodyFor("Backend only, if that's all you need.");
    const tall = format === "tall";
    const flag = useCue({ line: "headless", word: "flag,", plus: -6 }) ?? 9999;
    return (
        <>
            <Headline text="Backend only, if that's all you need." accent={ACCENT} mark={["only,"]} />
            <Switch from={false} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Window title="zsh">
                    <Prompt command="rebase init my-app --headless" at={flag} size={tall ? 26 : 30} />
                    <Log
                        size={tall ? 21 : 24}
                        lines={[{ text: "Backend only — headless API over your database. No collections, no UI", at: flag + 24, color: ACCENT }]}
                    />
                </Window>
                <div style={{ height: 22 }} />
                <Editor file="rebase.json" code={REBASE_JSON} size={tall ? 22 : 24} accent={ACCENT} at={flag + 34} step={2} />
            </At>
        </>
    );
};

const TREE = `<Rebase client={rebaseClient} authController={authController}>
    <RebaseAuth />
    <RebaseCMS collections={collections} />
    <RebaseShell title="Rebase" />
</Rebase>`;

const Add: React.FC = () => {
    const { x, y, w, format } = useBodyFor("The panel is a React app on top.");
    const tall = format === "tall";
    const react = useCue({ line: "add", word: "React", plus: -6 }) ?? 9999;
    return (
        <>
            <Headline text="The panel is a React app on top." accent={ACCENT} mark={["React"]} />
            <Switch from={false} flip={useCue({ line: "add", word: "panel,", plus: -4 }) ?? 9999} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Editor file="frontend/src/App.tsx" code={tall ? TREE.replace(" authController", "\n        authController") : TREE} size={tall ? 22 : 27} accent={ACCENT} at={react} step={3} />
            </At>
        </>
    );
};

const Same: React.FC = () => {
    const frame = useCurrentFrame();
    const panel = ramp(frame, 6, 14, ENTER);
    const pol = useCue({ line: "same", word: "policies.", plus: -6 }) ?? 9999;
    return (
        <>
            <Headline text="One API. Two callers." accent={ACCENT} mark={["One"]} />
            <Switch from={true} />
            <Stack panel={panel} policies={ramp(frame, pol, 12, ENTER)} />
        </>
    );
};

/** Four tiles: three views captured from the demo, and one written in React. */
const CLIPS = [
    { file: "demo/bento/b_exercises.mp4", label: "TABLE", word: "tables," },
    { file: "demo/bento/b_cards.mp4", label: "CARDS", word: "cards," },
    { file: "demo/bento/b_tickets.mp4", label: "KANBAN", word: "kanban" },
];

const CUSTOM = `admin: {
  customViews: [{
    key: "map",
    name: "Map",
    Builder: OrdersMap,
  }],
}`;

const Views: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor("Tables, cards, boards, and yours.");
    const tall = format === "tall";
    const ats = CLIPS.map((c) => useCue({ line: "views", word: c.word, plus: -6 }) ?? 9999);
    const yours = useCue({ line: "views", word: "write", plus: -6 }) ?? 9999;
    const W = tall ? w : 1300;
    const gap = 16;
    const tw = (W - gap) / 2;
    const th = tall ? 262 : 300;
    const tile = (i: number, child: React.ReactNode, label: string, at: number) => {
        const o = ramp(frame, at, 12, ENTER);
        return (
            <div key={label} style={{ position: "absolute", left: (i % 2) * (tw + gap), top: Math.floor(i / 2) * (th + gap), width: tw, height: th, borderRadius: 13, overflow: "hidden", border: `1px solid ${SURFACE.hairline}`, background: SURFACE.sheet, opacity: o, transform: `scale(${0.96 + 0.04 * o})` }}>
                {child}
                <div style={{ position: "absolute", left: 12, top: 12, fontFamily: FONT.mono, fontSize: 16, letterSpacing: "0.14em", color: GROUND.base, background: ACCENT, padding: "4px 10px", borderRadius: 6 }}>{label}</div>
            </div>
        );
    };
    return (
        <>
            <Headline text="Tables, cards, boards, and yours." accent={ACCENT} mark={["yours."]} />
            <Switch from={true} />
            <At x={x} y={y} w={W}>
                <div style={{ position: "relative", width: W, height: th * 2 + gap }}>
                    {CLIPS.map((c, i) =>
                        tile(
                            i,
                            <Sequence from={Math.min(ats[i], 9000)} layout="none">
                                <OffthreadVideo src={staticFile(c.file)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            </Sequence>,
                            c.label,
                            ats[i],
                        ),
                    )}
                    {tile(3, <div style={{ padding: "52px 22px 0" }}><Editor file="orders.ts" code={CUSTOM} size={tall ? 15 : 17} accent={ACCENT} at={yours + 6} step={1} /></div>, "YOUR REACT VIEW", yours)}
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const PANEL: FilmSpec = checkFilm({
    id: "panel",
    number: 8,
    title: "The panel is optional",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 4 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "headless", at: { line: "headless", plus: 2 }, render: Headless, roll: 0.26 },
        { id: "add", at: { line: "add", plus: 2 }, render: Add, roll: 0.5 },
        { id: "same", at: { line: "same", plus: 2 }, render: Same, roll: 0.2, ground: GROUND.claim, reveal: 0.6 },
        { id: "views", at: { line: "views", plus: 2 }, render: Views, roll: 0.66 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.4 },
    ],
});
