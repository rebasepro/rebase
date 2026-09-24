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
 *
 * Localhost only, and only take ids the page mints. Open the page in
 * Chrome: its speech recognition is what hears the words.
 */
import { context } from "esbuild";
import { createReadStream, existsSync } from "node:fs";
import { appendFile, mkdir, rename, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { processTake } from "./take.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "build", "live");
const PUBLIC = path.join(ROOT, "public");
const TAKES = path.join(ROOT, "takes");
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
<title>Rebase — record the desk film</title>
<style>html,body{margin:0;background:#0A0A0A;color:#fff}</style>
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
        if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
        if (url.pathname === "/") return res.writeHead(200, { "Content-Type": "text/html" }).end(HTML);
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
    console.log(`\n  Record the desk film:  http://localhost:${PORT}\n`);
    console.log(`  Open it in Chrome (speech recognition is Chrome's), allow the camera and`);
    console.log(`  microphone, press Space and read. Try it without a camera first:`);
    console.log(`  http://localhost:${PORT}/?simulate\n`);
});
