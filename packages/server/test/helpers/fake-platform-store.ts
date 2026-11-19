/**
 * A platform storage broker and the object store behind it, in-process, as one
 * `fetch`: what `PlatformStorageController` talks to in production, with the
 * semantics its promises rest on.
 *
 * The broker half answers `POST …/api/storage-broker/v1/<project>/sign` the way
 * the real one does (one result per op; a refusal per op; 401/404/429/503 for
 * the whole batch) and prepends the project's prefix. The store half serves
 * the URLs it signed — and only those: a URL carries its operation, its expiry
 * and, for a write, its length, and the store refuses a request whose method,
 * length or deadline does not match, the way SigV4 would.
 */

export const PLATFORM_BROKER = "http://broker.test";
export const PLATFORM_PROJECT = "11111111-2222-4333-8444-555555555555";
export const PLATFORM_KEY = "rsk_test_service_key";
const STORE = "https://store.test";

interface StoredObject { body: Buffer; type: string; meta: Record<string, string>; modified: number }
interface Upload { key: string; type: string; meta: Record<string, string>; parts: Map<number, Buffer> }

const METHODS: Record<string, string> = {
    get: "GET",
head: "HEAD",
put: "PUT",
delete: "DELETE",
list: "GET",
    "multipart-create": "POST",
"multipart-part": "PUT",
"multipart-complete": "POST",
"multipart-abort": "DELETE"
};
const LIFETIME: Record<string, number> = { get: 3600,
head: 300,
list: 300,
put: 900,
delete: 300,
"multipart-create": 900,
"multipart-part": 3600,
"multipart-complete": 900,
"multipart-abort": 900 };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const encodePath = (key: string) => key.split("/").map(encodeURIComponent).join("/");

export interface PlatformWorld {
    fetch: typeof fetch;
    objects: Map<string, StoredObject>;
    uploads: Map<string, Upload>;
    prefix: string;
    /** Broker requests seen, in order: each is the list of op names in one batch. */
    brokerCalls: string[][];
    storeCalls: string[];
    /** Milliseconds; the store's clock and the broker's. */
    now: () => number;
    advance(ms: number): void;
    brokerDown: boolean;
    /** Answer the next broker request with this status instead. */
    brokerStatus: number[];
    /** Refuse every op of this name with this code. */
    refuse: Map<string, string>;
    /** Fail the store's next answers to this op with this status. */
    storeFailures: Map<string, number[]>;
    /** Signatures issued before this instant no longer verify (a key rotation). */
    revokedBefore: number;
    reset(): void;
}

export function createPlatformWorld(): PlatformWorld {
    // The real clock, plus whatever a test has moved it on by.
    let offset = 0;
    const current = () => Date.now() + offset;
    let uploadCounter = 0;
    const world: PlatformWorld = {
        fetch: async (input, init) => handle(String(input instanceof Request ? input.url : input), init ?? {}),
        objects: new Map(),
        uploads: new Map(),
        prefix: `p/${PLATFORM_PROJECT}/_/`,
        brokerCalls: [],
        storeCalls: [],
        now: current,
        advance: (ms) => { offset += ms; },
        brokerDown: false,
        brokerStatus: [],
        refuse: new Map(),
        storeFailures: new Map(),
        revokedBefore: 0,
        reset() {
            this.objects.clear(); this.uploads.clear(); this.brokerCalls = []; this.storeCalls = [];
            this.brokerDown = false; this.brokerStatus = []; this.refuse.clear(); this.storeFailures.clear(); this.revokedBefore = 0;
        }
    };

    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify(body), { status,
headers: { "content-type": "application/json",
...headers } });

    function sign(op: Record<string, unknown>): Record<string, unknown> {
        const name = String(op.op);
        const refusal = world.refuse.get(name);
        if (refusal) return { ok: false,
op: name,
code: refusal,
message: `refused by the test (${refusal})` };
        const key = typeof op.key === "string" ? op.key : "";
        if (key.split("/").some((s) => s === ".." || s === ".")) return { ok: false,
op: name,
code: "invalid_key",
message: "a key has no . or .. segments" };
        const q = new URLSearchParams({ "x-op": name,
"x-signed": String(current()),
"x-exp": String(current() + LIFETIME[name] * 1000) });
        const headers: Record<string, string> = {};
        let path = `/${encodePath(world.prefix + key)}`;
        if (name === "put" || name === "multipart-part") {
            q.set("x-len", String(op.contentLength));
            headers["content-length"] = String(op.contentLength);
        }
        if (name === "put" || name === "multipart-create") {
            headers["content-type"] = String(op.contentType ?? "application/octet-stream");
            if (isRecord(op.metadata)) for (const [k, v] of Object.entries(op.metadata)) headers[`x-amz-meta-${k}`] = String(v);
        }
        if (name.startsWith("multipart-") && name !== "multipart-create") q.set("uploadId", String(op.uploadId));
        if (name === "multipart-part") q.set("partNumber", String(op.partNumber));
        if (name === "list") {
            path = "/";
            q.set("prefix", world.prefix + String(op.prefix ?? ""));
            if (op.delimiter) q.set("delimiter", String(op.delimiter));
            q.set("max-keys", String(op.maxKeys ?? 1000));
            if (op.continuationToken) q.set("continuation-token", String(op.continuationToken));
        }
        return {
            ok: true,
op: name,
method: METHODS[name],
url: `${STORE}${path}?${q}`,
headers,
            expiresIn: LIFETIME[name],
expiresAt: new Date(current() + LIFETIME[name] * 1000).toISOString(),
            ...(name === "list" ? { prefix: world.prefix } : {})
        };
    }

    async function handle(url: string, init: RequestInit): Promise<Response> {
        if (url.startsWith(PLATFORM_BROKER)) {
            if (world.brokerDown) throw new TypeError("fetch failed: connect ECONNREFUSED");
            const forced = world.brokerStatus.shift();
            if (forced) return json(forced, { code: "forced" }, forced === 429 ? { "retry-after": "1" } : {});
            const headers = new Headers(init.headers);
            if (headers.get("authorization") !== `Bearer ${PLATFORM_KEY}`) return json(401, { code: "unauthorized" });
            if (!url.endsWith(`/api/storage-broker/v1/${PLATFORM_PROJECT}/sign`)) return json(404, { code: "not_found" });
            const body: unknown = JSON.parse(String(init.body));
            if (!isRecord(body) || !Array.isArray(body.ops)) return json(400, { code: "invalid_request" });
            if (body.source !== "(default)") return json(404, { code: "no_storage" });
            world.brokerCalls.push(body.ops.map((o: unknown) => (isRecord(o) ? String(o.op) : "?")));
            return json(200, { results: body.ops.map((o: unknown) => (isRecord(o) ? sign(o) : { ok: false,
code: "invalid_request",
message: "?" })) });
        }
        return store(new URL(url), init);
    }

    async function bodyBytes(init: RequestInit): Promise<Buffer> {
        if (init.body === undefined || init.body === null) return Buffer.alloc(0);
        return Buffer.from(await new Response(init.body).arrayBuffer());
    }

    async function store(url: URL, init: RequestInit): Promise<Response> {
        const q = url.searchParams;
        const op = q.get("x-op") ?? "";
        const method = (init.method ?? "GET").toUpperCase();
        world.storeCalls.push(op);
        const denied = (code: string) => new Response(`<Error><Code>${code}</Code></Error>`, { status: 403 });
        if (METHODS[op] !== method) return denied("SignatureDoesNotMatch");
        if (Number(q.get("x-exp")) < current()) return denied("AccessDenied");
        if (Number(q.get("x-signed")) < world.revokedBefore) return denied("InvalidAccessKeyId");
        const failure = world.storeFailures.get(op)?.shift();
        if (failure) return new Response("<Error><Code>Forced</Code></Error>", { status: failure });

        const key = decodeURIComponent(url.pathname.slice(1));
        if (op !== "list" && !key.startsWith(world.prefix)) return denied("AccessDenied");
        const headers = new Headers(init.headers);

        switch (op) {
            case "put": {
                const body = await bodyBytes(init);
                if (String(body.byteLength) !== q.get("x-len")) return denied("SignatureDoesNotMatch");
                const meta: Record<string, string> = {};
                headers.forEach((v, k) => { if (k.startsWith("x-amz-meta-")) meta[k.slice(11)] = v; });
                world.objects.set(key, { body,
type: headers.get("content-type") ?? "application/octet-stream",
meta,
modified: Math.floor(current() / 1000) * 1000 });
                return new Response(null, { status: 200,
headers: { etag: "\"e\"" } });
            }
            case "get":
            case "head": {
                const obj = world.objects.get(key);
                if (!obj) return new Response(op === "head" ? null : "<Error><Code>NoSuchKey</Code></Error>", { status: 404 });
                const base: Record<string, string> = {
                    "content-type": obj.type,
                    "last-modified": new Date(obj.modified).toUTCString()
                };
                for (const [k, v] of Object.entries(obj.meta)) base[`x-amz-meta-${k}`] = v;
                const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") ?? "");
                if (op === "get" && range) {
                    const start = Number(range[1]);
                    const end = Math.min(Number(range[2]), obj.body.byteLength - 1);
                    if (start >= obj.body.byteLength) return new Response(null, { status: 416 });
                    const slice = obj.body.subarray(start, end + 1);
                    return new Response(new Uint8Array(slice), { status: 206,
headers: { ...base,
"content-length": String(slice.byteLength),
"content-range": `bytes ${start}-${end}/${obj.body.byteLength}` } });
                }
                return new Response(op === "head" ? null : new Uint8Array(obj.body), { status: 200,
headers: { ...base,
"content-length": String(obj.body.byteLength) } });
            }
            case "delete":
                world.objects.delete(key);
                return new Response(null, { status: 204 });
            case "multipart-create": {
                const id = `2~upload-${++uploadCounter}`;
                const meta: Record<string, string> = {};
                headers.forEach((v, k) => { if (k.startsWith("x-amz-meta-")) meta[k.slice(11)] = v; });
                world.uploads.set(id, { key,
type: headers.get("content-type") ?? "application/octet-stream",
meta,
parts: new Map() });
                return new Response(`<InitiateMultipartUploadResult><Key>${xml(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`, { status: 200 });
            }
            case "multipart-part": {
                const upload = world.uploads.get(q.get("uploadId") ?? "");
                if (!upload || upload.key !== key) return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
                const body = await bodyBytes(init);
                if (String(body.byteLength) !== q.get("x-len")) return denied("SignatureDoesNotMatch");
                const n = Number(q.get("partNumber"));
                upload.parts.set(n, body);
                return new Response(null, { status: 200,
headers: { etag: `"part-${n}"` } });
            }
            case "multipart-complete": {
                const id = q.get("uploadId") ?? "";
                const upload = world.uploads.get(id);
                if (!upload || upload.key !== key) return new Response("<Error><Code>NoSuchUpload</Code></Error>", { status: 404 });
                const listed = [...String(init.body).matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)].map((m) => Number(m[1]));
                const body = Buffer.concat(listed.map((n) => upload.parts.get(n) ?? Buffer.alloc(0)));
                world.objects.set(key, { body,
type: upload.type,
meta: upload.meta,
modified: Math.floor(current() / 1000) * 1000 });
                world.uploads.delete(id);
                return new Response(`<CompleteMultipartUploadResult><Key>${xml(key)}</Key></CompleteMultipartUploadResult>`, { status: 200 });
            }
            case "multipart-abort":
                world.uploads.delete(q.get("uploadId") ?? "");
                return new Response(null, { status: 204 });
            case "list": {
                const prefix = q.get("prefix") ?? "";
                const delimiter = q.get("delimiter");
                const max = Number(q.get("max-keys") ?? 1000);
                const after = q.get("continuation-token") ?? "";
                const keys = [...world.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
                const entries: { key: string; folder: boolean }[] = [];
                const seenFolders = new Set<string>();
                for (const k of keys) {
                    const rest = k.slice(prefix.length);
                    const cut = delimiter ? rest.indexOf(delimiter) : -1;
                    if (cut >= 0) {
                        const folder = prefix + rest.slice(0, cut + 1);
                        if (!seenFolders.has(folder)) { seenFolders.add(folder); entries.push({ key: folder,
folder: true }); }
                    } else {
                        entries.push({ key: k,
folder: false });
                    }
                }
                const page = entries.filter((e) => e.key > after).slice(0, max);
                const truncated = entries.filter((e) => e.key > after).length > page.length;
                const body = "<ListBucketResult>" +
                    page.map((e) => e.folder
                        ? `<CommonPrefixes><Prefix>${xml(e.key)}</Prefix></CommonPrefixes>`
                        : `<Contents><Key>${xml(e.key)}</Key><Size>${world.objects.get(e.key)!.body.byteLength}</Size><LastModified>${new Date(world.objects.get(e.key)!.modified).toISOString()}</LastModified></Contents>`).join("") +
                    `<IsTruncated>${truncated}</IsTruncated>` +
                    (truncated ? `<NextContinuationToken>${xml(page[page.length - 1].key)}</NextContinuationToken>` : "") +
                    "</ListBucketResult>";
                return new Response(body, { status: 200 });
            }
            default:
                return denied("SignatureDoesNotMatch");
        }
    }

    return world;
}
