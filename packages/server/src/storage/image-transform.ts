/**
 * Image Transformation Service
 *
 * Provides on-the-fly image resize, crop, format conversion, and quality
 * adjustment using the `sharp` library. Results are cached in an LRU
 * in-memory cache to avoid redundant processing.
 */

import os from "node:os";

/**
 * The second argument is the decoder's own limits — see `MAX_INPUT_PIXELS` and
 * `DECODABLE_FORMATS`. Typed here rather than left off, because omitting it is
 * how the defaults (a 268-megapixel ceiling, and tolerance for truncated
 * input) stayed in force without anyone choosing them.
 */
interface SharpOptions {
    limitInputPixels?: number | boolean;
    failOn?: "none" | "truncated" | "error" | "warning";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharpFactory: ((input: Buffer | Uint8Array, options?: SharpOptions) => any) | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSharp(): Promise<(input: Buffer | Uint8Array, options?: SharpOptions) => any> {
    if (!sharpFactory) {
        try {
            const mod = await import("sharp");
            sharpFactory = mod.default;
        } catch (err) {
            throw new Error("Failed to load optional 'sharp' dependency for image transformation.");
        }
    }
    if (!sharpFactory) {
        throw new Error("Failed to load optional 'sharp' dependency for image transformation.");
    }
    return sharpFactory;
}

/** Options that can be specified via query parameters. */
export interface ImageTransformOptions {
    width?: number;
    height?: number;
    quality?: number;
    format?: "webp" | "avif" | "jpeg" | "png";
    fit?: "cover" | "contain" | "fill" | "inside" | "outside";
}

/** Maximum dimension allowed (prevents abuse). */
const MAX_DIMENSION = 4096;
/** Maximum quality value. */
const MAX_QUALITY = 100;
/** Minimum quality value. */
const MIN_QUALITY = 1;

const VALID_FORMATS = new Set(["webp", "avif", "jpeg", "png"]);
const VALID_FITS = new Set(["cover", "contain", "fill", "inside", "outside"]);

/**
 * A transform request naming parameters outside the declared bounds.
 *
 * Surfaced as a 400 by the route. Out-of-range values used to be *clamped*:
 * `width=99999` silently became 4096 and `format=tiff` silently became webp,
 * so the caller debugged a wrongly-sized `<img>` in the browser instead of
 * reading an error. A bound that rewrites its input is invisible, and this
 * endpoint's bounds are load-bearing — see {@link runTransform}.
 */
export class InvalidTransformOptionsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidTransformOptionsError";
    }
}

/**
 * Parse a bounded integer parameter, or throw.
 *
 * Strict digits only: `parseInt` accepted `300px` and `12abc`, which is a
 * second way for a caller to get a transform they did not describe.
 */
function boundedInt(name: string, raw: string, min: number, max: number): number {
    if (!/^\d+$/.test(raw)) {
        throw new InvalidTransformOptionsError(`Invalid '${name}': expected an integer between ${min} and ${max}.`);
    }
    const value = parseInt(raw, 10);
    if (value < min || value > max) {
        throw new InvalidTransformOptionsError(`Invalid '${name}': must be between ${min} and ${max}, got ${value}.`);
    }
    return value;
}

/**
 * Parse transform options from URL query parameters.
 * Returns `null` when no transformation is requested.
 *
 * Throws {@link InvalidTransformOptionsError} for anything outside the bounds
 * declared here — these are the whole parameter surface of an endpoint that is
 * reachable anonymously for public objects, so what it accepts has to be a
 * closed, stated set rather than "whatever we could coerce into range".
 */
export function parseTransformOptions(query: Record<string, string>): ImageTransformOptions | null {
    const opts: ImageTransformOptions = {};
    let hasTransform = false;

    if (query.width) {
        opts.width = boundedInt("width", query.width, 1, MAX_DIMENSION);
        hasTransform = true;
    }

    if (query.height) {
        opts.height = boundedInt("height", query.height, 1, MAX_DIMENSION);
        hasTransform = true;
    }

    if (query.quality) {
        opts.quality = boundedInt("quality", query.quality, MIN_QUALITY, MAX_QUALITY);
        hasTransform = true;
    }

    if (query.format) {
        if (!VALID_FORMATS.has(query.format)) {
            throw new InvalidTransformOptionsError(
                `Invalid 'format': expected one of ${[...VALID_FORMATS].join(", ")}.`
            );
        }
        opts.format = query.format as ImageTransformOptions["format"];
        hasTransform = true;
    }

    if (query.fit) {
        if (!VALID_FITS.has(query.fit)) {
            throw new InvalidTransformOptionsError(
                `Invalid 'fit': expected one of ${[...VALID_FITS].join(", ")}.`
            );
        }
        opts.fit = query.fit as ImageTransformOptions["fit"];
        hasTransform = true;
    }

    return hasTransform ? opts : null;
}

/**
 * The largest decoded image this server will produce, in pixels.
 *
 * A cap on the DECODE, which is a different quantity from the file size the
 * upload path bounds: a 300 KB PNG can describe a 40,000 × 40,000 canvas, and
 * decoding it asks for several bytes per pixel. sharp's own default is about
 * 268 megapixels, which is not a limit so much as an upper bound on the format.
 *
 * 50 megapixels is beyond any image a website serves — a 50MP source is a
 * medium-format camera original — and bounds a decode at hundreds of megabytes
 * rather than tens of gigabytes.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/**
 * The formats this server will actually decode, judged from the bytes.
 *
 * `isTransformableImage` decides whether to transform at all, and it reads the
 * stored content type — which the uploader chose. This is the check that cannot
 * be lied to, and it exists because the two exclusions up there matter: SVG is
 * a document format rendered through librsvg, a much larger surface than a
 * raster decoder and one with a history of resolving external references, and
 * an animated GIF multiplies a decode by its frame count.
 *
 * Raster formats only, and only ones with a plain decoder.
 */
export const DECODABLE_FORMATS = new Set(["jpeg", "jpg", "png", "webp", "avif", "tiff", "heif"]);

/**
 * The file is not something this server is willing to decode.
 *
 * Distinct from {@link InvalidTransformOptionsError}, which is about the
 * request: this one is about what was found in the object. Surfaced as a 415.
 */
export class UntransformableImageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UntransformableImageError";
    }
}

/** MIME types that can be used as a Content-Type header. */
const FORMAT_CONTENT_TYPES: Record<string, string> = {
    webp: "image/webp",
    avif: "image/avif",
    jpeg: "image/jpeg",
    png: "image/png"
};

/** Check whether a content type is a transformable image. */
export function isTransformableImage(contentType: string): boolean {
    return (
        contentType.startsWith("image/") &&
        !contentType.includes("svg") &&
        !contentType.includes("gif")
    );
}

/**
 * A transform refused because the server is already doing as many as it will.
 *
 * Surfaced as a 503 by the route.
 */
export class TransformOverloadedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TransformOverloadedError";
    }
}

/**
 * A bounded work queue.
 *
 * A transform is seconds of libvips CPU and a full-resolution bitmap in RSS,
 * and `GET /file/*?width=…` is reachable anonymously for public objects — so
 * without a bound, a few hundred bytes per request buys unlimited pod CPU, and
 * enough of them at once buys the heap too. `maxConcurrent` caps the CPU and
 * memory in flight; `maxQueued` is what keeps an unbounded backlog from
 * becoming the same problem one level up, refusing fast (503) instead of
 * accepting work the process will not get to.
 */
export class TransformQueue {
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    constructor(
        private readonly maxConcurrent: number,
        private readonly maxQueued: number
    ) {}

    /** Number of tasks running plus waiting. Exposed for tests and metrics. */
    get depth(): number {
        return this.active + this.waiting.length;
    }

    async run<T>(work: () => Promise<T>): Promise<T> {
        if (this.active >= this.maxConcurrent) {
            if (this.waiting.length >= this.maxQueued) {
                throw new TransformOverloadedError(
                    "Image transformation is at capacity. Retry shortly."
                );
            }
            await new Promise<void>((resolve) => this.waiting.push(resolve));
        }
        this.active++;
        try {
            return await work();
        } finally {
            this.active--;
            this.waiting.shift()?.();
        }
    }
}

/**
 * The queue every transform goes through.
 *
 * Small on purpose: transforms are CPU-bound, so more concurrency than cores
 * buys nothing but resident bitmaps.
 */
export const transformQueue = new TransformQueue(
    Math.max(1, Math.min(4, os.availableParallelism?.() ?? os.cpus().length)),
    64
);

/**
 * Apply image transformations and return the result buffer + content type.
 *
 * Runs on {@link transformQueue}: the work is bounded, and callers past the
 * bound get {@link TransformOverloadedError} rather than a share of a
 * saturated CPU.
 */
export async function transformImage(
    buffer: Buffer | Uint8Array,
    options: ImageTransformOptions
): Promise<{ data: Buffer; contentType: string }> {
    return transformQueue.run(() => runTransform(buffer, options));
}

async function runTransform(
    buffer: Buffer | Uint8Array,
    options: ImageTransformOptions
): Promise<{ data: Buffer; contentType: string }> {
    const sharp = await getSharp();
    // A bound on what the DECODER will allocate, which is a different thing
    // from a bound on the file.
    //
    // sharp's default `limitInputPixels` is 0x3FFF × 0x3FFF — about 268
    // megapixels — and a decoded pixel costs several bytes, so a file well
    // inside the upload limit can ask this process for gigabytes. That is the
    // shape of the classic decompression bomb: a few hundred KB of PNG
    // describing a 40,000 × 40,000 canvas. The size checks upstream cannot see
    // it, because they are about the compressed bytes.
    //
    // 50 megapixels is far beyond any image a website serves — a 50MP source is
    // a medium-format camera original — and small enough that a decode is
    // hundreds of megabytes rather than tens of gigabytes.
    //
    // `failOn: "truncated"` in the same breath: sharp's default tolerates
    // damaged input and keeps decoding, which for a file chosen by somebody
    // else is a longer decode with a less predictable result.
    let pipeline = sharp(buffer, {
        limitInputPixels: MAX_INPUT_PIXELS,
        failOn: "truncated"
    });

    // What the BYTES are, not what the upload said they were.
    //
    // Whether a transform runs at all is decided by `isTransformableImage`,
    // which reads the stored content type — a value the uploader chose. So a
    // file served as `image/png` reaches this decoder whatever it actually
    // contains, and the two formats deliberately excluded up there are excluded
    // for real reasons: SVG is a document format that sharp renders through
    // librsvg, a far larger surface than a raster decoder and one with a
    // history of resolving external references; an animated GIF multiplies the
    // decode by its frame count.
    //
    // sharp has already parsed the header by the time `metadata()` answers, so
    // this costs nothing extra and asks the only source that cannot be lied to.
    const detected = (await pipeline.metadata()).format;
    if (!detected || !DECODABLE_FORMATS.has(detected)) {
        throw new UntransformableImageError(
            `This file is ${detected ? `a ${detected}` : "not an"} image that can be transformed. ` +
            `Transformable formats: ${[...DECODABLE_FORMATS].sort().join(", ")}.`
        );
    }

    if (options.width || options.height) {
        pipeline = pipeline.resize({
            width: options.width,
            height: options.height,
            fit: options.fit || "cover",
            withoutEnlargement: true
        });
    }

    const format = options.format || "webp";
    const quality = options.quality || 80;

    switch (format) {
        case "webp":
            pipeline = pipeline.webp({ quality });
            break;
        case "avif":
            pipeline = pipeline.avif({ quality });
            break;
        case "jpeg":
            pipeline = pipeline.jpeg({ quality });
            break;
        case "png":
            pipeline = pipeline.png({ quality });
            break;
    }

    const data = await pipeline.toBuffer();
    return { data,
contentType: FORMAT_CONTENT_TYPES[format] };
}

// ---------------------------------------------------------------------------
// LRU Transform Cache
// ---------------------------------------------------------------------------

interface CacheEntry {
    data: Buffer;
    contentType: string;
    timestamp: number;
}

/**
 * Simple LRU cache for transformed images.
 *
 * Entries expire after `maxAgeMs` (default: 1 hour) and the cache
 * evicts the oldest entry when `maxEntries` is exceeded.
 */
export class TransformCache {
    private cache = new Map<string, CacheEntry>();
    private readonly maxEntries: number;
    private readonly maxAgeMs: number;
    private readonly maxTotalBytes: number;
    private totalBytes = 0;

    constructor(maxEntries = 500, maxAgeMs = 3_600_000, maxTotalBytes = 256 * 1024 * 1024) {
        this.maxEntries = maxEntries;
        this.maxAgeMs = maxAgeMs;
        this.maxTotalBytes = maxTotalBytes;
    }

    /** Build a deterministic cache key from file key + transform options. */
    buildKey(fileKey: string, options: ImageTransformOptions): string {
        return `${fileKey}::${JSON.stringify(options)}`;
    }

    get(cacheKey: string): { data: Buffer; contentType: string } | null {
        const entry = this.cache.get(cacheKey);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.maxAgeMs) {
            this.totalBytes -= entry.data.length;
            this.cache.delete(cacheKey);
            return null;
        }
        // Move to end (most recently used)
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, entry);
        return { data: entry.data,
contentType: entry.contentType };
    }

    set(cacheKey: string, data: Buffer, contentType: string): void {
        // Evict oldest entries while over capacity (entry count or total bytes)
        while (
            (this.cache.size >= this.maxEntries || this.totalBytes + data.length > this.maxTotalBytes)
            && this.cache.size > 0
        ) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
                const evicted = this.cache.get(oldest);
                if (evicted) this.totalBytes -= evicted.data.length;
                this.cache.delete(oldest);
            }
        }
        this.totalBytes += data.length;
        this.cache.set(cacheKey, { data,
contentType,
timestamp: Date.now() });
    }
}
