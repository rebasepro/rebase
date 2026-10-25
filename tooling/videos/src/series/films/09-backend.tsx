import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK, SURFACE } from "../../theme";
import { checkFilm, Editor, Headline, lines, Log, useBodyFor, useCue, useStage, type FilmSpec } from "../kit";

/**
 * 09 — THE REST OF THE BACKEND.
 *
 * Its device: the project's file tree. It stands at the left of every scene
 * and grows by one file each time — a function, a cron job, a queue, a
 * storage field — and the file just added opens beside it, with the line the
 * server prints about it. (Tall: the tree is a row of chips above the file.)
 *
 * Real: functions are files under backend/functions, mounted at
 * /api/functions/<name> (the template's hello.ts); a cron file default-exports
 * defineCron from @rebasepro/server (cron-loader.ts) and the scheduler logs
 * "⏰ Loaded cron job: …"; queues are declared in config/resources.ts with
 * queue<T>() from @rebasepro/types, their jobs are Postgres rows with retries,
 * and the worker logs "failed on attempt 1/3; retrying"; storage is a
 * property's `storage` block, on local disk, S3 or GCS. Not claimed: Redis
 * (there is none to claim), "serverless".
 */

const ACCENT = CHROMA.yellow;
const GREEN = "#34D399";

const SCRIPT = lines([
    ["hook", "Tables are the easy part of a backend. Then come the endpoints, the scheduled jobs, the queues and the files."],
    ["function", "In Rebase, a function is a file. You drop it in the functions folder, and it becomes an endpoint."],
    ["cron", "A cron job is a file too, with its schedule written right in it."],
    ["queue", "Queues and background jobs run on Postgres, with retries, so there's no Redis to run."],
    ["storage", "File storage is a field on your collection, with local disk, S3 or Google Cloud Storage behind it."],
    ["close", "Rebase is open source. The whole backend lives in one repo, and runs in one process until you choose to split it."],
]);

/* ── the tree ───────────────────────────────────────────────────────── */

/** Every scene lays out under the longest headline, so the tree stands still
 *  between scenes whatever each headline's length. */
const TALLEST = "A cron job is a file, schedule included.";

type Step = "function" | "cron" | "queue" | "storage";
const STEPS: Step[] = ["function", "cron", "queue", "storage"];

/** Every row of the tree, and the step that adds it (none: there from the start). */
const TREE: { depth: number; name: string; step?: Step; dir?: boolean }[] = [
    { depth: 0, name: "backend/", dir: true },
    { depth: 1, name: "functions/", dir: true },
    { depth: 2, name: "hello.ts", step: "function" },
    { depth: 1, name: "crons/", dir: true },
    { depth: 2, name: "refresh-product-stats.ts", step: "cron" },
    { depth: 0, name: "config/", dir: true },
    { depth: 1, name: "collections/", dir: true },
    { depth: 2, name: "posts.ts", step: "storage" },
    { depth: 1, name: "resources.ts", step: "queue" },
];

const SHORT: Record<Step, string> = {
    function: "functions/hello.ts",
    cron: "crons/refresh-product-stats.ts",
    queue: "resources.ts",
    storage: "collections/posts.ts",
};

/** The tree as it stands in `step`: earlier files there, this one arriving. */
const Tree: React.FC<{ step: Step }> = ({ step }) => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor(TALLEST);
    const tall = format === "tall";
    const k = STEPS.indexOf(step);
    const arrive = ramp(frame, 4, 14, ENTER);
    if (tall) {
        return (
            <div style={{ position: "absolute", left: x, top: y, width: w, display: "flex", flexWrap: "wrap", gap: 10 }}>
                {STEPS.map((s, i) => {
                    if (i > k) return null;
                    const now = i === k;
                    const o = now ? arrive : 1;
                    return (
                        <span key={s} style={{ fontFamily: FONT.mono, fontSize: 18, padding: "7px 12px", borderRadius: 8, border: `1.5px solid ${now ? ACCENT : SURFACE.hairlineStrong}`, color: now ? INK.high : INK.muted, opacity: o }}>
                            {SHORT[s]}
                        </span>
                    );
                })}
            </div>
        );
    }
    return (
        <div style={{ position: "absolute", left: x, top: y, width: 380, padding: "18px 0", borderRadius: 14, background: SURFACE.sheet, border: `1px solid ${SURFACE.hairline}` }}>
            {TREE.map((r, i) => {
                const at = r.step ? STEPS.indexOf(r.step) : -1;
                if (at > k) return null;
                const now = at === k;
                const o = now ? arrive : 1;
                return (
                    <div
                        key={i}
                        style={{
                            fontFamily: FONT.mono,
                            fontSize: 21,
                            lineHeight: 1.85,
                            paddingLeft: 22 + r.depth * 22,
                            color: r.dir ? INK.muted : now ? INK.high : INK.copy,
                            background: now ? `rgba(255,198,0,${0.14 * o})` : undefined,
                            borderLeft: `3px solid ${now ? ACCENT : "transparent"}`,
                            opacity: o,
                            height: now ? `${o * 1.85}em` : undefined,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {r.name}
                    </div>
                );
            })}
        </div>
    );
};

/** The file beside the tree (wide) or under the chips (tall). */
const Beside: React.FC<{ children: React.ReactNode; headline: string }> = ({ children }) => {
    const { x, y, w, format } = useBodyFor(TALLEST);
    const tall = format === "tall";
    return <div style={{ position: "absolute", left: tall ? x : x + 410, top: tall ? y + 120 : y, width: tall ? w : 970 }}>{children}</div>;
};

/* ── scenes ─────────────────────────────────────────────────────────── */

const FUNCTION = `export default defineFunction((app) => {
    app.post("/", requireAuth, async (c) => {
        return c.json({ user: getUserId(c) });
    });
});`;

const CRON = `export default defineCron({
    name: "Refresh product stats",
    schedule: "*/30 * * * *",
    async handler({ rebase, log }) {
        const { meta } = await rebase.dataAsAdmin
            .collection("products").find({ limit: 1 });
        log(\`products total: \${meta.total}\`);
    },
});`;

const QUEUE = `export const thumbnails = queue<{ key: string }>("thumbnails");

thumbnails.handler(async ({ key }) => {
    /* resize the image at key */
});

await thumbnails.enqueue({ key });`;

const STORAGE = `cover: {
    type: "string",
    storage: {
        storagePath: "posts/hero/",
        acceptedFiles: ["image/*"],
        maxSize: 5_000_000,
    },
},`;

const Under: React.FC<{ at: number; lines: { text: string; color?: string }[]; size: number }> = ({ at, lines: rows, size }) => (
    <div style={{ marginTop: 18, padding: "14px 20px", borderRadius: 12, background: SURFACE.well, border: `1px solid ${SURFACE.hairline}` }}>
        <Log size={size} lines={rows.map((r, i) => ({ ...r, at: at + i * 8 }))} />
    </div>
);

function useSizes(): { code: number; log: number } {
    const tall = useStage().format === "tall";
    return { code: tall ? 21 : 23, log: tall ? 19 : 21 };
}

const H_FN = "A function is a file.";
const Fn: React.FC = () => {
    const s = useSizes();
    const ep = useCue({ line: "function", word: "endpoint.", plus: -8 }) ?? 9999;
    return (
        <>
            <Headline text={H_FN} accent={ACCENT} mark={["file."]} />
            <Tree step="function" />
            <Beside headline={H_FN}>
                <Editor file="backend/functions/hello.ts" code={FUNCTION} size={s.code + 3} accent={ACCENT} at={10} step={2} />
                <Under at={ep} size={s.log + 4} lines={[{ text: "POST /api/functions/hello", color: GREEN }]} />
            </Beside>
        </>
    );
};

const H_CRON = "A cron job is a file, schedule included.";
const Cron: React.FC = () => {
    const s = useSizes();
    return (
        <>
            <Headline text={H_CRON} accent={ACCENT} mark={["schedule"]} />
            <Tree step="cron" />
            <Beside headline={H_CRON}>
                <Editor file="backend/crons/refresh-product-stats.ts" code={CRON} size={useStage().format === "tall" ? 17 : s.code - 1} accent={ACCENT} at={8} step={1.5} />
                <Under at={44} size={useStage().format === "tall" ? 17 : s.log} lines={[{ text: "⏰ Loaded cron job: refresh-product-stats (*/30 * * * * in the process's local time)", color: INK.high }]} />
            </Beside>
        </>
    );
};

const H_QUEUE = "Queues run on Postgres.";
const Queue: React.FC = () => {
    const s = useSizes();
    const retry = useCue({ line: "queue", word: "retries,", plus: -6 }) ?? 9999;
    const redis = useCue({ line: "queue", word: "Redis", plus: -4 }) ?? 9999;
    const frame = useCurrentFrame();
    return (
        <>
            <Headline text={H_QUEUE} accent={ACCENT} mark={["Postgres."]} />
            <Tree step="queue" />
            <Beside headline={H_QUEUE}>
                <Editor file="config/resources.ts" code={QUEUE} size={s.code - 1} accent={ACCENT} at={8} step={2} />
                <Under at={retry} size={s.log} lines={[{ text: `[jobs] "thumbnails" failed on attempt 1/3; retrying`, color: CHROMA.yellow }]} />
                <div style={{ marginTop: 18, display: "inline-block", fontFamily: FONT.body, fontWeight: 600, fontSize: 30, color: GROUND.base, background: GREEN, padding: "8px 20px", borderRadius: 10, opacity: ramp(frame, redis, 12, ENTER) }}>
                    No Redis to run
                </div>
            </Beside>
        </>
    );
};

const H_STORAGE = "Storage is a field.";
const Storage: React.FC = () => {
    const s = useSizes();
    const frame = useCurrentFrame();
    const engines = ["local disk", "S3", "Google Cloud Storage"].map((e) => useCue({ line: "storage", word: e.split(" ")[0], plus: -2 }) ?? 9999);
    return (
        <>
            <Headline text={H_STORAGE} accent={ACCENT} mark={["field."]} />
            <Tree step="storage" />
            <Beside headline={H_STORAGE}>
                <Editor file="config/collections/posts.ts · excerpt" code={STORAGE} size={s.code} accent={ACCENT} at={8} step={2} />
                <div style={{ display: "flex", gap: 12, marginTop: 20, flexWrap: "wrap" }}>
                    {["local disk", "S3", "Google Cloud Storage"].map((e, i) => {
                        const o = ramp(frame, engines[i], 10, ENTER);
                        return (
                            <span key={e} style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 26, color: INK.high, padding: "8px 18px", borderRadius: 10, border: `2px solid ${ACCENT}`, opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>
                                {e}
                            </span>
                        );
                    })}
                </div>
            </Beside>
        </>
    );
};

/** What comes after the tables: four empty slots, filled one by one later. */
const Todo: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBodyFor("Then comes everything else.");
    const tall = format === "tall";
    const items = [
        ["endpoints", "endpoints,"],
        ["scheduled jobs", "scheduled"],
        ["queues", "queues"],
        ["files", "files."],
    ];
    const ats = items.map(([, wd]) => useCue({ line: "hook", word: wd, plus: -2 }) ?? 9999);
    return (
        <>
            <Headline text="Then comes everything else." accent={ACCENT} mark={["everything"]} />
            <div style={{ position: "absolute", left: x, top: y, width: tall ? w : 1300, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {items.map(([label], i) => {
                    const o = ramp(frame, ats[i], 12, ENTER);
                    return (
                        <div key={label} style={{ height: tall ? 150 : 170, borderRadius: 14, border: `2px dashed ${o > 0.5 ? ACCENT : SURFACE.hairlineStrong}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT.display, fontWeight: 600, fontSize: tall ? 36 : 44, color: INK.high, opacity: 0.2 + 0.8 * o, transform: `scale(${0.96 + 0.04 * o})` }}>
                            {label}
                        </div>
                    );
                })}
            </div>
        </>
    );
};

const Close: React.FC = () => null;

export const BACKEND: FilmSpec = checkFilm({
    id: "backend",
    number: 9,
    title: "The rest of the backend",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", word: "Then", plus: -4 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "todo", at: { line: "hook", word: "Then", plus: 2 }, render: Todo, roll: 0.7 },
        { id: "function", at: { line: "function", plus: 2 }, render: Fn, roll: 0.32 },
        { id: "cron", at: { line: "cron", plus: 2 }, render: Cron, roll: 0.42 },
        { id: "queue", at: { line: "queue", plus: 2 }, render: Queue, roll: 0.16, ground: GROUND.deep, reveal: 0.55 },
        { id: "storage", at: { line: "storage", plus: 2 }, render: Storage, roll: 0.62 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.5 },
    ],
});
