/**
 * Local filesystem storage controller
 */

import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import {
    StorageController,
    LocalStorageConfig,
    DEFAULT_MAX_FILE_SIZE
} from "./types";
import {
    UploadFileProps,
    UploadFileResult,
    DownloadConfig,
    DownloadMetadata,
    StorageListResult,
    StorageReference
} from "@rebasepro/types";

const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const access = promisify(fs.access);

/**
 * Bucket used when a call names none.
 *
 * Every method resolves through this, so put/get/delete/list agree on where a
 * bare key lives.
 */
export const DEFAULT_BUCKET = "default";

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

    constructor(config: LocalStorageConfig) {
        this.config = config;
        this.basePath = path.resolve(config.basePath);
    }

    getType(): "local" {
        return "local";
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

    /**
     * Validate file before upload
     */
    private validateFile(file: File): void {
        const maxSize = this.config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
        if (file.size > maxSize) {
            throw new Error(`File size ${file.size} exceeds maximum allowed size ${maxSize}`);
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
    }: UploadFileProps): Promise<UploadFileResult> {
        this.validateFile(file);

        // Always use a bucket (default to 'default'). `||`, not `??`: an empty
        // bucket is "the caller named none", and it used to resolve to the
        // storage root instead of the default bucket.
        const usedBucket = bucket || DEFAULT_BUCKET;
        const fullStoragePath = key;
        const fullPath = this.getFullPath(fullStoragePath, usedBucket);

        // Ensure parent directory exists
        await this.ensureDir(path.dirname(fullPath));

        // Convert File to Buffer and write
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await writeFile(fullPath, buffer);

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
            return new File([blob], path.basename(resolvedPath), { type: contentType });
        } catch {
            return null;
        }
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
        // Normalize path to handle leading/trailing slashes
        const normalizedPath = normalizeStoragePath(prefix);
        const fullPath = this.getFullPath(normalizedPath, options?.bucket);
        const items: StorageReference[] = [];
        const prefixes: StorageReference[] = [];

        try {
            await access(fullPath, fs.constants.R_OK);
            const entries = await readdir(fullPath, { withFileTypes: true });

            let count = 0;
            const maxResults = options?.maxResults ?? 1000;
            const startIndex = options?.pageToken ? parseInt(options.pageToken, 10) : 0;
            // Cursor over `entries`, not over emitted results. Every stored
            // object has a `.metadata.json` sidecar that is skipped without
            // emitting anything, so a token derived from `count` could fail to
            // advance — a page of nothing but sidecars handed back the token it
            // was called with, and `while (pageToken)` never terminated.
            let scanned = startIndex;

            for (let i = startIndex; i < entries.length && count < maxResults; i++) {
                const entry = entries[i];
                scanned = i + 1;

                // Skip metadata files
                if (entry.name.endsWith(".metadata.json")) {
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

            const nextPageToken = scanned < entries.length ? String(scanned) : undefined;

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
