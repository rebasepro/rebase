import { Transport } from "./transport";
import type { BackupInfo, BackupDestinationKind } from "@rebasepro/types";

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
     * Download a backup's bytes. Uses an authenticated fetch (not the JSON
     * transport) so the octet-stream response comes back as a Blob.
     */
    async function download(key: string): Promise<Blob> {
        const token = await transport.resolveToken();
        // Mirror transport.request's URL construction (baseUrl + apiPath + path)
        // — this endpoint returns an octet-stream, so we fetch it directly
        // instead of going through the JSON transport.
        const url = `${transport.baseUrl}${transport.apiPath}${backupsPath}/download?key=${encodeURIComponent(key)}`;
        const res = await fetch(url, {
            method: "GET",
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        if (!res.ok) {
            throw new Error(`Failed to download backup (${res.status})`);
        }
        return res.blob();
    }

    return { list, download };
}
