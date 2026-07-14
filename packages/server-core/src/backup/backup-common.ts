/**
 * Storage-generic backup helpers used by the admin backup routes.
 *
 * These live in server-core (which owns {@link StorageController}) so the
 * admin API can list backups without depending on the Postgres driver —
 * `server-core` must not import from `server-postgresql`. The `pg_dump`-side
 * copies of the tiny pure parsers live in `@rebasepro/server-postgresql`;
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
 * List the backups at a destination as {@link BackupInfo}, newest first.
 * Only `.dump` files are considered.
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
        return fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".dump"))
            .map((f): BackupInfo => {
                const full = path.join(dir, f);
                const st = fs.statSync(full);
                const createdAt = parseBackupTimestamp(f) ?? st.mtime;
                return {
                    key: full,
                    name: f,
                    sizeBytes: st.size,
                    createdAt: createdAt.toISOString(),
                    destinationKind: "local"
                };
            })
            .sort(byNewest);
    }

    if (!storage) return [];
    const result = await storage.listObjects(dest.prefix ? `${dest.prefix}/` : "", {
        bucket: dest.bucket,
        maxResults: 1000
    });
    return result.items
        .map((item) => item.fullPath)
        .filter((key) => key.endsWith(".dump"))
        .map((key): BackupInfo => {
            const createdAt = parseBackupTimestamp(key);
            return {
                key,
                name: key.split("/").pop() || key,
                createdAt: createdAt ? createdAt.toISOString() : undefined,
                destinationKind: dest.kind as BackupDestinationKind
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
        // Only allow reads inside the backup directory, and only .dump files.
        if (!resolved.startsWith(resolvedDir + path.sep) || !resolved.endsWith(".dump")) {
            return null;
        }
        if (!fs.existsSync(resolved)) return null;
        return { bytes: new Uint8Array(fs.readFileSync(resolved)), name: path.basename(resolved) };
    }

    if (!storage) return null;
    if (!key.endsWith(".dump")) return null;
    const file = await storage.getObject(key, dest.bucket);
    if (!file) return null;
    return { bytes: new Uint8Array(await file.arrayBuffer()), name: key.split("/").pop() || key };
}
