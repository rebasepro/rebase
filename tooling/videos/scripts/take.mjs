#!/usr/bin/env node
/**
 * A TAKE, MADE RENDERABLE.
 *
 *     node scripts/take.mjs <take-id>        (pnpm take <take-id>)
 *
 * The recording page (src/live, `pnpm live`) leaves a take in
 * takes/<id>/: the camera-and-microphone recording as the browser wrote it,
 * and live.json — everything the page heard: when each word was recognised,
 * when the voice started and stopped, when the follower thought each line
 * began and ended. This turns that into what the film renders from:
 *
 *   public/takes/<id>.mp4    the take at a constant 30 fps, H.264 and AAC —
 *                            what OffthreadVideo seeks reliably. The browser
 *                            writes variable-rate WebM with no index.
 *   takes/<id>/props.json    the render's --props: the take, and the TIMING,
 *                            the frame every word of the script was said.
 *
 * THE TIMING IS MEASURED ON THE RECORDING, not taken from the page. The page
 * heard words through speech recognition, a few hundred milliseconds late
 * and sometimes wrong; that was good enough to steer a live preview, and it
 * is only a starting point here. What the render needs exact is where each
 * LINE starts and ends — every camera move hangs off a line's first word —
 * and silence finds those precisely: the speech in the take is found by its
 * level, and each line's start and end snap to the edges of it. Words inside
 * a line are placed through the line's voiced time by their syllables.
 *
 * The film then starts fifteen frames before the first word, as the
 * authored film does: the take's head is trimmed with `startFrom`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** ffmpeg: $FFMPEG, else the first of the usual places, else the PATH. A
 *  server started by a launcher may not have the shell's PATH. */
const FFMPEG =
    process.env.FFMPEG ??
    [path.join(process.env.HOME ?? "", "ffmpeg", "bin", "ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((p) => existsSync(p)) ??
    "ffmpeg";
const FPS = 30;
/** The authored film's first word is at frame 15; so is a take's. */
const LEAD_IN = 15;
const RATE = 16000;
const HOP = 160; // 10 ms

function run(args, { capture = false } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(FFMPEG, args, { stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"] });
        const chunks = [];
        let err = "";
        if (capture) child.stdout.on("data", (c) => chunks.push(c));
        child.stderr.on("data", (c) => (err = (err + c).slice(-4000)));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exited ${code}: ${err}`))));
    });
}

/* ── speech in the recording ─────────────────────────────────────────── */

/** Level of every 10 ms of the take, dBFS. */
function levels(pcm) {
    const n = Math.floor(pcm.length / 2 / HOP);
    const out = new Float32Array(n);
    for (let f = 0; f < n; f++) {
        let sum = 0;
        for (let i = 0; i < HOP; i++) {
            const v = pcm.readInt16LE((f * HOP + i) * 2) / 32768;
            sum += v * v;
        }
        out[f] = 10 * Math.log10(sum / HOP + 1e-12);
    }
    return out;
}

/**
 * Where the voice is: 10 ms frames over a threshold set between the room
 * (10th percentile) and the voice (90th), gaps under 120 ms bridged — a
 * plosive's closure, not a pause — and blips under 80 ms dropped.
 */
function speech(db) {
    const sorted = [...db].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)];
    const voice = sorted[Math.floor(sorted.length * 0.9)];
    const threshold = floor + Math.max(8, (voice - floor) * 0.3);
    const segments = [];
    let start = -1;
    for (let f = 0; f <= db.length; f++) {
        const on = f < db.length && db[f] > threshold;
        if (on && start < 0) start = f;
        if (!on && start >= 0) {
            segments.push({ start: start / 100, end: f / 100 });
            start = -1;
        }
    }
    const bridged = [];
    for (const s of segments) {
        const last = bridged[bridged.length - 1];
        if (last && s.start - last.end < 0.12) last.end = s.end;
        else bridged.push({ ...s });
    }
    return { segments: bridged.filter((s) => s.end - s.start >= 0.08), floor, voice, threshold };
}

/* ── lines and words ─────────────────────────────────────────────────── */

const syllables = (word) =>
    word
        .toLowerCase()
        .split(/[-\s]+/)
        .reduce((n, part) => n + Math.max(1, (part.replace(/[^a-z]/g, "").replace(/e$/, "").match(/[aeiouy]+/g) ?? []).length), 0);

/**
 * Each line's start and end on the recording. The page's own estimate is
 * the prior — within a second or so — and the recording decides: the start
 * is the speech onset after the longest silence near the prior (the pause
 * between two lines is the longest one around it), the end is the end of the
 * last stretch of speech before the next line starts.
 */
function placeLines(live, segments) {
    const toSec = (frame) => frame / live.fps;
    const priors = live.timing.lines.map((l) => (l ? { start: toSec(l.words[0]), end: l.end !== undefined ? toSec(l.end) : null } : null));
    const placed = [];
    let floor = 0;
    for (let k = 0; k < priors.length; k++) {
        const prior = priors[k];
        if (!prior) {
            placed.push(null);
            continue;
        }
        let best = null;
        for (let i = 0; i < segments.length; i++) {
            const s = segments[i];
            if (s.start < floor || s.start < prior.start - 1.0 || s.start > prior.start + 0.5) continue;
            const silence = s.start - (i > 0 ? segments[i - 1].end : 0);
            const score = silence - Math.abs(s.start - prior.start) * 0.25;
            if (!best || score > best.score) best = { start: s.start, score };
        }
        const start = best ? best.start : prior.start;
        placed.push({ start, end: null, prior });
        floor = start + 0.2;
    }
    for (let k = 0; k < placed.length; k++) {
        const line = placed[k];
        if (!line) continue;
        const next = placed.slice(k + 1).find(Boolean);
        const limit = next ? next.start - 0.05 : (line.prior.end ?? line.start + 30) + 1.5;
        const inside = segments.filter((s) => s.start >= line.start - 0.01 && s.start < limit && s.end - s.start >= 0.12);
        const last = inside[inside.length - 1];
        line.end = Math.max(line.start + 0.3, Math.min(limit, last ? last.end : line.prior.end ?? line.start + 1));
        line.voiced = inside.map((s) => ({ start: Math.max(s.start, line.start), end: Math.min(s.end, line.end) })).filter((s) => s.end > s.start);
    }
    return placed;
}

/** Word starts through a line's voiced time, by syllables: pauses inside
 *  the line are skipped over, so a sentence after a breath starts after it. */
function placeWords(words, line) {
    const weights = words.map(syllables);
    const total = weights.reduce((a, b) => a + b, 0);
    const voiced = line.voiced.length ? line.voiced : [{ start: line.start, end: line.end }];
    const length = voiced.reduce((a, s) => a + (s.end - s.start), 0);
    const at = (position) => {
        let left = position;
        for (const s of voiced) {
            const d = s.end - s.start;
            if (left <= d) return s.start + left;
            left -= d;
        }
        return voiced[voiced.length - 1].end;
    };
    let before = 0;
    return weights.map((w) => {
        const t = at((before / total) * length);
        before += w;
        return t;
    });
}

/* ── the take ─────────────────────────────────────────────────────────── */

const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export async function processTake(id, { log = console.log } = {}) {
    if (!/^take-\d{8}-\d{6}$/.test(id)) throw new Error(`not a take id: ${id}`);
    const dir = path.join(ROOT, "takes", id);
    const live = JSON.parse(await readFile(path.join(dir, "live.json"), "utf8"));
    const source = ["take.webm", "take.mp4"].map((f) => path.join(dir, f)).find((f) => existsSync(f));
    if (!source) throw new Error(`no recording in takes/${id}/`);

    await mkdir(path.join(ROOT, "public", "takes"), { recursive: true });
    const video = path.join(ROOT, "public", "takes", `${id}.mp4`);
    log(`${id}: encoding the take for the film…`);
    await run([
        "-y", "-i", source,
        "-vf", "fps=30,format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
        "-movflags", "+faststart",
        video,
    ]);
    log(`${id}: finding the speech in it…`);
    const pcm = await run(["-i", video, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "pipe:1"], { capture: true });
    const { segments, floor, voice, threshold } = speech(levels(pcm));
    const seconds = pcm.length / 2 / RATE;
    /* A take with no voice in it cannot be measured, and measuring it anyway
       wrote a three-second film. Say what is wrong instead. */
    if (voice < -60 || voice - floor < 6) {
        throw new Error(
            `No voice in this take: its loudest stretches are ${voice.toFixed(0)} dBFS over a room of ${floor.toFixed(0)} dBFS. ` +
                `Check the microphone chosen on the page (and the system input) — the take is kept in takes/${id}/.`,
        );
    }

    const lines = placeLines(live, segments);
    const first = lines.find(Boolean);
    if (!first) throw new Error("no line of the script was heard in this take");
    const said = lines.filter(Boolean);
    const short = said.filter((l) => l.end - l.start < 0.5).length;
    if (short > said.length / 2) {
        throw new Error(`${short} of ${said.length} lines measured under half a second — the page lost the read. The take is kept in takes/${id}/.`);
    }
    const startFrom = Math.max(0, Math.round(first.start * FPS) - LEAD_IN);
    const frame = (t) => Math.round(t * FPS) - startFrom;

    const timing = {
        lines: lines.map((line, k) => {
            if (!line) return null;
            const words = placeWords(live.lines[k].words, line).map(frame);
            for (let i = 1; i < words.length; i++) words[i] = Math.max(words[i], words[i - 1] + 1);
            return { words, end: Math.max(frame(line.end), words[words.length - 1] + 1) };
        }),
    };
    const props = { take: { src: `takes/${id}.mp4`, startFrom }, timing };
    await writeFile(path.join(dir, "props.json"), JSON.stringify(props, null, 1));

    /* The report: each line where the recording put it, and where the page
       thought it was — a big difference is worth a look before rendering. */
    const rows = lines.map((line, k) => {
        const name = live.lines[k].id.padEnd(9);
        if (!line) return `${name} — never heard`;
        const words = live.lines[k].words.length;
        const wpm = Math.round((words / Math.max(0.1, line.end - line.start)) * 60);
        const drift = Math.round((line.start - line.prior.start) * FPS);
        return `${name} ${clock(line.start)} → ${clock(line.end)}  ${String(wpm).padStart(3)} wpm${Math.abs(drift) > 6 ? `   (page said ${drift > 0 ? drift + " frames early" : -drift + " frames late"})` : ""}`;
    });
    const last = timing.lines.filter(Boolean).pop();
    const film = (last.end + 49) / FPS;
    const summary = [
        `take ${clock(seconds)} · film ${clock(film)} · starts ${clock(startFrom / FPS)} into the take`,
        `voice ${voice.toFixed(0)} dBFS over a room of ${floor.toFixed(0)} dBFS (threshold ${threshold.toFixed(0)})${voice - floor < 15 ? " — LOW: the voice barely clears the room" : ""}`,
        "",
        ...rows,
    ].join("\n");
    await writeFile(path.join(dir, "summary.txt"), summary + "\n");
    const render = `pnpm exec remotion render src/index.ts RebaseDesk out/rebase-desk-${id}.mp4 --props=takes/${id}/props.json --scale=2 --timeout=120000`;
    return { id, summary, render, props };
}

/* ── as a command ────────────────────────────────────────────────────── */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const id = process.argv[2];
    if (!id) {
        const takes = existsSync(path.join(ROOT, "takes")) ? (await readdir(path.join(ROOT, "takes"))).filter((d) => d.startsWith("take-")) : [];
        console.log(takes.length ? `takes:\n  ${takes.join("\n  ")}` : "no takes yet — record one with `pnpm live`");
        process.exit(0);
    }
    try {
        const out = await processTake(id);
        console.log(`\n${out.summary}\n\nrender:\n  ${out.render}`);
    } catch (err) {
        console.error(String(err instanceof Error ? err.message : err));
        process.exit(1);
    }
}
