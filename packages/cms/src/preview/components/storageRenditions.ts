import type { DownloadConfig } from "@rebasepro/types";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";

/**
 * Thumbnails of stored images through the storage file route's resize
 * (`?width=…&format=webp`) instead of the full-size original. A table page of
 * 100 rows showing 3 MB photos at 40 px downloaded ~300 MB; as 96 px webp
 * renditions it is ~1 MB.
 *
 * Only for a URL of the Rebase storage file route (`…/storage/file/…`) — a
 * Firebase or custom source's URL, or an external one, is left as it is — and
 * only for an image the server would transform (not SVG, not GIF).
 *
 * The resize needs `sharp`, which is optional: without it the route answers
 * 500. So whether a server resizes is learned once per page load from one probe
 * image, and no thumbnail asks for a rendition before that is known. A server
 * that cannot resize costs one failed request per page load, not one per row.
 */

/** Rendition widths, about twice the rendered box (high-density screens). */
const RENDITION_WIDTHS: Record<PreviewSize | "fill", number> = {
    small: 96,
    medium: 200,
    large: 400,
    fill: 800
};

/** How long a thumbnail waits for the probe before showing the original. */
const PROBE_PATIENCE_MS = 3_000;

const STORAGE_FILE_ROUTE = "/storage/file/";

/**
 * What each server (`<origin><api path>`) is known to do: `true`/`false` once
 * its probe settled, the probe itself while it runs. Per page load; a server
 * that gains or loses `sharp` is re-learned on the next one.
 */
const resizeSupport = new Map<string, boolean | Promise<boolean>>();

/** The same rule as the server's `isTransformableImage`. */
function transformableImage(contentType: string | undefined): boolean {
    return !!contentType
        && contentType.startsWith("image/")
        && !contentType.includes("svg")
        && !contentType.includes("gif");
}

/** The server a storage file URL belongs to, or undefined if it is not one / already transformed. */
function storageServer(url: string): string | undefined {
    const route = url.indexOf(STORAGE_FILE_ROUTE);
    if (route < 0 || url.includes("#")) return undefined;
    if (/[?&](width|height|format|quality|fit)=/.test(url)) return undefined;
    return url.slice(0, route);
}

function withResize(url: string, width: number): string {
    return `${url}${url.includes("?") ? "&" : "?"}width=${width}&format=webp`;
}

function probe(server: string, renditionUrl: string): Promise<boolean> {
    const running = new Promise<boolean>(resolve => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = renditionUrl;
    }).then(supported => {
        resizeSupport.set(server, supported);
        return supported;
    });
    resizeSupport.set(server, running);
    return running;
}

/**
 * The rendition URL to show for a stored file, or undefined to show the
 * original. Resolves at once when the server's support is known; otherwise
 * waits for the probe (at most {@link PROBE_PATIENCE_MS}, then the original).
 */
export async function storageRenditionUrl(
    config: DownloadConfig,
    size: PreviewSize,
    fill?: boolean
): Promise<string | undefined> {
    const url = config.url;
    if (!url || !transformableImage(config.metadata?.contentType)) return undefined;
    const server = storageServer(url);
    if (server === undefined) return undefined;

    const renditionUrl = withResize(url, RENDITION_WIDTHS[fill ? "fill" : size]);
    const known = resizeSupport.get(server);
    if (known === true) return renditionUrl;
    if (known === false) return undefined;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const supported = await Promise.race([
        known ?? probe(server, renditionUrl),
        new Promise<false>(resolve => {
            timer = setTimeout(() => resolve(false), PROBE_PATIENCE_MS);
        })
    ]).finally(() => clearTimeout(timer));
    return supported ? renditionUrl : undefined;
}

/** {@link storageRenditionUrl} when it can answer without waiting; `null` when it would have to wait. */
export function knownStorageRenditionUrl(
    config: DownloadConfig,
    size: PreviewSize,
    fill?: boolean
): string | undefined | null {
    const url = config.url;
    if (!url || !transformableImage(config.metadata?.contentType)) return undefined;
    const server = storageServer(url);
    if (server === undefined) return undefined;
    const known = resizeSupport.get(server);
    if (known === true) return withResize(url, RENDITION_WIDTHS[fill ? "fill" : size]);
    if (known === false) return undefined;
    return null;
}
