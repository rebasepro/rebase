import { ArrayProperty, DEFAULT_STORAGE_SOURCE_KEY, EntityValues, StorageConfig, StorageSource, StorageSourceRegistry, StringProperty, UploadedFileContext } from "@rebasepro/types";
import { randomString } from "@rebasepro/utils";

/**
 * Resolve the {@link StorageSource} to use for a property, given the key
 * referenced by `StorageConfig.storageSource`.
 *
 * Resolution priority:
 * 1. No `sourceKey` → the default source.
 * 2. An explicit {@link StorageSourceRegistry} that has the key (e.g. `client.storageRegistry`).
 * 3. A `sources` lookup map (e.g. the `StorageSourcesContext`).
 * 4. `(default)` → the default source.
 * 5. `createSource(key)` — a server-routed source carrying `storageId`, so the
 *    server decides: it serves the source, or answers 400/501 naming it.
 * 6. Otherwise a source that refuses every call, naming the key.
 *
 * Never the default source for a key that names another. It used to be: a
 * named source enters the panel's map only once `GET /storage/sources` has
 * answered, so one failed fetch (or a typo, or a `direct` source the app did
 * not pass) silently uploaded the property's files into the default bucket —
 * with the authorize hook asked about `(default)` and the preview looking in
 * the wrong place. The server stopped falling back for the same reason.
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
    /** Default source, used when no key is set. */
    defaultSource: StorageSource;
    /**
     * Builds a server-routed source for a key nothing else resolves
     * (`client.createStorageSource`).
     */
    createSource?: (key: string) => StorageSource;
}): StorageSource {
    const { sourceKey, sources, registry, defaultSource, createSource } = params;
    if (!sourceKey) return defaultSource;
    if (registry?.has(sourceKey)) return registry.getOrDefault(sourceKey);
    const fromSources = sources?.[sourceKey];
    if (fromSources) return fromSources;
    if (sourceKey === DEFAULT_STORAGE_SOURCE_KEY) return defaultSource;
    if (createSource) return createSource(sourceKey);
    return unavailableStorageSource(sourceKey);
}

/**
 * A storage source for a key this app cannot reach: every call fails, naming
 * the key — so an upload is refused instead of landing in another bucket.
 *
 * @group Storage
 */
export function unavailableStorageSource(key: string): StorageSource {
    const refuse = (): Promise<never> => Promise.reject(new Error(
        `Storage source "${key}" is not available in this app. Check the property's ` +
        "`storageSource`, that the backend serves it (GET /api/storage/sources), and that a " +
        "`direct` source is passed to <Rebase storageSources>."
    ));
    return {
        putObject: refuse,
        getSignedUrl: refuse,
        getObject: refuse,
        deleteObject: refuse,
        listObjects: refuse
    };
}

interface ResolveFilenameStringParams<M extends Record<string, unknown>> {
    input: string | ((context: UploadedFileContext) => (Promise<string> | string));
    storage: StorageConfig;
    values: EntityValues<M>;
    entityId?: string | number;
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
        entityId,
        path,
        property,
        file,
        propertyKey
    }: ResolveFilenameStringParams<M>): Promise<string> {
    let result;

    if (typeof input === "function") {
        result = await input({
            path,
            entityId,
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
            entityId,
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
    values: EntityValues<M>;
    entityId?: string | number;
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
        entityId,
        path,
        property,
        file,
        propertyKey
    }: ResolveStoragePathStringParams<M>): string {
    let result;
    if (typeof input === "function") {
        result = input({
            path,
            entityId,
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
            entityId,
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
    entityId?: string | number;
    propertyKey: string;
    path?: string;
}

function replacePlaceholders({
    file,
    input,
    entityId,
    propertyKey,
    path
}: Placeholders) {
    const ext = file.name.split(".").pop();
    let result = input
        .replace("{propertyKey}", propertyKey)
        .replace("{rand}", randomString())
        .replace("{file}", file.name)
        .replace("{file.type}", file.type);
    if (entityId) {
        result = result.replace("{entityId}", String(entityId));
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
