/**
 * Storage-generic backup helpers used by the admin backup routes.
 *
 * These live in server (which owns {@link StorageController}) so the
 * admin API can list backups without depending on the Postgres driver —
 * `server` must not import from `server-postgres`. The `pg_dump`-side
 * copies of the tiny pure parsers live in `@rebasepro/server-postgres`;
 * keep the two in sync if the naming scheme ever changes.
 */
import fs from "fs";
import path from "path";
import type { BackupInfo, BackupDestinationKind } from "@rebasepro/types";
import type { StorageController } from "../storage";
import { logger } from "../utils/logger";

export type BackupDestination =
    | { kind: "local"; path: string }
    | { kind: "s3"; bucket: string; prefix: string }
    | { kind: "gcs"; bucket: string; prefix: string };

/** Parse a destination string (`s3://…`, `gs://…`, or a local path). */
export function parseBackupDestination(out: string): BackupDestination {
    const s3 = out.match(/^s3:\/\/([^/]+)\/?(.*)$/);
    if (s3) return { kind: "s3", bucket: s3[1], prefix: s3[2].replace(/\/+$/, "") };
    const gcs = out.match(/^gs:\/\/([^/]+)\/?(.*)$/);
    if (gcs) return { kind: "gcs", bucket: gcs[1], prefix: gcs[2].replace(/\/+$/, "") };
    return { kind: "local", path: out };
}

/**
 * Recover the UTC creation time encoded in a `rebase-<db>-<ts>.dump` name.
 * Returns `null` for names that don't match, so foreign objects are ignored.
 */
export function parseBackupTimestamp(fileName: string): Date | null {
    const base = fileName.split("/").pop() ?? fileName;
    const match = base.match(/-(\d{8})T(\d{6})Z\.dump$/);
    if (!match) return null;
    const [, ymd, hms] = match;
    const iso =
        `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` +
        `T${hms.slice(0, 2)}:${hms.slice(2, 4)}:${hms.slice(4, 6)}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * A backup is two files: the `.dump`, and beside it a `.globals.sql` holding
 * the cluster roles the dump's GRANTs and RLS policies name. Without that
 * sidecar a restore into a fresh cluster stops at the first GRANT to a role
 * that does not exist there. The CLI uploads, restores and prunes the two as
 * a pair. This listing used to know only the `.dump`, so a backup downloaded
 * from Studio arrived without its roles.
 *
 * The suffix mirrors `globalsFileForDump` in `@rebasepro/server-postgres`.
 */
const DUMP_SUFFIX = ".dump";
const GLOBALS_SUFFIX = ".globals.sql";

function globalsKeyFor(dumpKey: string): string {
    return dumpKey.slice(0, -DUMP_SUFFIX.length) + GLOBALS_SUFFIX;
}

/** The only files the download route will serve. */
function isBackupFile(key: string): boolean {
    return key.endsWith(DUMP_SUFFIX) || key.endsWith(GLOBALS_SUFFIX);
}

/**
 * How many pages of an object-storage listing to read before giving up — at
 * the providers' 1,000 keys a page, 100,000 objects, or 50,000 backups.
 */
const MAX_LIST_PAGES = 100;

/**
 * Every key under a prefix, across pages.
 *
 * S3 and GCS answer a listing a page at a time, in ascending key order, and a
 * backup's key is `rebase-<db>-<UTC timestamp>`. Reading one page therefore
 * returned the OLDEST thousand objects: with retention unset and an hourly
 * schedule, the newest backup the panel and `rebase db backups list` showed
 * stopped advancing after about three weeks, which reads as "backups stopped".
 */
export async function listAllObjectKeys(
    storage: StorageController,
    prefix: string,
    bucket: string
): Promise<string[]> {
    const keys: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const result = await storage.listObjects(prefix, { bucket, maxResults: 1000, pageToken });
        for (const item of result.items) keys.push(item.fullPath);
        pageToken = result.nextPageToken;
        if (!pageToken) return keys;
    }
    logger.warn(
        `[backups] Stopped listing ${bucket}/${prefix} after ${MAX_LIST_PAGES} pages (${keys.length} objects). ` +
        "Set BACKUP_RETENTION_DAYS so old backups are pruned, or give the backups a prefix of their own."
    );
    return keys;
}

/**
 * Whether an object key is one the backup routes may serve: a backup file, at
 * the destination's prefix and nowhere else.
 *
 * The local branch has always been held to the backup directory; this branch
 * checked only the suffix, so any `.dump` in the bucket — `uploads/x.dump`, a
 * neighbouring `nightlyish/` prefix — was readable by naming it. A key is taken
 * as written, so a scheme (`s3://other-bucket/…`, which S3StorageController
 * would follow) or a `.`/`..`/empty segment (which a filesystem-backed or
 * S3-compatible store may resolve) is refused rather than interpreted.
 */
function isObjectBackupKey(dest: { prefix: string }, key: string): boolean {
    if (!isBackupFile(key) || /^[a-z][a-z0-9+.-]*:\/\//i.test(key)) return false;
    const segments = key.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
    return dest.prefix === "" || key.startsWith(`${dest.prefix}/`);
}

/**
 * List the backups at a destination as {@link BackupInfo}, newest first.
 * One entry per `.dump`, with its `.globals.sql` sidecar attached as
 * `globalsKey` when there is one.
 */
export async function listBackupObjects(
    dest: BackupDestination,
    storage?: StorageController
): Promise<BackupInfo[]> {
    if (dest.kind === "local") {
        if (!fs.existsSync(dest.path)) return [];
        const stat = fs.statSync(dest.path);
        const dir = stat.isDirectory() ? dest.path : path.dirname(dest.path);
        if (!fs.existsSync(dir)) return [];
        const files = fs.readdirSync(dir);
        const present = new Set(files);
        return files
            .filter((f) => f.endsWith(DUMP_SUFFIX))
            .map((f): BackupInfo => {
                const full = path.join(dir, f);
                const st = fs.statSync(full);
                const createdAt = parseBackupTimestamp(f) ?? st.mtime;
                const globals = globalsKeyFor(f);
                return {
                    key: full,
                    name: f,
                    sizeBytes: st.size,
                    createdAt: createdAt.toISOString(),
                    destinationKind: "local",
                    ...(present.has(globals) ? { globalsKey: path.join(dir, globals) } : {})
                };
            })
            .sort(byNewest);
    }

    // An empty list is a claim about the bucket. Without a controller for it
    // nothing was read, and the panel said "No backups yet." about a bucket
    // full of them.
    if (!storage) throw new Error(noControllerFor(dest));
    const keys = await listAllObjectKeys(storage, dest.prefix ? `${dest.prefix}/` : "", dest.bucket);
    const present = new Set(keys);
    return keys
        .filter((key) => key.endsWith(DUMP_SUFFIX))
        .map((key): BackupInfo => {
            const createdAt = parseBackupTimestamp(key);
            const globals = globalsKeyFor(key);
            return {
                key,
                name: key.split("/").pop() || key,
                createdAt: createdAt ? createdAt.toISOString() : undefined,
                destinationKind: dest.kind as BackupDestinationKind,
                ...(present.has(globals) ? { globalsKey: globals } : {})
            };
        })
        .sort(byNewest);
}

function noControllerFor(dest: { kind: "s3" | "gcs"; bucket: string; prefix: string }): string {
    const scheme = dest.kind === "s3" ? "s3" : "gs";
    return `No storage controller for ${scheme}://${dest.bucket}${dest.prefix ? `/${dest.prefix}` : ""}, so its backups cannot be read.`;
}

function byNewest(a: BackupInfo, b: BackupInfo): number {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
}

/**
 * The absolute path of a local backup file, or `null` for anything the download
 * route must not serve: a path outside the backup directory, a file that is not
 * a backup, or one that does not exist.
 */
function resolveLocalBackupFile(dest: { path: string }, key: string): string | null {
    const stat = fs.existsSync(dest.path) ? fs.statSync(dest.path) : null;
    const dir = stat?.isDirectory() ? dest.path : path.dirname(dest.path);
    const resolvedDir = path.resolve(dir);
    const resolved = path.resolve(key);
    // Only allow reads inside the backup directory, and only backup files.
    if (!resolved.startsWith(resolvedDir + path.sep) || !isBackupFile(resolved)) {
        return null;
    }
    return fs.existsSync(resolved) ? resolved : null;
}

/** Read a single backup's bytes. Guards against path traversal for local. */
export async function readBackupBytes(
    dest: BackupDestination,
    key: string,
    storage?: StorageController
): Promise<{ bytes: Uint8Array<ArrayBuffer>; name: string } | null> {
    if (dest.kind === "local") {
        const resolved = resolveLocalBackupFile(dest, key);
        if (!resolved) return null;
        return { bytes: new Uint8Array(fs.readFileSync(resolved)), name: path.basename(resolved) };
    }

    if (!storage) throw new Error(noControllerFor(dest));
    if (!isObjectBackupKey(dest, key)) return null;
    const file = await storage.getObject(key, dest.bucket);
    if (!file) return null;
    return { bytes: new Uint8Array(await file.arrayBuffer()), name: key.split("/").pop() || key };
}

/**
 * A single backup, opened for streaming, with its size. Same guards as
 * {@link readBackupBytes}.
 *
 * What the download route serves. A dump is the size of the database, and
 * reading it whole put all of it on the API process's heap — twice for a local
 * destination (`readFileSync`, then a copy) and on top of the controller's own
 * buffer for object storage — and a file over 2 GiB never downloaded at all:
 * `readFileSync` throws `ERR_FS_FILE_TOO_LARGE` there.
 *
 * A local file is read from disk as the response is written. Object storage
 * still arrives through {@link StorageController.getObject}, which is a
 * buffered `File` by contract; streaming that avoids the second copy.
 */
export async function openBackupStream(
    dest: BackupDestination,
    key: string,
    storage?: StorageController
): Promise<{ stream: ReadableStream<Uint8Array>; size: number; name: string } | null> {
    if (dest.kind === "local") {
        const resolved = resolveLocalBackupFile(dest, key);
        if (!resolved) return null;
        const { size } = await fs.promises.stat(resolved);
        return { stream: fileStream(resolved), size, name: path.basename(resolved) };
    }

    if (!storage) throw new Error(noControllerFor(dest));
    if (!isObjectBackupKey(dest, key)) return null;
    const file = await storage.getObject(key, dest.bucket);
    if (!file) return null;
    return { stream: file.stream(), size: file.size, name: key.split("/").pop() || key };
}

/** A file on disk as a web stream, read a chunk at a time as the response is written. */
function fileStream(filePath: string): ReadableStream<Uint8Array> {
    const file = fs.createReadStream(filePath);
    const chunks: AsyncIterator<Buffer> = file[Symbol.asyncIterator]();
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const next = await chunks.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
        },
        cancel() {
            file.destroy();
        }
    });
}
