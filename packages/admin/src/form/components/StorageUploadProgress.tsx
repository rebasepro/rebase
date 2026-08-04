import React, { useCallback } from "react";

import { useSnackbarController, useStorageSource } from "@rebasepro/app";
import { StorageFieldItem } from "@rebasepro/app";
import { ErrorView } from "@rebasepro/app";
import type { StorageSource } from "@rebasepro/types";
import { cls, paperMixin, Skeleton } from "@rebasepro/ui";

export interface StorageUploadItemProps {
    storagePath: string;
    metadata?: Record<string, unknown>,
    entry: StorageFieldItem,
    onFileUploadComplete: (value: string,
        entry: StorageFieldItem,
        metadata?: Record<string, unknown>,
        uploadedUrl?: string) => Promise<void>;
    imageSize: number;
    simple: boolean;
    /** Override the storage source for this upload. When provided, this source
     *  is used instead of the default from context — enabling per-property
     *  multi-backend uploads. */
    storageSource?: StorageSource;
}

export function StorageUploadProgress({
    storagePath,
    entry,
    metadata,
    onFileUploadComplete,
    imageSize,
    simple,
    storageSource: storageSourceProp
}: StorageUploadItemProps) {

    const defaultStorageSource = useStorageSource();
    const storageSource = storageSourceProp ?? defaultStorageSource;

    const snackbarController = useSnackbarController();

    const [error, setError] = React.useState<Error | undefined>();
    const [loading, setLoading] = React.useState<boolean>(false);
    const mounted = React.useRef(false);
    const uploading = React.useRef(false);

    const upload = useCallback((file: File, fileName?: string) => {

        if (uploading.current) return;
        uploading.current = true;
        setError(undefined);
        setLoading(true);

        const key = storagePath && fileName ? `${storagePath}/${fileName}` : fileName || storagePath || "unnamed";
        storageSource.putObject({
            file,
            key,
            metadata
        })
            .then(async ({ key: resultKey, storageUrl }) => {
                console.debug("Upload successful", resultKey);
                await onFileUploadComplete(resultKey, entry, metadata, storageUrl);
                if (mounted.current)
                    setLoading(false);
            })
            .catch((e) => {
                console.warn("Upload error", e);
                if (mounted.current) {
                    setError(e);
                    setLoading(false);
                    snackbarController.open({
                        type: "error",
                        message: "Error uploading file: " + e.message
                    });
                }
            })
            .finally(() => {
                uploading.current = false;
            });
    }, [entry, metadata, onFileUploadComplete, storageSource, storagePath]);

    React.useEffect(() => {
        mounted.current = true;
        if (entry.file)
            upload(entry.file, entry.fileName);
        return () => {
            mounted.current = false;
        };
    }, [entry.file, entry.fileName, upload]);

    if (simple) {
        // `imageSize` is a pixel count, so it has to be sized inline: `w-${n}`
        // is neither a real Tailwind scale value nor a class the JIT can see.
        return <div style={{
            width: imageSize,
            height: imageSize
        }}>

            {loading && <Skeleton width={imageSize}
                height={imageSize}/>}

        </div>
    }
    return (

        <div className={cls(paperMixin,
            "p-4 relative border-box flex items-center justify-center",
            `min-w-[${imageSize}px] min-h-[${imageSize}px]`)}>

            {loading &&
                <Skeleton className="w-full h-full"/>}

            {error && <ErrorView title={"Error uploading file"}
                error={error}/>}

        </div>

    );

}
