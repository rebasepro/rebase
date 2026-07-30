/**
 * React hook for using backend storage API as a StorageSource
 */

import { useMemo, useCallback } from "react";
import {
    StorageSource,
    UploadFileProps,
    UploadFileResult,
    DownloadConfig,
    StorageListResult
} from "@rebasepro/types";
import { DEFAULT_API_PATH } from "./ApiConfigContext";

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

    // Cache for download URLs to avoid redundant API calls
    const urlsCache = useMemo(() => new Map<string, DownloadConfig>(), []);

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
        if (cached) {
            return cached;
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

        const response = await fetchWithAuth(`${storageBasePath}/metadata/${filePath}`);

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

        const result = await response.json();

        const token = await getAuthToken();
        const tokenQuery = token ? `?token=${token}` : "";

        // The URL should point to the storage file endpoint
        const downloadConfig: DownloadConfig = {
            url: `${storageBasePath}/file/${filePath}${tokenQuery}`,
            metadata: result.data
        };

        // Cache the result
        urlsCache.set(cacheKey, downloadConfig);

        return downloadConfig;
    }, [fetchWithAuth, storageBasePath, urlsCache]);

    /**
     * Get file as a File object
     */
    const getObject = useCallback(async (
        key: string,
        bucket?: string
    ): Promise<File | null> => {
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
            return null;
        }

        const response = await fetchWithAuth(`${storageBasePath}/file/${filePath}`);

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error("Failed to get file");
        }

        const blob = await response.blob();
        const fileName = filePath.split("/").pop() || "file";
        return new File([blob], fileName, { type: blob.type });
    }, [fetchWithAuth, storageBasePath]);

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

        const response = await fetchWithAuth(`${storageBasePath}/file/${filePath}`, {
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
