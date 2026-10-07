/**
 * React hook for using backend storage API as a StorageSource
 */

import { useMemo, useCallback } from "react";
import {
    StorageSource,
    UploadFileProps,
    UploadFileResult,
    DownloadConfig,
    DownloadMetadata,
    StorageListResult,
    isPublicStoragePath,
    storageObjectPath
} from "@rebasepro/types";
import {
    DOWNLOAD_URL_CONCURRENCY,
    createBatchLoader,
    createConcurrencyLimit,
    createDownloadUrlCache,
    type DownloadMetadataBatchEntry,
    type ResolvedDownload
} from "@rebasepro/common";
import { DEFAULT_API_PATH } from "./ApiConfigContext";

/**
 * A storage key as it goes into a URL path: each segment encoded, the `/`
 * between them kept. A raw key with `#`, `?` or `%` in it cut the URL short or
 * made the server's decode throw.
 */
function encodeStorageKey(key: string): string {
    return key.split("/").map(encodeURIComponent).join("/");
}

export interface BackendStorageSourceProps {
    /**
     * Backend API URL (e.g., 'http://localhost:3001')
     */
    apiUrl: string;
    /**
     * The path the backend mounts its API under. Defaults to the server's own
     * default; pass the backend's `basePath` if it was configured otherwise.
     */
    apiPath?: string;
    /**
     * Function to get the current auth token
     */
    getAuthToken: () => Promise<string>;
}

/**
 * Hook to create a StorageSource that uses the backend storage REST API.
 * Use this for self-hosted Rebase with local or S3 storage.
 *
 * @example
 * ```tsx
 * const storageSource = useBackendStorageSource({
 *     apiUrl: 'http://localhost:3001',
 *     getAuthToken: authController.getAuthToken
 * });
 *
 * // Then pass to Rebase:
 * <Rebase storageSource={storageSource} ... />
 * ```
 */
export function useBackendStorageSource({
    apiUrl,
    apiPath = DEFAULT_API_PATH,
    getAuthToken
}: BackendStorageSourceProps): StorageSource {

    const storageBasePath = `${apiUrl.replace(/\/+$/, "")}${apiPath}/storage`;

    // Cache for download URLs to avoid redundant API calls, keyed by
    // `[bucket/]keyOrUrl`. A private file's URL carries a download token that
    // expires, and the entry with it; `deleteObject` drops it; bounded LRU;
    // owned by the access token its URLs were minted with (see
    // `getSignedUrl`). Concurrent lookups of one key share one `/metadata`
    // request, and at most DOWNLOAD_URL_CONCURRENCY of those are open at once.
    const urlsCache = useMemo(() => createDownloadUrlCache(), []);
    const limitMetadata = useMemo(() => createConcurrencyLimit(DOWNLOAD_URL_CONCURRENCY), []);

    /**
     * Make an authenticated request to the storage API
     */
    const fetchWithAuth = useCallback(async (
        url: string,
        options: RequestInit = {}
    ): Promise<Response> => {
        const token = await getAuthToken();
        return fetch(url, {
            ...options,
            headers: {
                ...options.headers,
                "Authorization": `Bearer ${token}`
            }
        });
    }, [getAuthToken]);

    /**
     * Upload a file to storage
     */
    const putObject = useCallback(async ({
        file,
        key,
        metadata,
        bucket
    }: UploadFileProps): Promise<UploadFileResult> => {
        const formData = new FormData();
        formData.append("file", file);

        if (key) {
            formData.append("key", key);
        }
        if (bucket) {
            formData.append("bucket", bucket);
        }

        // Add metadata fields with prefix
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

        const response = await fetchWithAuth(`${storageBasePath}/upload`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: "Upload failed" }));
            throw new Error(error.error || "Upload failed");
        }

        const result = await response.json();
        return result.data;
    }, [fetchWithAuth, storageBasePath]);

    /**
     * A private file's metadata and download token, or `null` when there is
     * no such file. The lookups a page starts together go as one
     * `POST /storage/metadata` per hundred files, which the server charges a
     * tenth of the requests it replaces; one asked for alone is the `GET` it
     * always was. A server without the batch route (404) is asked one file at
     * a time from then on.
     */
    const describe = useMemo(() => createBatchLoader<DownloadMetadata | null>({
        loadOne: async (filePath) => {
            const response = await limitMetadata(() =>
                fetchWithAuth(`${storageBasePath}/metadata/${encodeStorageKey(filePath)}`));
            if (response.status === 404) return null;
            if (!response.ok) {
                const error = await response.json().catch(() => ({ error: "Failed to get download URL" }));
                throw new Error(error.error || "Failed to get download URL");
            }
            const result: { data: DownloadMetadata } = await response.json();
            return result.data;
        },
        loadMany: async (filePaths) => {
            const response = await limitMetadata(() => fetchWithAuth(`${storageBasePath}/metadata`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ keys: filePaths })
            }));
            if (!response.ok) {
                throw Object.assign(new Error(`Failed to get download URLs (${response.status})`), { status: response.status });
            }
            const result: { data: Record<string, DownloadMetadataBatchEntry> } = await response.json();
            const answers = new Map<string, DownloadMetadata | null | Error>();
            for (const [filePath, entry] of Object.entries(result.data ?? {})) {
                if (!("error" in entry)) answers.set(filePath, entry);
                else if (entry.error.status === 404) answers.set(filePath, null);
                else answers.set(filePath, new Error(entry.error.message || "Failed to get download URL"));
            }
            return answers;
        },
        isUnsupported: (error) => error instanceof Error && "status" in error && (error.status === 404 || error.status === 405)
    }), [fetchWithAuth, limitMetadata, storageBasePath]);

    /**
     * Resolve a file's download URL: the network half of `getSignedUrl`.
     */
    const resolveDownload = useCallback(async (
        keyOrUrl: string,
        bucket?: string
    ): Promise<ResolvedDownload> => {
        // The path the storage routes address the object by — the SDK's rule.
        const filePath = storageObjectPath(keyOrUrl, bucket);

        if (!filePath || filePath.trim() === "" || filePath === "/") {
            return { config: { url: null, fileNotFound: true }, noStore: true };
        }

        const fileUrl = `${storageBasePath}/file/${encodeStorageKey(filePath)}`;

        // A public file is served token-less at a permanent URL.
        if (isPublicStoragePath(filePath)) {
            return { config: { url: fileUrl } };
        }

        const metadata = await describe(filePath);

        if (metadata === null) {
            return { config: { url: null, fileNotFound: true }, noStore: true };
        }

        if (metadata.public) {
            return { config: { url: fileUrl, metadata } };
        }

        // A private file is read with the short-lived download token the
        // metadata call minted for this one path. Never the session's access
        // token: the file route refuses it, and a URL is no place for a
        // full-privilege credential — it lands in `<img src>` and access logs.
        const scopedToken = metadata.token;
        const downloadConfig: DownloadConfig = {
            url: scopedToken ? `${fileUrl}?token=${encodeURIComponent(scopedToken)}` : fileUrl,
            metadata
        };

        return {
            config: downloadConfig,
            // Ten seconds early, so a URL handed out is still good when used.
            expiresAt: metadata.tokenExpiresIn
                ? Date.now() + (metadata.tokenExpiresIn - 10) * 1000
                : undefined
        };
    }, [describe, storageBasePath]);

    /**
     * Get download URL for a file
     */
    const getSignedUrl = useCallback(async (
        keyOrUrl: string,
        bucket?: string
    ): Promise<DownloadConfig> => {
        const cacheKey = bucket ? `${bucket}/${keyOrUrl}` : keyOrUrl;
        // A private file's URL carries a download token the server minted for
        // whoever asked, and this source outlives them: after a sign-out, or
        // another user signing in in the same tab, the next preview of the
        // path was handed the previous user's URL. This hook knows the user
        // only by `getAuthToken`, so that token owns the cache, and a
        // different one empties it first (a refresh too: one request per file
        // shown afterwards, once per access-token lifetime). A public file's
        // URL carries no token and belongs to no one, so it is not asked for
        // one: signed out, `getAuthToken` may be a refresh request.
        const filePath = storageObjectPath(keyOrUrl, bucket);
        if (!filePath || !isPublicStoragePath(filePath)) {
            let credential = "";
            try {
                credential = await getAuthToken();
            } catch {
                // Signed out: the anonymous owner.
            }
            urlsCache.claim(credential);
        }
        return urlsCache.get(cacheKey, () => resolveDownload(keyOrUrl, bucket));
    }, [getAuthToken, resolveDownload, urlsCache]);

    /**
     * Get file as a File object
     */
    const getObject = useCallback(async (
        key: string,
        bucket?: string
    ): Promise<File | null> => {
        const downloadConfig = await getSignedUrl(key, bucket);
        if (downloadConfig.fileNotFound || !downloadConfig.url) {
            return null;
        }

        // The URL carries its own scoped token. No Authorization header: the
        // file route refuses the session's access token.
        const response = await fetch(downloadConfig.url);

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error("Failed to get file");
        }

        const blob = await response.blob();
        const fileName = (bucket ? `${bucket}/${key}` : key).split("/").pop() || "file";
        return new File([blob], fileName, { type: blob.type });
    }, [getSignedUrl]);

    /**
     * Delete a file
     */
    const deleteObject = useCallback(async (
        key: string,
        bucket?: string
    ): Promise<void> => {
        const filePath = storageObjectPath(key, bucket);

        if (!filePath || filePath.trim() === "" || filePath === "/") {
            return;
        }

        const response = await fetchWithAuth(`${storageBasePath}/file/${encodeStorageKey(filePath)}`, {
            method: "DELETE"
        });

        if (!response.ok && response.status !== 404) {
            const error = await response.json().catch(() => ({ error: "Failed to delete file" }));
            throw new Error(error.error || "Failed to delete file");
        }

        // Clear from cache
        urlsCache.delete(bucket ? `${bucket}/${key}` : key);
    }, [fetchWithAuth, storageBasePath, urlsCache]);

    /**
     * List files in a path
     */
    const listObjects = useCallback(async (
        prefix: string,
        options?: {
            bucket?: string;
            maxResults?: number;
            pageToken?: string;
        }
    ): Promise<StorageListResult> => {
        const params = new URLSearchParams();
        if (prefix) params.set("prefix", prefix);
        if (options?.bucket) params.set("bucket", options.bucket);
        if (options?.maxResults) params.set("maxResults", String(options.maxResults));
        if (options?.pageToken) params.set("pageToken", options.pageToken);

        const response = await fetchWithAuth(
            `${storageBasePath}/list?${params.toString()}`
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: "Failed to list files" }));
            throw new Error(error.error || "Failed to list files");
        }

        const result = await response.json();
        return result.data;
    }, [fetchWithAuth, storageBasePath]);

    // Return memoized StorageSource
    return useMemo<StorageSource>(() => ({
        putObject,
        getSignedUrl,
        getObject,
        deleteObject,
        listObjects
    }), [putObject, getSignedUrl, getObject, deleteObject, listObjects]);
}
