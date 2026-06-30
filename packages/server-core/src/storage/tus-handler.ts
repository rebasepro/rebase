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
import type { StorageRegistry } from "./storage-registry";
import { logger } from "../utils/logger.js";

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
    /** Target bucket (from metadata). */
    bucket?: string;
    /** Target key / filename (from metadata). */
    key?: string;
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
        private storageRegistry?: StorageRegistry
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
            return c.json({ error: "Upload-Length header is required" }, 400);
        }

        const uploadLength = parseInt(uploadLengthHeader, 10);
        if (Number.isNaN(uploadLength) || uploadLength <= 0) {
            return c.json({ error: "Invalid Upload-Length" }, 400);
        }
        if (uploadLength > MAX_UPLOAD_SIZE) {
            return c.json({ error: `Upload-Length exceeds maximum of ${MAX_UPLOAD_SIZE} bytes` }, 413);
        }

        const metadata = this.parseMetadata(c.req.header("Upload-Metadata") || "");
        const id = randomUUID();
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
            bucket: metadata.bucket || undefined,
            key: metadata.key || metadata.filename || undefined,
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
            return c.json({ error: "Upload not found" }, 404);
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
            return c.json({ error: "Upload not found" }, 404);
        }
        if (upload.completed) {
            return c.json({ error: "Upload already completed" }, 400);
        }

        // Validate offset
        const offsetHeader = c.req.header("Upload-Offset");
        if (!offsetHeader) {
            return c.json({ error: "Upload-Offset header is required" }, 400);
        }
        const offset = parseInt(offsetHeader, 10);
        if (offset !== upload.offset) {
            return c.json({ error: "Offset mismatch" }, 409);
        }

        // Validate content type
        const contentType = c.req.header("Content-Type");
        if (contentType !== "application/offset+octet-stream") {
            return c.json({ error: "Content-Type must be application/offset+octet-stream" }, 415);
        }

        // Read chunk and append to temp file
        const body = await c.req.arrayBuffer();
        const chunk = Buffer.from(body);

        // Prevent overrun
        if (upload.offset + chunk.length > upload.size) {
            return c.json({ error: "Chunk exceeds declared Upload-Length" }, 413);
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
            return c.json({ error: "Upload not found" }, 404);
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
     * Move a completed upload into the storage controller.
     */
    private async finalize(upload: TusUpload): Promise<void> {
        upload.completed = true;

        // Resolve the target controller: prefer storageId from TUS metadata,
        // then fall back to the registry default, then the single controller.
        const storageId = upload.metadata.storageId;
        let targetController = this.storageController;
        if (this.storageRegistry) {
            targetController = storageId
                ? this.storageRegistry.getOrDefault(storageId)
                : this.storageRegistry.getDefault();
        }

        if (!targetController) {
            // No controller — leave temp file in place
            logger.warn("[TUS] Upload completed but no StorageController configured. Temp file remains:", { filePath: upload.filePath });
            return;
        }

        try {
            const { readFile } = await import("fs/promises");
            const data = await readFile(upload.filePath);
            const fileName = upload.key || upload.metadata.filename || upload.id;
            const mimeType = upload.metadata.contentType || upload.metadata.filetype || "application/octet-stream";

            const file = new File([data], fileName, { type: mimeType });

            await targetController.putObject({
                file,
                key: fileName,
                bucket: upload.bucket
            });

            // Clean up temp file
            try { await unlink(upload.filePath); } catch { /* ok */ }
            this.uploads.delete(upload.id);

            logger.info(`[TUS] Upload ${upload.id} finalized → ${fileName}`, storageId ? { storageId } : {});
        } catch (err) {
            logger.error(`[TUS] Failed to finalize upload ${upload.id}`, { error: err });
        }
    }
}
