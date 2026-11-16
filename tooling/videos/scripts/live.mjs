#!/usr/bin/env node
/**
 * THE RECORDING PAGE'S SERVER.   pnpm live   → http://localhost:3500
 *
 * Bundles src/live (esbuild, rebuilt on every change) and serves it, with
 * public/ at the root — the film's footage, fonts and logo, which
 * staticFile() resolves to "/<path>" outside a render — and takes the
 * recording as it is made:
 *
 *   POST /api/takes/<id>/chunk?ext=webm   append a second of recording
 *   POST /api/takes/<id>/log              what the page heard (live.json)
 *   POST /api/takes/<id>/process          make it renderable (take.mjs)
 *   POST /api/takes/<id>/discard          move it to takes/.discarded
 *   GET  /api/takes?film=<id>              a film's processed takes
 *   GET  /api/edits/<film>                 which take serves each line
 *   POST /api/edits/<film>                   (takes/edits/<film>.json)
 *   POST /api/render/<film>/<cut>          render a cut from the props the
 *                                          page assembled; GET it for progress
 *   GET  /out/<file>                       a finished render
 *   POST /api/loose/<id>/chunk|save        a talk-through: unscripted, kept
 *                                          with its transcript (takes/loose/)
 *   GET  /api/loose?film=<id>              a film's talk-throughs
 *   POST /api/rehearsals/<film>            what a rehearsal heard, per line
 *   POST /api/script/<film>                change one line of the script in
 *                                          its source file (and the docs)
 *
 * Localhost only, and only take ids the page mints. Open the page in
 * Chrome: its speech recognition is what hears the words.
 */
import { context } from "esbuild";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processTake } from "./take.mjs";
import { listTakes } from "./takes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "build", "live");
const PUBLIC = path.join(ROOT, "public");
const TAKES = path.join(ROOT, "takes");
const EDITS = path.join(TAKES, "edits");
const RENDERS = path.join(ROOT, "out");
const PORT = Number(process.env.PORT ?? 3500);

const ctx = await context({
    entryPoints: [path.join(ROOT, "src", "live", "main.tsx")],
    outdir: OUT,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    sourcemap: "linked",
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "warning",
});
await ctx.watch();
await ctx.rebuild();

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rebase — recording</title>
<link rel="icon" href="data:,">
<style>html,body{margin:0;background:#090A0C;color:#fff}</style>
${existsSync(path.join(OUT, "main.css")) ? '<link rel="stylesheet" href="/live/main.css">' : ""}
</head>
<body><div id="root"></div><script type="module" src="/live/main.js"></script></body>
</html>`;

const TYPES = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".map": "application/json",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".json": "application/json",
};

/** A file, with Range support — the Player's video elements seek. */
async function serveFile(req, res, file) {
    let info;
    try {
        info = await stat(file);
    } catch {
        res.writeHead(404).end("not found");
        return;
    }
    if (!info.isFile()) {
        res.writeHead(404).end("not found");
        return;
    }
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (range) {
        const start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
        const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        if (start >= info.size || start > end) {
            res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
            return;
        }
        res.writeHead(206, {
            "Content-Type": type,
            "Content-Length": end - start + 1,
            "Content-Range": `bytes ${start}-${end}/${info.size}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-cache",
        });
        createReadStream(file, { start, end }).pipe(res);
        return;
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": info.size, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" });
    createReadStream(file).pipe(res);
}

/** Inside `base`, or null — no path escapes the folders served. */
function inside(base, rel) {
    const file = path.resolve(base, "." + path.posix.normalize("/" + decodeURIComponent(rel)));
    return file.startsWith(base + path.sep) ? file : null;
}

function body(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

const json = (res, status, value) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));

const LOOSE = path.join(TAKES, "loose");
const REHEARSALS = path.join(TAKES, "rehearsals");
const SRC = path.join(ROOT, "src");

/** Every .ts/.tsx file under src/. */
async function sources(dir = SRC) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await sources(file)));
        else if (/\.tsx?$/.test(entry.name)) out.push(file);
    }
    return out;
}

/**
 * One line of a script, changed where it is written. A line is a string
 * literal in its film's source (`lines([["id", "text"], …])`), so the text
 * must appear exactly once, quoted, in exactly one file — anything else is
 * refused rather than guessed at. The voice-over docs' tables carry the same
 * text and follow along.
 */
async function changeLine(from, to) {
    const needle = JSON.stringify(from);
    const hits = [];
    for (const file of await sources()) {
        const text = await readFile(file, "utf8");
        const count = text.split(needle).length - 1;
        if (count) hits.push({ file, text, count });
    }
    const total = hits.reduce((n, h) => n + h.count, 0);
    if (total !== 1) throw new Error(total ? `the line appears ${total} times in src/ — change it by hand` : "the line is not in src/ as written — was it changed already?");
    const [hit] = hits;
    await writeFile(hit.file, hit.text.replace(needle, JSON.stringify(to)));
    const docs = [];
    for (const name of (await readdir(ROOT)).filter((f) => /^VOICEOVER.*\.md$/.test(f))) {
        const file = path.join(ROOT, name);
        const text = await readFile(file, "utf8");
        if (text.includes(from)) {
            await writeFile(file, text.split(from).join(to));
            docs.push(name);
        }
    }
    return { file: path.relative(ROOT, hit.file), docs };
}

async function listLoose(film) {
    if (!existsSync(LOOSE)) return [];
    const out = [];
    for (const id of (await readdir(LOOSE)).filter((d) => /^loose-\d{8}-\d{6}$/.test(d)).sort().reverse()) {
        try {
            const t = JSON.parse(await readFile(path.join(LOOSE, id, "transcript.json"), "utf8"));
            if (t.film !== film) continue;
            const markdown = await readFile(path.join(LOOSE, id, "transcript.md"), "utf8");
            out.push({ id, recordedAt: t.recordedAt, words: t.words?.length ?? 0, simulated: !!t.simulated, markdown });
        } catch {
            /* still recording, or never saved */
        }
    }
    return out;
}

/** Renders in progress or done, by "<film>/<cut>". */
const renders = new Map();

function startRender(key, compositions, propsFile) {
    const job = { state: "rendering", progress: 0, step: 0, steps: compositions.length, files: [], log: "", startedAt: Date.now() };
    renders.set(key, job);
    const next = () => {
        if (job.step >= compositions.length) {
            job.state = "done";
            return;
        }
        const comp = compositions[job.step];
        const file = `${comp}.mp4`;
        const child = spawn("pnpm", ["exec", "remotion", "render", "src/index.ts", comp, `out/${file}`, `--props=${propsFile}`, "--timeout=120000"], { cwd: ROOT });
        const onData = (c) => {
            const text = String(c);
            job.log = (job.log + text).slice(-4000);
            const m = /(?:Rendered|Encoded)\s+(\d+)\/(\d+)/g;
            let hit;
            let last = null;
            while ((hit = m.exec(text))) last = hit;
            if (last) job.progress = (job.step + Number(last[1]) / Number(last[2])) / compositions.length;
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("close", (code) => {
            if (code !== 0) {
                job.state = "error";
                return;
            }
            job.files.push(file);
            job.step++;
            job.progress = job.step / compositions.length;
            next();
        });
    };
    next();
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
        const api = /^\/api\/takes\/(take-\d{8}-\d{6})\/(chunk|log|process|discard)$/.exec(url.pathname);
        if (api && req.method === "POST") {
            const [, id, action] = api;
            const dir = path.join(TAKES, id);
            await mkdir(dir, { recursive: true });
            if (action === "chunk") {
                const ext = url.searchParams.get("ext") === "mp4" ? "mp4" : "webm";
                await appendFile(path.join(dir, `take.${ext}`), await body(req));
                return json(res, 200, { ok: true });
            }
            if (action === "log") {
                await writeFile(path.join(dir, "live.json"), await body(req));
                return json(res, 200, { ok: true });
            }
            if (action === "discard") {
                await mkdir(path.join(TAKES, ".discarded"), { recursive: true });
                await rename(dir, path.join(TAKES, ".discarded", id));
                console.log(`${id}: discarded (moved to takes/.discarded/)`);
                return json(res, 200, { ok: true });
            }
            const out = await processTake(id, { log: (line) => console.log(line) });
            console.log(`\n${out.summary}\n\nrender:\n  ${out.render}\n`);
            return json(res, 200, { summary: out.summary, render: out.render });
        }
        const loose = /^\/api\/loose\/(loose-\d{8}-\d{6})\/(chunk|save)$/.exec(url.pathname);
        if (loose && req.method === "POST") {
            const [, id, action] = loose;
            const dir = path.join(LOOSE, id);
            await mkdir(dir, { recursive: true });
            if (action === "chunk") {
                const ext = url.searchParams.get("ext") === "mp4" ? "mp4" : "webm";
                await appendFile(path.join(dir, `take.${ext}`), await body(req));
                return json(res, 200, { ok: true });
            }
            const value = JSON.parse(String(await body(req)));
            await writeFile(path.join(dir, "transcript.json"), JSON.stringify(value, null, 1));
            await writeFile(path.join(dir, "transcript.md"), String(value.markdown ?? ""));
            console.log(`${id}: a talk-through, ${value.words?.length ?? 0} words → takes/loose/${id}/transcript.md`);
            return json(res, 200, { ok: true, path: `takes/loose/${id}/transcript.md` });
        }
        if (url.pathname === "/api/loose" && req.method === "GET") {
            const film = url.searchParams.get("film") ?? "";
            if (!/^[a-z0-9-]+$/.test(film)) return json(res, 400, { error: "film?" });
            return json(res, 200, await listLoose(film));
        }
        const rehearsal = /^\/api\/rehearsals\/([a-z0-9-]+)$/.exec(url.pathname);
        if (rehearsal && req.method === "POST") {
            const dir = path.join(REHEARSALS, rehearsal[1]);
            await mkdir(dir, { recursive: true });
            const value = JSON.parse(String(await body(req)));
            const name = `${String(value.id ?? Date.now()).replace(/[^a-z0-9-]/gi, "")}.json`;
            await writeFile(path.join(dir, name), JSON.stringify(value, null, 1));
            return json(res, 200, { ok: true, path: `takes/rehearsals/${rehearsal[1]}/${name}` });
        }
        const script = /^\/api\/script\/([a-z0-9-]+)$/.exec(url.pathname);
        if (script && req.method === "POST") {
            const { from, to } = JSON.parse(String(await body(req)));
            if (typeof from !== "string" || typeof to !== "string" || !to.trim() || to.length > 600 || /[\n\r]/.test(to)) return json(res, 400, { error: "a line is one non-empty line of text" });
            try {
                const out = await changeLine(from, to.trim());
                console.log(`script: ${out.file}${out.docs.length ? ` (+ ${out.docs.join(", ")})` : ""}\n  was: ${from}\n  now: ${to.trim()}`);
                return json(res, 200, out);
            } catch (err) {
                return json(res, 409, { error: String(err instanceof Error ? err.message : err) });
            }
        }
        if (url.pathname === "/api/takes" && req.method === "GET") {
            const film = url.searchParams.get("film") ?? "";
            if (!/^[a-z0-9-]+$/.test(film)) return json(res, 400, { error: "film?" });
            return json(res, 200, await listTakes(film));
        }
        const edit = /^\/api\/edits\/([a-z0-9-]+)$/.exec(url.pathname);
        if (edit) {
            const file = path.join(EDITS, `${edit[1]}.json`);
            if (req.method === "POST") {
                const value = JSON.parse(String(await body(req)));
                await mkdir(EDITS, { recursive: true });
                await writeFile(file, JSON.stringify({ picks: value.picks ?? {} }, null, 1));
                return json(res, 200, { ok: true });
            }
            return json(res, 200, existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : { picks: {} });
        }
        const render = /^\/api\/render\/([a-z0-9-]+)\/([a-z]+)$/.exec(url.pathname);
        if (render) {
            const key = `${render[1]}/${render[2]}`;
            if (req.method === "POST") {
                const job = renders.get(key);
                if (job?.state === "rendering") return json(res, 409, { error: "already rendering" });
                const value = JSON.parse(String(await body(req)));
                const compositions = (value.compositions ?? []).filter((c) => /^[A-Za-z0-9-]+$/.test(c));
                if (!compositions.length) return json(res, 400, { error: "compositions?" });
                await mkdir(EDITS, { recursive: true });
                const propsFile = path.join("takes", "edits", `${render[1]}-${render[2]}.props.json`);
                await writeFile(path.join(ROOT, propsFile), JSON.stringify(value.props, null, 1));
                startRender(key, compositions, propsFile);
                const command = compositions.map((c) => `pnpm exec remotion render src/index.ts ${c} out/${c}.mp4 --props=${propsFile} --scale=2`).join("\n");
                console.log(`rendering ${key}:\n  ${command.replace(/\n/g, "\n  ")}`);
                return json(res, 200, { ok: true, command });
            }
            return json(res, 200, renders.get(key) ?? { state: "idle" });
        }
        if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
        if (url.pathname === "/") return res.writeHead(200, { "Content-Type": "text/html" }).end(HTML);
        if (url.pathname.startsWith("/out/")) {
            const file = inside(RENDERS, url.pathname.slice("/out".length));
            return file ? serveFile(req, res, file) : res.writeHead(404).end();
        }
        if (url.pathname.startsWith("/live/")) {
            const file = inside(OUT, url.pathname.slice("/live".length));
            return file ? serveFile(req, res, file) : res.writeHead(404).end();
        }
        const file = inside(PUBLIC, url.pathname);
        return file ? serveFile(req, res, file) : res.writeHead(404).end();
    } catch (err) {
        console.error(err);
        return json(res, 500, { error: String(err instanceof Error ? err.message : err) });
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  The recording page:  http://localhost:${PORT}/?film=<id>\n`);
    console.log(`  Open it in Chrome (speech recognition is Chrome's) and allow the camera and`);
    console.log(`  microphone. Pick a chapter, press Space, read. Every take is kept; the film`);
    console.log(`  plays back each one in place, and each cut (long, short) is assembled from`);
    console.log(`  the takes you choose. Render from the page, or: pnpm assemble <film> --render`);
    console.log(`\n  A dry run with no camera:  http://localhost:${PORT}/?film=view-side-door&simulate\n`);
});
