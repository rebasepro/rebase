import { DEFAULT_STORAGE_SOURCE_KEY } from "../types/storage_source";
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
 * The scheme of a **storage reference**: a stored object named inside text.
 *
 * Text that embeds a file — a markdown body above all — cannot hold a private
 * object's URL: that URL carries a download token which expires in minutes,
 * after which every reader of the text gets a 401 for an image that is still in
 * the bucket. It holds a reference instead,
 * `rebase-storage:posts/cover.png` (`?storageId=media` for a named source),
 * and whoever renders the text exchanges each reference for a fresh URL with
 * {@link resolveStorageReferences} — `resolveStorageReferences(text, client)`
 * from `@rebasepro/client` on a site.
 *
 * @group Models
 */
export const STORAGE_REFERENCE_SCHEME = "rebase-storage:";

/**
 * The object a storage reference names.
 *
 * @group Models
 */
export interface StorageReferenceTarget {
    /** The object's key in its storage source. */
    key: string;
    /** The named storage source holding it. Absent for the default source. */
    storageId?: string;
}

/**
 * `encodeURIComponent`, plus the five characters it leaves alone that end or
 * break a markdown link destination: `(`, `)`, `'`, `!` and `*`.
 */
const encodeReferencePart = (part: string): string =>
    encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * A reference as it appears in text: the scheme, then the characters
 * {@link storageReference} writes. Kept beside {@link STORAGE_REFERENCE_SCHEME};
 * the test round-trips names chosen to break it.
 */
const STORAGE_REFERENCE_PATTERN = /rebase-storage:[A-Za-z0-9\-._~%/?=&]+/g;

/**
 * The reference for an object — what text stores in place of its URL.
 *
 * Every part is percent-encoded, so the reference contains no space,
 * parenthesis or quote and survives as one markdown link destination whatever
 * the file was called.
 *
 * @group Models
 */
export function storageReference(key: string, storageId?: string | null): string {
    const path = key.replace(/^\/+/, "").split("/").map(encodeReferencePart).join("/");
    const named = storageId && storageId !== DEFAULT_STORAGE_SOURCE_KEY
        ? `?storageId=${encodeReferencePart(storageId)}`
        : "";
    return `${STORAGE_REFERENCE_SCHEME}${path}${named}`;
}

/**
 * Whether a string — an image's `src`, a link's `href` — is a storage reference.
 *
 * @group Models
 */
export function isStorageReference(value: string | null | undefined): value is string {
    return typeof value === "string" && value.startsWith(STORAGE_REFERENCE_SCHEME);
}

/**
 * The object a storage reference names, or `null` for anything else — a URL, a
 * bare key, or a reference whose key would climb out of its prefix.
 *
 * @group Models
 */
export function parseStorageReference(value: string | null | undefined): StorageReferenceTarget | null {
    if (!isStorageReference(value)) return null;
    const rest = value.slice(STORAGE_REFERENCE_SCHEME.length);
    const queryAt = rest.indexOf("?");
    const rawPath = queryAt === -1 ? rest : rest.slice(0, queryAt);
    const query = queryAt === -1 ? "" : rest.slice(queryAt + 1);

    let key: string;
    let storageId: string | undefined;
    try {
        key = rawPath.split("/").map(decodeURIComponent).join("/");
        for (const pair of query.split("&")) {
            const [name, raw] = pair.split("=");
            if (name === "storageId" && raw) storageId = decodeURIComponent(raw);
        }
    } catch {
        return null;
    }
    if (!key || key.split("/").some((segment) => segment === "..")) return null;
    return storageId && storageId !== DEFAULT_STORAGE_SOURCE_KEY ? { key, storageId } : { key };
}

/**
 * Where {@link resolveStorageReferences} gets URLs from: a function that
 * answers one, or anything shaped like a Rebase client — its `storage` for the
 * default source and `createStorageSource(id)` for a named one.
 *
 * @group Models
 */
export type StorageReferenceResolver =
    | ((target: StorageReferenceTarget) => Promise<string | null | undefined>)
    | {
        storage?: StorageSource;
        createStorageSource?(storageId: string): StorageSource;
    };

/**
 * Exchange every storage reference in `text` for a URL, at the moment the text
 * is rendered.
 *
 * ```ts
 * const html = markdown.render(await resolveStorageReferences(post.body, client));
 * ```
 *
 * Each distinct object is asked for once — `getSignedUrl(key)` on its source —
 * so a private object gets a freshly minted download URL every time the text is
 * rendered. A reference that cannot be resolved (no such object, an unknown
 * source) is left as it was, so a missing object reads as a missing image
 * rather than as a failed render.
 *
 * @group Models
 */
export async function resolveStorageReferences(
    text: string,
    from: StorageReferenceResolver
): Promise<string> {
    if (!text || !text.includes(STORAGE_REFERENCE_SCHEME)) return text;
    const resolve = typeof from === "function" ? from : resolverFromSources(from);
    const references = new Set(text.match(STORAGE_REFERENCE_PATTERN) ?? []);
    const urls = new Map<string, string>();
    await Promise.all([...references].map(async (reference) => {
        const target = parseStorageReference(reference);
        if (!target) return;
        try {
            const url = await resolve(target);
            if (url) urls.set(reference, url);
        } catch {
            // Left as it was: one unreadable object must not fail the page.
        }
    }));
    if (urls.size === 0) return text;
    return text.replace(STORAGE_REFERENCE_PATTERN, (reference) => {
        const url = urls.get(reference);
        return url === undefined ? reference : asLinkDestination(url);
    });
}

/**
 * A URL as one markdown link destination: whitespace, parentheses, angle
 * brackets and quotes percent-encoded, since any of them ends the destination
 * and turns the image into literal text. The URL means the same thing either
 * way.
 */
const asLinkDestination = (url: string): string =>
    url.replace(/[\s()<>"']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

/** A resolver over a client's storage sources, one source per named key. */
function resolverFromSources(
    client: Exclude<StorageReferenceResolver, (target: StorageReferenceTarget) => unknown>
): (target: StorageReferenceTarget) => Promise<string | null> {
    const named = new Map<string, StorageSource | undefined>();
    return async ({ key, storageId }) => {
        let source = client.storage;
        if (storageId) {
            if (!named.has(storageId)) named.set(storageId, client.createStorageSource?.(storageId));
            source = named.get(storageId);
        }
        if (!source) return null;
        const config = await source.getSignedUrl(key);
        return config.fileNotFound ? null : config.url;
    };
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
     * The server reads it to enforce that property's own `storage.maxSize` and
     * `storage.acceptedFiles`, which were declared per property, published in
     * the generated types, rendered by the panel's file picker, and until now
     * enforced by nothing on the server — so a `curl` past the picker put a
     * 40 MB executable in a bucket whose config said "images, under 200 KB".
     *
     * Advisory in one direction only. The rules are resolved from the server's
     * own registry by slug, so naming a property can make an upload *stricter*
     * or leave it at the global cap; it can never widen anything.
     *
     * Omitted, the upload is checked against the deployment's global
     * `maxFileSize` exactly as before.
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
