import { useCallback, useRef } from "react";
import { parseStorageReference, type StorageReferenceTarget } from "@rebasepro/types";
import { useStorageSource, useStorageSources } from "@rebasepro/app";

/**
 * Exchanges a storage reference for a URL to render now.
 *
 * Text that embeds a file — a markdown body's images — stores a
 * `rebase-storage:` reference rather than a URL, because a private object's
 * URL carries a download token that expires in minutes. Every place the panel
 * renders such text asks this for the URL at that moment.
 *
 * A reference with no `storageId` is the default source's; a named one is
 * looked up by its key. A source this panel does not have answers `null` —
 * a missing image, not the same key read from another bucket.
 *
 * @internal
 */
export function useStorageReferenceResolver(): (target: StorageReferenceTarget) => Promise<string | null> {
    const defaultSource = useStorageSource();
    const { sources } = useStorageSources();
    // Read through a ref, and re-identified only when the set of sources
    // changes — a new map holding the same sources must not make every
    // rendered preview resolve its images again.
    const latest = useRef(sources);
    latest.current = sources;
    const sourceKeys = Object.keys(sources).sort().join("\n");
    return useCallback(async ({ key, storageId }: StorageReferenceTarget) => {
        const source = storageId ? latest.current[storageId] : defaultSource;
        if (!source) return null;
        const config = await source.getSignedUrl(key);
        return config.fileNotFound ? null : config.url;
    // `sourceKeys` is read nowhere inside, on purpose: it gives the resolver a
    // new identity when a source is added or removed, so a preview that found
    // no source for its reference resolves again once that source arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-identify on the set of sources, not on the map
    }, [defaultSource, sourceKeys]);
}

/**
 * The same, for one `src`: a reference is resolved, anything else — an
 * ordinary URL — is answered as it is.
 *
 * @internal
 */
export function useImageSrcResolver(): (src: string) => Promise<string | null> {
    const resolve = useStorageReferenceResolver();
    return useCallback(async (src: string) => {
        const target = parseStorageReference(src);
        return target ? resolve(target) : src;
    }, [resolve]);
}
