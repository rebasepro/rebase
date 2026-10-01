/**
 * The scopes a key stored before scopes existed is read as.
 *
 * Such a row carries `permissions` — `[{ collection, operations }]`, with
 * `"*"`, `"storage"`, `"functions"` and `"functions/<name>"` overloading the
 * collection field — and an `admin` flag. This turns it into the scopes and
 * RLS roles it now holds, once, when the store backfills the row.
 *
 * The rule is that nothing widens. Where a stored grant has no exact
 * equivalent, it narrows:
 *
 * - A function grant without `write` becomes nothing. Functions were checked
 *   by HTTP method, so a read-only grant let a key call GET functions; a
 *   function is code, and `functions:invoke` is not a read.
 * - `admin: true` becomes the `admin` RLS role and the admin surfaces such a
 *   key could reach (users, schema, backups, cron, logs) — not `database:*`,
 *   which lived on the realtime socket where no key could authenticate, and
 *   not `keys:*`, which no key may hold.
 *
 * @module
 */

import type { AdminScope } from "@rebasepro/types";

/** One stored permission entry, as the old column held it. */
export interface StoredPermission {
    collection: string;
    operations: string[];
}

const OPERATIONS = ["read", "write", "delete"] as const;
type Operation = (typeof OPERATIONS)[number];

function isOperation(value: string): value is Operation {
    return (OPERATIONS as readonly string[]).includes(value);
}

/** The admin surfaces an `admin: true` key reached. */
const ADMIN_KEY_SCOPES: readonly AdminScope[] = [
    "users:read",
    "users:write",
    "schema:read",
    "schema:write",
    "backups:read",
    "cron:read",
    "cron:write",
    "logs:read"
];

/** Read a stored `permissions` value — JSON text or already-parsed — into entries. */
export function parseStoredPermissions(value: unknown): StoredPermission[] {
    let raw = value;
    if (typeof raw === "string") {
        try {
            raw = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    if (!Array.isArray(raw)) return [];
    const entries: StoredPermission[] = [];
    for (const item of raw) {
        if (typeof item !== "object" || item === null) continue;
        if (!("collection" in item) || typeof item.collection !== "string") continue;
        const operations = "operations" in item && Array.isArray(item.operations)
            ? item.operations.filter((op: unknown): op is string => typeof op === "string")
            : [];
        entries.push({ collection: item.collection, operations });
    }
    return entries;
}

/** The scopes and RLS roles a stored key now holds. Never more than it did. */
export function scopesFromStoredPermissions(
    permissions: readonly StoredPermission[],
    admin: boolean
): { scopes: string[]; roles: string[] } {
    const scopes = new Set<string>();
    for (const { collection, operations } of permissions) {
        const ops = operations.filter(isOperation);
        if (collection === "*") {
            for (const op of ops) {
                scopes.add(`data:${op}`);
                scopes.add(`storage:${op}`);
            }
            if (ops.includes("write")) scopes.add("functions:invoke");
        } else if (collection === "storage") {
            for (const op of ops) scopes.add(`storage:${op}`);
        } else if (collection === "functions") {
            if (ops.includes("write")) scopes.add("functions:invoke");
        } else if (collection.startsWith("functions/")) {
            const name = collection.slice("functions/".length);
            if (name && ops.includes("write")) scopes.add(`functions:invoke:${name}`);
        } else if (collection) {
            for (const op of ops) scopes.add(`data:${op}:${collection}`);
        }
    }
    if (admin) {
        for (const scope of ADMIN_KEY_SCOPES) scopes.add(scope);
    }
    return { scopes: [...scopes], roles: admin ? ["admin"] : [] };
}
