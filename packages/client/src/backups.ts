import { Transport } from "./transport";
import { RebaseApiError, type BackupDownloadLink, type BackupListing } from "@rebasepro/types";

export interface CreateBackupsOptions {
    backupsPath?: string;
}

/** One backup's bytes, as {@link createBackups}' `stream()` answers them. */
export interface BackupStream {
    /** The dump, read from the server as it is consumed. */
    stream: ReadableStream<Uint8Array>;
    /** Its size in bytes, when the server said. */
    size?: number;
    /** Its file name: the key's last segment, as the server names the download. */
    name: string;
}

/**
 * Statuses that say the server cannot mint a download link at all — one that
 * predates `POST /download-url` (404/405), or one with no JWT secret to sign
 * it with (503) — rather than that this backup cannot be had. `download()`
 * then falls back to reading the bytes itself.
 */
const NO_LINKS = new Set([404, 405, 503]);

export function createBackups(transport: Transport, options?: CreateBackupsOptions) {
    const backupsPath = options?.backupsPath || "/admin/backups";
    /** Mirror transport.request's URL construction (baseUrl + apiPath + path). */
    const downloadPath = () => `${transport.baseUrl}${transport.apiPath}${backupsPath}/download`;

    async function list(): Promise<BackupListing> {
        return transport.request(backupsPath, { method: "GET" });
    }

    /**
     * A link to one backup's bytes, good for 60 seconds. The URL carries a
     * token that stands in for the `Authorization` header, for this backup
     * only, so anything can be pointed at it — a browser, `curl`, a
     * `fetch` that streams it to a file. The URL is absolute, on this
     * client's base URL.
     */
    async function downloadUrl(key: string): Promise<BackupDownloadLink> {
        const link = await transport.request<BackupDownloadLink>(`${backupsPath}/download-url`, {
            method: "POST",
            body: JSON.stringify({ key })
        });
        return {
            url: `${downloadPath()}?key=${encodeURIComponent(key)}&token=${encodeURIComponent(link.token)}`,
            token: link.token,
            expiresIn: link.expiresIn
        };
    }

    /**
     * A backup's bytes as a stream, read as they are consumed — the way to
     * write one to a file outside a browser:
     * `await pipeline(Readable.fromWeb(stream), fs.createWriteStream(name))`.
     *
     * Through the transport's own `fetch` and headers, so a client configured
     * with its own `fetch` or with default headers (a gateway key, the schema
     * version) reaches the same place every other call does.
     */
    async function stream(key: string): Promise<BackupStream> {
        const url = `${downloadPath()}?key=${encodeURIComponent(key)}`;
        const token = await transport.resolveToken();
        const headers = transport.getHeaders();
        // A GET with no body: the JSON default says nothing true here.
        delete headers["Content-Type"];
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await transport.fetchFn(url, { method: "GET", headers });
        if (!res.ok || !res.body) {
            throw new RebaseApiError(`Failed to download backup (${res.status})`, { status: res.status });
        }
        // `Content-Length` is CORS-safelisted; `Content-Disposition` is not,
        // so the name comes from the key, as the server's does.
        const length = Number(res.headers.get("Content-Length"));
        return {
            stream: res.body,
            ...(Number.isFinite(length) && length > 0 ? { size: length } : {}),
            name: fileNameOf(key)
        };
    }

    /**
     * Save a backup in the browser: the browser is sent to a
     * {@link downloadUrl} link and streams the dump to disk, so the page never
     * holds it. It used to be fetched into a Blob — the whole database in the
     * tab's memory, with no progress shown.
     *
     * Against a server that cannot mint links (one older than them, or one
     * with no JWT secret) it reads the bytes itself and saves them as before.
     *
     * Browser only. Elsewhere, {@link stream} writes a backup to a file and
     * {@link downloadUrl} gives a link.
     */
    async function download(key: string): Promise<void> {
        if (typeof document === "undefined") {
            throw new Error(
                "backups.download() hands the file to a browser to save. Outside one, use " +
                "backups.stream(key) to write it to a file, or backups.downloadUrl(key) for a link."
            );
        }
        let link: BackupDownloadLink;
        try {
            link = await downloadUrl(key);
        } catch (error: unknown) {
            if (!(error instanceof RebaseApiError) || error.status === undefined || !NO_LINKS.has(error.status)) throw error;
            const { stream: body, name } = await stream(key);
            const objectUrl = URL.createObjectURL(await new Response(body).blob());
            try {
                saveFrom(objectUrl, name);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
            return;
        }
        saveFrom(link.url, fileNameOf(key));
    }

    return { list, download, downloadUrl, stream };
}

/** The last segment of a backup's key: its file name, local path or object key alike. */
function fileNameOf(key: string): string {
    return key.split(/[\\/]/).pop() || key;
}

/**
 * Have the browser save `url` as `fileName`. The server answers a backup with
 * `Content-Disposition: attachment`, so the browser saves it rather than
 * navigating, cross-origin too, where `download` is ignored.
 */
function saveFrom(url: string, fileName: string): void {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
}
