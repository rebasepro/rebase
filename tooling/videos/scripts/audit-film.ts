// The frame audit: renders a film at a SIMULATED read (the live page's own
// simulated presenter, src/live/simulate.ts — not the authored nine frames
// a word), in both shapes, and fails with a clear message when
//
//   bare-ground   a frame around a scene cut is near-empty: the scenes, the
//                 film's layer and the end card are rendered alone on black
//                 (the kit's audit "content" mode: no ground, captions or
//                 episode mark; the presenter painted flat while large), and a
//                 frame whose mean brightness falls under a third of the
//                 dimmer of the two settled frames either side of the cut —
//                 or under an absolute floor — is flagged;
//   headlines     more than three distinct headline sizes (display type at
//                 32px and up, outside the kit's captions, marks and end
//                 card) appear across the film, per shape;
//   wrap          a headline wraps to more than two lines (tall wraps at
//                 ~30 characters).
//
// It also writes, per shape, a contact sheet of the whole film (a frame
// every --every frames) and a strip across every cut (a row per cut, seven
// frames from just before to well after), full look, as PNGs.
//
//   pnpm audit:film <id> [--wpm 155] [--seed 7] [--every 45] [--shape wide|tall|both]
//
// Output: out/audit/<id>/{wide,tall}/{sheet.png,cuts.png,report.txt}, and
// out/audit/<id>/props.json — the simulated read as render props, to look
// closer at a frame: remotion still src/index.ts <comp> f.png --frame=N
// --props=out/audit/<id>/props.json
//
// What it does NOT catch: anything inside a scene that is not at a cut
// (a hole mid-scene, an element that leaves too early); legibility, overlap
// and clipping (look at the sheets); motion problems (jitter, a camera move
// on text) — stills cannot show them; a read faster or slower than --wpm;
// the presenter's real picture (the placeholder stands in). The headline
// count trusts the display font to mean "headline": a headline set in
// another face is not counted.
//
// Plain TypeScript run by tsx; not in the project's tsc program (scripts/
// is not), like lint-series.ts.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { EXPLAINERS, explainerCompositions } from "../src/explainers/index";
import { SERIES } from "../src/series/index";
import { buildSeries, type FilmSpec } from "../src/series/kit";
import { simulateRead } from "../src/live/simulate";
import type { Timing } from "../src/spoken/narration";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FPS = 30;

/* ── arguments ─────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const id = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const WPM = Number(flag("wpm", "155"));
const SEED = Number(flag("seed", "7"));
const EVERY = Number(flag("every", "45"));
const SHAPES = flag("shape", "both") === "both" ? (["wide", "tall"] as const) : ([flag("shape", "wide")] as const);

const films: { spec: FilmSpec; comps: [string, string] }[] = [
    ...EXPLAINERS.map((e) => ({ spec: e.film, comps: explainerCompositions(e.film.id) })),
    ...SERIES.map((spec) => ({ spec, comps: [`Series-${spec.id}`, `Series-${spec.id}-Tall`] as [string, string] })),
];
const film = films.find((f) => f.spec.id === id);
if (!film) {
    console.error(`usage: pnpm audit:film <id> [--wpm 155] [--every 45] [--shape wide|tall|both]\nfilms: ${films.map((f) => f.spec.id).join(", ")}`);
    process.exit(2);
}

/* ── the simulated read, as a Timing ───────────────────────────────── */

function simulatedTiming(spec: FilmSpec): Timing {
    const read = simulateRead({ script: spec.script, wpm: WPM, seed: SEED });
    const f = (ms: number) => Math.round((ms * FPS) / 1000);
    return {
        lines: spec.script.map((_, i) => {
            const words = read.words[i].map(f);
            for (let k = 1; k < words.length; k++) words[k] = Math.max(words[k], words[k - 1] + 1);
            return { words, end: Math.max(f(read.ends[i]), words[words.length - 1] + 1) };
        }),
    };
}

const timing = simulatedTiming(film.spec);
const series = buildSeries(film.spec, timing);
const duration = series.duration ?? 1;

interface Cut {
    label: string;
    at: number;
}
const cuts: Cut[] = [];
if (series.toCorner !== null) cuts.push({ label: "presenter → corner", at: series.toCorner });
film.spec.scenes.forEach((s, i) => {
    const at = series.starts[i];
    if (at !== null) cuts.push({ label: `→ ${s.id}`, at });
});
cuts.sort((a, b) => a.at - b.at);

/* ── Remotion, through the CLI's own copies ─────────────────────────── */

const req = createRequire(import.meta.url);
const cliReq = createRequire(req.resolve("@remotion/cli/package.json"));
const { bundle } = cliReq("@remotion/bundler");
const renderer = cliReq("@remotion/renderer");

/* ── PNGs: decode (8-bit, non-interlaced, as Chrome writes them), measure,
   tile. Done here because the ffmpeg Remotion ships has no tile filter. ── */

interface Image {
    width: number;
    height: number;
    /** RGB, 3 bytes a pixel. */
    rgb: Uint8Array;
}

function decodePng(file: string): Image {
    const buf = readFileSync(file);
    let pos = 8;
    let width = 0;
    let height = 0;
    let channels = 0;
    const idat: Buffer[] = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString("ascii", pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            const colorType = data[9];
            if (data[8] !== 8 || data[12] !== 0) throw new Error(`${file}: only 8-bit non-interlaced PNG`);
            channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
            if (!channels) throw new Error(`${file}: unsupported PNG colour type ${colorType}`);
        } else if (type === "IDAT") idat.push(data);
        else if (type === "IEND") break;
        pos += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const prev = new Uint8Array(stride);
    const cur = new Uint8Array(stride);
    const rgb = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
        const row = y * (stride + 1);
        const filter = raw[row];
        for (let x = 0; x < stride; x++) {
            const v = raw[row + 1 + x];
            const a = x >= channels ? cur[x - channels] : 0;
            const b = prev[x];
            const c = x >= channels ? prev[x - channels] : 0;
            let out = v;
            if (filter === 1) out = v + a;
            else if (filter === 2) out = v + b;
            else if (filter === 3) out = v + ((a + b) >> 1);
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            }
            cur[x] = out & 255;
        }
        for (let x = 0; x < width; x++) {
            const i = x * channels;
            const o = (y * width + x) * 3;
            rgb[o] = cur[i];
            rgb[o + 1] = channels >= 3 ? cur[i + 1] : cur[i];
            rgb[o + 2] = channels >= 3 ? cur[i + 2] : cur[i];
        }
        prev.set(cur);
    }
    return { width, height, rgb };
}

function meanLuma(file: string): number {
    const { width, height, rgb } = decodePng(file);
    let sum = 0;
    for (let i = 0; i < width * height; i++) sum += 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
    return sum / (width * height);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}

/** Lays images out `across` to a row, `pad` px apart on grey, as one PNG. */
function tile(files: string[], across: number, out: string, pad = 4) {
    const imgs = files.map(decodePng);
    const cw = Math.max(...imgs.map((i) => i.width));
    const ch = Math.max(...imgs.map((i) => i.height));
    const rows = Math.ceil(imgs.length / across);
    const W = across * cw + (across + 1) * pad;
    const H = rows * ch + (rows + 1) * pad;
    const raw = Buffer.alloc((W * 3 + 1) * H, 0x30);
    for (let y = 0; y < H; y++) raw[y * (W * 3 + 1)] = 0;
    imgs.forEach((img, k) => {
        const ox = pad + (k % across) * (cw + pad);
        const oy = pad + Math.floor(k / across) * (ch + pad);
        for (let y = 0; y < img.height; y++) {
            const dst = (oy + y) * (W * 3 + 1) + 1 + ox * 3;
            raw.set(img.rgb.subarray(y * img.width * 3, (y + 1) * img.width * 3), dst);
        }
    });
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/* ── the run ────────────────────────────────────────────────────────── */

interface Probe {
    frame: number;
    headlineSizes: number[];
    headlineLines: number;
}

const OUT = path.join(ROOT, "out", "audit", film.spec.id);

async function main() {
    console.log(`audit:film ${film!.spec.id} — simulated read at ${WPM} wpm (seed ${SEED}), ${duration} frames (${(duration / FPS).toFixed(1)} s), ${cuts.length} cuts`);
    const serveUrl: string = await bundle({ entryPoint: path.join(ROOT, "src/index.ts"), publicDir: path.join(ROOT, "public") });
    mkdirSync(OUT, { recursive: true });
    /* The simulated read as render props, to look closer at any frame:
       remotion still src/index.ts <comp> out.png --frame=N --props=out/audit/<id>/props.json */
    writeFileSync(path.join(OUT, "props.json"), JSON.stringify({ timing, take: null }));
    writeFileSync(path.join(OUT, "cuts.json"), JSON.stringify(cuts, null, 1));
    const browser = await renderer.openBrowser("chrome", { chromiumOptions: { gl: "angle" }, logLevel: "error" });
    let failed = false;
    try {
        for (const shape of SHAPES) {
            const comp = shape === "tall" ? film!.comps[1] : film!.comps[0];
            const dir = path.join(OUT, shape);
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(path.join(dir, "frames"), { recursive: true });
            const report: string[] = [];
            const say = (s: string) => {
                report.push(s);
                console.log(s);
            };
            say(`\n== ${comp}`);

            const probes: Probe[] = [];
            const onBrowserLog = (log: { text: string }) => {
                if (log.text.startsWith("[audit] ")) probes.push(JSON.parse(log.text.slice(8)));
            };
            const compFor = async (audit: "probe" | "content") => {
                const inputProps = { timing, take: null, audit };
                const composition = await renderer.selectComposition({ serveUrl, id: comp, inputProps, puppeteerInstance: browser, chromiumOptions: { gl: "angle" }, logLevel: "error" });
                return { composition, inputProps };
            };
            const still = async (c: { composition: unknown; inputProps: Record<string, unknown> }, frame: number, output: string, log = false) => {
                await renderer.renderStill({
                    serveUrl,
                    composition: c.composition,
                    frame: Math.max(0, Math.min(duration - 1, frame)),
                    output,
                    scale: 0.25,
                    inputProps: c.inputProps,
                    puppeteerInstance: browser,
                    chromiumOptions: { gl: "angle" },
                    timeoutInMilliseconds: 120000,
                    logLevel: "error",
                    onBrowserLog: log ? onBrowserLog : undefined,
                });
            };

            /* 1. bare ground at the cuts */
            const content = await compFor("content");
            const OFFSETS = [-6, -4, -2, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
            const FLOOR = 0.6;
            let bare = 0;
            for (const cut of cuts) {
                const lum = async (f: number) => {
                    const file = path.join(dir, "frames", `content-${String(f).padStart(5, "0")}.png`);
                    await still(content, f, file);
                    return meanLuma(file);
                };
                const before = await lum(cut.at - 10);
                const after = await lum(cut.at + 28);
                const ref = Math.min(before, after);
                const vals: string[] = [];
                const flagged: number[] = [];
                for (const o of OFFSETS) {
                    const m = await lum(cut.at + o);
                    vals.push(m.toFixed(1));
                    if (m < Math.max(FLOOR, ref / 3)) flagged.push(cut.at + o);
                }
                const ok = flagged.length === 0;
                if (!ok) bare++;
                say(`${ok ? "ok  " : "BARE"} cut ${cut.label.padEnd(20)} @${cut.at}  settled ${before.toFixed(1)} / ${after.toFixed(1)}  across: ${vals.join(" ")}${ok ? "" : `  ← near-empty at ${flagged.join(", ")}`}`);
            }

            /* 2. contact sheet, full look, probing type as it goes */
            const look = await compFor("probe");
            const sheetFrames: number[] = [];
            for (let f = 0; f < duration; f += EVERY) sheetFrames.push(f);
            if (sheetFrames[sheetFrames.length - 1] !== duration - 1) sheetFrames.push(duration - 1);
            for (const [i, f] of sheetFrames.entries()) await still(look, f, path.join(dir, "frames", `sheet-${String(i).padStart(4, "0")}.png`), true);
            const across = shape === "tall" ? 10 : 6;
            tile(sheetFrames.map((_, i) => path.join(dir, "frames", `sheet-${String(i).padStart(4, "0")}.png`)), across, path.join(dir, "sheet.png"));
            say(`sheet: ${sheetFrames.length} frames, every ${EVERY} (${(EVERY / FPS).toFixed(1)} s), ${across} across → ${path.join(dir, "sheet.png")}`);

            /* 3. a strip across every cut */
            const STRIP = [-8, -2, 2, 6, 10, 16, 24];
            let n = 0;
            for (const cut of cuts) {
                for (const o of STRIP) await still(look, cut.at + o, path.join(dir, "frames", `cut-${String(n++).padStart(4, "0")}.png`), true);
            }
            tile(Array.from({ length: n }, (_, i) => path.join(dir, "frames", `cut-${String(i).padStart(4, "0")}.png`)), STRIP.length, path.join(dir, "cuts.png"));
            say(`cuts: ${cuts.length} rows (${cuts.map((c) => c.label.replace("→ ", "")).join(", ")}), frames at ${STRIP.join(" ")} around each → ${path.join(dir, "cuts.png")}`);

            /* 4. headline sizes and wrapping */
            const sizes = [...new Set(probes.flatMap((p) => p.headlineSizes))].sort((a, b) => a - b);
            const maxLines = Math.max(0, ...probes.map((p) => p.headlineLines));
            const sizesOk = sizes.length <= 3;
            const wrapOk = maxLines <= 2;
            say(`${sizesOk ? "ok  " : "FAIL"} headline sizes: ${sizes.length} (${sizes.join(", ") || "none"}px)${sizesOk ? "" : " — at most three, chosen by role"}`);
            if (!sizesOk) {
                for (const s of sizes) say(`       ${s}px first at frame ${probes.find((p) => p.headlineSizes.includes(s))?.frame}`);
            }
            say(`${wrapOk ? "ok  " : "FAIL"} headline lines: at most ${maxLines}${wrapOk ? "" : ` — at frame ${probes.find((p) => p.headlineLines === maxLines)?.frame}; keep headlines to ~30 characters`}`);
            if (bare) say(`FAIL ${bare} cut(s) show bare ground`);
            if (bare || !sizesOk || !wrapOk) failed = true;
            writeFileSync(path.join(dir, "report.txt"), report.join("\n") + "\n");
        }
    } finally {
        await browser.close({ silent: true });
        rmSync(serveUrl, { recursive: true, force: true });
    }
    if (failed) {
        console.error(`\naudit:film: ${film!.spec.id} FAILED — see out/audit/${film!.spec.id}/*/report.txt and the sheets.`);
        process.exit(1);
    }
    console.log(`\naudit:film: ${film!.spec.id} passed. Now LOOK at the sheets — the audit cannot see overlap, clipping or legibility.`);
}

main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
});
