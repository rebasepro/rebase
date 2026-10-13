import type { UploadFileResult } from "@rebasepro/types";
import { RESUMABLE_UPLOAD_THRESHOLD } from "./resumable-upload-threshold";

/** One response, as the resumable upload reads it. */
export interface ResumableUploadResponse {
    status: number;
    header(name: string): string | null;
    /** The error a non-2xx response stands for, as the transport reports it. */
    error?: Error;
}

/**
 * Send one TUS request. `path` is `""` for the creation request and
 * `/<upload id>` after it, relative to the source's `…/storage/tus` endpoint.
 * Answers every HTTP status; throws only when no response arrived.
 */
export type ResumableUploadSend = (
    method: "POST" | "PATCH" | "HEAD" | "DELETE",
    path: string,
    headers: Record<string, string>,
    body?: Blob
) => Promise<ResumableUploadResponse>;

export interface ResumableUploadOptions {
    file: Blob;
    /** `Upload-Metadata` entries: `key`, `filename`, `filetype`, `bucket`, `storageId`, `collection`, `property`, `metadata_<name>`. */
    metadata: Record<string, string>;
    send: ResumableUploadSend;
    /** Bytes per `PATCH`. Default {@link RESUMABLE_UPLOAD_THRESHOLD}. */
    chunkSize?: number;
    /** How long to wait before each retry of a chunk; its length is the number of retries. */
    retryDelaysMs?: readonly number[];
}

/**
 * What a resumable upload came to: the stored object, or — for a reason the
 * multipart route does not share — nothing, and the caller sends the file
 * through `POST /storage/upload` instead.
 */
export type ResumableUploadOutcome =
    | { stored: UploadFileResult }
    | { unavailable: string };

/** What `create` answers in `Rebase-Upload-Result` when the last `PATCH` will carry the stored object there. */
const RESULT_ON_COMPLETE = "on-complete";
const DEFAULT_RETRY_DELAYS_MS = [250, 1_000, 3_000];

/** `value` as UTF-8, base64-encoded — what `Upload-Metadata` carries. */
function base64Utf8(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

/** Worth asking for the offset and sending again: an offset conflict, a lock, a rate limit, a server fault. */
const isRetryable = (status: number) => status === 409 || status === 423 || status === 429 || status >= 500;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** The stored object a finished upload reports, or `null` when the header says nothing readable. */
function storedObjectOf(header: string | null): UploadFileResult | null {
    if (!header) return null;
    let value: unknown;
    try {
        value = JSON.parse(decodeURIComponent(header));
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const key = "key" in value ? value.key : undefined;
    const bucket = "bucket" in value ? value.bucket : undefined;
    const storageUrl = "storageUrl" in value ? value.storageUrl : undefined;
    if (typeof key !== "string" || typeof bucket !== "string" || typeof storageUrl !== "string") return null;
    return { key, bucket, storageUrl };
}

/**
 * Upload `file` through a Rebase server's TUS endpoint, one chunk at a time.
 *
 * The server holds every upload to what `POST /storage/upload` holds a file
 * to — the source's and the property's limits, the authorize hook, the bucket
 * — and stores it with the same key, type and custom metadata, and fires the
 * same triggers. So a refusal is thrown as the multipart route would have
 * thrown it. A chunk that fails on the way — a dropped connection, a 5xx, a
 * conflict over the offset — is retried from the offset the server reports.
 *
 * Answers `unavailable` when the resumable path cannot carry this file and
 * the multipart one can: a server without the endpoint (or one too old to
 * report the stored object), an upload another instance cannot see (several
 * instances, no shared volume, no sticky sessions), or a chunk over the
 * server's body limit.
 */
export async function uploadResumable(options: ResumableUploadOptions): Promise<ResumableUploadOutcome> {
    const { file, send } = options;
    const chunkSize = Math.max(1, options.chunkSize ?? RESUMABLE_UPLOAD_THRESHOLD);
    const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const tus = { "Tus-Resumable": "1.0.0" };

    const created = await send("POST", "", {
        ...tus,
        "Upload-Length": String(file.size),
        "Upload-Metadata": Object.entries(options.metadata)
            .map(([name, value]) => `${name} ${base64Utf8(value)}`)
            .join(",")
    });
    if (created.status === 404 || created.status === 405 || created.status === 501) {
        return { unavailable: `the server has no resumable upload endpoint (${created.status})` };
    }
    if (created.status < 200 || created.status >= 300) {
        throw created.error ?? new Error(`The upload was refused (${created.status}).`);
    }
    const id = created.header("Location")?.split("?")[0].split("/").filter(Boolean).pop();
    if (!id) return { unavailable: "the server did not say where the upload lives" };
    const path = `/${encodeURIComponent(id)}`;
    if (created.header("Rebase-Upload-Result") !== RESULT_ON_COMPLETE) {
        await send("DELETE", path, tus).catch(() => undefined);
        return { unavailable: "the server does not report the object a resumable upload stores" };
    }

    let offset = 0;
    let lastFailure: Error | undefined;
    for (let attempt = 0; ;) {
        const end = Math.min(file.size, offset + chunkSize);
        let response: ResumableUploadResponse | undefined;
        try {
            response = await send("PATCH", path, {
                ...tus,
                "Upload-Offset": String(offset),
                "Content-Type": "application/offset+octet-stream"
            }, file.slice(offset, end));
        } catch (error: unknown) {
            // No response: the connection dropped. Ask where the upload got to.
            lastFailure = error instanceof Error ? error : new Error(String(error));
        }

        if (response && response.status >= 200 && response.status < 300) {
            attempt = 0;
            const reported = Number(response.header("Upload-Offset"));
            offset = Number.isFinite(reported) && reported > offset ? reported : end;
            if (offset < file.size) continue;
            const stored = storedObjectOf(response.header("Rebase-Upload-Result"));
            if (!stored) throw new Error("The upload finished, but the server did not say where it stored it.");
            return { stored };
        }
        if (response?.status === 404) {
            return { unavailable: "the server no longer knows this upload — another instance may have answered" };
        }
        if (response?.status === 413) {
            await send("DELETE", path, tus).catch(() => undefined);
            return { unavailable: "a chunk is over the server's request body limit" };
        }
        if (response && !isRetryable(response.status)) {
            await send("DELETE", path, tus).catch(() => undefined);
            throw response.error ?? new Error(`The upload was refused (${response.status}).`);
        }
        if (response) lastFailure = response.error ?? new Error(`The upload failed (${response.status}).`);

        if (attempt >= retryDelays.length) throw lastFailure ?? new Error("The upload failed.");
        await sleep(retryDelays[attempt++]);
        // Resume from what the server holds, which may be more than was
        // acknowledged (the chunk arrived, its answer did not) or less.
        try {
            const progress = await send("HEAD", path, tus);
            if (progress.status === 404) {
                return { unavailable: "the server no longer knows this upload — another instance may have answered" };
            }
            const held = Number(progress.header("Upload-Offset"));
            if (progress.status >= 200 && progress.status < 300 && Number.isFinite(held)) offset = held;
        } catch {
            // Still no connection: the next attempt asks again.
        }
    }
}
