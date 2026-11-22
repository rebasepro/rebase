/**
 * Platform-managed storage: files in a prefix the hosting platform owns, moved
 * directly between this process and the object store over short-lived
 * presigned URLs that the platform's storage broker signs.
 *
 * The process holds NO object-store credential. It holds its own service key
 * (`REBASE_SERVICE_KEY`), which the broker accepts for this project only, and
 * asks the broker to sign each request: a GET for this key, a PUT of exactly
 * this many bytes, a list of this folder. The broker prepends the project's
 * prefix and refuses anything that could reach outside it, so nothing this
 * process — or code running in it — does can address another project's files.
 * The bytes never pass through the broker.
 *
 * Selected with `STORAGE_TYPE=platform` (per source, like every other type) and
 * configured by `STORAGE_BROKER_URL` and `STORAGE_BROKER_PROJECT`, which the
 * platform sets. Outside a platform that runs a broker there is nothing to
 * point this at.
 *
 * ## Staying up when the broker is not
 *
 * Read URLs live an hour, and are cached here until five minutes before they
 * expire, so a file read once keeps being served through a broker outage of up
 * to that long. Writes always need the broker, which must count them against
 * the project's quota before it signs.
 *
 * ## References
 *
 * An upload's `storageUrl` is `s3://default/<key>`: the scheme every client
 * already parses (it drops the bucket and keeps the key). Any `s3://` or
 * `gs://` reference is read the same way — bucket dropped, key kept — so
 * references written while the project's files were in its own bucket keep
 * working after they are copied, key for key, into its prefix.
 */

import {
    DEFAULT_MAX_FILE_SIZE,
    type PlatformStorageConfig,
    type PutObjectOptions,
    type PutObjectStreamProps,
    type PutObjectStreamResult,
    type StorageController,
    type StoredObjectInfo,
    type StoredObjectRange,
    type StoredObjectStream
} from "./types";
import { folderKey, listingPrefix } from "./keys";
import { meteredChunks } from "./streams";
import { ApiError } from "../api/errors";
import { validateUploadedFile } from "./upload-validation";
import type {
    DownloadConfig,
    DownloadMetadata,
    StorageListResult,
    StorageReference,
    UploadFileProps,
    UploadFileResult
} from "@rebasepro/types";

/** Files up to this size are one PUT; larger ones go in parts of (at least) this size. */
export const PLATFORM_PART_SIZE = 8 * 1024 * 1024;
const MAX_PARTS = 10_000;
/** A cached URL is not handed out within this long of its expiry. */
const CACHE_MARGIN_MS = 5 * 60_000;
const MAX_CACHED_URLS = 10_000;

/** One operation the broker signs. The shapes `storage-broker/broker.ts` accepts. */
export type BrokerOp =
    | { op: "get" | "head" | "delete"; key: string }
    | { op: "put"; key: string; contentLength: number; contentType: string; metadata?: Record<string, string> }
    | { op: "list"; prefix?: string; delimiter?: "/"; maxKeys?: number; continuationToken?: string }
    | { op: "multipart-create"; key: string; contentType: string; metadata?: Record<string, string> }
    | { op: "multipart-part"; key: string; uploadId: string; partNumber: number; contentLength: number }
    | { op: "multipart-complete" | "multipart-abort"; key: string; uploadId: string };

export interface SignedRequest {
    method: string;
    url: string;
    headers: Record<string, string>;
    /** Seconds the URL is good for, from when the broker answered. */
    expiresIn: number;
    /** For a list: the prefix to strip from every key. */
    prefix?: string;
}

export interface PlatformStorageDeps {
    fetch?: typeof fetch;
    now?: () => number;
    /** Waits between retries; injectable so tests do not sleep. */
    sleep?: (ms: number) => Promise<void>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A broker refusal for one operation, as the caller of a controller method sees it. */
function refusalError(code: string, message: string): ApiError {
    switch (code) {
        case "invalid_key":
            return new ApiError(400, "INVALID_STORAGE_KEY", `This storage key is not allowed: ${message}.`, undefined, true);
        case "quota_exceeded":
            return new ApiError(413, "STORAGE_QUOTA_EXCEEDED", `This project's storage is full: ${message}.`);
        case "ledger_unavailable":
            return new ApiError(503, "STORAGE_UNAVAILABLE", `Uploads are paused for a moment: ${message}. Try again shortly.`);
        default:
            return new ApiError(502, "STORAGE_BROKER_REFUSED", `Platform storage refused the request (${code}): ${message}.`);
    }
}

function unavailable(detail: string): ApiError {
    return new ApiError(503, "STORAGE_UNAVAILABLE", `Platform storage is unavailable right now (${detail}). Try again shortly.`);
}

/** Text of one element in an S3 XML document. */
function xmlText(xml: string, tag: string): string | undefined {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
    return m ? xmlDecode(m[1]) : undefined;
}

function xmlDecode(text: string): string {
    return text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&amp;/g, "&");
}

function xmlEscape(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A part as a request body, without copying it when it already sits on an ArrayBuffer. */
function bodyOf(buffer: Buffer): Uint8Array<ArrayBuffer> {
    return buffer.buffer instanceof ArrayBuffer
        ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        : new Uint8Array(buffer);
}

/** A metadata value as a header can carry it: printable ASCII as is, anything else percent-encoded. */
function headerSafe(value: string): string {
    return /^[\x20-\x7e]*$/.test(value) ? value : encodeURIComponent(value);
}

export class PlatformStorageController implements StorageController {
    private readonly config: PlatformStorageConfig;
    private readonly fetchImpl: typeof fetch;
    private readonly now: () => number;
    private readonly sleep: (ms: number) => Promise<void>;
    /** `op\0key` → a signed GET/HEAD and when it stops being handed out. */
    private readonly urlCache = new Map<string, { signed: SignedRequest; usableUntil: number }>();

    constructor(config: PlatformStorageConfig, deps: PlatformStorageDeps = {}) {
        this.config = config;
        this.fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init));
        this.now = deps.now ?? Date.now;
        this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    }

    getType(): "platform" {
        return "platform";
    }

    /** One logical bucket: the source itself. The broker decides where it physically is. */
    knownBuckets(): string[] {
        return ["default"];
    }

    /** See {@link StorageController.storageLocation}. */
    storageLocation(): string {
        return `platform:${this.config.brokerUrl.replace(/\/+$/, "").toLowerCase()}/${this.config.projectId}/${this.config.source}`;
    }

    maxFileSize(): number {
        return this.config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
    }

    // ── The broker ───────────────────────────────────────────────────────

    /**
     * Sign a batch. One result per op; a per-op refusal is thrown as the
     * error that op's caller should see. Retries once on 429/503 and on a
     * network error, honouring a short `Retry-After`.
     */
    async sign(ops: BrokerOp[]): Promise<SignedRequest[]> {
        const url = `${this.config.brokerUrl.replace(/\/+$/, "")}/api/storage-broker/v1/${encodeURIComponent(this.config.projectId)}/sign`;
        const body = JSON.stringify({ source: this.config.source,
ops });
        let response: Response | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                response = await this.fetchImpl(url, {
                    method: "POST",
                    headers: { "content-type": "application/json",
authorization: `Bearer ${this.config.serviceKey}` },
                    body
                });
            } catch (error) {
                if (attempt === 1) throw unavailable(`the broker could not be reached: ${error instanceof Error ? error.message : String(error)}`);
                await this.sleep(500);
                continue;
            }
            if ((response.status === 429 || response.status === 503) && attempt === 0) {
                const retryAfter = Number(response.headers.get("retry-after"));
                await response.body?.cancel();
                await this.sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500, 2000));
                continue;
            }
            break;
        }
        if (!response) throw unavailable("no answer from the broker");
        if (response.status === 401) {
            throw new ApiError(502, "STORAGE_MISCONFIGURED", "Platform storage refused this deployment's service key. Redeploy the project so it runs with its current key.");
        }
        if (response.status === 404) {
            throw new ApiError(501, "STORAGE_NOT_CONFIGURED", `No platform storage is attached for the storage source "${this.config.source}".`);
        }
        if (response.status === 429) throw new ApiError(429, "STORAGE_RATE_LIMITED", "Too many storage requests from this project; slow down.");
        if (!response.ok) throw unavailable(`the broker answered ${response.status}`);

        const parsed: unknown = await response.json();
        const results = isRecord(parsed) && Array.isArray(parsed.results) ? parsed.results : undefined;
        if (!results || results.length !== ops.length) throw unavailable("the broker's answer could not be read");
        return results.map((r: unknown) => {
            if (!isRecord(r)) throw unavailable("the broker's answer could not be read");
            if (r.ok !== true) throw refusalError(String(r.code ?? "unknown"), String(r.message ?? ""));
            if (typeof r.url !== "string" || typeof r.method !== "string" || !isRecord(r.headers) || typeof r.expiresIn !== "number") {
                throw unavailable("the broker's answer could not be read");
            }
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(r.headers)) if (typeof v === "string") headers[k] = v;
            return { method: r.method,
url: r.url,
headers,
expiresIn: r.expiresIn,
...(typeof r.prefix === "string" ? { prefix: r.prefix } : {}) };
        });
    }

    private async signOne(op: BrokerOp): Promise<SignedRequest> {
        const [signed] = await this.sign([op]);
        return signed;
    }

    /** A read URL from the cache, or a fresh one (which is then cached). */
    private async readUrl(op: "get" | "head", key: string, fresh = false): Promise<SignedRequest> {
        const id = `${op}\u0000${key}`;
        const cached = this.urlCache.get(id);
        if (!fresh && cached && cached.usableUntil > this.now()) return cached.signed;
        const signed = await this.signOne({ op,
key });
        this.remember(id, signed);
        return signed;
    }

    private remember(id: string, signed: SignedRequest): void {
        const usableUntil = this.now() + signed.expiresIn * 1000 - CACHE_MARGIN_MS;
        if (usableUntil <= this.now()) return;
        if (this.urlCache.size >= MAX_CACHED_URLS) {
            const oldest = this.urlCache.keys().next().value;
            if (oldest !== undefined) this.urlCache.delete(oldest);
        }
        this.urlCache.delete(id);
        this.urlCache.set(id, { signed,
usableUntil });
    }

    /**
     * Send a signed request. A 403 on a cached read URL — expired by the
     * store's clock, or revoked by a key rotation — re-signs once.
     */
    private async send(signed: SignedRequest, init: { body?: BodyInit; headers?: Record<string, string> } = {}): Promise<Response> {
        try {
            return await this.fetchImpl(signed.url, {
                method: signed.method,
                headers: { ...signed.headers,
...(init.headers ?? {}) },
                ...(init.body !== undefined ? { body: init.body } : {})
            });
        } catch (error) {
            throw unavailable(`the object store could not be reached: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async sendRead(op: "get" | "head", key: string, headers: Record<string, string> = {}): Promise<Response> {
        let response = await this.send(await this.readUrl(op, key), { headers });
        if (response.status === 403) {
            await response.body?.cancel();
            response = await this.send(await this.readUrl(op, key, true), { headers });
        }
        return response;
    }

    /** The key a call addresses: an `s3://` or `gs://` reference names its key after the bucket. */
    private keyOf(keyOrUrl: string): string {
        const scheme = /^(s3|gs):\/\//.exec(keyOrUrl);
        if (!scheme) return keyOrUrl;
        const rest = keyOrUrl.substring(scheme[0].length);
        const slash = rest.indexOf("/");
        return slash > 0 ? rest.substring(slash + 1) : rest;
    }

    private async storeFailure(response: Response, what: string): Promise<ApiError> {
        let detail = "";
        try {
            detail = xmlText(await response.text(), "Code") ?? "";
        } catch {
            // The status is the finding.
        }
        if (response.status === 503 || detail === "SlowDown") return unavailable(`the object store is busy (${what})`);
        return new ApiError(502, "STORAGE_PROVIDER_ERROR", `The object store refused ${what}: HTTP ${response.status}${detail ? ` ${detail}` : ""}.`, { status: response.status,
reason: detail || undefined });
    }

    // ── StorageController ────────────────────────────────────────────────

    async putObject({ file, key, metadata }: UploadFileProps, options?: PutObjectOptions): Promise<UploadFileResult> {
        if (options?.uploadLimits !== false) validateUploadedFile(file, this.maxFileSize(), this.config.allowedMimeTypes);
        const contentType = file.type || "application/octet-stream";
        const flat = metadata ? this.flattenMetadata(metadata) : undefined;
        if (file.size <= PLATFORM_PART_SIZE) {
            const signed = await this.signOne({ op: "put",
key,
contentLength: file.size,
contentType,
...(flat ? { metadata: flat } : {}) });
            const response = await this.send(signed, { body: new Uint8Array(await file.arrayBuffer()) });
            if (!response.ok) throw await this.storeFailure(response, `the upload of ${key}`);
            await response.body?.cancel();
        } else {
            await this.putMultipart(key, contentType, flat, fileParts(file));
        }
        return { key,
bucket: "default",
storageUrl: `s3://default/${key}` };
    }

    /**
     * A stream of unknown length: read up to one part; if the stream ends
     * there, it is one PUT of exactly that many bytes (the broker signs the
     * length, so it must be known); otherwise it is a multipart upload. Past
     * `maxBytes` the metered stream throws and the upload is aborted.
     */
    async putObjectStream({ stream, key, contentType, maxBytes }: PutObjectStreamProps): Promise<PutObjectStreamResult> {
        const metered = meteredChunks(stream, maxBytes);
        const type = contentType ?? "application/octet-stream";
        const parts = streamParts(metered.chunks);
        const first = await parts.next();
        const second = first.done ? first : await parts.next();
        if (second.done) {
            const body = first.done ? Buffer.alloc(0) : first.value;
            const signed = await this.signOne({ op: "put",
key,
contentLength: body.byteLength,
contentType: type });
            const response = await this.send(signed, { body: bodyOf(body) });
            if (!response.ok) throw await this.storeFailure(response, `the upload of ${key}`);
            await response.body?.cancel();
        } else {
            const head = first.done ? [] : [first.value];
            async function* all(): AsyncGenerator<Buffer> {
                yield* head;
                yield second.value;
                yield* parts;
            }
            await this.putMultipart(key, type, undefined, all());
        }
        return { key,
bucket: "default",
storageUrl: `s3://default/${key}`,
size: metered.size() };
    }

    /**
     * A large object in parts, one part in memory at a time. Parts are signed
     * in batches as they are reached, so an upload that takes longer than a
     * part URL lives never holds an expired one; a part refused with 403 is
     * re-signed and sent once more. Any failure aborts the upload, so no
     * partial object appears and no orphaned parts are billed.
     */
    private async putMultipart(key: string, contentType: string, metadata: Record<string, string> | undefined, parts: AsyncIterable<Buffer>): Promise<void> {
        const create = await this.signOne({ op: "multipart-create",
key,
contentType,
...(metadata ? { metadata } : {}) });
        const created = await this.send(create);
        if (!created.ok) throw await this.storeFailure(created, `starting the upload of ${key}`);
        const uploadId = xmlText(await created.text(), "UploadId");
        if (!uploadId) throw new ApiError(502, "STORAGE_PROVIDER_ERROR", `The object store did not start an upload for ${key}.`);

        const done: { partNumber: number; etag: string }[] = [];
        try {
            let partNumber = 1;
            for await (const body of parts) {
                if (partNumber > MAX_PARTS) throw new ApiError(413, "STORAGE_OBJECT_TOO_LARGE", `${key} needs more than ${MAX_PARTS} parts.`);
                const sign = () => this.signOne({ op: "multipart-part",
key,
uploadId,
partNumber,
contentLength: body.byteLength });
                let response = await this.send(await sign(), { body: bodyOf(body) });
                if (response.status === 403) {
                    await response.body?.cancel();
                    response = await this.send(await sign(), { body: bodyOf(body) });
                }
                if (!response.ok) throw await this.storeFailure(response, `part ${partNumber} of ${key}`);
                const etag = response.headers.get("etag");
                await response.body?.cancel();
                if (!etag) throw new ApiError(502, "STORAGE_PROVIDER_ERROR", `The object store returned no ETag for part ${partNumber} of ${key}.`);
                done.push({ partNumber,
etag });
                partNumber++;
            }
            const complete = await this.signOne({ op: "multipart-complete",
key,
uploadId });
            const xml = `<CompleteMultipartUpload>${done.map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
            const response = await this.send(complete, { body: xml,
headers: { "content-type": "application/xml" } });
            const text = await response.text();
            // S3 can answer 200 with an <Error> body when completion fails late.
            if (!response.ok || /<Error>/.test(text)) {
                throw new ApiError(502, "STORAGE_PROVIDER_ERROR", `The object store did not complete the upload of ${key}: ${xmlText(text, "Code") ?? `HTTP ${response.status}`}.`);
            }
        } catch (error) {
            try {
                const abort = await this.signOne({ op: "multipart-abort",
key,
uploadId });
                const aborted = await this.send(abort);
                await aborted.body?.cancel();
            } catch {
                // The lifecycle rule aborts what this could not (docs/storage-broker.md).
            }
            throw error;
        }
    }

    private flattenMetadata(metadata: Record<string, unknown>): Record<string, string> {
        const flattened: Record<string, string> = {};
        for (const [name, value] of Object.entries(metadata)) {
            const header = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "").slice(0, 64);
            if (!header || value === undefined || value === null) continue;
            flattened[header] = headerSafe(typeof value === "string" ? value : JSON.stringify(value));
        }
        return flattened;
    }

    async getSignedUrl(keyOrUrl: string): Promise<DownloadConfig> {
        const key = this.keyOf(keyOrUrl);
        const metadata = await this.getMetadata(key);
        if (!metadata) return { url: null,
fileNotFound: true };
        const signed = await this.readUrl("get", key);
        return { url: signed.url,
metadata };
    }

    async getMetadata(keyOrUrl: string): Promise<DownloadMetadata | null> {
        const key = this.keyOf(keyOrUrl);
        const response = await this.sendRead("head", key);
        if (response.status === 404) return null;
        if (!response.ok) throw await this.storeFailure(response, `reading ${key}`);
        const customMetadata: Record<string, string> = {};
        response.headers.forEach((value, name) => {
            if (name.startsWith("x-amz-meta-")) customMetadata[name.slice("x-amz-meta-".length)] = value;
        });
        return {
            bucket: "default",
            fullPath: key,
            name: key.split("/").pop() || key,
            size: Number(response.headers.get("content-length") ?? 0),
            contentType: response.headers.get("content-type") || "application/octet-stream",
            customMetadata
        };
    }

    async statObject(keyOrUrl: string): Promise<StoredObjectInfo | null> {
        const key = this.keyOf(keyOrUrl);
        const response = await this.sendRead("head", key);
        if (response.status === 404) return null;
        if (!response.ok) throw await this.storeFailure(response, `reading ${key}`);
        const modified = Date.parse(response.headers.get("last-modified") ?? "");
        return {
            size: Number(response.headers.get("content-length") ?? 0),
            contentType: response.headers.get("content-type") || "application/octet-stream",
            lastModified: Number.isFinite(modified) ? modified : this.now()
        };
    }

    async getObject(keyOrUrl: string): Promise<File | null> {
        const key = this.keyOf(keyOrUrl);
        const response = await this.sendRead("get", key);
        if (response.status === 404) return null;
        if (!response.ok) throw await this.storeFailure(response, `reading ${key}`);
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const modified = Date.parse(response.headers.get("last-modified") ?? "");
        return new File([await response.arrayBuffer()], key.split("/").pop() || key, {
            type: contentType,
            ...(Number.isFinite(modified) ? { lastModified: modified } : {})
        });
    }

    async getObjectStream(keyOrUrl: string, options?: { range?: StoredObjectRange }): Promise<StoredObjectStream | null> {
        const key = this.keyOf(keyOrUrl);
        const range = options?.range;
        const response = await this.sendRead("get", key, range ? { range: `bytes=${range.start}-${range.end}` } : {});
        if (response.status === 404) return null;
        if (range && response.status === 416) {
            await response.body?.cancel();
            return this.getObjectStream(key);
        }
        if (!response.ok || !response.body) throw await this.storeFailure(response, `reading ${key}`);
        const total = range && response.status === 206 ? /\/(\d+)\s*$/.exec(response.headers.get("content-range") ?? "")?.[1] : undefined;
        const modified = Date.parse(response.headers.get("last-modified") ?? "");
        return {
            stream: response.body,
            size: total !== undefined ? Number(total) : Number(response.headers.get("content-length") ?? 0),
            contentType: response.headers.get("content-type") || "application/octet-stream",
            lastModified: Number.isFinite(modified) ? modified : this.now(),
            ...(range && total !== undefined ? { range } : {})
        };
    }

    async deleteObject(keyOrUrl: string): Promise<void> {
        const key = this.keyOf(keyOrUrl);
        const response = await this.send(await this.signOne({ op: "delete",
key }));
        await response.body?.cancel();
        // Deleting what is already gone is the outcome the caller wanted.
        if (!response.ok && response.status !== 404) throw await this.storeFailure(response, `deleting ${key}`);
    }

    async listObjects(prefix: string, options?: { maxResults?: number; pageToken?: string }): Promise<StorageListResult> {
        const folderPrefix = listingPrefix(prefix);
        const signed = await this.signOne({
            op: "list",
            prefix: folderPrefix ?? "",
            delimiter: "/",
            maxKeys: Math.min(Math.max(1, options?.maxResults ?? 1000), 1000),
            ...(options?.pageToken ? { continuationToken: options.pageToken } : {})
        });
        const response = await this.send(signed);
        if (!response.ok) throw await this.storeFailure(response, `listing ${prefix || "/"}`);
        const xml = await response.text();
        const strip = signed.prefix ?? "";
        const relative = (absolute: string): string | undefined => (absolute.startsWith(strip) ? absolute.slice(strip.length) : undefined);

        const items: StorageReference[] = [];
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
            const key = relative(xmlText(m[1], "Key") ?? "");
            // Outside the prefix (the broker would never sign such a list), or
            // the folder's own marker, which is how the folder exists.
            if (key === undefined || key === "" || key === folderPrefix) continue;
            const size = Number(xmlText(m[1], "Size"));
            const updated = xmlText(m[1], "LastModified");
            items.push({
                bucket: "default",
                fullPath: key,
                name: key.split("/").pop() || "",
                ...(Number.isFinite(size) ? { size } : {}),
                ...(updated ? { updated: new Date(updated).toISOString() } : {}),
                parent: null,
                root: null,
                toString: () => `s3://default/${key}`
            });
        }
        const prefixes: StorageReference[] = [];
        for (const m of xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)) {
            const common = relative(xmlText(m[1], "Prefix") ?? "");
            if (common === undefined) continue;
            const folder = folderKey(common);
            if (!folder) continue;
            prefixes.push({
                bucket: "default",
                fullPath: folder,
                name: folder.split("/").pop() || "",
                parent: null,
                root: null,
                toString: () => `s3://default/${folder}`
            });
        }
        const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
        const next = truncated ? xmlText(xml, "NextContinuationToken") : undefined;
        return { items,
prefixes,
nextPageToken: next };
    }
}

/** A file as parts. A slice reads only its range, from disk for a disk-backed file. */
async function* fileParts(file: Blob): AsyncGenerator<Buffer> {
    const partSize = Math.max(PLATFORM_PART_SIZE, Math.ceil(file.size / MAX_PARTS));
    for (let offset = 0; offset < file.size; offset += partSize) {
        yield Buffer.from(await file.slice(offset, Math.min(offset + partSize, file.size)).arrayBuffer());
    }
}

/** A stream as parts of one size, holding at most one part. An empty stream is one empty part. */
async function* streamParts(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
    let held: Uint8Array[] = [];
    let bytes = 0;
    let yielded = false;
    for await (const chunk of chunks) {
        held.push(chunk);
        bytes += chunk.byteLength;
        while (bytes >= PLATFORM_PART_SIZE) {
            const joined = Buffer.concat(held, bytes);
            yield joined.subarray(0, PLATFORM_PART_SIZE);
            yielded = true;
            held = [joined.subarray(PLATFORM_PART_SIZE)];
            bytes -= PLATFORM_PART_SIZE;
        }
    }
    if (bytes > 0 || !yielded) yield Buffer.concat(held, bytes);
}
