/**
 * In-process stand-ins for the S3 and GCS SDK clients, for the storage
 * controller contract suite (`storage-controller-contract.test.ts`).
 *
 * They exist so the S3 and GCS controllers can be held to the same assertions
 * as the local one. Every cache-header, rendition and folder test used to run
 * against `LocalStorageController` only, which is the implementation that
 * happened to work — so the remote ones served a new `ETag` on every read and
 * nobody's test could see it.
 *
 * A fake is only worth having if it is honest about the SDK semantics the
 * controllers depend on. The ones that matter, each mirrored from the real
 * service:
 *
 * - **Versions.** An S3 object's `LastModified` and a GCS object's `updated`
 *   are fixed when the object is written and come back unchanged on every
 *   read. S3's arrives as a `Date` floored to the second (it is parsed from
 *   the `Last-Modified` header); GCS's as an RFC 3339 string with
 *   milliseconds.
 * - **Listing.** Keys come back in lexicographic order. With a delimiter, keys
 *   that share a segment past the prefix collapse into one common prefix.
 *   `MaxKeys` / `maxResults` count objects and prefixes *together*, and the
 *   continuation token is opaque.
 * - **Folder markers.** A zero-byte `folder/` object is an ordinary key. When
 *   the listed prefix *is* `folder/`, the marker itself is in `Contents` /
 *   `items` — S3 and GCS both return it.
 * - **Absence.** S3 answers a missing key on `GetObject` with `NoSuchKey`, on
 *   `HeadObject` with `NotFound`, both HTTP 404; `DeleteObject` on a missing
 *   key succeeds. GCS answers a missing object with code 404 ("No such
 *   object"), and an unknown bucket with code 404 too.
 *
 * Commands are recognised by class name and read through `input`, the shape
 * every `@aws-sdk/client-s3` command has, so the real command classes are used
 * unmodified — only the client that sends them is replaced.
 */

interface StoredObject {
    body: Uint8Array;
    contentType: string;
    metadata: Record<string, string>;
    /** Epoch ms the object was last written. */
    writtenAt: number;
}

/** One provider: buckets of objects, keyed by name. */
class ObjectWorld {
    private buckets = new Map<string, Map<string, StoredObject>>();
    /** Every write, in order — the contract suite counts rendition writes. */
    readonly writes: { bucket: string; key: string }[] = [];

    reset(bucketNames: string[]): void {
        this.buckets = new Map(bucketNames.map(name => [name, new Map()]));
        this.writes.length = 0;
    }

    bucket(name: string): Map<string, StoredObject> | undefined {
        return this.buckets.get(name);
    }

    write(bucketName: string, key: string, object: StoredObject): boolean {
        const bucket = this.buckets.get(bucketName);
        if (!bucket) return false;
        bucket.set(key, object);
        this.writes.push({ bucket: bucketName, key });
        return true;
    }
}

/** A listing entry, either an object or a collapsed common prefix. */
type ListEntry = { kind: "object"; key: string } | { kind: "prefix"; prefix: string };

/**
 * The provider listing algorithm both S3 and GCS implement: sorted keys under
 * `prefix`, collapsed on `delimiter`, paged by a combined count.
 */
function listEntries(
    keys: Iterable<string>,
    prefix: string,
    delimiter: string | undefined,
    max: number,
    after: string | undefined
): { page: ListEntry[]; last: string | undefined; truncated: boolean } {
    const sorted = [...keys].filter(k => k.startsWith(prefix)).sort();
    const entries: ListEntry[] = [];
    const seen = new Set<string>();
    for (const key of sorted) {
        const rest = key.slice(prefix.length);
        const cut = delimiter ? rest.indexOf(delimiter) : -1;
        if (delimiter && cut >= 0) {
            const common = prefix + rest.slice(0, cut + delimiter.length);
            if (seen.has(common)) continue;
            seen.add(common);
            entries.push({ kind: "prefix", prefix: common });
        } else {
            entries.push({ kind: "object", key });
        }
    }
    const sortKey = (e: ListEntry) => e.kind === "object" ? e.key : e.prefix;
    const remaining = after === undefined ? entries : entries.filter(e => sortKey(e) > after);
    const page = remaining.slice(0, max);
    return {
        page,
        last: page.length > 0 ? sortKey(page[page.length - 1]) : undefined,
        truncated: remaining.length > page.length
    };
}

const encodeToken = (s: string) => Buffer.from(`fake:${s}`, "utf-8").toString("base64");
const decodeToken = (token: string): string => {
    const raw = Buffer.from(token, "base64").toString("utf-8");
    if (!raw.startsWith("fake:")) {
        throw Object.assign(new Error("The continuation token provided is incorrect"), {
            name: "InvalidArgument",
            code: 400,
            $metadata: { httpStatusCode: 400 }
        });
    }
    return raw.slice("fake:".length);
};

async function toBytes(body: unknown): Promise<Uint8Array> {
    if (body instanceof Uint8Array) return new Uint8Array(body);
    if (typeof body === "string") return new TextEncoder().encode(body);
    if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    if (body === undefined || body === null) return new Uint8Array(0);
    throw new Error(`fake object store: unsupported body ${typeof body}`);
}

// ─── S3 ──────────────────────────────────────────────────────────────────

export const s3World = new ObjectWorld();

interface S3CommandLike {
    constructor: { name: string };
    input: Record<string, unknown>;
}

function s3Error(name: string, status: number, message: string): Error {
    return Object.assign(new Error(message), {
        name,
        Code: name,
        $fault: "client",
        $metadata: { httpStatusCode: status }
    });
}

/** `LastModified` as the SDK hands it back: a Date parsed from an HTTP date, so whole seconds. */
const s3LastModified = (writtenAt: number) => new Date(Math.floor(writtenAt / 1000) * 1000);

/** A Body the way the Node SDK returns one: async-iterable, with the `transformTo*` mixins. */
function s3Body(bytes: Uint8Array) {
    return {
        async *[Symbol.asyncIterator]() {
            // Two chunks, so a reader that assumes one is caught.
            const mid = Math.floor(bytes.length / 2);
            if (mid > 0) yield bytes.slice(0, mid);
            yield bytes.slice(mid);
        },
        transformToByteArray: async () => bytes,
        transformToString: async () => new TextDecoder().decode(bytes)
    };
}

export class FakeS3Client {
    // The real client takes its config here; nothing in it matters to a fake.
    constructor(_config?: unknown) {}

    async send(command: S3CommandLike): Promise<Record<string, unknown>> {
        const input = command.input;
        const bucketName = String(input.Bucket);
        const bucket = s3World.bucket(bucketName);
        if (!bucket) throw s3Error("NoSuchBucket", 404, "The specified bucket does not exist");
        const key = typeof input.Key === "string" ? input.Key : undefined;

        switch (command.constructor.name) {
            case "PutObjectCommand": {
                s3World.write(bucketName, key!, {
                    body: await toBytes(input.Body),
                    contentType: typeof input.ContentType === "string" && input.ContentType
                        ? input.ContentType
                        : "binary/octet-stream",
                    metadata: (input.Metadata as Record<string, string> | undefined) ?? {},
                    writtenAt: Date.now()
                });
                return { ETag: `"${key}-${Date.now()}"`, $metadata: { httpStatusCode: 200 } };
            }
            case "GetObjectCommand": {
                const object = bucket.get(key!);
                if (!object) throw s3Error("NoSuchKey", 404, "The specified key does not exist.");
                return {
                    Body: s3Body(object.body),
                    ContentType: object.contentType,
                    ContentLength: object.body.length,
                    LastModified: s3LastModified(object.writtenAt),
                    Metadata: object.metadata,
                    $metadata: { httpStatusCode: 200 }
                };
            }
            case "HeadObjectCommand": {
                const object = bucket.get(key!);
                if (!object) throw s3Error("NotFound", 404, "NotFound");
                return {
                    ContentType: object.contentType,
                    ContentLength: object.body.length,
                    LastModified: s3LastModified(object.writtenAt),
                    Metadata: object.metadata,
                    $metadata: { httpStatusCode: 200 }
                };
            }
            case "DeleteObjectCommand": {
                // AWS answers 204 whether or not the key existed.
                bucket.delete(key!);
                return { $metadata: { httpStatusCode: 204 } };
            }
            case "ListObjectsV2Command": {
                const prefix = typeof input.Prefix === "string" ? input.Prefix : "";
                const delimiter = typeof input.Delimiter === "string" ? input.Delimiter : undefined;
                const max = typeof input.MaxKeys === "number" ? input.MaxKeys : 1000;
                const after = typeof input.ContinuationToken === "string"
                    ? decodeToken(input.ContinuationToken)
                    : undefined;
                const { page, last, truncated } = listEntries(bucket.keys(), prefix, delimiter, max, after);
                const contents = page.flatMap(e => {
                    if (e.kind !== "object") return [];
                    const object = bucket.get(e.key)!;
                    return [{
                        Key: e.key,
                        // Listings carry milliseconds; the version is the same instant.
                        LastModified: new Date(object.writtenAt),
                        Size: object.body.length,
                        StorageClass: "STANDARD"
                    }];
                });
                const commonPrefixes = page.flatMap(e => e.kind === "prefix" ? [{ Prefix: e.prefix }] : []);
                return {
                    // S3 omits empty lists rather than sending [].
                    Contents: contents.length ? contents : undefined,
                    CommonPrefixes: commonPrefixes.length ? commonPrefixes : undefined,
                    IsTruncated: truncated,
                    KeyCount: page.length,
                    NextContinuationToken: truncated && last !== undefined ? encodeToken(last) : undefined,
                    $metadata: { httpStatusCode: 200 }
                };
            }
            default:
                throw new Error(`fake S3: ${command.constructor.name} is not implemented`);
        }
    }
}

/** Stand-in for `@aws-sdk/s3-request-presigner`'s `getSignedUrl`. */
export async function fakeS3Presign(_client: unknown, command: S3CommandLike, options?: { expiresIn?: number }): Promise<string> {
    return `https://fake-s3.invalid/${String(command.input.Bucket)}/${String(command.input.Key)}` +
        `?X-Amz-Expires=${options?.expiresIn ?? 900}&X-Amz-Signature=fake`;
}

// ─── GCS ─────────────────────────────────────────────────────────────────

export const gcsWorld = new ObjectWorld();

function gcsError(message: string, code: number): Error {
    return Object.assign(new Error(message), { code, errors: [{ message, reason: "notFound" }] });
}

function gcsMetadata(bucketName: string, key: string, object: StoredObject): Record<string, unknown> {
    return {
        kind: "storage#object",
        name: key,
        bucket: bucketName,
        // The JSON API sends sizes as strings.
        size: String(object.body.length),
        contentType: object.contentType,
        timeCreated: new Date(object.writtenAt).toISOString(),
        updated: new Date(object.writtenAt).toISOString(),
        generation: String(object.writtenAt * 1000),
        metadata: Object.keys(object.metadata).length ? object.metadata : undefined
    };
}

class FakeGcsFile {
    constructor(readonly bucketName: string, readonly name: string, readonly metadata: Record<string, unknown> = {}) {}

    private objects(): Map<string, StoredObject> {
        const bucket = gcsWorld.bucket(this.bucketName);
        if (!bucket) throw gcsError("The specified bucket does not exist.", 404);
        return bucket;
    }

    private existing(): StoredObject {
        const object = this.objects().get(this.name);
        if (!object) throw gcsError(`No such object: ${this.bucketName}/${this.name}`, 404);
        return object;
    }

    async save(data: unknown, options?: { contentType?: string; metadata?: { contentType?: string; metadata?: Record<string, string> } }): Promise<void> {
        this.objects();
        gcsWorld.write(this.bucketName, this.name, {
            body: await toBytes(data),
            contentType: options?.contentType || options?.metadata?.contentType || "application/octet-stream",
            metadata: options?.metadata?.metadata ?? {},
            writtenAt: Date.now()
        });
    }

    async download(): Promise<[Buffer]> {
        return [Buffer.from(this.existing().body)];
    }

    async getMetadata(): Promise<[Record<string, unknown>, Record<string, unknown>]> {
        const meta = gcsMetadata(this.bucketName, this.name, this.existing());
        return [meta, meta];
    }

    async delete(options?: { ignoreNotFound?: boolean }): Promise<[unknown]> {
        const objects = this.objects();
        if (!objects.has(this.name) && !options?.ignoreNotFound) {
            throw gcsError(`No such object: ${this.bucketName}/${this.name}`, 404);
        }
        objects.delete(this.name);
        return [{}];
    }

    async getSignedUrl(options: { expires: number }): Promise<[string]> {
        return [`https://fake-gcs.invalid/${this.bucketName}/${this.name}?Expires=${options.expires}&Signature=fake`];
    }
}

class FakeGcsBucket {
    constructor(readonly name: string) {}

    file(key: string): FakeGcsFile {
        return new FakeGcsFile(this.name, key);
    }

    async getFiles(query: { prefix?: string; delimiter?: string; maxResults?: number; pageToken?: string; autoPaginate?: boolean }):
        Promise<[FakeGcsFile[], Record<string, unknown> | null, Record<string, unknown>]> {
        const bucket = gcsWorld.bucket(this.name);
        if (!bucket) throw gcsError("The specified bucket does not exist.", 404);
        const { page, last, truncated } = listEntries(
            bucket.keys(),
            query.prefix ?? "",
            query.delimiter,
            query.maxResults ?? 1000,
            query.pageToken ? decodeToken(query.pageToken) : undefined
        );
        const files = page.flatMap(e => e.kind === "object"
            ? [new FakeGcsFile(this.name, e.key, gcsMetadata(this.name, e.key, bucket.get(e.key)!))]
            : []);
        const prefixes = page.flatMap(e => e.kind === "prefix" ? [e.prefix] : []);
        const nextPageToken = truncated && last !== undefined ? encodeToken(last) : undefined;
        const apiResponse: Record<string, unknown> = {
            kind: "storage#objects",
            ...(files.length ? { items: files.map(f => f.metadata) } : {}),
            // Absent, not empty, when there are none — as the JSON API sends it.
            ...(prefixes.length ? { prefixes } : {}),
            ...(nextPageToken ? { nextPageToken } : {})
        };
        return [files, nextPageToken ? { ...query, pageToken: nextPageToken } : null, apiResponse];
    }
}

export class FakeGcsStorage {
    constructor(_options?: unknown) {}

    bucket(name: string): FakeGcsBucket {
        return new FakeGcsBucket(name);
    }
}
