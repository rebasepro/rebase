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
 * True when a storage key/path points at a public object (lives under
 * {@link PUBLIC_STORAGE_PREFIX}). The check is applied to the key *within the
 * bucket* — strip any `bucket/` and `scheme://` prefixes first.
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
    public?: boolean
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
}
