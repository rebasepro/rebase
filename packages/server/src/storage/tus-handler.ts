/**
 * TUS Protocol Handler
 *
 * Implements the TUS v1.0.0 resumable upload protocol with the
 * Creation and Termination extensions. Uploads are stored in a
 * temporary directory and moved to final storage on completion.
 *
 * @see https://tus.io/protocols/resumable-upload
 */

import { randomUUID } from "crypto";
import { writeFile, unlink, stat, mkdir, open } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { Context } from "hono";
import type { StorageController } from "./types";
import { UnknownStorageSourceError, type StorageRegistry } from "./storage-registry";
import { logger } from "../utils/logger.js";
import { ApiError } from "../api/errors";
import { canonicalStorageKey, InvalidStorageKeyError, canonicalStorageBucket, InvalidStorageBucketError, canonicalStorageId } from "./keys";

/** Metadata for an in-progress resumable upload. */
interface TusUpload {
    id: string;
    /** Total declared size in bytes. */
    size: number;
    /** Bytes received so far. */
    offset: number;
    /** TUS metadata parsed from the creation request. */
    metadata: Record<string, string>;
    /** Timestamp of creation (epoch ms). */
    createdAt: number;
    /** Absolute path to the temp file on disk. */
    filePath: string;
    /**
     * Target bucket, canonicalized at creation, or undefined when the upload
     * named none. Same discipline as {@link TusUpload.key}: resolved once, and
     * both what the hook was shown and what `finalize` writes to.
     */
    bucket?: string;
    /**
     * Target storage source, resolved at creation.
     *
     * It used to be resolved twice from two different places — the route asked
     * the hook about `?storageId` from the query string while `finalize` wrote
     * to `metadata.storageId` from the header — so one request could obtain
     * approval for one source and deliver the bytes to another.
     */
    storageId?: string;
    /**
     * The canonical key this upload will be written to.
     *
     * Resolved once, at creation, and never re-derived: it is both what the
     * authorize hook was shown and what `finalize` passes to `putObject`. It
     * used to be neither — the hook saw a sanitized `metadata.key` while
     * `finalize` used the raw header value with its own chain of fallbacks, so
     * the two were different strings by construction and no fix to the
     * sanitizer could have brought them together.
     */
    key: string;
    /** Whether the upload has been fully received and finalized. */
    completed: boolean;
}

/** Maximum upload size: 5 GB. */
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024;

/** Stale upload expiry: 24 hours. */
const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * TUS resumable upload handler.
 *
 * Each instance manages uploads for a single storage root. The
 * `storageController` is used to finalize completed uploads by
 * calling `putObject`.
 */
export class TusHandler {
    private uploads = new Map<string, TusUpload>();
    private tusDir: string;
    private cleanupTimer?: ReturnType<typeof setInterval>;

    constructor(
        storageBaseDir: string,
        private storageController?: StorageController,
        private storageRegistry?: StorageRegistry,
        /**
         * Per-object authorization, applied to the resumable path too.
         *
         * TUS is a second way to write an object, so a hook enforced only on
         * `POST /upload` would leave the door it was added to close standing
         * open. The target key lives in the `Upload-Metadata` header, which
         * only this class parses — hence the injection rather than a check in
         * the route. Rejects by throwing.
         *
         * Every routing value the write will use is passed in, because the hook
         * can only answer for the destination it is told about.
         */
        private authorizeUpload?: (c: Context, key: string, bucket: string, storageId?: string) => Promise<void>
    ) {
        this.tusDir = join(storageBaseDir, ".tus-uploads");
    }

    /** Ensure the temp directory exists. */
    private async ensureDir(): Promise<void> {
        if (!existsSync(this.tusDir)) {
            await mkdir(this.tusDir, { recursive: true });
        }
    }

    /** Start periodic cleanup of stale uploads. */
    startCleanup(): void {
        if (this.cleanupTimer) return;
        this.cleanupTimer = setInterval(() => {
            void this.cleanupStale();
        }, 60_000); // every minute
        // A sweeper is not a reason for the process to stay alive: unref'd, it
        // runs while there is work and never holds the event loop open. It used
        // to, so every `createStorageRoutes()` in a test run left Node running
        // after the last assertion.
        this.cleanupTimer.unref?.();
    }

    /** Remove uploads that have been idle for longer than UPLOAD_EXPIRY_MS. */
    private async cleanupStale(): Promise<void> {
        const now = Date.now();
        for (const [id, upload] of this.uploads) {
            if (now - upload.createdAt > UPLOAD_EXPIRY_MS && !upload.completed) {
                try { await unlink(upload.filePath); } catch { /* ok */ }
                this.uploads.delete(id);
            }
        }
    }

    // -----------------------------------------------------------------------
    // TUS Metadata Parsing
    // -----------------------------------------------------------------------

    /**
     * Parse the `Upload-Metadata` header.
     *
     * Format: `key base64value,key2 base64value2`
     */
    private parseMetadata(header: string): Record<string, string> {
        const metadata: Record<string, string> = {};
        if (!header) return metadata;
        for (const pair of header.split(",")) {
            const trimmed = pair.trim();
            const spaceIdx = trimmed.indexOf(" ");
            if (spaceIdx === -1) {
                metadata[trimmed] = "";
            } else {
                const key = trimmed.substring(0, spaceIdx);
                const value = Buffer.from(trimmed.substring(spaceIdx + 1), "base64").toString("utf-8");
                metadata[key] = value;
            }
        }
        return metadata;
    }

    // -----------------------------------------------------------------------
    // Protocol Endpoints
    // -----------------------------------------------------------------------

    /** `OPTIONS /tus` — TUS capability discovery. */
    options(): Response {
        return new Response(null, {
            status: 204,
            headers: {
                "Tus-Resumable": "1.0.0",
                "Tus-Version": "1.0.0",
                "Tus-Extension": "creation,termination",
                "Tus-Max-Size": String(MAX_UPLOAD_SIZE)
            }
        });
    }

    /** `POST /tus` — Create a new upload. */
    async create(c: Context): Promise<Response> {
        await this.ensureDir();

        const uploadLengthHeader = c.req.header("Upload-Length");
        if (!uploadLengthHeader) {
            throw ApiError.badRequest("Upload-Length header is required");
        }

        const uploadLength = parseInt(uploadLengthHeader, 10);
        if (Number.isNaN(uploadLength) || uploadLength <= 0) {
            throw ApiError.badRequest("Invalid Upload-Length");
        }
        if (uploadLength > MAX_UPLOAD_SIZE) {
            throw new ApiError(413, "PAYLOAD_TOO_LARGE", `Upload-Length exceeds maximum of ${MAX_UPLOAD_SIZE} bytes`);
        }

        const metadata = this.parseMetadata(c.req.header("Upload-Metadata") || "");

        const id = randomUUID();

        // Resolve the destination ONCE, here, and carry it on the upload.
        // Everything downstream — the authorize call below, `finalize` — reads
        // this field rather than re-deriving from `metadata`.
        //
        // The `id` fallback (an upload that names no key at all) is resolved
        // here too, so the hook is asked about the key that will actually be
        // written instead of the empty string it used to see.
        const rawKey = metadata.key || metadata.filename || "";
        let key: string;
        try {
            key = canonicalStorageKey(rawKey) || id;
        } catch (err) {
            throw new ApiError(
                400,
                "INVALID_STORAGE_KEY",
                err instanceof InvalidStorageKeyError ? err.message : "Invalid storage key"
            );
        }

        // The other two routing values, resolved here and stored on the upload
        // for the same reason the key is: `finalize` must not be able to reach
        // a destination the hook below was not asked about. The header wins
        // over the query string for `storageId` because the header is what
        // `finalize` has always used — now the hook is asked about it too.
        let bucket: string | undefined;
        try {
            bucket = canonicalStorageBucket(metadata.bucket);
        } catch (err) {
            throw new ApiError(
                400,
                "INVALID_STORAGE_BUCKET",
                err instanceof InvalidStorageBucketError ? err.message : "Invalid storage bucket"
            );
        }
        const storageId = metadata.storageId || c.req.query("storageId") || undefined;

        // Refuse an unknown source now, while the request is cheap. `finalize`
        // resolves the controller again and would refuse there too, but that is
        // after the client has uploaded every byte — and before this check the
        // resolution silently fell back to the default source, so the hook was
        // asked about one bucket and the object landed in another.
        if (storageId !== undefined && this.storageRegistry && !this.storageRegistry.has(canonicalStorageId(storageId))) {
            throw new ApiError(
                400,
                "UNKNOWN_STORAGE_SOURCE",
                `Unknown storage source "${storageId}". ` +
                `Available: ${this.storageRegistry.list().map((k) => `"${k}"`).join(", ") || "(none)"}.`,
                undefined,
                true
            );
        }

        // Gate before any temp file exists, so a denied upload leaves nothing
        // behind to resume.
        if (this.authorizeUpload) {
            await this.authorizeUpload(c, key, bucket || "default", storageId);
        }

        const filePath = join(this.tusDir, id);

        // Create empty temp file
        await writeFile(filePath, Buffer.alloc(0));

        const upload: TusUpload = {
            id,
            size: uploadLength,
            offset: 0,
            metadata,
            createdAt: Date.now(),
            filePath,
            bucket,
            storageId,
            key,
            completed: false
        };
        this.uploads.set(id, upload);

        // Build absolute Location
        const reqUrl = new URL(c.req.url);
        const location = `${reqUrl.origin}${reqUrl.pathname}/${id}`;

        return new Response(null, {
            status: 201,
            headers: {
                Location: location,
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": "0"
            }
        });
    }

    /** `HEAD /tus/:id` — Query upload progress. */
    head(c: Context, id: string): Response {
        const upload = this.uploads.get(id);
        if (!upload) {
            throw ApiError.notFound("Upload not found");
        }

        return new Response(null, {
            status: 200,
            headers: {
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": String(upload.offset),
                "Upload-Length": String(upload.size),
                "Cache-Control": "no-store"
            }
        });
    }

    /** `PATCH /tus/:id` — Append data to an upload. */
    async patch(c: Context, id: string): Promise<Response> {
        const upload = this.uploads.get(id);
        if (!upload) {
            throw ApiError.notFound("Upload not found");
        }
        if (upload.completed) {
            throw ApiError.badRequest("Upload already completed");
        }

        // Validate offset
        const offsetHeader = c.req.header("Upload-Offset");
        if (!offsetHeader) {
            throw ApiError.badRequest("Upload-Offset header is required");
        }
        const offset = parseInt(offsetHeader, 10);
        if (offset !== upload.offset) {
            throw ApiError.conflict("Offset mismatch");
        }

        // Validate content type
        const contentType = c.req.header("Content-Type");
        if (contentType !== "application/offset+octet-stream") {
            throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/offset+octet-stream");
        }

        // Read chunk and append to temp file
        const body = await c.req.arrayBuffer();
        const chunk = Buffer.from(body);

        // Prevent overrun
        if (upload.offset + chunk.length > upload.size) {
            throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Chunk exceeds declared Upload-Length");
        }

        const fh = await open(upload.filePath, "a");
        try {
            await fh.write(chunk);
        } finally {
            await fh.close();
        }
        upload.offset += chunk.length;

        // Finalize if complete
        if (upload.offset >= upload.size) {
            await this.finalize(upload);
        }

        return new Response(null, {
            status: 204,
            headers: {
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": String(upload.offset)
            }
        });
    }

    /** `DELETE /tus/:id` — Cancel and remove an upload. */
    async delete(c: Context, id: string): Promise<Response> {
        const upload = this.uploads.get(id);
        if (!upload) {
            throw ApiError.notFound("Upload not found");
        }

        try { await unlink(upload.filePath); } catch { /* ok */ }
        this.uploads.delete(id);

        return new Response(null, {
            status: 204,
            headers: { "Tus-Resumable": "1.0.0" }
        });
    }

    // -----------------------------------------------------------------------
    // Finalization
    // -----------------------------------------------------------------------

    /**
     * Move a fully-received upload into the storage controller.
     *
     * Everything here used to be best-effort: no controller warned and
     * returned, a failing `putObject` was caught and logged, and either way the
     * `PATCH` that carried the last chunk answered `204` with
     * `Upload-Offset: <size>` — which in TUS is the server saying "I have your
     * file". The object did not exist. For the one operation a user can spend
     * minutes on, the failure mode was silent data loss with a success code.
     *
     * `completed` is now set only once the bytes are stored, and that matters
     * twice over: a "completed" upload is refused a retry (`patch` answers
     * "Upload already completed") and is skipped by the stale sweeper, so
     * marking it up front both locked the client out of retrying and leaked the
     * temp file forever. Left false, a client that retries sends an empty chunk
     * at `offset === size`, which lands straight back here.
     */
    private async finalize(upload: TusUpload): Promise<void> {
        // Resolve the target controller from the storage source decided — and
        // authorized — in `create`. Reading `upload.metadata.storageId` here
        // instead is how the hook's answer and the write came apart.
        const storageId = upload.storageId;
        let targetController = this.storageController;
        if (this.storageRegistry) {
            try {
                targetController = storageId
                    ? this.storageRegistry.getOrDefault(storageId)
                    : this.storageRegistry.getDefault();
            } catch (err) {
                // `create` already refused an unknown source, so reaching this
                // means the registry changed under a resumable upload. Fall
                // into the "nothing to write to" branch below rather than
                // letting it surface as a 500 — and never into another bucket.
                if (!(err instanceof UnknownStorageSourceError)) throw err;
                targetController = undefined;
            }
        }

        if (!targetController) {
            logger.error(
                "[TUS] Upload received but no StorageController is configured — nothing can be written",
                { uploadId: upload.id, storageId }
            );
            throw new ApiError(
                503,
                "STORAGE_NOT_CONFIGURED",
                storageId
                    ? `Storage source "${storageId}" is not configured on this server, so the upload cannot be stored.`
                    : "No storage is configured on this server, so the upload cannot be stored."
            );
        }

        try {
            const { readFile } = await import("fs/promises");
            const data = await readFile(upload.filePath);
            // `upload.key` and nothing else. The fallback chain that used to
            // live here (`|| metadata.filename || id`) is what let the write
            // land somewhere the hook was never asked about; the destination is
            // decided in `create`, where it is authorized.
            const fileName = upload.key;
            const mimeType = upload.metadata.contentType || upload.metadata.filetype || "application/octet-stream";

            // `new Uint8Array(buffer)` rather than the Buffer directly: a Node
            // `Buffer` is typed `Buffer<ArrayBufferLike>`, and `ArrayBufferLike`
            // admits `SharedArrayBuffer`, which is not a `BlobPart`. This copies
            // into a plain ArrayBuffer, which is.
            const file = new File([new Uint8Array(data)], fileName, { type: mimeType });

            await targetController.putObject({
                file,
                key: fileName,
                bucket: upload.bucket
            });

            // Stored: only now is the upload complete, and only now is the temp
            // file redundant.
            upload.completed = true;

            // Clean up temp file
            try { await unlink(upload.filePath); } catch { /* ok */ }
            this.uploads.delete(upload.id);

            logger.info(`[TUS] Upload ${upload.id} finalized → ${fileName}`, storageId ? { storageId } : {});
        } catch (err) {
            logger.error(`[TUS] Failed to finalize upload ${upload.id}`, { error: err });
            // The bytes stay on disk and the upload stays incomplete, so a
            // retry can re-run this. Answering 204 here told the client its
            // file was safe when the store had refused it — a full bucket,
            // expired credentials and a deleted bucket all looked like success.
            if (err instanceof ApiError) throw err;
            throw new ApiError(
                502,
                "STORAGE_WRITE_FAILED",
                `Upload ${upload.id} was received but could not be stored: ` +
                (err instanceof Error ? err.message : String(err))
            );
        }
    }
}
