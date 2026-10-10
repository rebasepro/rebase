import { StorageSource, UploadFileProps, UploadFileResult, DownloadConfig, StorageListResult, DownloadMetadata, PUBLIC_STORAGE_PREFIX, RebaseApiError, isPublicStoragePath, storageObjectPath } from "@rebasepro/types";
import {
    DOWNLOAD_URL_CONCURRENCY,
    RESUMABLE_UPLOAD_THRESHOLD,
    createBatchLoader,
    createConcurrencyLimit,
    createDownloadUrlCache,
    uploadResumable,
    type DownloadMetadataBatchEntry,
    type ResolvedDownload,
    type ResumableUploadSend
} from "@rebasepro/common";
import { Transport, type ResponseMeta } from "./transport";

/**
 * Create a StorageSource that talks to the Rebase backend REST API.
 *
 * @param transport - HTTP transport instance
 * @param storageId - Optional storage-source key for multi-backend routing.
 *                    When set, it is forwarded to the server so the correct
 *                    `StorageController` is resolved from the registry.
 */
/**
 * A storage key, encoded for a URL path.
 *
 * Every call below interpolated the key raw, and the server decodes what it
 * receives — so three ordinary filenames did three different wrong things:
 *
 *   `Invoice #12.pdf`  the `#` began the fragment, the server saw
 *                      `default/Invoice ` and looked up a key that is not the
 *                      file — and a scoped `?token=` after it was swallowed too
 *   `100% done.png`    `decodeURIComponent` threw URIError → 500
 *   `a%2Fb.png`        decoded to `a/b.png`, silently resolving a DIFFERENT
 *                      object
 *
 * Per SEGMENT, because `/` is the key's own separator and must survive; every
 * other character is encoded, including a literal `%`. Verified to round-trip
 * through the server's decode for all of the above, plus `+`, accented
 * characters and a trailing `%`.
 */
export function encodeStorageKey(key: string): string {
    return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * The fields of an upload's form, as the resumable endpoint's
 * `Upload-Metadata`: the same names, plus the file's own name and type, which
 * the form carries in the file part. A Blob travels in a form as `blob`.
 */
function resumableMetadataOf(form: FormData): Record<string, string> {
    const entries: Record<string, string> = {};
    for (const [name, value] of form.entries()) {
        if (typeof value === "string") {
            entries[name] = value;
        } else if (name === "file") {
            const filename = value instanceof File ? value.name : "blob";
            if (filename) entries.filename = filename;
            entries.filetype = value.type || "application/octet-stream";
        }
    }
    if (!entries.key && !entries.filename) entries.key = "unnamed";
    return entries;
}

export function createStorage(transport: Transport, storageId?: string): StorageSource {
    // Keyed by `[bucket/]keyOrUrl`; an entry lives until its download token
    // expires (public URLs: until evicted), is dropped by `deleteObject`, and
    // is bounded LRU. One per source instance, i.e. per client, and owned by
    // the credential its URLs were minted with (see `getSignedUrl`), so a
    // sign-out or another user's sign-in empties it. Concurrent lookups of one
    // key share one `/metadata` request, and at most
    // DOWNLOAD_URL_CONCURRENCY of those are open at once.
    const urlsCache = createDownloadUrlCache();
    const limitMetadata = createConcurrencyLimit(DOWNLOAD_URL_CONCURRENCY);

    /**
     * A private file's metadata and download token. The lookups a page starts
     * together — a table of thumbnails — go as one `POST /storage/metadata`
     * per hundred files, which the server charges a tenth of the requests it
     * replaces; one asked for alone is the `GET` it always was. A server
     * without the batch route (404) is asked one file at a time from then on.
     */
    const describe = createBatchLoader<DownloadMetadata>({
        loadOne: async (filePath) => (await limitMetadata(() =>
            transport.request<{ data: DownloadMetadata }>(withStorageId(`/storage/metadata/${encodeStorageKey(filePath)}`)))).data,
        loadMany: async (filePaths) => {
            const result = await limitMetadata(() => transport.request<{ data: Record<string, DownloadMetadataBatchEntry> }>("/storage/metadata", {
                method: "POST",
                body: JSON.stringify({ keys: filePaths, ...(storageId ? { storageId } : {}) })
            }));
            const answers = new Map<string, DownloadMetadata | Error>();
            for (const [filePath, entry] of Object.entries(result.data ?? {})) {
                answers.set(filePath, "error" in entry
                    ? new RebaseApiError(entry.error.message, { status: entry.error.status, code: entry.error.code })
                    : entry);
            }
            return answers;
        },
        isUnsupported: (error) => error instanceof Error && "status" in error && (error.status === 404 || error.status === 405)
    });

    /**
     * Base for URLs the *browser* will fetch on its own (file downloads,
     * previews). API requests keep going to `baseUrl`; see
     * {@link RebaseClientConfig.storageUrlOrigin} for why these can differ.
     */
    const fileUrlBase = (): string =>
        `${transport.storageUrlOrigin ?? transport.baseUrl}${transport.apiPath}`;

    /** Append ?storageId=... to a path when multi-backend routing is active. */
    const withStorageId = (path: string): string => {
        if (!storageId) return path;
        const sep = path.includes("?") ? "&" : "?";
        return `${path}${sep}storageId=${encodeURIComponent(storageId)}`;
    };

    /**
     * Whether this source sends large files through the resumable endpoint.
     * Turned off for the rest of its life by the first upload that finds it
     * cannot — a server without the endpoint, or several instances that do
     * not share an upload — so only that one upload pays for finding out.
     */
    let resumable = true;

    /** One request of a resumable upload, through the transport (its token, its refresh). */
    const sendResumable: ResumableUploadSend = async (method, path, headers, body) => {
        const meta: ResponseMeta = {};
        try {
            await transport.request(`/storage/tus${path}`, { method, headers, ...(body ? { body } : {}) }, meta);
            return { status: meta.status ?? 200, header: (name) => meta.headers?.get(name) ?? null };
        } catch (error: unknown) {
            // An HTTP answer is the protocol's to read; a dropped connection
            // (status 0) is thrown, and the upload asks where it got to.
            if (error instanceof RebaseApiError && typeof error.status === "number" && error.status > 0) {
                return { status: error.status, header: () => null, error };
            }
            throw error;
        }
    };

    async function putObject({
        file,
        key,
        metadata,
        bucket,
        public: isPublic,
        context
    }: UploadFileProps): Promise<UploadFileResult> {
        const formData = new FormData();
        formData.append("file", file);

        // Which property this file is for, so the server can enforce that
        // property's own `maxSize` and `acceptedFiles` — declared in the
        // collection, rendered by the panel's picker, and previously checked by
        // the browser alone. Two plain fields rather than a header: the request
        // is already multipart, and a header would have to survive every proxy
        // between here and the route.
        if (context?.collection && context?.property) {
            formData.append("collection", context.collection);
            formData.append("property", context.property);
        }

        // Public objects live under the public prefix so they can be served
        // token-less via a stable, permanent URL. Normalize the key here so the
        // stored path is self-describing (no server round-trip needed to know
        // it's public).
        //
        // With no key, the server names the object after the uploaded file —
        // at the root, which is not the public prefix. So a public upload with
        // no key is given that same name here, prefixed: the key is optional,
        // and `public: true` promised a token-less URL either way. A Blob
        // travels in the form as a file called "blob".
        let effectiveKey = key;
        if (isPublic) {
            effectiveKey ||= (file instanceof File && file.name) ? file.name : "blob";
            if (!isPublicStoragePath(effectiveKey)) {
                effectiveKey = `${PUBLIC_STORAGE_PREFIX}${effectiveKey.replace(/^\/+/, "")}`;
            }
        }

        if (effectiveKey) formData.append("key", effectiveKey);
        if (bucket) formData.append("bucket", bucket);
        if (storageId) formData.append("storageId", storageId);

        if (metadata) {
            for (const [key, value] of Object.entries(metadata)) {
                if (value !== undefined && value !== null) {
                    formData.append(
                        `metadata_${key}`,
                        typeof value === "string" ? value : JSON.stringify(value)
                    );
                }
            }
        }

        // A large file goes up a chunk at a time: the multipart request is
        // parsed whole by the server, three to five times the file in its
        // memory. Same fields, so the same object, the same checks and the
        // same triggers — only the transport differs.
        if (resumable && file.size > RESUMABLE_UPLOAD_THRESHOLD) {
            const outcome = await uploadResumable({ file, metadata: resumableMetadataOf(formData), send: sendResumable });
            if ("stored" in outcome) return outcome.stored;
            resumable = false;
        }

        const result = await transport.request<{ data: UploadFileResult }>(withStorageId("/storage/upload"), {
            method: "POST",
            body: formData,
            headers: {}
        });

        return result.data;
    }

    async function getSignedUrl(
        keyOrUrl: string,
        bucket?: string
    ): Promise<DownloadConfig> {
        const cacheKey = bucket ? `${bucket}/${keyOrUrl}` : keyOrUrl;
        // A private file's URL carries a download token the server minted for
        // whoever asked, and this source outlives them: after a sign-out, or
        // another user signing in in the same tab, the next preview of the
        // path was handed the previous user's URL. The credential the request
        // goes out with is the owner — the access token, in cookie mode too
        // (only the refresh token is a cookie) — so a different one empties
        // the cache first. A token refresh empties it as well, which costs one
        // request per file shown afterwards, once per access-token lifetime.
        urlsCache.claim((await transport.resolveToken()) ?? "");
        return urlsCache.get(cacheKey, () => resolveDownload(keyOrUrl, bucket));
    }

    async function resolveDownload(
        keyOrUrl: string,
        bucket?: string
    ): Promise<ResolvedDownload> {
        const filePath = storageObjectPath(keyOrUrl, bucket);

        if (!filePath || filePath.trim() === "" || filePath === "/") {
            return { config: { url: null, fileNotFound: true }, noStore: true };
        }

        // ── Public objects ────────────────────────────────────────────────
        // A public file (under the public prefix) is served token-less via a
        // stable, permanent, CDN-cacheable URL. No metadata round-trip and no
        // token are needed — build the URL directly and cache it forever.
        if (isPublicStoragePath(filePath)) {
            return {
                config: { url: withStorageId(`${fileUrlBase()}/storage/file/${encodeStorageKey(filePath)}`) }
                // no expiry
            };
        }

        try {
            const metadata = await describe(filePath);

            // Public object (server-confirmed): token-less permanent URL.
            if (metadata.public) {
                return {
                    config: {
                        url: withStorageId(`${fileUrlBase()}/storage/file/${encodeStorageKey(filePath)}`),
                        metadata
                    }
                    // no expiry
                };
            }

            // Private object: use the short-lived, file-scoped download token
            // minted by the server. We deliberately do NOT fall back to the
            // caller's access token — a URL must never carry a full-privilege
            // credential. If no scoped token is present the URL fails closed.
            const scopedToken = metadata.token;
            const tokenQuery = scopedToken ? `?token=${scopedToken}` : "";

            const downloadConfig: DownloadConfig = {
                // `withStorageId` picks `?` or `&` based on whether the token
                // query is already present, so the URL stays valid even when
                // there is no token.
                url: withStorageId(`${fileUrlBase()}/storage/file/${encodeStorageKey(filePath)}${tokenQuery}`),
                metadata
            };

            const expiresAt = metadata.tokenExpiresIn
                ? Date.now() + (metadata.tokenExpiresIn - 10) * 1000 // subtract 10s buffer
                : undefined;

            return { config: downloadConfig, expiresAt };
        } catch (e: unknown) {
            if (e instanceof Error && "status" in e && (e as { status: number }).status === 404) {
                return { config: { url: null, fileNotFound: true }, noStore: true };
            }
            throw e;
        }
    }

    async function getObject(
        key: string,
        bucket?: string
    ): Promise<File | null> {
        const downloadConfig = await getSignedUrl(key, bucket);
        if (downloadConfig.fileNotFound || !downloadConfig.url) {
            return null;
        }

        // Fetch using the signed URL directly. Since the scoped token is in the ?token= query param,
        // we explicitly omit any Authorization headers to prevent passing full access tokens to file serving routes.
        const response = await transport.fetchFn(downloadConfig.url, {
            headers: {}
        });

        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Failed to get file");

        const blob = await response.blob();
        const fileName = (bucket ? `${bucket}/${key}` : key).split("/").pop() || "file";
        return new File([blob], fileName, { type: blob.type });
    }

    async function deleteObject(
        key: string,
        bucket?: string
    ): Promise<void> {
        const filePath = storageObjectPath(key, bucket);

        if (!filePath || filePath.trim() === "" || filePath === "/") {
            return;
        }

        try {
            await transport.request(withStorageId(`/storage/file/${encodeStorageKey(filePath)}`), { method: "DELETE" });
        } catch (e: unknown) {
            if (!(e instanceof Error && "status" in e && (e as { status: number }).status === 404)) throw e;
        }

        urlsCache.delete(bucket ? `${bucket}/${key}` : key);
    }

    async function listObjects(
        prefix: string,
        options?: {
            bucket?: string;
            maxResults?: number;
            pageToken?: string;
        }
    ): Promise<StorageListResult> {
        const params = new URLSearchParams();
        if (prefix) params.set("prefix", prefix);
        if (options?.bucket) params.set("bucket", options.bucket);
        if (options?.maxResults) params.set("maxResults", String(options.maxResults));
        if (options?.pageToken) params.set("pageToken", options.pageToken);

        if (storageId) params.set("storageId", storageId);

        const result = await transport.request<{ data: StorageListResult }>(`/storage/list?${params.toString()}`);
        return result.data;
    }

    return {
        putObject,
        getSignedUrl,
        getObject,
        deleteObject,
        listObjects
    };
}
