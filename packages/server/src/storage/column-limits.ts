import type { TableDescriptor } from "@rebasepro/types";
import { PUBLIC_STORAGE_PREFIX } from "@rebasepro/types";
import { formatJsonPath, storageAt, storagePositions } from "@rebasepro/common";
import { ApiError } from "../api/errors";
import { canonicalStorageId } from "./keys";

/**
 * Server-side enforcement of a storage column's own `maxBytes` and `accept`.
 *
 * Both are declared per column (`col.storage({ maxBytes, accept })`, or a
 * `json.storage()` field inside a document), published in the generated types,
 * rendered by the panel's file picker — and once enforced by exactly one thing:
 * the browser. A `curl -F file=@payload.exe` past the picker put a 40 MB
 * executable in the avatar bucket, and the schema that said otherwise was never
 * consulted.
 *
 * The limits are per *column position*, read from the table descriptors
 * (`storagePositions`), and the server finds the position two ways. By where
 * the file lands: a column's storage `path` is where its files go, so every
 * upload into it meets the column's limits (`createUploadPathResolver`) — the
 * panel never names its column, and a direct caller need not. And by name,
 * when the upload carries context (a form field on `POST /upload`,
 * `Upload-Metadata` on the resumable path). A key no column claims, uploaded
 * with no context, meets the source's own limit alone.
 */

/** What a storage column says a file may be. */
export interface UploadConstraints {
    /** Bytes. From the column's `maxBytes`. */
    maxSize?: number;
    /** MIME types or extensions. From the column's `accept`. */
    acceptedFiles?: readonly string[];
    /** `posts.coverImage` — for the message, so the answer names the rule. */
    source: string;
}

/** Look up the constraints for a table slug and a column address (`cover`, `content.seo.image`). */
export type ResolveUploadConstraints = (
    tableSlug: string,
    columnPath: string
) => UploadConstraints | undefined;

/**
 * A resolver over the tables this backend serves.
 *
 * Built from the server's descriptors rather than from the request,
 * deliberately: the limits have to be the server's, resolved by slug, or a
 * caller could send their own generous `maxBytes` alongside the file and the
 * check would be theirs to choose.
 */
export function createUploadConstraintResolver(
    tables: readonly TableDescriptor[]
): ResolveUploadConstraints {
    const bySlug = new Map<string, TableDescriptor>();
    for (const table of tables) bySlug.set(table.slug, table);

    return (tableSlug, columnPath) => {
        const table = bySlug.get(tableSlug);
        if (!table) return undefined;
        const storage = storageAt(table, columnPath);
        if (!storage) return undefined;
        if (storage.maxBytes === undefined && !storage.accept?.length) return undefined;
        return {
            maxSize: storage.maxBytes,
            acceptedFiles: storage.accept,
            source: `${tableSlug}.${columnPath}`
        };
    };
}

/**
 * The limits of every storage column whose path a key falls in.
 *
 * @param storageId the source the upload is written to, canonical.
 * @param key the canonical key the upload is written to.
 */
export type ResolveUploadPathConstraints = (storageId: string, key: string) => UploadConstraints[];

interface UploadPathRule {
    storageId: string;
    pattern: RegExp;
    constraints: UploadConstraints;
}

/**
 * A storage `path` template as a pattern over the keys the panel writes under
 * it: `<path>/<fileName>`, one segment for the file, under `public/` for a
 * public column.
 *
 * The placeholders the panel fills in (`resolveStoragePathString`) are
 * wildcards: one segment each, except `{path}` — a table path, which a nested
 * one has several of — and `{file.type}`, which has a `/` in it.
 */
function storagePathPattern(template: string, isPublic: boolean): RegExp {
    const trimmed = template.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
    const prefixed = isPublic && !trimmed.startsWith(PUBLIC_STORAGE_PREFIX) && trimmed !== PUBLIC_STORAGE_PREFIX.slice(0, -1)
        ? `${PUBLIC_STORAGE_PREFIX}${trimmed}`.replace(/\/+$/, "")
        : trimmed;
    const body = prefixed
        .split(/(\{[^}]*\})/)
        .map(part => {
            if (part === "{path}" || part === "{file.type}") return ".+";
            if (/^\{(propertyKey|rand|file|file\.name|file\.ext|id|entityId)\}$/.test(part)) return "[^/]+";
            return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("");
    return new RegExp(`^${body ? `${body}/` : ""}[^/]+$`);
}

const pathRuleCache = new WeakMap<readonly TableDescriptor[], UploadPathRule[]>();

/**
 * The storage-path rules of the tables this backend serves.
 *
 * A column's `maxBytes` and `accept` used to be checked only when an upload
 * named the column — which the panel never did, and a direct caller simply
 * does not — so the limits the docs called "enforced by the server" held for
 * nobody. A column's storage `path` is where its files go, so it is also where
 * its limits hold: every upload into that path, through any door, meets them.
 *
 * A position that declares no limits has no rule.
 */
export function createUploadPathResolver(tables: readonly TableDescriptor[]): ResolveUploadPathConstraints {
    let rules = pathRuleCache.get(tables);
    if (!rules) {
        rules = [];
        for (const table of tables) {
            for (const { column, path, storage } of storagePositions(table)) {
                if (storage.maxBytes === undefined && !storage.accept?.length) continue;
                const inside = formatJsonPath(path.filter(step => !("items" in step)));
                rules.push({
                    storageId: canonicalStorageId(storage.source),
                    pattern: storagePathPattern(storage.path, storage.public === true),
                    constraints: {
                        maxSize: storage.maxBytes,
                        acceptedFiles: storage.accept,
                        source: `${table.slug}.${column.key}${inside ? `.${inside}` : ""}`
                    }
                });
            }
        }
        pathRuleCache.set(tables, rules);
    }
    const compiled = rules;
    return (storageId, key) => compiled
        .filter(rule => rule.storageId === storageId && rule.pattern.test(key))
        .map(rule => rule.constraints);
}

/**
 * Refuse an upload that no storage column claiming its path would accept.
 *
 * Several columns may share a path; the file is for one of them, so it is
 * enough that one accepts it. When none does, the first one's refusal is the
 * answer, naming its column.
 */
export function assertUploadWithinPathLimits(
    constraints: readonly UploadConstraints[],
    file: { size?: number; type?: string; name?: string }
): void {
    if (constraints.length === 0) return;
    let refusal: unknown;
    for (const rule of constraints) {
        try {
            assertUploadWithinColumnLimits(rule, file);
            return;
        } catch (err) {
            refusal ??= err;
        }
    }
    throw refusal;
}

/**
 * Does `contentType` (or the file's extension) satisfy one `acceptedFiles`
 * entry?
 *
 * Three spellings, because all three are in use in the wild and the panel's own
 * picker accepts all three:
 *
 * - `image/*`          — a wildcard over a type
 * - `application/pdf`  — an exact MIME type
 * - `.pdf`             — an extension, which is what `<input accept>` takes and
 *                        what people therefore write
 *
 * A browser that sends `application/octet-stream` for a `.pdf` — which happens,
 * and is the reason extension entries exist at all — is matched on the name.
 */
function matchesOne(entry: string, contentType: string | undefined, fileName: string | undefined): boolean {
    const rule = entry.trim().toLowerCase();
    if (!rule || rule === "*" || rule === "*/*") return true;

    if (rule.startsWith(".")) {
        return Boolean(fileName && fileName.toLowerCase().endsWith(rule));
    }

    const type = (contentType ?? "").toLowerCase().split(";")[0].trim();
    if (!type) return false;
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
}

/** Is this file one the column accepts? */
export function isAcceptedFile(
    accepted: readonly string[] | undefined,
    contentType: string | undefined,
    fileName: string | undefined
): boolean {
    if (!accepted || accepted.length === 0) return true;
    return accepted.some(entry => matchesOne(entry, contentType, fileName));
}

/**
 * Refuse an upload the destination storage column does not accept.
 *
 * `413` for size and `400` for type, which is the distinction HTTP already
 * draws: one is "too big for this endpoint", the other is "this is not the
 * thing being asked for". Both name the column, because "file too large" with
 * no limit and no field is a message a developer cannot act on.
 */
export function assertUploadWithinColumnLimits(
    constraints: UploadConstraints | undefined,
    file: { size?: number; type?: string; name?: string }
): void {
    if (!constraints) return;

    if (constraints.maxSize !== undefined && typeof file.size === "number" && file.size > constraints.maxSize) {
        throw new ApiError(
            413,
            "STORAGE_FILE_TOO_LARGE",
            `This file is ${file.size} bytes, and '${constraints.source}' accepts at most ${constraints.maxSize}.`,
            {
                column: constraints.source,
                maxSize: constraints.maxSize,
                size: file.size
            }
        );
    }

    if (!isAcceptedFile(constraints.acceptedFiles, file.type, file.name)) {
        throw ApiError.badRequest(
            `'${constraints.source}' accepts ${constraints.acceptedFiles!.join(", ")}` +
            `${file.type ? `, and this file is ${file.type}` : ""}.`,
            "STORAGE_FILE_TYPE_REFUSED",
            {
                column: constraints.source,
                acceptedFiles: constraints.acceptedFiles,
                contentType: file.type
            }
        );
    }
}

/**
 * The storage column an upload names, from a request's own fields.
 *
 * Two keys, not one: the table is resolved against the server's descriptors,
 * so a caller cannot invent a limit — the worst they can do is name a column
 * whose rules are *stricter*, or none at all, which leaves the global cap.
 */
export function readUploadColumnContext(
    source: Record<string, unknown> | undefined
): { table: string; column: string } | undefined {
    const table = source?.[UPLOAD_TABLE_FIELD];
    const column = source?.[UPLOAD_COLUMN_FIELD];
    if (typeof table !== "string" || typeof column !== "string") return undefined;
    if (!table.trim() || !column.trim()) return undefined;
    return { table: table.trim(), column: column.trim() };
}

/**
 * The names the context travels under.
 *
 * Shared constants rather than three string literals, because the client
 * writes them and two servers read them (the multipart route and the TUS
 * metadata parser), and a typo in any one of the three fails silently as "no
 * context, use the global cap".
 *
 * The values are the wire's, which the client writes (`collection` for the
 * table slug, `property` for the column address); they change with the
 * client in one release, not here alone.
 */
export const UPLOAD_TABLE_FIELD = "collection";
/** The upload field naming the storage column's address. See {@link UPLOAD_TABLE_FIELD}. */
export const UPLOAD_COLUMN_FIELD = "property";
