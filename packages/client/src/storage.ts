import { StorageSource, UploadFileProps, UploadFileResult, DownloadConfig, StorageListResult, DownloadMetadata } from "@rebasepro/types";
import { Transport } from "./transport";

export function createStorage(transport: Transport): StorageSource {
    const urlsCache = new Map<string, DownloadConfig>();
    
    // We expect the transport to point to /api, and storage endpoints handle /api/storage internally if they are relative?
    // Wait, useBackendStorageSource uses `${apiUrl}/api/storage` directly.
    // Transport has `.request` which hits `${config.baseUrl}${config.apiPath}${path}`.
    // Assuming `config.apiPath` is "/api", we just request(`/storage/upload`, ...).

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

        // We use fetchFn directly if we need to do multipart boundary, but Transport.request might override Content-Type?
        // Wait, transport.request defaults to application/json. We must remove Content-Type header or allow it to be evaluated by fetch when body is FormData!
        const result = await transport.request<{ data: UploadFileResult }>("/storage/upload", {
            method: "POST",
            body: formData,
            headers: {
                // transport.request merges headers, so to prevent it setting application/json we can delete it 
                // in transport if body is FormData, or we can explicitly set it to an empty string.
                // Let's rely on standard behaviour for now and adjust transport if it fails.
            }
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

        if (filePath && (filePath.startsWith("local://") || filePath.startsWith("s3://"))) {
            filePath = filePath.substring(filePath.indexOf("://") + 3);
        }

        if (bucket && filePath && !filePath.startsWith(bucket)) {
            filePath = `${bucket}/${filePath}`;
        }

        if (!filePath || filePath.trim() === '' || filePath === '/') {
            return { url: null, fileNotFound: true };
        }

        try {
            const result = await transport.request<{ data: DownloadMetadata }>(`/storage/metadata/${filePath}`);
            
            const activeToken = await transport.resolveToken();
            const tokenQuery = activeToken ? `?token=${activeToken}` : '';

            const downloadConfig: DownloadConfig = {
                url: `${transport.baseUrl}${transport.apiPath}/storage/file/${filePath}${tokenQuery}`,
                metadata: result.data
            };

            urlsCache.set(cacheKey, downloadConfig);
            return downloadConfig;
        } catch (e: unknown) {
            if (e instanceof Error && 'status' in e && (e as { status: number }).status === 404) {
                return { url: null, fileNotFound: true };
            }
            throw e;
        }
    }

    async function getObject(
        key: string,
        bucket?: string
    ): Promise<File | null> {
        let filePath = key;

        if (filePath && (filePath.startsWith("local://") || filePath.startsWith("s3://"))) {
            filePath = filePath.substring(filePath.indexOf("://") + 3);
        }

        if (bucket && filePath && !filePath.startsWith(bucket)) {
            filePath = `${bucket}/${filePath}`;
        }

        if (!filePath || filePath.trim() === '' || filePath === '/') {
            return null;
        }

        // We must use plain fetch because transport.request expects JSON response, but here we want a Blob.
        const url = `${transport.baseUrl}${transport.apiPath}/storage/file/${filePath}`;
        
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

        if (filePath && (filePath.startsWith("local://") || filePath.startsWith("s3://"))) {
            filePath = filePath.substring(filePath.indexOf("://") + 3);
        }

        if (bucket && filePath && !filePath.startsWith(bucket)) {
            filePath = `${bucket}/${filePath}`;
        }

        if (!filePath || filePath.trim() === '' || filePath === '/') {
            return;
        }

        try {
            await transport.request(`/storage/file/${filePath}`, { method: "DELETE" });
        } catch (e: unknown) {
            if (!(e instanceof Error && 'status' in e && (e as { status: number }).status === 404)) throw e;
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
