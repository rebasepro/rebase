import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, SURFACE } from "../../theme";
import { At, checkFilm, Headline, lines, Log, Prompt, useBody, useCue, useStage, Window, type FilmSpec } from "../kit";

/**
 * 04 — YOU HOLD THE KEYS.
 *
 * Who owns a backend is a list of plain questions: whose licence, whose
 * database, whose servers, whose backups, whose server code. Each scene
 * answers one, and a ring of five keys along the foot of the frame fills in
 * as it does — the device that runs through the whole film.
 *
 * All real: the MIT licence; the Postgres hosts the docs list; the deploy
 * guides that exist (docs/deploy); `rebase db backup` and its own lines
 * (server-postgres backup-cli.ts; the file name is buildBackupFilename's);
 * `rebase eject` and the five lines it prints (cli/src/commands/eject.ts).
 */

const ACCENT = CHROMA.yellow;
const GREEN = "#34D399";

const SCRIPT = lines([
    ["hook", "Before you pick a backend, ask who holds the keys."],
    ["licence", "Rebase is MIT licensed. The code is yours to read, change and run."],
    ["data", "Your data lives in plain Postgres tables, in a database you choose: your own server, Neon, Supabase, RDS or Cloud SQL."],
    ["run", "The server runs anywhere a container runs, with guides for AWS, Google Cloud, Azure, Fly, Railway and Hetzner."],
    ["backup", "Backups are standard Postgres dumps: one command takes them, and another restores them."],
    ["eject", "And rebase eject writes the entry point, the Dockerfile and the compose file into your repo."],
    ["close", "No vendor sits between you and your data. Rebase is open source, and the backend is yours."],
]);

/* ── the keyring ────────────────────────────────────────────────────── */

const KEYS = ["code", "data", "servers", "backups", "server code"];

/** The five keys along the foot of the stage. `held` are already yours;
 *  the next one turns at `turn` (scene-local). Same place in every scene, so
 *  the dissolve between scenes leaves the ring standing still. */
const Keyring: React.FC<{ held: number; turn?: number }> = ({ held, turn = 9999 }) => {
    const frame = useCurrentFrame();
    const { x, y, h, format } = useStage();
    const tall = format === "tall";
    const size = tall ? 21 : 26;
    return (
        <div style={{ position: "absolute", left: x, top: y + h - (tall ? 54 : 40), display: "flex", gap: tall ? 10 : 14, flexWrap: "wrap", width: tall ? 936 : 1360 }}>
            {KEYS.map((k, i) => {
                const lit = i < held ? 1 : i === held ? ramp(frame, turn, 14, ENTER) : 0;
                return (
                    <div
                        key={k}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: tall ? "8px 14px" : "10px 18px",
                            borderRadius: 99,
                            border: `1.5px solid ${lit > 0.5 ? ACCENT : SURFACE.hairlineStrong}`,
                            background: `rgba(255,198,0,${0.12 * lit})`,
                            fontFamily: FONT.mono,
                            fontSize: size,
                            color: lit > 0.5 ? INK.high : INK.muted,
                        }}
                    >
                        <KeyGlyph size={size} lit={lit} />
                        {k}
                    </div>
                );
            })}
        </div>
    );
};

const KeyGlyph: React.FC<{ size: number; lit: number }> = ({ size, lit }) => (
    <svg width={size * 1.3} height={size * 0.8} viewBox="0 0 26 16" style={{ transform: `rotate(${(1 - lit) * -90}deg)` }}>
        <circle cx="6" cy="8" r="5" fill="none" stroke={lit > 0.5 ? ACCENT : INK.muted} strokeWidth="2" />
        <path d="M11 8 H25 M20 8 V13 M24 8 V12" stroke={lit > 0.5 ? ACCENT : INK.muted} strokeWidth="2" fill="none" />
    </svg>
);

function rows(f: "wide" | "tall"): number {
    return f === "tall" ? 2 : 1;
}

/* ── scenes ─────────────────────────────────────────────────────────── */

const Licence: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    const verbs = ["read", "change", "run"].map((v) => useCue({ line: "licence", word: v === "run" ? "run." : v, plus: -2 }) ?? 9999);
    return (
        <>
            <Headline text="The code is yours." accent={ACCENT} mark={["yours."]} />
            <At x={x} y={y} w={tall ? w : 1180}>
                <Window caption="LICENSE" accent={INK.muted}>
                    <div style={{ fontFamily: FONT.mono, fontSize: tall ? 25 : 28, lineHeight: 1.6, color: INK.copy }}>
                        <div style={{ color: INK.high, fontSize: tall ? 30 : 34, marginBottom: 10 }}>MIT License</div>
                        Permission is hereby granted, free of charge, to any person obtaining a copy of this software…
                    </div>
                </Window>
                <div style={{ display: "flex", gap: 18, marginTop: 28 }}>
                    {["read", "change", "run"].map((v, i) => {
                        const o = ramp(frame, verbs[i], 10, ENTER);
                        return (
                            <span key={v} style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: tall ? 44 : 52, color: GROUND.base, background: ACCENT, padding: "6px 22px", borderRadius: 12, opacity: o, transform: `translateY(${(1 - o) * 12}px)` }}>
                                {v}
                            </span>
                        );
                    })}
                </div>
            </At>
            <Keyring held={0} turn={verbs[2]} />
        </>
    );
};

const HOSTS = ["your own server", "Neon", "Supabase", "RDS", "Cloud SQL"];

/** One table, and the places it can live: the same rows, whichever host. */
const Data: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(rows(useStage().format));
    const tall = format === "tall";
    const first = useCue({ line: "data", word: "own", plus: -2 }) ?? 9999;
    const others = HOSTS.slice(1).map((h) => useCue({ line: "data", word: h.split(" ")[0], plus: -2 }) ?? 9999);
    const hostAt = [first, ...others];
    const size = tall ? 23 : 26;
    return (
        <>
            <Headline text="Plain tables, in a database you choose." accent={ACCENT} mark={["you", "choose."]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Window title="psql">
                    <Log
                        size={size}
                        lines={[
                            { text: "app=# \\dt", at: 6, color: INK.high },
                            { text: "  Schema |   Name    | Type  | Owner", at: 10 },
                            { text: " --------+-----------+-------+-------", at: 10 },
                            { text: "  public | customers | table | app", at: 14, color: INK.high },
                            { text: "  public | orders    | table | app", at: 16, color: INK.high },
                            { text: "  public | products  | table | app", at: 18, color: INK.high },
                        ]}
                    />
                </Window>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 26 }}>
                    {HOSTS.map((h, i) => {
                        const o = ramp(frame, hostAt[i], 10, ENTER);
                        return (
                            <span key={h} style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: tall ? 28 : 32, color: INK.high, padding: "10px 22px", borderRadius: 10, border: `2px solid ${ACCENT}`, opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>
                                {h}
                            </span>
                        );
                    })}
                </div>
            </At>
            <Keyring held={1} turn={hostAt[1]} />
        </>
    );
};

const CLOUDS = ["AWS", "Google Cloud", "Azure", "Fly", "Railway", "Hetzner"];

const Run: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(rows(useStage().format));
    const tall = format === "tall";
    const guides = useCue({ line: "run", word: "guides", plus: 0 }) ?? 9999;
    const t = 8 + 22 * 0.55 + 6;
    return (
        <>
            <Headline text="It runs anywhere a container runs." accent={ACCENT} mark={["anywhere"]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Window title="zsh">
                    <Prompt command="rebase build" at={6} size={tall ? 26 : 30} />
                    <Prompt command="docker compose up -d" at={t} size={tall ? 26 : 30} />
                </Window>
                <div style={{ display: "grid", gridTemplateColumns: tall ? "1fr 1fr" : "repeat(3, 1fr)", gap: 14, marginTop: 26 }}>
                    {CLOUDS.map((c, i) => {
                        const o = ramp(frame, guides + 6 + i * 6, 10, ENTER);
                        return (
                            <div key={c} style={{ padding: tall ? "14px 18px" : "16px 22px", borderRadius: 12, background: SURFACE.sheet, border: `1px solid ${SURFACE.hairline}`, opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>
                                <div style={{ fontFamily: FONT.mono, fontSize: tall ? 16 : 16, color: INK.muted, letterSpacing: "0.12em" }}>DEPLOY GUIDE</div>
                                <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: tall ? 32 : 36, color: INK.high }}>{c}</div>
                            </div>
                        );
                    })}
                </div>
            </At>
            <Keyring held={2} turn={8} />
        </>
    );
};

const Backup: React.FC = () => {
    const { x, y, w, format } = useBody(rows(useStage().format));
    const tall = format === "tall";
    const restore = useCue({ line: "backup", word: "another", plus: -6 }) ?? 9999;
    const size = tall ? 22 : 26;
    const p = tall ? 24 : 28;
    return (
        <>
            <Headline text="Backups are ordinary Postgres dumps." accent={ACCENT} mark={["ordinary"]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Window title="zsh">
                    <Prompt command="rebase db backup --out ./backups" at={6} size={p} rate={0.45} />
                    <Log size={size} lines={[{ text: "  ✓ Backup written to backups/rebase-app-20261025T090000Z.dump", at: 26, color: GREEN }]} />
                    <div style={{ height: 14 }} />
                    <Prompt command="rebase db restore backups/rebase-app-…dump" at={restore} size={p} rate={0.4} />
                    <Log size={size} lines={[{ text: `  ✓ Restore completed into "app".`, at: restore + 24, color: GREEN }]} />
                </Window>
            </At>
            <Keyring held={3} turn={28} />
        </>
    );
};

const Eject: React.FC = () => {
    const { x, y, w, format } = useBody(rows(useStage().format));
    const tall = format === "tall";
    const size = tall ? 21 : 25;
    const t = 26;
    const pad = (s: string) => s.padEnd(tall ? 0 : 26);
    const rowsOut = [
        ["backend/src/index.ts", "your entrypoint"],
        ["backend/src/env.ts", "the environment it reads"],
        ["Dockerfile", "your image"],
        ["docker-compose.custom.yml", "runs it"],
        ["rebase.json", "runtime: custom"],
    ];
    return (
        <>
            <Headline text="The server code can be yours too." accent={ACCENT} mark={["yours"]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Window title="zsh">
                    <Prompt command="rebase eject" at={6} size={tall ? 26 : 30} />
                    <Log
                        size={size}
                        lines={[
                            { text: `✓ Ejected "backend" to a custom runtime.`, at: t, color: GREEN },
                            { text: "", at: t },
                            ...rowsOut.map(([f, d], i) => ({ text: tall ? `  ${f}\n      ${d}` : `  ${pad(f)} ${d}`, at: t + 6 + i * 5, color: INK.high })),
                        ]}
                    />
                </Window>
            </At>
            <Keyring held={4} turn={t + 30} />
        </>
    );
};

const Close: React.FC = () => null;

export const OWN: FilmSpec = checkFilm({
    id: "own",
    number: 4,
    title: "You hold the keys",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 4 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "licence", at: { line: "licence", plus: 2 }, render: Licence, roll: 0.3 },
        { id: "data", at: { line: "data", plus: 2 }, render: Data, roll: 0.62 },
        { id: "run", at: { line: "run", plus: 2 }, render: Run, roll: 0.18, ground: GROUND.deep, reveal: 0.6 },
        { id: "backup", at: { line: "backup", plus: 2 }, render: Backup, roll: 0.44 },
        { id: "eject", at: { line: "eject", plus: 2 }, render: Eject, roll: 0.74 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.5 },
    ],
});
