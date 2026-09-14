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

    if (!storage) return [];
    const result = await storage.listObjects(dest.prefix ? `${dest.prefix}/` : "", {
        bucket: dest.bucket,
        maxResults: 1000
    });
    const keys = result.items.map((item) => item.fullPath);
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

function byNewest(a: BackupInfo, b: BackupInfo): number {
    const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
    return tb - ta;
}

/** Read a single backup's bytes. Guards against path traversal for local. */
export async function readBackupBytes(
    dest: BackupDestination,
    key: string,
    storage?: StorageController
): Promise<{ bytes: Uint8Array<ArrayBuffer>; name: string } | null> {
    if (dest.kind === "local") {
        const stat = fs.existsSync(dest.path) ? fs.statSync(dest.path) : null;
        const dir = stat?.isDirectory() ? dest.path : path.dirname(dest.path);
        const resolvedDir = path.resolve(dir);
        const resolved = path.resolve(key);
        // Only allow reads inside the backup directory, and only backup files.
        if (!resolved.startsWith(resolvedDir + path.sep) || !isBackupFile(resolved)) {
            return null;
        }
        if (!fs.existsSync(resolved)) return null;
        return { bytes: new Uint8Array(fs.readFileSync(resolved)), name: path.basename(resolved) };
    }

    if (!storage) return null;
    if (!isBackupFile(key)) return null;
    const file = await storage.getObject(key, dest.bucket);
    if (!file) return null;
    return { bytes: new Uint8Array(await file.arrayBuffer()), name: key.split("/").pop() || key };
}
