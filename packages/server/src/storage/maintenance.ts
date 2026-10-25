/**
 * Storage maintenance: the objects a source holds that no row names
 * (`rebase storage orphans`), and copying a folder of objects from one source
 * to another (`rebase storage move`).
 *
 * Nothing deletes a stored file when its field is cleared, its file replaced or
 * its row deleted — two rows may hold one key, so the panel cannot know a file
 * is unused. What can know is a scan of every row against every object, which
 * is what this is. It errs one way only: a string anywhere in any row that
 * could name an object keeps that object, whichever source it is in and
 * whichever property holds it. A file is reported only when nothing points at
 * it at all.
 */
import type { CollectionCallbacks, CollectionConfig, DataDriver } from "@rebasepro/types";
import { storageTargetsInText } from "@rebasepro/types";
import { buildPropertyCallbacks } from "@rebasepro/common";
import type { StorageController } from "./types";
import { isRenditionKey } from "./rendition-cache";
import { randomUUID } from "crypto";

/** One stored object, as a listing describes it. */
export interface StoredObjectEntry {
    key: string;
    size?: number;
    /** ISO 8601, when the source's listing says. */
    updated?: string;
}

/** Folders still to read, and the page reached in the first of them. */
interface WalkState {
    folders: string[];
    pageToken?: string;
}

/** The internal folder: image renditions and the like. Never an app's file. */
const INTERNAL_FOLDER = "_rebase";

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, "");

function encodeCursor(state: WalkState): string {
    return Buffer.from(JSON.stringify(state), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string): WalkState {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8"));
    } catch {
        throw new InvalidMaintenanceRequestError("The cursor is not one this server handed out.");
    }
    if (!parsed || typeof parsed !== "object"
        || !("folders" in parsed) || !Array.isArray(parsed.folders)
        || !parsed.folders.every((folder: unknown) => typeof folder === "string")) {
        throw new InvalidMaintenanceRequestError("The cursor is not one this server handed out.");
    }
    const pageToken = "pageToken" in parsed && typeof parsed.pageToken === "string" ? parsed.pageToken : undefined;
    return { folders: parsed.folders, pageToken };
}

/** A request this module cannot act on: a bad cursor, a source that is not served. */
export class InvalidMaintenanceRequestError extends Error {}

/**
 * The objects under a folder of a source, folder by folder, at most `limit` at
 * a time. Hand the returned `cursor` back for the next ones; none means the
 * walk is done. The internal `_rebase/` folder is not walked.
 */
export async function walkObjects(
    controller: StorageController,
    options: { prefix?: string; cursor?: string; limit?: number } = {}
): Promise<{ objects: StoredObjectEntry[]; cursor?: string }> {
    const limit = Math.max(1, options.limit ?? 1000);
    const state: WalkState = options.cursor
        ? decodeCursor(options.cursor)
        : { folders: [trimSlashes(options.prefix ?? "")] };
    const objects: StoredObjectEntry[] = [];

    while (objects.length < limit && state.folders.length > 0) {
        const folder = state.folders[0];
        const page = await controller.listObjects(folder, {
            maxResults: Math.min(1000, limit - objects.length),
            pageToken: state.pageToken
        });
        for (const item of page.items) {
            const key = trimSlashes(item.fullPath);
            if (!key || isRenditionKey(key)) continue;
            objects.push({ key, size: item.size, updated: item.updated });
        }
        const subfolders = page.prefixes
            .map(prefix => trimSlashes(prefix.fullPath))
            .filter(sub => sub && sub !== INTERNAL_FOLDER && !sub.startsWith(`${INTERNAL_FOLDER}/`) && sub !== folder);
        state.folders.push(...subfolders);
        if (page.nextPageToken) {
            state.pageToken = page.nextPageToken;
        } else {
            state.folders.shift();
            state.pageToken = undefined;
        }
    }

    return { objects, cursor: state.folders.length > 0 ? encodeCursor(state) : undefined };
}

/**
 * The keys one stored string could name an object by.
 *
 * A file field stores a bare key, a `local://`, `s3://` or `gs://` URL with the
 * bucket, or — with `storeUrl` — a download URL; text stores
 * `rebase-storage:` references, and from before those, download URLs. Each
 * spelling yields the key it names, and a key under a leading `default/` is
 * also read without it, as the routes read it.
 */
export function keysNamedBy(value: string): string[] {
    const keys = new Set<string>();
    const add = (key: string) => {
        const trimmed = key.replace(/^\/+/, "");
        if (!trimmed) return;
        keys.add(trimmed);
        if (trimmed.toLowerCase().startsWith("default/")) keys.add(trimmed.slice("default/".length));
    };

    if (value.length <= 2048) {
        add(value);
        const scheme = /^(?:local|s3|gs):\/\/[^/]+\/(.+)$/.exec(value);
        if (scheme) add(scheme[1]);
    }
    if (value.includes("/storage/file/")) {
        for (const match of value.matchAll(/\/storage\/file\/([^\s?#"'<>)]+)/g)) {
            try {
                add(match[1].split("/").map(decodeURIComponent).join("/"));
            } catch {
                add(match[1]);
            }
        }
    }
    for (const target of storageTargetsInText(value)) add(target.key);
    return [...keys];
}

/** Calls `visit` with every string anywhere in a row's value. */
function forEachString(value: unknown, visit: (text: string) => void, depth = 0): void {
    if (depth > 32 || value === null || value === undefined) return;
    if (typeof value === "string") {
        visit(value);
    } else if (Array.isArray(value)) {
        for (const element of value) forEachString(element, visit, depth + 1);
    } else if (typeof value === "object" && !(value instanceof Date)) {
        for (const element of Object.values(value)) forEachString(element, visit, depth + 1);
    }
}

/** A collection whose rows could not be read, and why. */
export interface UnscannedCollection {
    collection: string;
    reason: string;
}

/**
 * Whether reading a collection through `fetchCollection` could hide a row or
 * change a value: a `beforeQuery` or an `afterRead`, the collection's own, a
 * global one, or a property's.
 */
export function hasReadHooks(collection: CollectionConfig, globalCallbacks?: CollectionCallbacks): boolean {
    const own = collection.callbacks;
    return Boolean(
        own?.beforeQuery || own?.afterRead
        || globalCallbacks?.beforeQuery || globalCallbacks?.afterRead
        || (collection.properties && buildPropertyCallbacks(collection.properties)?.afterRead)
    );
}

/**
 * Remove from `keys` every key some row names.
 *
 * Every row of every collection is read — soft-deleted rows too, since a
 * restore brings their files back — a page at a time, through the driver that
 * serves the collection. What is left in `keys` afterwards is named by no row.
 * A collection that could not be read is returned, and its rows count for
 * nothing: a caller must not treat what is left as unused when any is.
 *
 * Rows are read as stored, through the driver's `scanStoredRows`. A driver
 * without it is read through `fetchCollection` only for a collection with no
 * read hooks: a `beforeQuery` scoping rows to `context.user` — there is none
 * here — or an `afterRead` rewriting a file field would hide a reference, and
 * the file it names would be deleted as unused. Such a collection is
 * returned as unscanned instead.
 */
export async function removeReferencedKeys(
    keys: Set<string>,
    collections: readonly CollectionConfig[],
    driverFor: (collection: CollectionConfig) => DataDriver | undefined,
    options: {
        pageSize?: number;
        globalCallbacks?: CollectionCallbacks;
        /** Counted into as it goes, and `onProgress` called after each page. */
        progress?: ScanProgress;
        onProgress?: () => void;
        /** Checked between pages: an aborted scan stops, and throws. */
        signal?: AbortSignal;
    } = {}
): Promise<{ scanned: string[]; unscanned: UnscannedCollection[] }> {
    const pageSize = options.pageSize ?? 500;
    const scanned: string[] = [];
    const unscanned: UnscannedCollection[] = [];
    const progress = options.progress;
    const visit = (text: string) => {
        if (keys.size === 0) return;
        for (const key of keysNamedBy(text)) keys.delete(key);
    };
    const pageRead = (rows: readonly unknown[]) => {
        for (const row of rows) forEachString(row, visit);
        if (progress) progress.rowsScanned += rows.length;
        options.onProgress?.();
        options.signal?.throwIfAborted();
    };
    const notRead = (entry: UnscannedCollection) => {
        unscanned.push(entry);
        progress?.unscanned.push(entry);
    };
    if (progress) progress.collectionsTotal += collections.length;

    for (const collection of collections) {
        options.signal?.throwIfAborted();
        if (progress) progress.currentCollection = collection.slug;
        try {
            const driver = driverFor(collection);
            if (!driver) {
                notRead({ collection: collection.slug, reason: "no data driver serves it here" });
                continue;
            }
            try {
                if (driver.scanStoredRows) {
                    for await (const rows of driver.scanStoredRows({ path: collection.slug, collection, pageSize })) {
                        pageRead(rows);
                    }
                } else if (hasReadHooks(collection, options.globalCallbacks)) {
                    notRead({
                        collection: collection.slug,
                        reason: "it has a beforeQuery or afterRead hook, and its data driver cannot read its rows past them"
                    });
                    continue;
                } else {
                    let after: Record<string, unknown> | undefined;
                    for (;;) {
                        const rows = await driver.fetchCollection({
                            path: collection.slug,
                            collection,
                            limit: pageSize,
                            withDeleted: true,
                            ...(after ? { startAfter: after } : {})
                        });
                        pageRead(rows);
                        if (rows.length < pageSize) break;
                        after = rows[rows.length - 1];
                    }
                }
                scanned.push(collection.slug);
            } catch (error: unknown) {
                // A stopped scan is not a collection that could not be read.
                if (options.signal?.aborted) throw error;
                notRead({
                    collection: collection.slug,
                    reason: error instanceof Error ? error.message : String(error)
                });
            }
        } finally {
            if (progress) {
                progress.collectionsScanned++;
                progress.currentCollection = undefined;
            }
        }
    }
    options.onProgress?.();
    return { scanned, unscanned };
}

/** How row history is named among the scanned and unscanned collections. */
export const HISTORY_SCAN_NAME = "(row history)";

/**
 * Remove from `keys` every key a history entry names, in its values or its
 * previous values. Resolves to why history could not be read, if it could not.
 */
async function removeKeysInHistory(
    keys: Set<string>,
    history: StoredHistory,
    options: { progress?: ScanProgress; onProgress?: () => void; signal?: AbortSignal } = {}
): Promise<UnscannedCollection | undefined> {
    if (!history.scanStoredValues) {
        return { collection: HISTORY_SCAN_NAME, reason: "this backend's history service cannot be scanned" };
    }
    try {
        for await (const values of history.scanStoredValues()) {
            if (keys.size === 0) return undefined;
            forEachString(values, (text) => {
                for (const key of keysNamedBy(text)) keys.delete(key);
            });
            if (options.progress) options.progress.historyEntriesScanned += values.length;
            options.onProgress?.();
            options.signal?.throwIfAborted();
        }
        return undefined;
    } catch (error: unknown) {
        if (options.signal?.aborted) throw error;
        return { collection: HISTORY_SCAN_NAME, reason: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Remove from `keys` every key a row or a history entry names: the rows of
 * every collection, then history when the backend keeps it. What is left is
 * named by nothing — unless `unscanned` is not empty.
 */
async function removeKeysNamedAnywhere(
    keys: Set<string>,
    options: ReferenceSources & { progress?: ScanProgress; onProgress?: () => void; signal?: AbortSignal }
): Promise<{ scanned: string[]; unscanned: UnscannedCollection[] }> {
    const { scanned, unscanned } = await removeReferencedKeys(keys, options.collections, options.driverFor, {
        globalCallbacks: options.globalCallbacks,
        progress: options.progress,
        onProgress: options.onProgress,
        signal: options.signal
    });
    if (options.history) {
        if (options.progress) options.progress.phase = "history";
        options.onProgress?.();
        const history = await removeKeysInHistory(keys, options.history, options);
        if (history) {
            unscanned.push(history);
            options.progress?.unscanned.push(history);
        } else {
            scanned.push(HISTORY_SCAN_NAME);
        }
    }
    return { scanned, unscanned };
}

/** What `findOrphans` found. */
export interface OrphanReport {
    /** Objects in the source, internal ones aside. */
    objects: number;
    /** Objects no row names and older than the grace period. */
    orphans: StoredObjectEntry[];
    /**
     * Objects no row names but too new to call unused — an upload whose row
     * has not been saved yet looks exactly like this — or of unknown age.
     */
    recent: number;
    scanned: string[];
    unscanned: UnscannedCollection[];
}

/** Row history, as a scan reads it. */
export interface StoredHistory {
    scanStoredValues?(pageSize?: number): AsyncIterable<unknown[]>;
}

/** Where references to stored files are read from: every row, and history. */
export interface ReferenceSources {
    collections: readonly CollectionConfig[];
    driverFor: (collection: CollectionConfig) => DataDriver | undefined;
    /** The callbacks every collection runs, which may scope or rewrite its reads. */
    globalCallbacks?: CollectionCallbacks;
    /**
     * Row history, when the backend keeps it: a revert restores the values an
     * entry holds, so a file only history names is still in use. One that
     * cannot be read is reported unscanned, as {@link HISTORY_SCAN_NAME}.
     */
    history?: StoredHistory;
}

/** How far a scan has got. Counted into in place, so a caller can report it while it runs. */
export interface ScanProgress {
    phase: "listing" | "rows" | "history" | "deleting" | "done";
    /** Objects listed in the source so far. */
    filesScanned: number;
    /** Rows read so far, over every collection. */
    rowsScanned: number;
    /** History entries read so far. */
    historyEntriesScanned: number;
    /** Collections finished, read or not. */
    collectionsScanned: number;
    collectionsTotal: number;
    /** The collection being read now. */
    currentCollection?: string;
    /** The collections that could not be read, as they are found. */
    unscanned: UnscannedCollection[];
}

/** A progress record at the start of a scan. */
export function emptyScanProgress(): ScanProgress {
    return {
        phase: "listing",
        filesScanned: 0,
        rowsScanned: 0,
        historyEntriesScanned: 0,
        collectionsScanned: 0,
        collectionsTotal: 0,
        unscanned: []
    };
}

/**
 * The objects of one source that no row names.
 *
 * @param olderThanMs an object written less long ago than this is not called
 *        an orphan: the admin panel uploads a file before the row that names it
 *        is saved. One whose age the listing does not say is not either.
 */
export async function findOrphans(options: ReferenceSources & {
    controller: StorageController;
    olderThanMs: number;
    now?: number;
    /** Counted into as the scan goes; `onProgress` is called after each page. */
    progress?: ScanProgress;
    onProgress?: () => void;
    /** Checked between pages: an aborted scan stops, and throws. */
    signal?: AbortSignal;
}): Promise<OrphanReport> {
    const progress = options.progress;
    const all: StoredObjectEntry[] = [];
    let cursor: string | undefined;
    if (progress) progress.phase = "listing";
    do {
        options.signal?.throwIfAborted();
        const page = await walkObjects(options.controller, { cursor, limit: 1000 });
        all.push(...page.objects);
        if (progress) progress.filesScanned = all.length;
        options.onProgress?.();
        cursor = page.cursor;
    } while (cursor);

    const unnamed = new Set(all.map(object => object.key));
    if (progress) progress.phase = "rows";
    const { scanned, unscanned } = await removeKeysNamedAnywhere(unnamed, options);

    const cutoff = (options.now ?? Date.now()) - options.olderThanMs;
    const orphans: StoredObjectEntry[] = [];
    let recent = 0;
    for (const object of all) {
        if (!unnamed.has(object.key)) continue;
        const written = object.updated ? Date.parse(object.updated) : NaN;
        if (Number.isFinite(written) && written <= cutoff) orphans.push(object);
        else recent++;
    }
    orphans.sort((a, b) => a.key.localeCompare(b.key));
    if (progress) progress.phase = "done";
    return { objects: all.length, orphans, recent, scanned, unscanned };
}

/** What deleting a scan's orphans did. */
export interface OrphanDeletion {
    deleted: string[];
    /** Candidates not deleted, because something changed since the scan. */
    kept: { key: string; reason: string }[];
    failed: { key: string; error: string }[];
    /** Collections the re-check could not read; when any is, nothing was deleted. */
    unscanned: UnscannedCollection[];
}

/** How far a stored object's time may stray from the listing's and still be the same version. */
const SAME_VERSION_SLACK_MS = 1_000;

/**
 * Delete the orphans an earlier scan found — each only if it is still one.
 *
 * Every row and history entry is read again, against the candidates alone
 * (the source is not listed again): a row written since the scan may name one
 * now. When a collection cannot be read, nothing is deleted. Then, right
 * before each delete, the object is asked for again: one that is gone, was
 * written again since the scan (another size or time), or is now inside the
 * grace period is kept.
 */
export async function deleteScannedOrphans(options: ReferenceSources & {
    controller: StorageController;
    candidates: readonly StoredObjectEntry[];
    olderThanMs: number;
    now?: () => number;
    progress?: ScanProgress;
    onProgress?: () => void;
    /** Called after each file deleted. */
    onDeleted?: (key: string) => void;
    signal?: AbortSignal;
}): Promise<OrphanDeletion> {
    const progress = options.progress;
    const unnamed = new Set(options.candidates.map(candidate => candidate.key));
    if (progress) progress.phase = "rows";
    const { unscanned } = await removeKeysNamedAnywhere(unnamed, options);
    const result: OrphanDeletion = { deleted: [], kept: [], failed: [], unscanned };
    if (unscanned.length > 0) return result;

    if (progress) progress.phase = "deleting";
    options.onProgress?.();
    const now = options.now ?? Date.now;
    for (const candidate of options.candidates) {
        options.signal?.throwIfAborted();
        if (!unnamed.has(candidate.key)) {
            result.kept.push({ key: candidate.key, reason: "a row or a history entry names it now" });
            continue;
        }
        try {
            const current = await versionOf(options.controller, candidate.key, candidate);
            const scannedAt = candidate.updated ? Date.parse(candidate.updated) : NaN;
            if (current === null) {
                result.kept.push({ key: candidate.key, reason: "it is gone already" });
            } else if ((candidate.size !== undefined && current.size !== candidate.size)
                || !Number.isFinite(scannedAt)
                || Math.abs(current.lastModified - scannedAt) > SAME_VERSION_SLACK_MS) {
                result.kept.push({ key: candidate.key, reason: "it was written again since the scan" });
            } else if (current.lastModified > now() - options.olderThanMs) {
                result.kept.push({ key: candidate.key, reason: "it is newer than the grace period" });
            } else {
                await options.controller.deleteObject(candidate.key);
                result.deleted.push(candidate.key);
                options.onDeleted?.(candidate.key);
            }
        } catch (error: unknown) {
            result.failed.push({ key: candidate.key, error: error instanceof Error ? error.message : String(error) });
        }
        options.onProgress?.();
    }
    if (progress) progress.phase = "done";
    return result;
}

/**
 * An object's size and modification time now, or `null` when there is no such
 * object. A source without `statObject` says only its size, and the time is
 * then taken to be the one the scan listed.
 */
async function versionOf(
    controller: StorageController,
    key: string,
    listed: StoredObjectEntry
): Promise<{ size: number; lastModified: number } | null> {
    if (controller.statObject) {
        const info = await controller.statObject(key);
        return info ? { size: info.size, lastModified: info.lastModified } : null;
    }
    const size = await sizeIn(controller, key);
    if (size === undefined) return null;
    return { size, lastModified: listed.updated ? Date.parse(listed.updated) : NaN };
}

/** What happened to one object in a move. */
export interface MovedObject {
    key: string;
    outcome: "copied" | "exists" | "failed";
    /** Whether the source's copy was deleted afterwards. */
    deleted?: boolean;
    error?: string;
}

/**
 * Copy the objects under a folder of one source into another, under the same
 * keys, `limit` objects per call. Hand the returned `cursor` back for the next
 * ones; none means the folder is done.
 *
 * A key the target already holds at the same size is left alone, so a move
 * that stopped half-way is resumed by running it again. With `deleteSource`,
 * the source's copy is deleted once the target holds one of the same size.
 * The copy is the server's own write: the target's upload limits, which say
 * what a user may upload, do not apply to a file already accepted once.
 */
export async function moveObjects(options: {
    from: StorageController;
    to: StorageController;
    prefix?: string;
    cursor?: string;
    limit?: number;
    deleteSource?: boolean;
}): Promise<{ moved: MovedObject[]; cursor?: string }> {
    const page = await walkObjects(options.from, {
        prefix: options.prefix,
        cursor: options.cursor,
        limit: options.limit ?? 25
    });
    const moved: MovedObject[] = [];
    for (const object of page.objects) {
        try {
            const existing = await sizeIn(options.to, object.key);
            let outcome: MovedObject["outcome"] = "exists";
            if (existing === undefined || existing !== object.size) {
                const file = await options.from.getObject(object.key);
                if (!file) {
                    moved.push({ key: object.key, outcome: "failed", error: "the object was gone before it was read" });
                    continue;
                }
                const metadata = await customMetadataOf(options.from, object.key);
                await options.to.putObject({ file, key: object.key, ...(metadata ? { metadata } : {}) }, { uploadLimits: false });
                outcome = "copied";
            }
            const result: MovedObject = { key: object.key, outcome };
            if (options.deleteSource) {
                const copied = await sizeIn(options.to, object.key);
                if (copied === undefined || (object.size !== undefined && copied !== object.size)) {
                    result.outcome = "failed";
                    result.error = "the target does not hold a copy of the same size; the source's copy was kept";
                } else {
                    await options.from.deleteObject(object.key);
                    result.deleted = true;
                }
            }
            moved.push(result);
        } catch (error: unknown) {
            moved.push({ key: object.key, outcome: "failed", error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { moved, cursor: page.cursor };
}

/** A file a move did not move, and why it counts as not moved. */
export interface NotMovedObject {
    key: string;
    reason: string;
}

/**
 * List the source again after a move and name every file it did not move,
 * `limit` source objects per call; hand the returned `cursor` back for the
 * next ones.
 *
 * Defence in depth: a move reports what its own walk saw, and a walk that
 * skipped files (as the local listing's page token once did, over a folder
 * the move was emptying) reported success over the half it moved. A fresh
 * listing does not share the walk's state. With `deleteSource`, every file
 * still in the source is not moved; without it, a file the target holds no
 * copy of the same size of.
 */
export async function verifyMove(options: {
    from: StorageController;
    to: StorageController;
    prefix?: string;
    cursor?: string;
    limit?: number;
    deleteSource?: boolean;
}): Promise<{ checked: number; notMoved: NotMovedObject[]; cursor?: string }> {
    const page = await walkObjects(options.from, {
        prefix: options.prefix,
        cursor: options.cursor,
        limit: options.limit ?? 100
    });
    const notMoved: NotMovedObject[] = [];
    for (const object of page.objects) {
        let copy: number | undefined;
        try {
            copy = await sizeIn(options.to, object.key);
        } catch (error: unknown) {
            notMoved.push({
                key: object.key,
                reason: `the target could not be asked for it: ${error instanceof Error ? error.message : String(error)}`
            });
            continue;
        }
        const held = copy !== undefined && (object.size === undefined || copy === object.size);
        if (options.deleteSource) {
            notMoved.push({
                key: object.key,
                reason: held
                    ? "still in the source; the target holds a copy, so running the move again deletes it"
                    : "still in the source, and the target has no copy of the same size"
            });
        } else if (copy === undefined) {
            notMoved.push({ key: object.key, reason: "the target has no copy" });
        } else if (!held) {
            notMoved.push({ key: object.key, reason: `the target's copy is ${copy} bytes, the source's ${object.size}` });
        }
    }
    return { checked: page.objects.length, notMoved, cursor: page.cursor };
}

/**
 * Whether two sources store in the same place — one bucket or directory under
 * two names. Asked by their `storageLocation` when both can say; otherwise by
 * a probe object written to `a` under the internal folder, looked for in `b`,
 * and deleted.
 */
export async function storesInSamePlace(a: StorageController, b: StorageController): Promise<boolean> {
    const here = a.storageLocation?.();
    const there = b.storageLocation?.();
    if (here !== undefined && there !== undefined) return here === there;
    const key = `${INTERNAL_FOLDER}/move-probe/${randomUUID()}`;
    await a.putObject({ file: new File(["probe"], "probe", { type: "text/plain" }), key }, { uploadLimits: false });
    try {
        return (await sizeIn(b, key)) !== undefined;
    } finally {
        await a.deleteObject(key).catch(() => undefined);
    }
}

/** An object's size in a source, or `undefined` when it has no such object. */
async function sizeIn(controller: StorageController, key: string): Promise<number | undefined> {
    if (controller.statObject) {
        return (await controller.statObject(key))?.size;
    }
    if (controller.getMetadata) {
        return (await controller.getMetadata(key))?.size;
    }
    const config = await controller.getSignedUrl(key);
    return config.fileNotFound ? undefined : config.metadata?.size;
}

/** The custom metadata an object was stored with, to store its copy with. */
async function customMetadataOf(controller: StorageController, key: string): Promise<Record<string, unknown> | undefined> {
    const metadata = controller.getMetadata
        ? await controller.getMetadata(key)
        : (await controller.getSignedUrl(key)).metadata;
    const custom = metadata?.customMetadata;
    return custom && Object.keys(custom).length > 0 ? custom : undefined;
}
