import { ArrayProperty, SnapshotValues, StorageConfig, StorageSource, StorageSourceRegistry, StringProperty, UploadedFileContext } from "@rebasepro/types";
import { randomString } from "@rebasepro/utils";

/**
 * Resolve the {@link StorageSource} to use for a property, given the key
 * referenced by `StorageConfig.storageSource`.
 *
 * Resolution priority:
 * 1. No `sourceKey` → the default source (backward compatible).
 * 2. An explicit {@link StorageSourceRegistry} (e.g. `client.storageRegistry`).
 * 3. A `sources` lookup map (e.g. the `StorageSourcesContext`).
 * 4. Fall back to the default source.
 *
 * Shared by the upload hook, the markdown editor, and the read-only previews
 * so the resolution logic lives in one place.
 *
 * @group Storage
 */
export function resolveStorageSource(params: {
    /** Key from `StorageConfig.storageSource`. */
    sourceKey?: string | null;
    /** Built sources keyed by storage-source key (e.g. from context). */
    sources?: Record<string, StorageSource>;
    /** Optional explicit registry — takes precedence over `sources`. */
    registry?: StorageSourceRegistry;
    /** Default source, used when no key is set or the key cannot be resolved. */
    defaultSource: StorageSource;
}): StorageSource {
    const { sourceKey, sources, registry, defaultSource } = params;
    if (!sourceKey) return defaultSource;
    if (registry) return registry.getOrDefault(sourceKey);
    const fromSources = sources?.[sourceKey];
    if (fromSources) return fromSources;
    return defaultSource;
}

interface ResolveFilenameStringParams<M extends Record<string, unknown>> {
    input: string | ((context: UploadedFileContext) => (Promise<string> | string));
    storage: StorageConfig;
    values: SnapshotValues<M>;
    snapshotId?: string | number;
    path?: string;
    property: StringProperty | ArrayProperty,
    file: File;
    propertyKey: string;
}

export async function resolveStorageFilenameString<M extends Record<string, unknown>>(
    {
        input,
        storage,
        values,
        snapshotId,
        path,
        property,
        file,
        propertyKey
    }: ResolveFilenameStringParams<M>): Promise<string> {
    let result;

    if (typeof input === "function") {
        result = await input({
            path,
            snapshotId,
            values,
            property,
            file,
            storage,
            propertyKey
        });
        if (!result)
            console.warn("Storage callback returned empty result. Using default name value")
    } else {
        result = replacePlaceholders({
            file,
            input,
            snapshotId,
            propertyKey,
            path
        });
    }

    if (!result)
        result = randomString() + "_" + file.name;

    return result;
}

interface ResolveStoragePathStringParams<M extends Record<string, unknown>> {
    input: string | ((context: UploadedFileContext) => string);
    storage: StorageConfig;
    values: SnapshotValues<M>;
    snapshotId?: string | number;
    path?: string;
    property: StringProperty | ArrayProperty;
    file: File;
    propertyKey: string;
}

export function resolveStoragePathString<M extends Record<string, unknown>>(
    {
        input,
        storage,
        values,
        snapshotId,
        path,
        property,
        file,
        propertyKey
    }: ResolveStoragePathStringParams<M>): string {
    let result;
    if (typeof input === "function") {
        result = input({
            path,
            snapshotId,
            values,
            property,
            file,
            storage,
            propertyKey
        });
        if (!result)
            console.warn("Storage callback returned empty result. Using default name value")
    } else {
        result = replacePlaceholders({
            file,
            input,
            snapshotId,
            propertyKey,
            path
        });
    }

    if (!result)
        result = randomString() + "_" + file.name;

    return result;
}

interface Placeholders {
    file: File;
    input: string;
    snapshotId?: string | number;
    propertyKey: string;
    path?: string;
}

function replacePlaceholders({
    file,
    input,
    snapshotId,
    propertyKey,
    path
}: Placeholders) {
    const ext = file.name.split(".").pop();
    let result = input
        .replace("{propertyKey}", propertyKey)
        .replace("{rand}", randomString())
        .replace("{file}", file.name)
        .replace("{file.type}", file.type);
    if (snapshotId) {
        result = result.replace("{snapshotId}", String(snapshotId));
    }
    if (path) {
        result = result.replace("{path}", path);
    }
    if (ext) {
        result = result.replace("{file.ext}", ext);
        const name = file.name.replace(`.${ext}`, "");
        result = result.replace("{file.name}", name)
    }

    if (!result)
        result = randomString() + "_" + file.name;

    return result;
}
