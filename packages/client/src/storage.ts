import { StorageSource, UploadFileProps, UploadFileResult, DownloadConfig, StorageListResult, DownloadMetadata } from "@rebasepro/types";
import { Transport } from "./transport";

/**
 * Create a StorageSource that talks to the Rebase backend REST API.
 *
 * @param transport - HTTP transport instance
 * @param storageId - Optional storage-source key for multi-backend routing.
 *                    When set, it is forwarded to the server so the correct
 *                    `StorageController` is resolved from the registry.
 */
export function createStorage(transport: Transport, storageId?: string): StorageSource {
    const urlsCache = new Map<string, DownloadConfig>();

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
        bucket
    }: UploadFileProps): Promise<UploadFileResult> {
        const formData = new FormData();
        formData.append("file", file);

        if (key) formData.append("key", key);
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
        const cached = urlsCache.get(cacheKey);
        if (cached) return cached;

        let filePath = keyOrUrl;

        if (filePath && (filePath.startsWith("local://") || filePath.startsWith("s3://") || filePath.startsWith("gs://"))) {
            filePath = filePath.substring(filePath.indexOf("://") + 3);
        }

        if (bucket && filePath && !filePath.startsWith(bucket)) {
            filePath = `${bucket}/${filePath}`;
        }

        if (!filePath || filePath.trim() === "" || filePath === "/") {
            return { url: null,
fileNotFound: true };
        }

        try {
            const result = await transport.request<{ data: DownloadMetadata }>(withStorageId(`/storage/metadata/${filePath}`));

            const activeToken = await transport.resolveToken();
            const tokenQuery = activeToken ? `?token=${activeToken}` : "";

            const downloadConfig: DownloadConfig = {
                // `withStorageId` picks `?` or `&` based on whether the token
                // query is already present, so the URL stays valid even when
                // there is no auth token.
                url: withStorageId(`${transport.baseUrl}${transport.apiPath}/storage/file/${filePath}${tokenQuery}`),
                metadata: result.data
            };

            urlsCache.set(cacheKey, downloadConfig);
            return downloadConfig;
        } catch (e: unknown) {
            if (e instanceof Error && "status" in e && (e as { status: number }).status === 404) {
                return { url: null,
fileNotFound: true };
            }
            throw e;
        }
    }

    async function getObject(
        key: string,
        bucket?: string
    ): Promise<File | null> {
        let filePath = key;

        if (filePath && (filePath.startsWith("local://") || filePath.startsWith("s3://") || filePath.startsWith("gs://"))) {
            filePath = filePath.substring(filePath.indexOf("://") + 3);
        }

        if (bucket && filePath && !filePath.startsWith(bucket)) {
            filePath = `${bucket}/${filePath}`;
        }

        if (!filePath || filePath.trim() === "" || filePath === "/") {
            return null;
        }

        // We must use plain fetch because transport.request expects JSON response, but here we want a Blob.
        const url = withStorageId(`${transport.baseUrl}${transport.apiPath}/storage/file/${filePath}`);

        // This is a bit manual, but necessary for blob handling
        const response = await transport.fetchFn(url, {
            headers: transport.getHeaders ? transport.getHeaders() : {}
        });

        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Failed to get file");

        const blob = await response.blob();
        const fileName = filePath.split("/").pop() || "file";
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
            await transport.request(withStorageId(`/storage/file/${filePath}`), { method: "DELETE" });
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
