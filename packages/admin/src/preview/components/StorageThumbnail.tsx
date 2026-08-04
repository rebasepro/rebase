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
        storage.getSignedUrl(storagePathOrDownloadUrl)
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
