import React, { useEffect } from "react";

import { renderSkeletonImageThumbnail } from "../property_previews/SkeletonPropertyComponent";
import { UrlComponentPreview } from "./UrlComponentPreview";
import { ErrorView, useStorageSource, useStorageSources, useTranslation } from "@rebasepro/app";
import { resolveStorageSource } from "@rebasepro/common";
import { DownloadConfig, FileType } from "@rebasepro/types";
import type { PreviewSize } from "../../types/components/PropertyPreviewProps";
import { Skeleton } from "@rebasepro/ui";
type StorageThumbnailProps = {
    storagePathOrDownloadUrl: string;
    storeUrl: boolean;
    size: PreviewSize;
    interactive?: boolean;
    fill?: boolean;
    /** Key of the storage source backing this property (`StorageConfig.storageSource`). */
    storageSourceKey?: string;
};

/**
 * @group Preview components
 */
export const StorageThumbnail = React.memo<StorageThumbnailProps>(StorageThumbnailInternal, areEqual) as React.FunctionComponent<StorageThumbnailProps>;

function areEqual(prevProps: StorageThumbnailProps, nextProps: StorageThumbnailProps) {
    return prevProps.size === nextProps.size &&
        prevProps.storagePathOrDownloadUrl === nextProps.storagePathOrDownloadUrl &&
        prevProps.storeUrl === nextProps.storeUrl &&
        prevProps.interactive === nextProps.interactive &&
        prevProps.fill === nextProps.fill &&
        prevProps.storageSourceKey === nextProps.storageSourceKey;
}

const URL_CACHE: Record<string, DownloadConfig> = {};

/**
 * The signed-URL request currently in flight for a given cache key.
 *
 * A collection view draws one thumbnail per row and rows share images far more
 * often than not — the demo's 200 blog posts are illustrated by 20 hero images.
 * Every one of those thumbnails mounts in the same tick, and each used to call
 * `getSignedUrl` on its own: {@link URL_CACHE} is only written when a response
 * *lands*, so it is still empty while the burst goes out and dedupes nothing.
 * The result was five or more identical requests per distinct file, and minting
 * a download token is a real request — `/api/storage/metadata/<path>` — against
 * a rate-limited surface. One page view was enough to exhaust the budget and
 * every thumbnail on the screen then failed with a 429.
 *
 * Sharing the promise collapses that burst to one request per file. It
 * deliberately does not extend how long anything is cached: `DownloadConfig.url`
 * is temporal, so a later mount still refetches exactly as it did before.
 */
const IN_FLIGHT = new Map<string, Promise<DownloadConfig>>();

function getSignedUrlOnce(
    storage: { getSignedUrl: (path: string) => Promise<DownloadConfig> },
    path: string,
    cacheKey: string
): Promise<DownloadConfig> {
    const existing = IN_FLIGHT.get(cacheKey);
    if (existing) return existing;

    const request = storage.getSignedUrl(path).finally(() => {
        IN_FLIGHT.delete(cacheKey);
    });
    IN_FLIGHT.set(cacheKey, request);
    return request;
}

export function StorageThumbnailInternal({
    storeUrl,
    interactive,
    storagePathOrDownloadUrl,
    size,
    fill,
    storageSourceKey
}: StorageThumbnailProps) {

    const { t } = useTranslation();
    const [error, setError] = React.useState<Error | undefined>(undefined);
    const defaultStorage = useStorageSource();
    const storageSources = useStorageSources();
    // Resolve the per-property backend so previews of `storeUrl: false`
    // properties pointing at a named source hit the right backend.
    const storage = resolveStorageSource({
        sourceKey: storageSourceKey,
        sources: storageSources.sources,
        defaultSource: defaultStorage
    });

    // Cache key is namespaced by source so the same path on two backends
    // does not collide.
    const cacheKey = `${storageSourceKey ?? ""}::${storagePathOrDownloadUrl}`;

    const [downloadConfig, setDownloadConfig] = React.useState<DownloadConfig>(URL_CACHE[cacheKey]);

    useEffect(() => {
        if (!storagePathOrDownloadUrl)
            return;
        let unmounted = false;
        getSignedUrlOnce(storage, storagePathOrDownloadUrl, cacheKey)
            .then(function (downloadConfig) {
                if (!unmounted) {
                    setDownloadConfig(downloadConfig);
                    URL_CACHE[cacheKey] = downloadConfig;
                }
            }).catch(setError);
        return () => {
            unmounted = true;
        };
    }, [storagePathOrDownloadUrl, cacheKey]);

    if (!storagePathOrDownloadUrl) return null;

    const filetype = downloadConfig?.metadata ? getFiletype(downloadConfig?.metadata.contentType) : undefined;
    const previewType = filetype?.startsWith("image")
        ? "image"
        : (filetype?.startsWith("video")
            ? "video"
            : (filetype?.startsWith("audio") ? "audio" : "file"));

    if (downloadConfig?.fileNotFound)
        // `file_not_found` is translated into seven locales and this rendered
        // the English literal, so a German panel said "File not found".
        return <ErrorView error={t("file_not_found")}></ErrorView>

    return downloadConfig?.url
        ? <UrlComponentPreview previewType={previewType}
            url={downloadConfig.url}
            interactive={interactive}
            size={size}
            fill={fill}
            hint={storagePathOrDownloadUrl}/>
        : fill
            ? <Skeleton className="w-full h-full"/>
            : renderSkeletonImageThumbnail(size);
}

function getFiletype(input: string): FileType {
    if (input.startsWith("image")) return "image/*";
    else if (input.startsWith("video")) return "video/*";
    else if (input.startsWith("audio")) return "audio/*";
    else if (input.startsWith("application")) return "application/*";
    else if (input.startsWith("text")) return "text/*";
    else if (input.startsWith("font")) return "font/*";
    else return input;
}
