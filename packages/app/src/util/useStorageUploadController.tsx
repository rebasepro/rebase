
import type { ArrayProperty, Property, StringProperty } from "@rebasepro/types";
import Compressor from "compressorjs";
import { deepEqual as equal } from "fast-equals";

import { resourceKeyOf } from "@rebasepro/types";
import { EntityValues, StorageConfig, StorageSource, StorageSourceRegistry } from "@rebasepro/types";import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveStorageFilenameString, resolveStoragePathString, resolveStorageSource } from "@rebasepro/common";
import { useAuthController } from "../hooks";
import { useStorageSources } from "../contexts/StorageSourcesContext";
import { randomString } from "@rebasepro/utils";

export type StorageFieldSize = "smallest" | "small" | "medium" | "large" | number;

/**
 * Internal representation of an item in the storage
 * It can have two states, having a storagePathOrDownloadUrl set,
 * which means the file has been uploaded, and it is rendered as a preview
 * Or have a pending file being uploaded.
 */
export interface StorageFieldItem {
    id: number; // generated on the fly for internal use only
    storagePathOrDownloadUrl?: string;
    file?: File;
    fileName?: string;
    metadata?: Record<string, unknown>,
    size: StorageFieldSize
}

export function useStorageUploadController<M extends Record<string, unknown>>({
    entityId,
    entityValues,
    path,
    value,
    property,
    propertyKey,
    storageSource,
    storageSourceRegistry,
    disabled,
    onChange
}:
    {
        entityId?: string | number,
        entityValues: EntityValues<M>,
        value: string | string[] | null;
        path?: string,
        propertyKey: string,
        property: StringProperty | ArrayProperty | StringProperty | ArrayProperty,
        storageSource: StorageSource,
        /** Optional explicit registry. When omitted, the hook reads from the
         *  `StorageSourcesContext` provided by `<Rebase storageSources={...}>`. */
        storageSourceRegistry?: StorageSourceRegistry,
        disabled: boolean,
        onChange: (value: string | string[] | null) => void
    }) {

    const authController = useAuthController();
    const storageSources = useStorageSources();
    const storage: StorageConfig | undefined = property.type === "string"
        ? property.storage
        : property.type === "array" &&
            (property.of as Property).type === "string"
            ? (property.of as StringProperty).storage
            : undefined;

    // Resolve the correct storage source for this property.
    // Priority: explicit registry prop → StorageSourcesContext → default.
    const resolvedStorageSource = useMemo(() => resolveStorageSource({
        sourceKey: storage?.storageSource === undefined ? undefined : resourceKeyOf(storage.storageSource),
        registry: storageSourceRegistry,
        sources: storageSources.sources,
        defaultSource: storageSource
    }), [storage?.storageSource, storageSourceRegistry, storageSources.sources, storageSource]);

    const multipleFilesSupported = property.type === "array";

    if (!storage)
        throw Error("Storage meta must be specified");

    const processFile = storage?.processFile;

    const metadata: Record<string, unknown> | undefined = storage?.metadata;
    // One preview size. A single-file field asked for "large" (a 220px
    // thumbnail) while a multi-file field asked for "medium" (118px), so two
    // upload fields in the same form reserved wildly different heights and
    // neither matched its own empty state.
    const size = "medium";

    const imageResize = storage?.imageResize;

    const internalInitialValue: StorageFieldItem[] =
        getInternalInitialValue(multipleFilesSupported, value, metadata, size);

    const [initialValue, setInitialValue] = useState<string | string[] | null>(value);
    const [internalValue, setInternalValue] = useState<StorageFieldItem[]>(internalInitialValue);

    useEffect(() => {
        if (!equal(initialValue, value)) {
            setInitialValue(value);
            setInternalValue(internalInitialValue);
        }
    }, [internalInitialValue, value, initialValue]);

    const fileNameBuilder = useCallback(async (file: File) => {
        if (storage.fileName) {
            const fileName = await resolveStorageFilenameString({
                input: storage.fileName,
                storage,
                values: entityValues,
                entityId,
                path,
                property: property,
                file,
                propertyKey
            });
            if (!fileName || fileName.length === 0) {
                throw Error("You need to return a valid filename");
            }
            return fileName;
        }
        return randomString() + "_" + file.name;
    }, [entityId, entityValues, path, property, propertyKey, storage]);

    const storagePathBuilder = useCallback((file: File) => {
        return resolveStoragePathString({
            input: storage.storagePath,
            storage,
            values: entityValues,
            entityId,
            path,
            property: property,
            file,
            propertyKey
        }) ?? "/";
    }, [entityId, entityValues, path, property, propertyKey, storage]);

    const onFileUploadComplete = useCallback(async (uploadedPath: string,
        entry: StorageFieldItem,
        metadata?: Record<string, unknown>,
        uploadedUrl?: string) => {

        console.debug("onFileUploadComplete", uploadedPath, entry);

        let uploadPathOrDownloadUrl: string | null = uploadedPath;

        if (storage.includeBucketUrl) {
            if (!uploadedUrl) {
                console.warn("includeBucketUrl is set but no fully-qualified storage URL was returned by the StorageSource. Falling back to the storage path.");
            } else {
                uploadPathOrDownloadUrl = uploadedUrl;
            }
        }

        if (storage.storeUrl) {
            uploadPathOrDownloadUrl = (await resolvedStorageSource.getSignedUrl(uploadedPath)).url;
        }
        if (storage.postProcess && uploadPathOrDownloadUrl) {
            uploadPathOrDownloadUrl = await storage.postProcess(uploadPathOrDownloadUrl);
        }

        if (!uploadPathOrDownloadUrl) {
            console.warn("uploadPathOrDownloadUrl is null")
            return;
        }

        let newValue: StorageFieldItem[];

        entry.storagePathOrDownloadUrl = uploadPathOrDownloadUrl;
        entry.metadata = metadata;
        newValue = [...internalValue];

        newValue = removeDuplicates(newValue);
        setInternalValue(newValue);

        const fieldValue = newValue
            .filter(e => !!e.storagePathOrDownloadUrl)
            .map(e => e.storagePathOrDownloadUrl as string);

        if (multipleFilesSupported) {
            onChange(fieldValue);
        } else {
            onChange(fieldValue ? fieldValue[0] : null);
        }
    }, [internalValue, multipleFilesSupported, onChange, storage, resolvedStorageSource]);

    const onFileUploadError = useCallback((entry: StorageFieldItem) => {
        console.debug("onFileUploadError", entry);

        // Remove the failed entry from internalValue
        const newValue = internalValue.filter(item => item.id !== entry.id);
        setInternalValue(newValue);
    }, [internalValue]);

    const onFilesAdded = useCallback(async (acceptedFiles: File[]) => {

        if (!acceptedFiles.length || disabled)
            return;

        if (processFile) {
            try {
                acceptedFiles = await Promise.all(acceptedFiles.map(async file => {
                    const processedFile = await processFile(file);
                    if (!processedFile) {
                        return file;
                    }
                    return processedFile;
                }));
            } catch (e) {
                console.error("Error processing file with custom code. Attempting to continue uploading.", e);
            }
        }

        let newInternalValue: StorageFieldItem[];

        if (multipleFilesSupported) {
            newInternalValue = [...internalValue,
            ...(await Promise.all(acceptedFiles.map(async file => {
                if (imageResize && isImageFile(file)) {
                    file = await resizeImage(file, imageResize);
                }

                return {
                    id: getRandomId(),
                    file,
                    fileName: await fileNameBuilder(file),
                    metadata,
                    size
                } as StorageFieldItem;
            })))];
        } else {
            let file = acceptedFiles[0];
            if (imageResize && isImageFile(file)) {
                file = await resizeImage(file, imageResize);
            }

            newInternalValue = [{
                id: getRandomId(),
                file,
                fileName: await fileNameBuilder(file),
                metadata,
                size
            }];
        }

        // Remove either storage path or file duplicates
        newInternalValue = removeDuplicates(newInternalValue);
        setInternalValue(newInternalValue);
    }, [disabled, fileNameBuilder, internalValue, metadata, multipleFilesSupported, size, imageResize]);

    return {
        internalValue,
        setInternalValue,
        storage,
        fileNameBuilder,
        storagePathBuilder,
        onFileUploadComplete,
        onFileUploadError,
        onFilesAdded,
        multipleFilesSupported,
        /** The resolved StorageSource for this property — may differ from the
         *  default context source when `StorageConfig.storageSource` is set. */
        resolvedStorageSource
    }
}

function getInternalInitialValue(multipleFilesSupported: boolean,
    value: string | string[] | null,
    metadata: Record<string, unknown> | undefined,
    size: StorageFieldSize): StorageFieldItem[] {
    let strings: string[] = [];
    if (multipleFilesSupported) {
        if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
            strings = (value ?? []) as string[];
        }
    } else {
        if (typeof value === "string") {
            strings = value ? [value as string] : [];
        }
    }

    return strings
        .map(entry => (
            {
                id: getRandomId(),
                storagePathOrDownloadUrl: entry,
                metadata,
                size
            }
        ));
}

function removeDuplicates(items: StorageFieldItem[]) {
    return items.filter(
        (item, i) => {
            return ((items.map((v) => v.storagePathOrDownloadUrl).indexOf(item.storagePathOrDownloadUrl) === i) || !item.storagePathOrDownloadUrl) &&
                ((items.map((v) => v.file).indexOf(item.file) === i) || !item.file);
        }
    );
}

function getRandomId() {
    return Math.floor(Math.random() * Math.floor(Number.MAX_SAFE_INTEGER));
}

/**
 * Check if a file is an image type supported for resizing
 */
function isImageFile(file: File): boolean {
    return file.type === "image/jpeg" ||
        file.type === "image/png" ||
        file.type === "image/webp";
}

/**
 * Resize and compress an image using compressorjs.
 */
async function resizeImage(
    file: File,
    imageResize?: StorageConfig["imageResize"]
): Promise<File> {
    const maxWidth = imageResize?.maxWidth;
    const maxHeight = imageResize?.maxHeight;
    const quality = (imageResize?.quality ?? 80) / 100;
    const mode = imageResize?.mode ?? "contain";

    // Determine output format
    let mimeType = file.type;
    if (imageResize?.format && imageResize.format !== "original") {
        mimeType = `image/${imageResize.format}`;
    }

    return new Promise<File>((resolve, reject) => {
        new Compressor(file, {
            quality,
            maxWidth,
            maxHeight,
            mimeType,
            // Use cover mode if specified (crops to fit)
            // Otherwise use contain mode (scales to fit)
            ...(mode === "cover" || mode === undefined ? {
                width: maxWidth,
                height: maxHeight,
                resize: "cover" as const
            } : {}),
            success: (result) => {
                const compressedFile = new File([result], file.name, {
                    type: result.type,
                    lastModified: Date.now()
                });
                resolve(compressedFile);
            },
            error: reject
        });
    });
}
