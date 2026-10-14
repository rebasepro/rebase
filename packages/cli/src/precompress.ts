/**
 * `.br` and `.gz` beside a static build's content-hashed assets, written when
 * the build is folded into a bundle.
 *
 * The runtime serves a sibling when the browser accepts its encoding
 * (`serveSPA` turns `precompressed` on at mount when the build holds any), so a
 * hashed chunk costs no compression CPU at all, on any request — including the
 * first one after a deploy, which otherwise gzips every chunk once per process
 * — and the browsers that accept brotli get it. Without siblings the runtime
 * only ever sends gzip.
 *
 * Which files: the ones the runtime caches as `immutable` — a content hash in
 * the name, by the rule the runtime reads it with (`isContentHashedFileName`) — of a type worth
 * compressing, and 1 KB or more (the runtime's own compression threshold). An
 * unhashed file (`index.html`) is left to on-the-fly compression, where a
 * rewrite of it can never be served stale from a sibling. A sibling is written
 * only when it is smaller, and never over one the build already emitted.
 *
 * Brotli at quality 9, not 11. On the example app's 5.6 MB of JavaScript,
 * quality 11 is 1.30 MB and took 20 s (8.7 s across the thread pool); quality
 * 9 is 1.41 MB in 0.9 s. gzip at level 9 is 1.57 MB in 0.3 s. A deploy runs
 * this every time, and a CI runner has fewer cores than a laptop.
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { isContentHashedFileName } from "@rebasepro/types";

/** Below this a compressed response saves less than its headers cost — the runtime's threshold. */
const MIN_BYTES = 1024;

/**
 * Extensions whose content type the runtime compresses (`COMPRESSIBLE_CONTENT_TYPE_REGEX`).
 * All of them, because a build with any sibling switches the runtime's cache of
 * gzipped hashed files off: a hashed type left out here would be compressed on
 * every request instead of once.
 */
const COMPRESSIBLE = new Set([
    "js", "mjs", "cjs", "css", "html", "htm", "txt", "csv", "md", "xml", "json", "webmanifest",
    "svg", "wasm", "ttf", "otf", "eot", "ico", "bmp"
]);

export interface PrecompressOutcome {
    /** Files that got at least one sibling. */
    files: number;
    /** Their total size, and their siblings'. */
    bytes: number;
    brotliBytes: number;
    gzipBytes: number;
}

/** Write `.br` and `.gz` siblings for every hashed, compressible asset under `dir`. */
export function precompressStaticAssets(dir: string): PrecompressOutcome {
    const outcome: PrecompressOutcome = { files: 0, bytes: 0, brotliBytes: 0, gzipBytes: 0 };
    const pending = [dir];
    while (pending.length > 0) {
        const current = pending.pop() as string;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            // Not build output, as the runtime's own scan has it.
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const file = path.join(current, entry.name);
            if (entry.isDirectory()) {
                pending.push(file);
                continue;
            }
            if (!entry.isFile() || !worthCompressing(entry.name)) continue;
            const source = fs.readFileSync(file);
            if (source.byteLength < MIN_BYTES) continue;

            const brotli = writeSibling(`${file}.br`, source, () => zlib.brotliCompressSync(source, {
                params: {
                    [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
                    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
                    [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.byteLength
                }
            }));
            const gzip = writeSibling(`${file}.gz`, source, () => zlib.gzipSync(source, { level: 9 }));
            if (brotli === 0 && gzip === 0) continue;
            outcome.files++;
            outcome.bytes += source.byteLength;
            outcome.brotliBytes += brotli;
            outcome.gzipBytes += gzip;
        }
    }
    return outcome;
}

function worthCompressing(fileName: string): boolean {
    const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
    return COMPRESSIBLE.has(extension) && isContentHashedFileName(fileName);
}

/** The sibling's size, or 0 when there already was one or it would not be smaller. */
function writeSibling(target: string, source: Buffer, compress: () => Buffer): number {
    if (fs.existsSync(target)) return 0;
    const compressed = compress();
    if (compressed.byteLength >= source.byteLength) return 0;
    fs.writeFileSync(target, compressed);
    return compressed.byteLength;
}
