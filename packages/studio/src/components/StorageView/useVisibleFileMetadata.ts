import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DownloadConfig, StorageSource } from "@rebasepro/types";

/**
 * What the storage browser shows of a file beyond its name. The listing carries
 * the size and version — and, except on S3, the type — of every file; the rest
 * is read per file, from the server, when it is needed.
 */
export interface FileMetadata {
    size?: number;
    contentType?: string;
    /**
     * A link minted when the metadata was read, for the thumbnail only: a
     * private file's token expires, and a link to share or download is minted
     * when it is used (see `FileLink` in `StorageView.tsx`).
     */
    downloadUrl?: string;
}

export function fileMetadataOf(config: DownloadConfig): FileMetadata {
    return {
        size: config.metadata?.size,
        contentType: config.metadata?.contentType,
        downloadUrl: config.url ?? undefined
    };
}

/**
 * How many metadata requests run at once: what one origin gets over HTTP/1.1.
 * Each is a round trip to the server, an auth hook and a HEAD on the bucket.
 */
export const METADATA_CONCURRENCY = 6;

const NO_METADATA: ReadonlyMap<string, FileMetadata> = new Map();

/**
 * The metadata asked for one listing: each path once, {@link METADATA_CONCURRENCY}
 * at a time, through the source that listed it. Cancelled when the listing is
 * replaced, so an answer for a folder or source the view has left is dropped.
 */
class MetadataRun<F extends { fullPath: string }> {
    private readonly requested = new Set<string>();
    private queue: string[] = [];
    private inFlight = 0;
    private cancelled = false;
    private answered: [string, FileMetadata][] = [];
    private flushQueued = false;

    constructor(
        private readonly source: StorageSource | null,
        private readonly files: ReadonlyMap<string, F>,
        private readonly publish: (answered: [string, FileMetadata][]) => void,
        /** Whether a file is worth a request at all — see `useVisibleFileMetadata`. */
        private readonly wants: (file: F) => boolean,
        /** Paths already answered for this listing, by an earlier run over it. */
        private readonly known: ReadonlyMap<string, FileMetadata>
    ) {}

    want(path: string | undefined): void {
        if (this.cancelled || !this.source || !path || this.requested.has(path) || this.known.has(path)) return;
        const file = this.files.get(path);
        if (!file || !this.wants(file)) return;
        this.requested.add(path);
        this.queue.push(path);
        this.pump();
    }

    cancel(): void {
        this.cancelled = true;
        this.queue = [];
        this.answered = [];
    }

    private pump(): void {
        const source = this.source;
        if (!source) return;
        while (!this.cancelled && this.inFlight < METADATA_CONCURRENCY && this.queue.length > 0) {
            const path = this.queue.shift();
            if (path === undefined) break;
            this.inFlight++;
            source.getSignedUrl(path)
                .then(config => this.deliver(path, fileMetadataOf(config)))
                // A file whose metadata cannot be read is still listed, with none.
                .catch(() => this.deliver(path, {}))
                .finally(() => {
                    this.inFlight--;
                    this.pump();
                });
        }
    }

    /** Answers that arrive together are published as one update. */
    private deliver(path: string, metadata: FileMetadata): void {
        if (this.cancelled) return;
        this.answered.push([path, metadata]);
        if (this.flushQueued) return;
        this.flushQueued = true;
        queueMicrotask(() => {
            this.flushQueued = false;
            if (this.cancelled || this.answered.length === 0) return;
            const answered = this.answered;
            this.answered = [];
            this.publish(answered);
        });
    }
}

/**
 * Metadata for the files of a listing, asked for as each comes on screen —
 * and only for those `wants` says need it: the listing already describes most
 * files (see `StorageReference.size`), so what is left is a file a source
 * listed bare, and the link an image's thumbnail is drawn from.
 *
 * The browser used to ask for every file's metadata before it showed any of
 * them: a folder of 1,000 files was 1,001 requests and seconds of a spinner.
 * The listing is shown as it comes back; a file's metadata is asked for when
 * its element — given {@link observe} as its `ref`, and its path as
 * `data-storage-path` — scrolls into view, a few requests at a time.
 *
 * Kept per listing: keyed by path, and dropped when `files` or `source`
 * changes — another folder, another source, or the same folder read again
 * after an upload or a delete, whose files may have changed. Without an
 * `IntersectionObserver` every file of the listing is asked for, still a few
 * at a time and still after the listing is shown.
 */
export function useVisibleFileMetadata<F extends { fullPath: string }>(
    source: StorageSource | null,
    files: readonly F[],
    wants: (file: F) => boolean = () => true
): {
    metadata: ReadonlyMap<string, FileMetadata>;
    observe: (element: HTMLElement | null) => (() => void) | undefined;
} {
    const [store, setStore] = useState<{ files: readonly F[]; entries: ReadonlyMap<string, FileMetadata> }>(
        () => ({ files, entries: NO_METADATA })
    );
    // What is already answered for this listing, for a run started over it
    // again — `wants` changed, say the grid was switched to — so it does not
    // ask for those twice.
    // Kept current by a layout effect declared before the one that reads it,
    // so it runs first in the same commit.
    const storeRef = useRef(store);
    useLayoutEffect(() => {
        storeRef.current = store;
    });
    const runRef = useRef<MetadataRun<F> | null>(null);
    const elementsRef = useRef(new Set<HTMLElement>());
    const observerRef = useRef<IntersectionObserver | null>(null);

    const observer = useCallback((): IntersectionObserver | null => {
        if (observerRef.current) return observerRef.current;
        if (typeof IntersectionObserver !== "function") return null;
        observerRef.current = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (entry.isIntersecting && entry.target instanceof HTMLElement) runRef.current?.want(entry.target.dataset.storagePath);
            }
        }, { rootMargin: "200px" });
        return observerRef.current;
    }, []);

    // Layout, not passive: it runs in the commit that shows the listing,
    // before an observer can report an element of it.
    useLayoutEffect(() => {
        const known = storeRef.current.files === files ? storeRef.current.entries : NO_METADATA;
        const run = new MetadataRun(source, new Map(files.map(file => [file.fullPath, file])), answered => setStore(previous => ({
            files,
            entries: new Map([...(previous.files === files ? previous.entries : NO_METADATA), ...answered])
        })), wants, known);
        runRef.current = run;
        // The elements already on screen — the same ones, when a folder is
        // read again — are looked at afresh for this listing.
        const io = observer();
        for (const element of elementsRef.current) {
            if (io) {
                io.unobserve(element);
                io.observe(element);
            } else {
                run.want(element.dataset.storagePath);
            }
        }
        return () => run.cancel();
    }, [source, files, wants, observer]);

    useEffect(() => () => {
        observerRef.current?.disconnect();
        observerRef.current = null;
    }, []);

    const observe = useCallback((element: HTMLElement | null) => {
        if (!element) return undefined;
        elementsRef.current.add(element);
        const io = observer();
        if (io) io.observe(element);
        else runRef.current?.want(element.dataset.storagePath);
        return () => {
            elementsRef.current.delete(element);
            io?.unobserve(element);
        };
    }, [observer]);

    return { metadata: store.files === files ? store.entries : NO_METADATA, observe };
}
