/**
 * Local filesystem storage controller
 */

import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { promisify } from "util";
import {
    StorageController,
    LocalStorageConfig,
    DEFAULT_MAX_FILE_SIZE,
    type StoredObjectInfo,
    type StoredObjectRange,
    type PutObjectOptions,
    type StoredObjectStream
} from "./types";
import { fileWebStream } from "./streams";
import {
    UploadFileProps,
    UploadFileResult,
    DownloadConfig,
    DownloadMetadata,
    StorageListResult,
    StorageReference
} from "@rebasepro/types";
import { InvalidListOptionsError } from "./keys";
import { ApiError } from "../api/errors";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

/**
 * Bucket used when a call names none.
 *
 * Every method resolves through this, so put/get/delete/list agree on where a
 * bare key lives.
 */
export const DEFAULT_BUCKET = "default";

/** What a write in progress is named: `.<name>.<uuid>.partial`, beside its target. */
const PARTIAL_SUFFIX = ".partial";

/**
 * How long a folder's entries, read for a paged listing, serve its
 * continuation pages. See {@link LocalStorageController.listingEntries}.
 */
const LISTING_SNAPSHOT_TTL_MS = 30_000;
/**
 * A folder changed less than this long before it was read is not kept. Two
 * changes inside one mtime tick (a second on HFS+ and ext3, two on FAT) leave
 * one mtime, so the later change would not invalidate the read.
 */
const LISTING_SNAPSHOT_RACY_MS = 2_000;
/** Folders kept at once, and entries across them, before the oldest goes. */
const LISTING_SNAPSHOT_MAX_DIRS = 16;
const LISTING_SNAPSHOT_MAX_ENTRIES = 100_000;

interface ListingSnapshot {
    entries: fs.Dirent[];
    /** The folder's mtime when it was read. */
    mtimeMs: number;
    /** When it was read, by `Date.now()`. */
    readAt: number;
}
const isPartialWrite = (name: string) => /^\..+\.[0-9a-f-]{36}\.partial$/.test(name);

/** What the metadata kept beside an object is named: `<key>.metadata.json`. */
const METADATA_SUFFIX = ".metadata.json";

/**
 * Refuse a key that names one of local storage's own files rather than an
 * object: the metadata beside an object, or a write in progress.
 *
 * Both live in the object namespace, beside the objects they serve. A key that
 * names one used to be stored like any other, and so overwrote another
 * object's metadata: uploading `a.png.metadata.json` changed the content type
 * `a.png` is served with — the authorize hook asked about the one key while
 * the other changed — and the uploader's own file vanished from listings and
 * went with `a.png` when that was deleted. Read, it served the metadata.
 *
 * Local only: S3 and GCS keep metadata on the object, so every key there is
 * an object. A 400, at every operation, because every one resolves its path
 * through `getFullPath`.
 */
export function refuseLocalReservedKey(key: string): void {
    const name = key.split("/").pop() ?? "";
    if (name.endsWith(METADATA_SUFFIX) || isPartialWrite(name)) {
        throw new ApiError(
            400,
            "INVALID_STORAGE_KEY",
            `"${name}" names a file local storage keeps for itself (an object's \`${METADATA_SUFFIX}\` ` +
            "metadata, or a write in progress), not an object. Choose another name."
        );
    }
}

/** A file's bytes, a chunk at a time. */
async function* blobChunks(file: Blob): AsyncGenerator<Uint8Array> {
    const reader = file.stream().getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) return;
            yield value;
        }
    } finally {
        reader.releaseLock();
    }
}

/** Files of one listing page described at once: a `stat` and a sidecar read each. */
const LISTING_DESCRIBE_CONCURRENCY = 32;

/**
 * Give each listed file its `size`, `updated` and `contentType`, from a `stat`
 * and the metadata sidecar `putObject` writes. A file gone since the folder
 * was read keeps its name and nothing else; one without a sidecar is
 * `application/octet-stream`, as `statObject` reports it.
 */
async function describeListed(items: StorageReference[], absolutePathOf: (ref: StorageReference) => string): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const ref = items[next++];
            const absolute = absolutePathOf(ref);
            let fileStat: fs.Stats;
            try {
                fileStat = await fs.promises.stat(absolute);
            } catch {
                continue;
            }
            let contentType = "application/octet-stream";
            try {
                const sidecar = JSON.parse(await fs.promises.readFile(`${absolute}.metadata.json`, "utf-8"));
                if (typeof sidecar?.contentType === "string" && sidecar.contentType) contentType = sidecar.contentType;
            } catch {
                // No sidecar: the default type.
            }
            ref.size = fileStat.size;
            ref.updated = new Date(Math.trunc(fileStat.mtimeMs)).toISOString();
            ref.contentType = contentType;
        }
    };
    await Promise.all(Array.from({ length: Math.min(LISTING_DESCRIBE_CONCURRENCY, items.length) }, worker));
}

/**
 * Remove initial and trailing slashes from a path.
 * Handles paths like "/images/", "images/", "/images" → "images"
 */
function normalizeStoragePath(s: string): string {
    let result = s;
    while (result.startsWith("/")) {
        result = result.slice(1);
    }
    while (result.endsWith("/")) {
        result = result.slice(0, -1);
    }
    return result;
}

/**
 * Local filesystem storage implementation
 * Stores files in a directory structure: {basePath}/{bucket}/{path}
 */
export class LocalStorageController implements StorageController {
    private config: LocalStorageConfig;
    private basePath: string;
    /**
     * Folder entries read by a listing's first page, for its continuation
     * pages. Keyed by the folder's absolute path (bucket included). Not
     * caller-scoped, because the entries are not: every caller of this method
     * gets the same names, and the routes authorize the prefix before calling
     * it. Insertion-ordered, so the first key is the oldest.
     */
    private readonly listingSnapshots = new Map<string, ListingSnapshot>();

    constructor(config: LocalStorageConfig) {
        this.config = config;
        this.basePath = path.resolve(config.basePath);
    }

    getType(): "local" {
        return "local";
    }

    /**
     * The bucket directories that exist under the storage root, plus `default`.
     *
     * Read from disk rather than from config, because a local bucket *is* a
     * directory and a write creates it: `putObject({ bucket: "media" })` makes
     * `<root>/media` on the spot, which is deliberate and tested. So there is no
     * configured list to compare against — the only honest answer to "which
     * buckets does this serve" is "the ones that are there".
     *
     * Which is exactly what a read needs. `default` is always included: it is
     * the logical name every route uses when the caller names none, and it may
     * not have been written to yet.
     */
    knownBuckets(): string[] {
        try {
            const dirs = fs.readdirSync(this.basePath, { withFileTypes: true })
                .filter(entry => entry.isDirectory())
                .map(entry => entry.name);
            return [...new Set([DEFAULT_BUCKET, ...dirs])];
        } catch {
            // No storage root yet — nothing has been written. `default` is
            // still the bucket a read would use.
            return [DEFAULT_BUCKET];
        }
    }

    /**
     * Ensure directory exists, creating it if necessary
     */
    private async ensureDir(dirPath: string): Promise<void> {
        try {
            await mkdir(dirPath, { recursive: true });
        } catch (error: unknown) {
            if (error instanceof Error && (error as NodeJS.ErrnoException).code !== "EEXIST") {
                throw error;
            }
        }
    }

    /**
     * Get the full filesystem path for a storage path, with a traversal guard
     * that keeps the result inside the storage root.
     *
     * Defaults the bucket the way `putObject` does.
     *
     * `putObject` has always written into `default` when given no bucket, while
     * the read side resolved a bare key against the storage root — where
     * nothing is. The two disagreed silently: `getObject` returned null (reads
     * as "file missing"), `deleteObject` deleted nothing (404s are swallowed by
     * design), and `listObjects` returned an empty page. So the obvious
     * `putObject({ key })` → `getObject(key)` did not round-trip and nothing
     * said why. One default, applied everywhere, removes the whole class.
     *
     * Two boundaries, checked separately, because there are two of them. The
     * key must stay inside its bucket — that check always worked. The bucket
     * must stay inside the storage root, and that one did not exist: the guard
     * derived `bucketPath` from the caller's `bucket` and then asked whether
     * the result was inside `bucketPath`, so `bucket = "../../etc"` made the
     * reference point `/etc` and `/etc/passwd` is comfortably inside it. A
     * guard whose reference point moves with its input is not a guard. The
     * route boundary rejects such a bucket outright
     * (`canonicalStorageBucket`); this is the layer underneath that does not
     * depend on it having run.
     */
    private getFullPath(storagePath: string, bucket?: string): string {
        refuseLocalReservedKey(storagePath);
        const bucketPath = path.resolve(this.basePath, bucket || DEFAULT_BUCKET);
        if (!bucketPath.startsWith(this.basePath + path.sep)) {
            throw new Error("Path traversal detected: bucket resolves outside the storage root.");
        }
        const resolved = path.resolve(bucketPath, storagePath);
        if (!resolved.startsWith(bucketPath + path.sep) && resolved !== bucketPath) {
            throw new Error("Path traversal detected: resolved storage path is outside the bucket directory.");
        }
        return resolved;
    }

    /** See {@link StorageController.maxFileSize}. */
    maxFileSize(): number {
        return this.config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    }

    /**
     * Validate file before upload
     */
    private validateFile(file: File): void {
        const maxSize = this.maxFileSize();
        if (file.size > maxSize) {
            // An ApiError, so the refusal reaches the caller as what it is. A
            // plain Error was a 500 on `/upload` and a 502 on TUS — after the
            // client had sent every byte.
            throw new ApiError(
                413,
                "PAYLOAD_TOO_LARGE",
                `File size ${file.size} exceeds this storage source's maximum of ${maxSize} bytes.`,
                { size: file.size, maxFileSize: maxSize }
            );
        }

        if (this.config.allowedMimeTypes && this.config.allowedMimeTypes.length > 0) {
            if (!this.config.allowedMimeTypes.includes(file.type)) {
                throw new Error(`File type ${file.type} is not allowed. Allowed types: ${this.config.allowedMimeTypes.join(", ")}`);
            }
        }
    }

    async putObject({
        file,
        key,
        metadata,
        bucket
    }: UploadFileProps, options?: PutObjectOptions): Promise<UploadFileResult> {
        if (options?.uploadLimits !== false) this.validateFile(file);

        // Always use a bucket (default to 'default'). `||`, not `??`: an empty
        // bucket is "the caller named none", and it used to resolve to the
        // storage root instead of the default bucket.
        const usedBucket = bucket || DEFAULT_BUCKET;
        const fullStoragePath = key;
        const fullPath = this.getFullPath(fullStoragePath, usedBucket);

        // Ensure parent directory exists
        await this.ensureDir(path.dirname(fullPath));

        // Streamed to disk a chunk at a time — read whole, the file was held
        // twice in memory (the read, then a copy). Written beside the target
        // and renamed over it, so a write that fails part-way leaves the old
        // object (or none), never a truncated one.
        const partial = path.join(path.dirname(fullPath), `.${path.basename(fullPath)}.${randomUUID()}${PARTIAL_SUFFIX}`);
        try {
            await pipeline(Readable.from(blobChunks(file)), fs.createWriteStream(partial));
            await fs.promises.rename(partial, fullPath);
        } catch (error: unknown) {
            await fs.promises.rm(partial, { force: true });
            throw error;
        }

        // Always save metadata file with at least contentType (required for preview)
        const metadataPath = `${fullPath}.metadata.json`;
        await writeFile(metadataPath, JSON.stringify({
            ...(metadata || {}),
            contentType: file.type,
            size: file.size,
            uploadedAt: new Date().toISOString()
        }, null, 2));

        return {
            key: fullStoragePath,
            bucket: usedBucket,
            storageUrl: `local://${usedBucket}/${fullStoragePath}`
        };
    }

    async getSignedUrl(key: string, bucket?: string): Promise<DownloadConfig> {
        // Handle local:// URLs
        let resolvedPath = key;
        let resolvedBucket = bucket;

        if (key.startsWith("local://")) {
            const withoutProtocol = key.substring("local://".length);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                resolvedBucket = withoutProtocol.substring(0, firstSlash);
                resolvedPath = withoutProtocol.substring(firstSlash + 1);
            }
        }

        // Normalize path to handle leading/trailing slashes
        resolvedPath = normalizeStoragePath(resolvedPath);
        const fullPath = this.getFullPath(resolvedPath, resolvedBucket);

        try {
            await access(fullPath, fs.constants.R_OK);
            // A directory is readable but is not an object — on S3 and GCS
            // there is nothing at a folder's key, and the routes answer 404.
            if (!(await stat(fullPath)).isFile()) throw new Error("not a file");
        } catch {
            return {
                url: null,
                fileNotFound: true
            };
        }

        // Read metadata if available
        let metadata: DownloadMetadata | undefined;
        const metadataPath = `${fullPath}.metadata.json`;
        try {
            const metadataContent = await readFile(metadataPath, "utf-8");
            const savedMetadata = JSON.parse(metadataContent);
            const fileStat = await stat(fullPath);

            metadata = {
                bucket: resolvedBucket ?? DEFAULT_BUCKET,
                fullPath: resolvedPath,
                name: path.basename(resolvedPath),
                size: fileStat.size,
                contentType: savedMetadata.contentType || "application/octet-stream",
                customMetadata: savedMetadata
            };
        } catch {
            // No metadata file, create basic metadata from stat
            try {
                const fileStat = await stat(fullPath);
                metadata = {
                    bucket: resolvedBucket ?? DEFAULT_BUCKET,
                    fullPath: resolvedPath,
                    name: path.basename(resolvedPath),
                    size: fileStat.size,
                    contentType: "application/octet-stream",
                    customMetadata: {}
                };
            } catch {
                // Stat failed
            }
        }

        // Return a relative URL that will be served by the storage routes
        const bucketPath = resolvedBucket ? `${resolvedBucket}/` : "";
        const url = `/api/storage/file/${bucketPath}${resolvedPath}`;

        return {
            url,
            metadata
        };
    }

    async getObject(key: string, bucket?: string): Promise<File | null> {
        // Handle local:// URLs
        let resolvedPath = key;
        let resolvedBucket = bucket;

        if (key.startsWith("local://")) {
            const withoutProtocol = key.substring("local://".length);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                resolvedBucket = withoutProtocol.substring(0, firstSlash);
                resolvedPath = withoutProtocol.substring(firstSlash + 1);
            }
        }

        // Normalize path to handle leading/trailing slashes
        resolvedPath = normalizeStoragePath(resolvedPath);
        const fullPath = this.getFullPath(resolvedPath, resolvedBucket);

        try {
            await access(fullPath, fs.constants.R_OK);
            const fileStat = await stat(fullPath);
            const buffer = await readFile(fullPath);

            // Try to get content type from metadata
            let contentType = "application/octet-stream";
            try {
                const metadataPath = `${fullPath}.metadata.json`;
                const metadataContent = await readFile(metadataPath, "utf-8");
                const metadata = JSON.parse(metadataContent);
                contentType = metadata.contentType || contentType;
            } catch {
                // No metadata, use default content type
            }

            const blob = new Blob([buffer], { type: contentType });
            // The file's own mtime, as the routes' local branch already uses —
            // without it `File` stamps the time of the read.
            return new File([blob], path.basename(resolvedPath), {
                type: contentType,
                lastModified: Math.trunc(fileStat.mtimeMs)
            });
        } catch {
            return null;
        }
    }

    /** The file a read of `key` addresses — `getObject`'s resolution, `local://` URLs included. */
    private readPath(key: string, bucket?: string): string {
        let resolvedPath = key;
        let resolvedBucket = bucket;
        if (key.startsWith("local://")) {
            const withoutProtocol = key.substring("local://".length);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                resolvedBucket = withoutProtocol.substring(0, firstSlash);
                resolvedPath = withoutProtocol.substring(firstSlash + 1);
            }
        }
        return this.getFullPath(normalizeStoragePath(resolvedPath), resolvedBucket);
    }

    /** See {@link StorageController.statObject}. A `stat` and the metadata sidecar; the file is not read. */
    async statObject(key: string, bucket?: string): Promise<StoredObjectInfo | null> {
        const fullPath = this.readPath(key, bucket);
        let fileStat: fs.Stats;
        try {
            fileStat = await stat(fullPath);
        } catch {
            return null;
        }
        // A folder is not an object — see `getSignedUrl`.
        if (!fileStat.isFile()) return null;

        let contentType = "application/octet-stream";
        try {
            const metadata = JSON.parse(await readFile(`${fullPath}.metadata.json`, "utf-8"));
            contentType = metadata.contentType || contentType;
        } catch {
            // No metadata, use default content type
        }
        return { size: fileStat.size, contentType, lastModified: Math.trunc(fileStat.mtimeMs) };
    }

    /**
     * See {@link StorageController.getObjectStream}. The file — or only the
     * requested range of it — read from disk a chunk at a time, opened on the
     * first read.
     */
    async getObjectStream(
        key: string,
        options?: { bucket?: string; range?: StoredObjectRange }
    ): Promise<StoredObjectStream | null> {
        const info = await this.statObject(key, options?.bucket);
        if (!info) return null;
        const range = options?.range;
        return {
            ...info,
            stream: fileWebStream(this.readPath(key, options?.bucket), range),
            ...(range ? { range } : {})
        };
    }

    async deleteObject(key: string, bucket?: string): Promise<void> {
        // Handle local:// URLs
        let resolvedPath = key;
        let resolvedBucket = bucket;

        if (key.startsWith("local://")) {
            const withoutProtocol = key.substring("local://".length);
            const firstSlash = withoutProtocol.indexOf("/");
            if (firstSlash > 0) {
                resolvedBucket = withoutProtocol.substring(0, firstSlash);
                resolvedPath = withoutProtocol.substring(firstSlash + 1);
            }
        }

        // Normalize path to handle leading/trailing slashes
        resolvedPath = normalizeStoragePath(resolvedPath);

        if (!resolvedPath) {
            // Safety: never delete the bucket root
            return;
        }

        const fullPath = this.getFullPath(resolvedPath, resolvedBucket);

        // Check if path exists before attempting to delete
        try {
            await access(fullPath, fs.constants.F_OK);
        } catch {
            // File doesn't exist — nothing to delete
            return;
        }

        try {
            const stats = await stat(fullPath);
            if (stats.isDirectory()) {
                // Only remove if empty — client must delete contents first
                await fs.promises.rmdir(fullPath);
            } else {
                await unlink(fullPath);
                // Also delete metadata file if exists
                try {
                    await unlink(`${fullPath}.metadata.json`);
                } catch {
                    // Metadata file might not exist
                }
            }
        } catch (error: unknown) {
            if (error instanceof Error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (code === "ENOENT" || code === "ENOTEMPTY") {
                    // File doesn't exist or directory not empty — ignore
                    return;
                }
            }
            throw error;
        }
    }

    async listObjects(prefix: string, options?: {
        bucket?: string;
        maxResults?: number;
        pageToken?: string;
    }): Promise<StorageListResult> {
        // Checked before the directory is read, so a bad page is refused the
        // same way whether or not there is anything to list. The token is this
        // controller's own — the decimal index it hands back as
        // `nextPageToken` — so anything else was not issued by it.
        const maxResults = options?.maxResults ?? 1000;
        if (!Number.isInteger(maxResults) || maxResults < 1) {
            throw new InvalidListOptionsError(`maxResults must be a whole number of at least 1, got ${maxResults}.`);
        }
        const pageToken = options?.pageToken;
        if (pageToken && !/^\d+$/.test(pageToken)) {
            throw new InvalidListOptionsError(`"${pageToken}" is not a page token this listing issued.`);
        }
        const startIndex = pageToken ? parseInt(pageToken, 10) : 0;

        // Normalize path to handle leading/trailing slashes
        const normalizedPath = normalizeStoragePath(prefix);
        const fullPath = this.getFullPath(normalizedPath, options?.bucket);
        const items: StorageReference[] = [];
        const prefixes: StorageReference[] = [];

        try {
            const entries = await this.listingEntries(fullPath, startIndex > 0);

            let count = 0;
            // Cursor over `entries`, not over emitted results. Every stored
            // object has a `.metadata.json` sidecar that is skipped without
            // emitting anything, so a token derived from `count` could fail to
            // advance — a page of nothing but sidecars handed back the token it
            // was called with, and `while (pageToken)` never terminated.
            let scanned = startIndex;

            for (let i = startIndex; i < entries.length && count < maxResults; i++) {
                const entry = entries[i];
                scanned = i + 1;

                // Skip metadata files, and writes still in progress
                if (entry.name.endsWith(METADATA_SUFFIX) || isPartialWrite(entry.name)) {
                    continue;
                }

                // `normalizedPath`, not `prefix`. The raw argument still has
                // whatever slashes the caller wrote, so listing
                // `"products/images/"` — the form the docs' own example uses —
                // handed back `"products/images//sdk04.txt"` while `putObject`
                // had returned `"products/images/sdk04.txt"`. Locally that is a
                // key you cannot pass back; on S3 it is a different object.
                const entryPath = normalizedPath ? `${normalizedPath}/${entry.name}` : entry.name;
                const bucket = options?.bucket ?? DEFAULT_BUCKET;

                const ref: StorageReference = {
                    bucket,
                    fullPath: entryPath,
                    name: entry.name,
                    parent: null as never, // Simplified - not fully implementing parent chain
                    root: null as never,
                    toString: () => `local://${bucket}/${entryPath}`
                };

                if (entry.isDirectory()) {
                    prefixes.push(ref);
                } else {
                    items.push(ref);
                }
                count++;
            }

            // Each file's size, version and stored type, so a folder can be
            // shown without a metadata request per file — which made the
            // same `stat` and sidecar read, behind an HTTP round trip each.
            await describeListed(items, ref => path.join(fullPath, ref.name));

            const nextPageToken = scanned < entries.length ? String(scanned) : undefined;
            // The last page of a walk frees the folder's read.
            if (!nextPageToken) this.listingSnapshots.delete(fullPath);

            return {
                items,
                prefixes,
                nextPageToken
            };
        } catch (error: unknown) {
            const code = (error as NodeJS.ErrnoException)?.code;
            if (code === "ENOENT" || code === "ENOTDIR") {
                return { items: [],
prefixes: [] };
            }
            throw error;
        }
    }

    /**
     * A folder's entries for a listing page.
     *
     * A page token is an index into these entries, and every continuation
     * page used to read the whole folder again to find its place: a folder of
     * n entries listed in pages of p cost n/p full reads. A first page reads
     * the folder and, when there is a next page, keeps the read; a
     * continuation page indexes into it while all of these hold:
     *
     *  - the folder's mtime is the one read with it. Adding, removing or
     *    renaming an entry changes it, which is the invalidation;
     *  - it is under {@link LISTING_SNAPSHOT_TTL_MS} old;
     *  - the folder had not changed in the {@link LISTING_SNAPSHOT_RACY_MS}
     *    before the read. Otherwise it is not kept at all.
     *
     * A first page always reads the folder as it is.
     */
    private async listingEntries(fullPath: string, continuation: boolean): Promise<fs.Dirent[]> {
        const readAt = Date.now();
        // A stat rather than `access`: the same ENOENT/ENOTDIR for a missing
        // folder, and the mtime the kept read is checked against. A folder
        // this process cannot read still fails at `readdir`, as it did.
        const { mtimeMs } = await fs.promises.stat(fullPath);
        const kept = this.listingSnapshots.get(fullPath);
        if (continuation && kept && kept.mtimeMs === mtimeMs && readAt - kept.readAt < LISTING_SNAPSHOT_TTL_MS) {
            return kept.entries;
        }
        this.listingSnapshots.delete(fullPath);

        const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
        if (readAt - mtimeMs > LISTING_SNAPSHOT_RACY_MS && entries.length <= LISTING_SNAPSHOT_MAX_ENTRIES) {
            this.listingSnapshots.set(fullPath, { entries, mtimeMs, readAt });
            let total = 0;
            for (const snapshot of this.listingSnapshots.values()) total += snapshot.entries.length;
            for (const [key, snapshot] of this.listingSnapshots) {
                if (this.listingSnapshots.size <= LISTING_SNAPSHOT_MAX_DIRS && total <= LISTING_SNAPSHOT_MAX_ENTRIES) break;
                this.listingSnapshots.delete(key);
                total -= snapshot.entries.length;
            }
        }
        return entries;
    }

    /**
     * Get the absolute filesystem path for serving files
     * Used by the storage routes to serve files directly
     */
    getAbsolutePath(key: string, bucket?: string): string {
        return this.getFullPath(key, bucket);
    }

    /**
     * Get the base path for the storage
     */
    getBasePath(): string {
        return this.basePath;
    }
}
