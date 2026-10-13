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
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { storageTargetsInText } from "@rebasepro/types";
import type { StorageController } from "./types";
import { isRenditionKey } from "./rendition-cache";

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
 * Remove from `keys` every key some row names.
 *
 * Every row of every collection is read — soft-deleted rows too, since a
 * restore brings their files back — a page at a time, through the driver that
 * serves the collection. What is left in `keys` afterwards is named by no row.
 * A collection that could not be read is returned, and its rows count for
 * nothing: a caller must not treat what is left as unused when any is.
 */
export async function removeReferencedKeys(
    keys: Set<string>,
    collections: readonly CollectionConfig[],
    driverFor: (collection: CollectionConfig) => DataDriver | undefined,
    options: { pageSize?: number } = {}
): Promise<{ scanned: string[]; unscanned: UnscannedCollection[] }> {
    const pageSize = options.pageSize ?? 500;
    const scanned: string[] = [];
    const unscanned: UnscannedCollection[] = [];
    const visit = (text: string) => {
        if (keys.size === 0) return;
        for (const key of keysNamedBy(text)) keys.delete(key);
    };

    for (const collection of collections) {
        const driver = driverFor(collection);
        if (!driver) {
            unscanned.push({ collection: collection.slug, reason: "no data driver serves it here" });
            continue;
        }
        try {
            let after: Record<string, unknown> | undefined;
            for (;;) {
                const rows = await driver.fetchCollection({
                    path: collection.slug,
                    collection,
                    limit: pageSize,
                    withDeleted: true,
                    ...(after ? { startAfter: after } : {})
                });
                for (const row of rows) forEachString(row, visit);
                if (rows.length < pageSize) break;
                after = rows[rows.length - 1];
            }
            scanned.push(collection.slug);
        } catch (error: unknown) {
            unscanned.push({
                collection: collection.slug,
                reason: error instanceof Error ? error.message : String(error)
            });
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

/**
 * The objects of one source that no row names.
 *
 * @param olderThanMs an object written less long ago than this is not called
 *        an orphan: the admin panel uploads a file before the row that names it
 *        is saved. One whose age the listing does not say is not either.
 */
export async function findOrphans(options: {
    controller: StorageController;
    collections: readonly CollectionConfig[];
    driverFor: (collection: CollectionConfig) => DataDriver | undefined;
    olderThanMs: number;
    now?: number;
}): Promise<OrphanReport> {
    const all: StoredObjectEntry[] = [];
    let cursor: string | undefined;
    do {
        const page = await walkObjects(options.controller, { cursor, limit: 1000 });
        all.push(...page.objects);
        cursor = page.cursor;
    } while (cursor);

    const unnamed = new Set(all.map(object => object.key));
    const { scanned, unscanned } = await removeReferencedKeys(unnamed, options.collections, options.driverFor);

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
    return { objects: all.length, orphans, recent, scanned, unscanned };
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
