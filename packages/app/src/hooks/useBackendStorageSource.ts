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
    isPublicStoragePath
} from "@rebasepro/types";
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

    // Cache for download URLs to avoid redundant API calls. A private file's
    // URL carries a download token that expires, and the entry with it.
    const urlsCache = useMemo(() => new Map<string, { config: DownloadConfig; expiresAt?: number }>(), []);

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
     * Get download URL for a file
     */
    const getSignedUrl = useCallback(async (
        keyOrUrl: string,
        bucket?: string
    ): Promise<DownloadConfig> => {
        // Check cache first
        const cacheKey = bucket ? `${bucket}/${keyOrUrl}` : keyOrUrl;
        const cached = urlsCache.get(cacheKey);
        if (cached && (cached.expiresAt === undefined || cached.expiresAt > Date.now())) {
            return cached.config;
        }

        // Build the file path for the API
        let filePath = keyOrUrl;

        // Handle local:// and s3:// URLs
        if (filePath && (filePath.startsWith("local://") || filePath.startsWith("s3://"))) {
            const withoutProtocol = filePath.substring(filePath.indexOf("://") + 3);
            filePath = withoutProtocol;
        }

        // If bucket is provided separately, prepend it
        if (bucket && filePath && !filePath.startsWith(bucket)) {
            filePath = `${bucket}/${filePath}`;
        }

        if (!filePath || filePath.trim() === "" || filePath === "/") {
            return { url: null,
fileNotFound: true };
        }

        const fileUrl = `${storageBasePath}/file/${encodeStorageKey(filePath)}`;

        // A public file is served token-less at a permanent URL.
        if (isPublicStoragePath(filePath)) {
            const publicConfig: DownloadConfig = { url: fileUrl };
            urlsCache.set(cacheKey, { config: publicConfig });
            return publicConfig;
        }

        const response = await fetchWithAuth(`${storageBasePath}/metadata/${encodeStorageKey(filePath)}`);

        if (response.status === 404) {
            return {
                url: null,
                fileNotFound: true
            };
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: "Failed to get download URL" }));
            throw new Error(error.error || "Failed to get download URL");
        }

        const result: { data: DownloadMetadata } = await response.json();

        if (result.data.public) {
            const publicConfig: DownloadConfig = { url: fileUrl, metadata: result.data };
            urlsCache.set(cacheKey, { config: publicConfig });
            return publicConfig;
        }

        // A private file is read with the short-lived download token the
        // metadata call minted for this one path. Never the session's access
        // token: the file route refuses it, and a URL is no place for a
        // full-privilege credential — it lands in `<img src>` and access logs.
        const scopedToken = result.data.token;
        const downloadConfig: DownloadConfig = {
            url: scopedToken ? `${fileUrl}?token=${encodeURIComponent(scopedToken)}` : fileUrl,
            metadata: result.data
        };

        urlsCache.set(cacheKey, {
            config: downloadConfig,
            // Ten seconds early, so a URL handed out is still good when used.
            expiresAt: result.data.tokenExpiresIn
                ? Date.now() + (result.data.tokenExpiresIn - 10) * 1000
                : undefined
        });

        return downloadConfig;
    }, [fetchWithAuth, storageBasePath, urlsCache]);

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
        let filePath = key;

        // Handle protocol URLs
        if (filePath && (filePath.startsWith("local://") || filePath.startsWith("s3://"))) {
            const withoutProtocol = filePath.substring(filePath.indexOf("://") + 3);
            filePath = withoutProtocol;
        }

        if (bucket && filePath && !filePath.startsWith(bucket)) {
            filePath = `${bucket}/${filePath}`;
        }

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
