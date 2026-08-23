import { StorageSource, UploadFileProps, UploadFileResult, DownloadConfig, StorageListResult, DownloadMetadata, PUBLIC_STORAGE_PREFIX, isPublicStoragePath } from "@rebasepro/types";
import { Transport } from "./transport";

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

export function createStorage(transport: Transport, storageId?: string): StorageSource {
    const urlsCache = new Map<string, { config: DownloadConfig; expiresAt?: number }>();

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

    async function putObject({
        file,
        key,
        metadata,
        bucket,
        public: isPublic
    }: UploadFileProps): Promise<UploadFileResult> {
        const formData = new FormData();
        formData.append("file", file);

        // Public objects live under the public prefix so they can be served
        // token-less via a stable, permanent URL. Normalize the key here so the
        // stored path is self-describing (no server round-trip needed to know
        // it's public).
        let effectiveKey = key;
        if (isPublic && effectiveKey && !isPublicStoragePath(effectiveKey)) {
            effectiveKey = `${PUBLIC_STORAGE_PREFIX}${effectiveKey.replace(/^\/+/, "")}`;
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
        const cachedEntry = urlsCache.get(cacheKey);
        if (cachedEntry) {
            if (!cachedEntry.expiresAt || cachedEntry.expiresAt > Date.now()) {
                return cachedEntry.config;
            }
            urlsCache.delete(cacheKey);
        }

        let filePath = keyOrUrl;

        if (filePath && (filePath.startsWith("local://") || filePath.startsWith("s3://") || filePath.startsWith("gs://"))) {
            filePath = filePath.substring(filePath.indexOf("://") + 3);
        }

        if (bucket && filePath && !filePath.startsWith(bucket)) {
            filePath = `${bucket}/${filePath}`;
        }

        if (!filePath || filePath.trim() === "" || filePath === "/") {
            return { url: null, fileNotFound: true };
        }

        // ── Public objects ────────────────────────────────────────────────
        // A public file (under the public prefix) is served token-less via a
        // stable, permanent, CDN-cacheable URL. No metadata round-trip and no
        // token are needed — build the URL directly and cache it forever.
        if (isPublicStoragePath(filePath)) {
            const publicConfig: DownloadConfig = {
                url: withStorageId(`${fileUrlBase()}/storage/file/${encodeStorageKey(filePath)}`)
            };
            urlsCache.set(cacheKey, { config: publicConfig }); // no expiry
            return publicConfig;
        }

        try {
            const result = await transport.request<{ data: DownloadMetadata }>(withStorageId(`/storage/metadata/${encodeStorageKey(filePath)}`));

            // Public object (server-confirmed): token-less permanent URL.
            if (result.data.public) {
                const publicConfig: DownloadConfig = {
                    url: withStorageId(`${fileUrlBase()}/storage/file/${encodeStorageKey(filePath)}`),
                    metadata: result.data
                };
                urlsCache.set(cacheKey, { config: publicConfig }); // no expiry
                return publicConfig;
            }

            // Private object: use the short-lived, file-scoped download token
            // minted by the server. We deliberately do NOT fall back to the
            // caller's access token — a URL must never carry a full-privilege
            // credential. If no scoped token is present the URL fails closed.
            const scopedToken = result.data.token;
            const tokenQuery = scopedToken ? `?token=${scopedToken}` : "";

            const downloadConfig: DownloadConfig = {
                // `withStorageId` picks `?` or `&` based on whether the token
                // query is already present, so the URL stays valid even when
                // there is no token.
                url: withStorageId(`${fileUrlBase()}/storage/file/${encodeStorageKey(filePath)}${tokenQuery}`),
                metadata: result.data
            };

            const expiresAt = result.data.tokenExpiresIn
                ? Date.now() + (result.data.tokenExpiresIn - 10) * 1000 // subtract 10s buffer
                : undefined;

            urlsCache.set(cacheKey, { config: downloadConfig, expiresAt });
            return downloadConfig;
        } catch (e: unknown) {
            if (e instanceof Error && "status" in e && (e as { status: number }).status === 404) {
                return { url: null, fileNotFound: true };
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
        let filePath = key;

        if (filePath && (filePath.startsWith("local://") || filePath.startsWith("s3://") || filePath.startsWith("gs://"))) {
            filePath = filePath.substring(filePath.indexOf("://") + 3);
        }

        if (bucket && filePath && !filePath.startsWith(bucket)) {
            filePath = `${bucket}/${filePath}`;
        }

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
