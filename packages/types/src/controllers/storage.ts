/**
 * Path prefix that marks an object as **public**. Files stored under this
 * prefix are served without any auth token via a stable, permanent,
 * CDN-cacheable URL (see {@link StorageSource.getSignedUrl}). Shared by the
 * client SDK and the backend so both agree on which objects are public.
 *
 * @group Models
 */
export const PUBLIC_STORAGE_PREFIX = "public/";

/**
 * True when a storage **key** is public: it lies under
 * {@link PUBLIC_STORAGE_PREFIX}.
 *
 * The key is read exactly as it is — the canonical key within its bucket, the
 * one the server stores, serves, and hands a `storageAuthorize` hook as
 * `key` — and nothing is parsed out of it. That is the difference from
 * {@link isPublicStoragePath}, which reads a client-side *path* and so strips
 * a `scheme://` and a leading `default/` bucket segment first. On a key both are
 * wrong: `default/public/x` is a key in a folder called `default`, and a
 * request path `notes://public/x` names the key `notes:/public/x`. Neither is
 * public, and the server decides on this function so that it never says they
 * are.
 *
 * @group Models
 */
export function isPublicStorageKey(key: string | null | undefined): boolean {
    if (!key || !key.startsWith(PUBLIC_STORAGE_PREFIX)) return false;
    // A canonical key never carries a `..` segment; one that does is not a key
    // the server would serve, and is never public.
    return !key.split(/[\\/]/).includes("..");
}

/**
 * True when a storage key or client-side path points at a public object
 * (lives under {@link PUBLIC_STORAGE_PREFIX}).
 *
 * For a path as a client holds it: a `scheme://` prefix and a single leading
 * `default/` bucket segment are stripped first. The server and a
 * `storageAuthorize` hook, which hold the canonical key, use
 * {@link isPublicStorageKey}.
 *
 * @group Models
 */
export function isPublicStoragePath(path: string | null | undefined): boolean {
    if (!path) return false;
    let p = path;
    const scheme = p.indexOf("://");
    if (scheme !== -1) p = p.substring(scheme + 3);
    p = p.replace(/^\/+/, "");

    // Defense-in-depth: a path containing traversal segments is never public,
    // so an attacker can't reach a private object via `public/../secret`.
    if (p.split("/").some((seg) => seg === "..")) return false;

    // Public iff the object **key** starts with the public prefix. A single
    // leading `default/` bucket segment is tolerated (the default bucket).
    // A substring match is deliberately NOT used — a private object under a
    // folder literally named `public` (e.g. `reports/public/q3.pdf`) must stay
    // private. Named buckets: pass the key (not `bucket/key`) so the prefix is
    // anchored; otherwise it falls back to a private, token-scoped URL (safe).
    return p.startsWith(PUBLIC_STORAGE_PREFIX) || p.startsWith(`default/${PUBLIC_STORAGE_PREFIX}`);
}

/**
 * The path the storage routes address an object by, from a key or from the
 * `storageUrl` an upload returned (`<scheme>://<bucket>/<key>`, which is what a
 * property with `includeBucketUrl: true` keeps in its column).
 *
 * The routes address a source's objects by key. On S3 and GCS the bucket in a
 * `storageUrl` is always the source's own — the server refuses any other — so
 * it is dropped: sent along, `s3://acme-media/products/a.png` reached the
 * server as the key `acme-media/products/a.png`, the preview found nothing and
 * a delete reported success while the object stayed. It worked on local disk
 * only, because `local://default/<key>` happens to carry the one bucket
 * segment the routes recognise — which is kept, as is any other local bucket.
 *
 * A bare key whose first folder is `default` is sent behind that bucket
 * segment. The routes read one leading `default/` (in any case) as the bucket,
 * so the key `default/photo.png` sent as it is names the root `photo.png`:
 * {@link defaultBucketPath} is the spelling that names the key itself.
 *
 * Shared by every storage source that talks to those routes, so they address
 * an object alike.
 *
 * @group Models
 */
export function storageObjectPath(keyOrUrl: string, bucket?: string): string {
    let filePath = keyOrUrl;
    // Whether `filePath` already carries a bucket segment, rather than being a key.
    let bucketQualified = false;
    const scheme = /^(local|s3|gs):\/\//.exec(filePath);
    if (scheme) {
        filePath = filePath.substring(scheme[0].length);
        if (scheme[1] !== "local") {
            const slash = filePath.indexOf("/");
            if (slash > 0) filePath = filePath.substring(slash + 1);
        } else {
            bucketQualified = true;
        }
    }
    if (bucket && filePath) {
        // Already behind its bucket, or not: `defaults/x` is not in `default`.
        if (!filePath.startsWith(`${bucket}/`)) filePath = `${bucket}/${filePath}`;
        bucketQualified = true;
    }
    return bucketQualified ? filePath : defaultBucketPath(filePath);
}

/**
 * The request path of a key in the default bucket: the key itself, unless the
 * routes would read its first folder as the bucket — a first folder named
 * `default`, matched as the routes match it (case-insensitively, and only when
 * something follows it). Then the bucket segment goes in front, so exactly the
 * one segment the routes strip is the one added.
 */
function defaultBucketPath(key: string): string {
    const segments = key.split("/");
    return segments.length > 1 && segments[0].toLowerCase() === "default" ? `default/${key}` : key;
}

/**
 * @group Models
 */
export interface UploadFileProps {
    file: File,
    key: string,
    metadata?: Record<string, unknown>,
    bucket?: string,
    /**
     * Store this object as **public**: it is placed under
     * {@link PUBLIC_STORAGE_PREFIX} and served via a stable, token-less,
     * permanent URL (safe to persist in a database and cache on a CDN).
     * Defaults to `false` (private, short-lived signed URLs).
     */
    public?: boolean,
    /**
     * Which property this file is being uploaded *for* — the collection's slug
     * and the property path within it (`coverImage`, `meta.avatar`,
     * `gallery` for an array of files).
     *
     * The server holds the upload to that property's own `storage.maxSize`
     * and `storage.acceptedFiles`. It holds every upload to the limits of the
     * properties whose `storagePath` its key falls in anyway, named or not;
     * naming the property adds that property's rule, which matters for a
     * property whose `storagePath` is a function the server cannot read.
     *
     * Advisory in one direction only. The rules are resolved from the server's
     * own registry by slug, so naming a property can make an upload *stricter*;
     * it can never widen anything.
     */
    context?: UploadPropertyContext
}

/**
 * The property an upload is destined for.
 *
 * @group Models
 */
export interface UploadPropertyContext {
    /** The collection's slug, as the server registered it. */
    collection: string;
    /** Dotted path to the property — `coverImage`, `meta.avatar`. */
    property: string;
}

/**
 * @group Models
 */
export interface UploadFileResult {
    /**
     * Storage key including the file name where the file was uploaded.
     */
    key: string;
    /**
     * Bucket where the file was uploaded
     */
    bucket: string;

    /**
     * Fully qualified storage URL for the uploaded file.
     *
     * For example: `s3://my-bucket/path/to/file.png`. Every controller in the
     * framework returns one — S3, GCS and local alike — and a caller that stores
     * the reference needs it, so it is part of the result rather than a maybe.
     */
    storageUrl: string;
}

/**
 * @group Models
 */
export interface DownloadConfig {
    /**
     * Temporal url that can be used to download the file
     */
    url: string | null;

    metadata?: DownloadMetadata;

    fileNotFound?: boolean;
}

/**
 * The full set of object metadata, including read-only properties.
 * @public
 */
export declare interface DownloadMetadata {
    /**
     * The bucket this object is contained in.
     */
    bucket: string;
    /**
     * The full path of this object.
     */
    fullPath: string;
    /**
     * The short name of this object, which is the last component of the full path.
     * For example, if path is 'full/path/image.png', name is 'image.png'.
     */
    name: string;
    /**
     * The size of this object, in bytes.
     */
    size: number;
    /**
     * Type of the uploaded file
     * e.g. "image/jpeg"
     */
    contentType: string;

    customMetadata: Record<string, unknown>;
    /**
     * Optional short-lived download token (for local/server-mediated storage).
     * Absent for public objects, which need no token.
     */
    token?: string;
    /**
     * Optional remaining lifetime of the token, in seconds.
     */
    tokenExpiresIn?: number;
    /**
     * True when this object is public: it is served without a token via a
     * stable, permanent, CDN-cacheable URL. When set, the client builds a
     * token-less URL and caches it indefinitely.
     */
    public?: boolean;
}

/**
 * What serving an object needs to know before deciding whether to read it.
 * See {@link StorageSource.statObject}.
 *
 * @group Models
 */
export interface StoredObjectInfo {
    /** The whole object's size in bytes. */
    size: number;
    /** The stored content type — the uploader's claim, not a sniffed one. */
    contentType: string;
    /**
     * The object's own modification time, in milliseconds since the epoch.
     * The routes build `ETag`, `Last-Modified` and the transform cache key from
     * it, so it must be the object's version, not the time of the read.
     */
    lastModified: number;
}

/**
 * An inclusive byte range, as `Range: bytes=start-end` names one.
 *
 * @group Models
 */
export interface StoredObjectRange {
    start: number;
    end: number;
}

/**
 * An object's bytes as a stream. See {@link StorageSource.getObjectStream}.
 *
 * @group Models
 */
export interface StoredObjectStream extends StoredObjectInfo {
    /** The bytes: the range when {@link range} is set, the whole object otherwise. */
    stream: ReadableStream<Uint8Array>;
    /**
     * The range {@link stream} holds — the one asked for — or absent when it
     * holds the whole object. A controller may answer a range with the whole
     * object, as HTTP lets a server do; the caller then serves it whole.
     */
    range?: StoredObjectRange;
}

/**
 * A write of bytes whose length is not known yet. See
 * {@link StorageSource.putObjectStream}.
 *
 * @group Models
 */
export interface PutObjectStreamProps {
    /** Read once, to its end. A controller cannot retry a stream it has consumed. */
    stream: ReadableStream<Uint8Array>;
    key: string;
    contentType?: string;
    bucket?: string;
    /** Refuse the write once the stream passes this many bytes. */
    maxBytes?: number;
}

/**
 * @group Models
 */
export interface PutObjectStreamResult extends UploadFileResult {
    /** How many bytes were written. */
    size: number;
}

/**
 * @group Models
 */
export interface StorageSource {
    /**
     * Upload an object, specifying a key
     * @param file
     * @param key
     * @param metadata
     * @param bucket
     */
    putObject: ({
                     file,
                     key,
                     metadata,
                     bucket
                 }: UploadFileProps) => Promise<UploadFileResult>;

    /**
     * Convert a storage key or URL into a download configuration (signed URL equivalent)
     * @param keyOrUrl
     * @param bucket
     */
    getSignedUrl: (keyOrUrl: string, bucket?: string) => Promise<DownloadConfig>;

    /**
     * Get an object from a storage key.
     * It returns null if the object does not exist.
     * @param key
     * @param bucket
     */
    getObject: (key: string, bucket?: string) => Promise<File | null>;

    /**
     * Describe an object without reading its bytes, or `null` when there is no
     * such object. Server-side storage only.
     */
    statObject?: (key: string, bucket?: string) => Promise<StoredObjectInfo | null>;

    /**
     * Read an object, or one byte range of it, as a stream, or `null` when
     * there is no such object. Server-side storage only.
     *
     * The stream holds a file or a connection until it is read to the end or
     * cancelled, so a caller that decides not to read it must cancel it.
     */
    getObjectStream?: (key: string, options?: { bucket?: string; range?: StoredObjectRange }) => Promise<StoredObjectStream | null>;

    /**
     * Write an object from a stream, holding a chunk at a time however large it
     * is. Server-side storage only.
     *
     * Rejects with `ObjectTooLargeError` past `maxBytes`, and on that or any
     * other failure leaves no object at the key. The controller's upload limits
     * do not apply: this is how the server stores something of its own, and
     * `maxBytes` is its limit.
     */
    putObjectStream?: (props: PutObjectStreamProps) => Promise<PutObjectStreamResult>;

    /**
     * Delete an object.
     * @param key
     * @param bucket
     */
    deleteObject: (key: string, bucket?: string) => Promise<void>;

    /**
     * List the contents of a prefix.
     * @param prefix
     * @param options
     */
    listObjects: (prefix: string, options?: {
        bucket?: string,
        maxResults?: number,
        pageToken?: string
    }) => Promise<StorageListResult>;

}

/**
 * Result returned by list().
 * @public
 */
export declare interface StorageListResult {
    /**
     * References to prefixes (sub-folders). You can call list() on them to
     * get its contents.
     *
     * Folders are implicit based on '/' in the object paths.
     * For example, if a bucket has two objects '/a/b/1' and '/a/b/2', list('/a')
     * will return '/a/b' as a prefix.
     */
    prefixes: StorageReference[];
    /**
     * Objects in this directory.
     * You can call getMetadata() and getDownloadUrl() on them.
     */
    items: StorageReference[];
    /**
     * If set, there might be more results for this list. Use this token to resume the list.
     */
    nextPageToken?: string;
}

/**
 * Represents a reference to an S3-compatible storage object. Developers can
 * upload, download, and delete objects, as well as get/set object metadata.
 * @public
 */
export declare interface StorageReference {
    /**
     * Returns a s3:// URL for this object in the form
     *   `s3://<bucket>/<path>/<to>/<object>`
     * @returns The s3:// URL.
     */
    toString(): string;

    /**
     * A reference to the root of this object's bucket.
     */
    root: StorageReference;
    /**
     * The name of the bucket containing this reference's object.
     */
    bucket: string;
    /**
     * The full path of this object.
     */
    fullPath: string;
    /**
     * The short name of this object, which is the last component of the full path.
     * For example, if path is 'full/path/image.png', name is 'image.png'.
     */
    name: string;

    /**
     * A reference pointing to the parent location of this reference, or null if
     * this reference is the root.
     */
    parent: StorageReference | null;

    /**
     * The object's size in bytes, as the listing read it. Set on the objects
     * of a listing from the built-in local, S3 and GCS sources; absent on
     * folders and from a source that cannot list it without a request per
     * object. Since 0.24.
     */
    size?: number;

    /**
     * When the object was last written, as an ISO 8601 timestamp — set where
     * {@link size} is.
     */
    updated?: string;

    /**
     * The object's stored content type, as the listing read it: set by local
     * storage and GCS. An S3 listing does not carry it, so on S3 it is absent
     * and `getSignedUrl()` (or the metadata route) still says.
     */
    contentType?: string;
}
