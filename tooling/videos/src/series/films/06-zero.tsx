import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, SURFACE } from "../../theme";
import { At, checkFilm, Editor, Headline, lines, useBody, useCue, useStage, type FilmSpec } from "../kit";

/**
 * 06 — ZERO TO RUNNING.
 *
 * Its device: one take. The whole film is a single terminal that never cuts
 * away — each scene is the same window, scrolled on, with the earlier lines
 * still above — and a counter of the commands typed so far. It stops at two.
 *
 * Every line is the CLI's own: init's prompts as inquirer prints them once
 * answered (commands/init.ts, agent-setup.ts) and its closing lines; the dev
 * server's banner and database line (commands/dev.ts); the boot line
 * "Applied N additive schema change(s) before boot."; the env file's own
 * comment (templates/template/.env.example). Ports are derived from the
 * project path, so the two here are two such values. No speed is claimed.
 */

const ACCENT = CHROMA.cyan;
const GREEN = "#34D399";

const SCRIPT = lines([
    ["hook", "Here's everything it takes to start a Rebase backend."],
    ["init", "One command creates the project. You pick a template, and it writes the collections for you."],
    ["agent", "It can set up the MCP server and the Rebase skills for your coding agent, too."],
    ["dev", "Then run dev. With no database configured, Rebase runs a development Postgres inside your project."],
    ["up", "There's no Docker, no cloud account and nothing else to install. The API and the admin panel are up."],
    ["own", "When you're ready for your own Postgres, you set one line in the env file."],
    ["close", "Rebase is open source. Two commands, and you're building."],
]);

/* ── the one take ───────────────────────────────────────────────────── */

type Part = "init" | "agent" | "dev" | "up";
const PARTS: Part[] = ["init", "agent", "dev", "up"];

interface Row {
    part: Part;
    /** A command: typed, and counted. */
    cmd?: string;
    text?: string;
    color?: string;
    /** Frames after its scene starts, or a word of its line to wait for. */
    at: number | string;
}

const ROWS: Row[] = [
    { part: "init", cmd: "pnpm dlx @rebasepro/cli init", at: 6 },
    { part: "init", text: "Rebase — Create a new project 🚀", color: INK.high, at: 30 },
    { part: "init", text: "✔ Project name: my-app", at: 38 },
    { part: "init", text: "✔ What do you want to build? Backend + admin", at: 46 },
    { part: "init", text: "✔ Choose a starter template: Blog", at: "template," },
    { part: "init", text: "✔ PostgreSQL connection string (blank = a managed database for this project, no setup):", at: "writes" },
    { part: "agent", text: "✔ Set up Rebase skills and the Rebase MCP server for your AI coding agent(s)? Yes", at: "MCP" },
    { part: "agent", text: "  Copying project files...", at: "agent," },
    { part: "agent", text: "✓ Project my-app created successfully!", color: GREEN, at: "too." },
    { part: "dev", cmd: "cd my-app && pnpm run dev", at: 6 },
    { part: "dev", text: "  🚀 Rebase Dev Server", color: INK.high, at: "configured," },
    { part: "dev", text: "  Starting the development database…", at: "runs" },
    { part: "dev", text: "  ↳ Database = the managed development database (PGlite)", color: ACCENT, at: "development" },
    { part: "dev", text: "  Applied 4 additive schema change(s) before boot.", at: "inside" },
    { part: "up", text: "✦ Rebase is ready!", color: GREEN, at: "API" },
    { part: "up", text: "➜ Admin: http://localhost:5236", color: INK.high, at: "admin" },
    { part: "up", text: "➜ API:   http://localhost:3417", color: INK.high, at: "admin" },
    { part: "up", text: "First login: the first account to register becomes admin", at: "up." },
];

/** The terminal as it stands in `part`: every earlier part already printed,
 *  this part's rows arriving on their cues, the newest at the bottom. */
const OneTake: React.FC<{ part: Part }> = ({ part }) => {
    const frame = useCurrentFrame();
    const { x, y, w, h, format } = useStage();
    const tall = format === "tall";
    const size = tall ? 23 : 25;
    const upTo = PARTS.indexOf(part);
    const rows = ROWS.filter((r) => PARTS.indexOf(r.part) <= upTo);
    /* each row's frame, scene-local: earlier parts are already there */
    const ats = rows.map((r) => {
        const cue = useCue(typeof r.at === "string" ? { line: r.part, word: r.at, plus: -2 } : { line: r.part, plus: 0 });
        if (r.part !== part) return -1;
        return typeof r.at === "number" ? r.at : (cue ?? 9999);
    });
    const shown = rows.filter((_, i) => frame >= ats[i]);
    const commands = shown.filter((r) => r.cmd).length;
    const lastCmd = rows.findIndex((r) => r.cmd && r.part === part);
    /* a band above the window stays clear for what lands over the take */
    const top = y + 72;
    const height = h - 72 - (tall ? 20 : 30);
    return (
        <>
            <div
                style={{
                    position: "absolute",
                    left: x,
                    top,
                    width: tall ? w : 1300,
                    height,
                    borderRadius: 14,
                    border: `1px solid ${SURFACE.hairlineStrong}`,
                    background: SURFACE.well,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 20px", borderBottom: `1px solid ${SURFACE.hairline}`, background: SURFACE.sheet }}>
                    {["#F43F5E", "#FBBF24", "#34D399"].map((c) => (
                        <span key={c} style={{ width: 11, height: 11, borderRadius: 99, background: c, opacity: 0.55 }} />
                    ))}
                    <span style={{ marginLeft: 8, fontFamily: FONT.mono, fontSize: 16, color: INK.muted }}>~/code — zsh</span>
                    <span style={{ marginLeft: "auto", fontFamily: FONT.mono, fontSize: tall ? 18 : 18, letterSpacing: "0.14em", color: INK.muted }}>
                        COMMANDS <span style={{ color: ACCENT, fontSize: tall ? 30 : 30, letterSpacing: 0, marginLeft: 8 }}>{commands}</span>
                    </span>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: tall ? "18px 22px" : "22px 30px", fontFamily: FONT.mono, fontSize: size, lineHeight: 1.6 }}>
                    {rows.map((r, i) => {
                        if (frame < ats[i]) return null;
                        const o = ats[i] < 0 ? 1 : ramp(frame, ats[i], 6);
                        if (r.cmd) {
                            const typed = i === lastCmd ? Math.round(ramp(frame, ats[i], r.cmd.length * 0.55, (t) => t) * r.cmd.length) : r.cmd.length;
                            return (
                                <div key={i} style={{ color: INK.high, marginTop: i ? size * 0.6 : 0 }}>
                                    <span style={{ color: ACCENT, marginRight: size * 0.5 }}>$</span>
                                    {r.cmd.slice(0, typed)}
                                    {i === lastCmd && typed < r.cmd.length && <span style={{ color: ACCENT }}>▌</span>}
                                </div>
                            );
                        }
                        const isReady = r.text?.startsWith("✦");
                        return (
                            <div key={i} style={{ color: r.color ?? INK.copy, opacity: o, whiteSpace: "pre-wrap", marginTop: isReady ? size * 0.6 : 0, fontWeight: isReady ? 600 : 400 }}>
                                {r.text}
                            </div>
                        );
                    })}
                </div>
            </div>
        </>
    );
};

const Init: React.FC = () => <OneTake part="init" />;
const Agent: React.FC = () => <OneTake part="agent" />;
const Dev: React.FC = () => <OneTake part="dev" />;

/** The take, and over it the three things that are not needed. */
const Up: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useStage();
    const tall = format === "tall";
    const nots = ["Docker", "cloud", "nothing"].map((wd) => useCue({ line: "up", word: wd, plus: -2 }) ?? 9999);
    const labels = ["no Docker", "no cloud account", "nothing else to install"];
    return (
        <>
            <OneTake part="up" />
            <div style={{ position: "absolute", left: x + (tall ? 0 : 0), top: y + 6, width: tall ? w : 1300, display: "flex", justifyContent: "flex-start", gap: 12, padding: 0, boxSizing: "border-box", flexWrap: "wrap" }}>
                {labels.map((l, i) => {
                    const o = ramp(frame, nots[i], 10, ENTER);
                    return (
                        <span key={l} style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 26 : 28, padding: "8px 18px", borderRadius: 99, background: ACCENT, color: GROUND.base, opacity: o, transform: `scale(${0.9 + 0.1 * o})` }}>
                            {l}
                        </span>
                    );
                })}
            </div>
        </>
    );
};

const ENV = `# DATABASE_URL: unset means the managed database; set means yours.
DATABASE_URL=postgresql://app:…@db.example.com:5432/app`;

const Own: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    const set = useCue({ line: "own", word: "line", plus: -4 }) ?? 9999;
    return (
        <>
            <Headline text="Your own Postgres is one line." accent={ACCENT} mark={["one", "line."]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Editor file=".env" code={tall ? ENV.replace("; set", ";\n# set") : ENV} size={tall ? 22 : 26} accent={ACCENT} at={6} step={0} />
                <div style={{ marginTop: 22, fontFamily: FONT.body, fontSize: tall ? 26 : 30, color: INK.copy, opacity: ramp(frame, set, 12) }}>
                    Local, Neon, Supabase, RDS, Cloud SQL — any Postgres.
                </div>
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const ZERO: FilmSpec = checkFilm({
    id: "zero",
    number: 6,
    title: "Zero to running",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 2 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "init", at: { line: "init", plus: 0 }, render: Init, roll: 0.3 },
        { id: "agent", at: { line: "agent", plus: 0 }, render: Agent, roll: 0.34 },
        { id: "dev", at: { line: "dev", plus: 0 }, render: Dev, roll: 0.38 },
        { id: "up", at: { line: "up", plus: 0 }, render: Up, roll: 0.42 },
        { id: "own", at: { line: "own", plus: 2 }, render: Own, roll: 0.7, ground: GROUND.deep, reveal: 0.55 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.5 },
    ],
});
