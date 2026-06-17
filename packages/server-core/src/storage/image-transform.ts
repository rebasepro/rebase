/**
 * Image Transformation Service
 *
 * Provides on-the-fly image resize, crop, format conversion, and quality
 * adjustment using the `sharp` library. Results are cached in an LRU
 * in-memory cache to avoid redundant processing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharpFactory: ((input: Buffer | Uint8Array) => any) | undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSharp(): Promise<(input: Buffer | Uint8Array) => any> {
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
 * Parse transform options from URL query parameters.
 * Returns `null` when no transformation is requested.
 */
export function parseTransformOptions(query: Record<string, string>): ImageTransformOptions | null {
    const opts: ImageTransformOptions = {};
    let hasTransform = false;

    if (query.width) {
        const w = parseInt(query.width, 10);
        if (!Number.isNaN(w) && w > 0) {
            opts.width = Math.min(w, MAX_DIMENSION);
            hasTransform = true;
        }
    }

    if (query.height) {
        const h = parseInt(query.height, 10);
        if (!Number.isNaN(h) && h > 0) {
            opts.height = Math.min(h, MAX_DIMENSION);
            hasTransform = true;
        }
    }

    if (query.quality) {
        const q = parseInt(query.quality, 10);
        if (!Number.isNaN(q)) {
            opts.quality = Math.min(Math.max(q, MIN_QUALITY), MAX_QUALITY);
            hasTransform = true;
        }
    }

    if (query.format && VALID_FORMATS.has(query.format)) {
        opts.format = query.format as ImageTransformOptions["format"];
        hasTransform = true;
    }

    if (query.fit && VALID_FITS.has(query.fit)) {
        opts.fit = query.fit as ImageTransformOptions["fit"];
        hasTransform = true;
    }

    return hasTransform ? opts : null;
}

/** MIME types that can be used as a Content-Type header. */
const FORMAT_CONTENT_TYPES: Record<string, string> = {
    webp: "image/webp",
    avif: "image/avif",
    jpeg: "image/jpeg",
    png: "image/png",
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
 * Apply image transformations and return the result buffer + content type.
 */
export async function transformImage(
    buffer: Buffer | Uint8Array,
    options: ImageTransformOptions
): Promise<{ data: Buffer; contentType: string }> {
    const sharp = await getSharp();
    let pipeline = sharp(buffer);

    if (options.width || options.height) {
        pipeline = pipeline.resize({
            width: options.width,
            height: options.height,
            fit: options.fit || "cover",
            withoutEnlargement: true,
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
    return { data, contentType: FORMAT_CONTENT_TYPES[format] };
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

    constructor(maxEntries = 500, maxAgeMs = 3_600_000) {
        this.maxEntries = maxEntries;
        this.maxAgeMs = maxAgeMs;
    }

    /** Build a deterministic cache key from file key + transform options. */
    buildKey(fileKey: string, options: ImageTransformOptions): string {
        return `${fileKey}::${JSON.stringify(options)}`;
    }

    get(cacheKey: string): { data: Buffer; contentType: string } | null {
        const entry = this.cache.get(cacheKey);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > this.maxAgeMs) {
            this.cache.delete(cacheKey);
            return null;
        }
        // Move to end (most recently used)
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, entry);
        return { data: entry.data, contentType: entry.contentType };
    }

    set(cacheKey: string, data: Buffer, contentType: string): void {
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxEntries) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(cacheKey, { data, contentType, timestamp: Date.now() });
    }
}
