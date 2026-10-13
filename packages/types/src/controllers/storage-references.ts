import { DEFAULT_STORAGE_SOURCE_KEY } from "../types/storage_source";
import type { StorageSource } from "./storage";

// Storage references: a stored object named inside text. A module of its own,
// apart from ./storage, because only the code that renders or rewrites text
// needs it — an app bundles it only where it does, and not with every client
// that uploads a file.

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

/** The JSON in a JWT's payload segment, or `undefined` for anything else. */
function jwtPayload(token: string): Record<string, unknown> | undefined {
    const segments = token.split(".");
    if (segments.length !== 3) return undefined;
    try {
        const base64 = segments[1].replace(/-/g, "+").replace(/_/g, "/");
        const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
        const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
        const payload: unknown = JSON.parse(json);
        return payload && typeof payload === "object" && !Array.isArray(payload)
            ? payload as Record<string, unknown>
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The object a private file's download URL was minted for, or `null` for any
 * other URL.
 *
 * Text written before storage references stored such URLs —
 * `…/storage/file/posts/cover.png?token=…` — and their tokens expired minutes
 * later. The token still names the object it was minted for, so the URL can be
 * traded for a fresh one, or for a reference. Read without verifying the
 * token: it grants nothing here, it only says which object is meant, and the
 * key in the URL must agree with it. Host-agnostic, since a URL written
 * through one origin may be read through another.
 *
 * @group Models
 */
export function storageTargetOfDownloadUrl(url: string): StorageReferenceTarget | null {
    let parsed: URL;
    try {
        parsed = new URL(url, "http://relative.invalid");
    } catch {
        return null;
    }
    const marker = "/storage/file/";
    const at = parsed.pathname.indexOf(marker);
    const token = parsed.searchParams.get("token");
    if (at === -1 || !token) return null;

    let key: string;
    try {
        key = parsed.pathname.slice(at + marker.length).split("/").map(decodeURIComponent).join("/");
    } catch {
        return null;
    }
    if (!key || key.split("/").some((segment) => segment === "..")) return null;

    const payload = jwtPayload(token);
    if (payload?.purpose !== "file-read" || typeof payload.path !== "string") return null;
    // The token's path is `<bucket>/<key>`.
    const slash = payload.path.indexOf("/");
    if (payload.path !== key && payload.path.slice(slash + 1) !== key) return null;

    const named = parsed.searchParams.get("storageId")
        ?? (typeof payload.storageId === "string" ? payload.storageId : undefined);
    return named && named !== DEFAULT_STORAGE_SOURCE_KEY ? { key, storageId: named } : { key };
}

/**
 * A private file's download URL as it may appear in text. Parentheses are
 * allowed in the path, where an unencoded file name puts them; the query, a
 * token, has none, so the match ends where a markdown destination does.
 */
const DOWNLOAD_URL_PATTERN = /(?:https?:\/\/[^\s()<>"'\]]+)?\/storage\/file\/[^\s<>"'?#\]]+\?[^\s()<>"'#\]]*/g;

/** Each download URL in `text` that names an object, with its reference. */
function downloadUrlsIn(text: string): Map<string, string> {
    const found = new Map<string, string>();
    if (!text.includes("/storage/file/")) return found;
    for (const url of text.match(DOWNLOAD_URL_PATTERN) ?? []) {
        const target = storageTargetOfDownloadUrl(url);
        if (target) found.set(url, storageReference(target.key, target.storageId));
    }
    return found;
}

/**
 * Every object `text` names: its storage references, and the private files'
 * download URLs saved in it before references existed. An object named more
 * than once may be listed more than once.
 *
 * @group Models
 */
export function storageTargetsInText(text: string): StorageReferenceTarget[] {
    const references = text.includes(STORAGE_REFERENCE_SCHEME) ? text.match(STORAGE_REFERENCE_PATTERN) ?? [] : [];
    return [...references, ...downloadUrlsIn(text).values()]
        .map((reference) => parseStorageReference(reference))
        .filter((target): target is StorageReferenceTarget => target !== null);
}

/**
 * `text` with every private file's download URL replaced by the storage
 * reference for its object — for rewriting text saved before references, so
 * it stores what new text stores. Any other URL is left as it is.
 *
 * @group Models
 */
export function storageReferencesForDownloadUrls(text: string): string {
    const urls = downloadUrlsIn(text);
    if (urls.size === 0) return text;
    return text.replace(DOWNLOAD_URL_PATTERN, (url) => urls.get(url) ?? url);
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
 * A private file's download URL saved in the text before references existed
 * is renewed the same way: its expired token still names the object (see
 * {@link storageTargetOfDownloadUrl}). One that cannot be resolved is left as
 * it was.
 *
 * @group Models
 */
export async function resolveStorageReferences(
    text: string,
    from: StorageReferenceResolver
): Promise<string> {
    if (!text) return text;
    const downloadUrls = downloadUrlsIn(text);
    if (!text.includes(STORAGE_REFERENCE_SCHEME) && downloadUrls.size === 0) return text;
    const resolve = typeof from === "function" ? from : resolverFromSources(from);
    const references = new Set([...(text.match(STORAGE_REFERENCE_PATTERN) ?? []), ...downloadUrls.values()]);
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
    const renewed = downloadUrls.size === 0 ? text : text.replace(DOWNLOAD_URL_PATTERN, (saved) => {
        const reference = downloadUrls.get(saved);
        const url = reference === undefined ? undefined : urls.get(reference);
        return url === undefined ? saved : asLinkDestination(url);
    });
    return renewed.replace(STORAGE_REFERENCE_PATTERN, (reference) => {
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
