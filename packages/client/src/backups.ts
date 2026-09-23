import { Transport } from "./transport";
import { RebaseApiError, type BackupInfo, type BackupDestinationKind } from "@rebasepro/types";

export interface CreateBackupsOptions {
    backupsPath?: string;
}

export function createBackups(transport: Transport, options?: CreateBackupsOptions) {
    const backupsPath = options?.backupsPath || "/admin/backups";

    async function list(): Promise<{
        backups: BackupInfo[];
        destinationKind: BackupDestinationKind;
        configured: boolean;
    }> {
        return transport.request(backupsPath, { method: "GET" });
    }

    /**
     * Download a backup's bytes. Not through the JSON `request()`, since the
     * answer is an octet-stream to hand back as a Blob — but through the
     * transport's own `fetch` and headers all the same. It used the global
     * `fetch` and a bare `Authorization` header, so a client configured with
     * its own `fetch` or with default headers (a gateway key, the schema
     * version) had every call but this one go where it was told.
     */
    async function download(key: string): Promise<Blob> {
        // Mirror transport.request's URL construction (baseUrl + apiPath + path).
        const url = `${transport.baseUrl}${transport.apiPath}${backupsPath}/download?key=${encodeURIComponent(key)}`;
        const token = await transport.resolveToken();
        const headers = transport.getHeaders();
        // A GET with no body: the JSON default says nothing true here.
        delete headers["Content-Type"];
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await transport.fetchFn(url, { method: "GET", headers });
        if (!res.ok) {
            throw new RebaseApiError(`Failed to download backup (${res.status})`, { status: res.status });
        }
        return res.blob();
    }

    return { list, download };
}
