import { useEffect, useState } from "react";
import type { User } from "@rebasepro/types";
import { apiBaseOf, useAuthController, useRebaseClient } from "@rebasepro/app";

/**
 * Resolves the auth users behind `userSelect` values.
 *
 * A collection view can ask for dozens of ids at once — one per row — so
 * lookups are coalesced into a single `GET /api/users?ids=…` per tick and
 * cached per base URL. Ids that resolve to nothing are remembered too, so a
 * dangling reference is not retried on every render.
 */

interface UserCache {
    users: Map<string, User | null>;
    pending: Map<string, Promise<void>>;
    queue: Set<string>;
    flush?: ReturnType<typeof setTimeout>;
}

const caches = new Map<string, UserCache>();

function getCache(baseUrl: string): UserCache {
    let cache = caches.get(baseUrl);
    if (!cache) {
        cache = { users: new Map(),
pending: new Map(),
queue: new Set() };
        caches.set(baseUrl, cache);
    }
    return cache;
}

async function fetchUsers(apiBase: string, ids: string[], token: string | undefined): Promise<Map<string, User | null>> {
    const resolved = new Map<string, User | null>();
    for (const id of ids) resolved.set(id, null);

    const params = new URLSearchParams({ ids: ids.join(",") });
    // Same route as the selector — see the note there; `/api/users` is a 404,
    // so every `userSelect` value rendered as a bare id.
    const response = await fetch(`${apiBase}/admin/users?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!response.ok) {
        // A non-admin viewer gets a 403 here. Treat it as "unresolvable" rather
        // than an error: callers fall back to showing the raw value.
        return resolved;
    }
    const data = await response.json();
    const rows: Record<string, unknown>[] = data.users ?? data.data ?? [];
    for (const row of rows) {
        const uid = (row.uid as string) ?? (row.id as string);
        if (!uid) continue;
        resolved.set(uid, {
            uid,
            email: (row.email as string) ?? "",
            displayName: (row.displayName as string) ?? (row.display_name as string) ?? null,
            photoURL: (row.photoURL as string) ?? (row.photo_url as string) ?? null,
            providerId: "custom",
            isAnonymous: false,
            roles: (row.roles as string[]) ?? []
        });
    }
    return resolved;
}

function requestUser(
    baseUrl: string,
    uid: string,
    getAuthToken: (() => Promise<string | undefined>) | undefined
): Promise<void> {
    const cache = getCache(baseUrl);
    const existing = cache.pending.get(uid);
    if (existing) return existing;

    cache.queue.add(uid);

    const promise = new Promise<void>((resolve, reject) => {
        if (cache.flush) clearTimeout(cache.flush);
        cache.flush = setTimeout(async () => {
            const ids = [...cache.queue];
            cache.queue.clear();
            cache.flush = undefined;
            try {
                const token = await getAuthToken?.();
                const resolved = await fetchUsers(baseUrl, ids, token);
                for (const id of ids) {
                    cache.users.set(id, resolved.get(id) ?? null);
                    cache.pending.delete(id);
                }
                resolve();
            } catch (error) {
                for (const id of ids) cache.pending.delete(id);
                reject(error);
            }
        }, 0);
    });

    cache.pending.set(uid, promise);
    return promise;
}

/**
 * The auth user behind a `userSelect` value, or `null` while it is loading or
 * when it cannot be resolved.
 */
export function useResolvedUser(uid: string | undefined): User | null {
    const client = useRebaseClient<{ baseUrl?: string, apiPath?: string }>();
    const { getAuthToken } = useAuthController();
    /* The API prefix, not the bare origin: it keys the cache and is what a
       request is built from, and a backend with a non-default `basePath`
       serves neither at `/api`. */
    const baseUrl = apiBaseOf(client);

    const [user, setUser] = useState<User | null>(() =>
        (baseUrl && uid) ? getCache(baseUrl).users.get(uid) ?? null : null);

    useEffect(() => {
        if (!baseUrl || !uid) {
            setUser(null);
            return;
        }
        const cache = getCache(baseUrl);
        if (cache.users.has(uid)) {
            setUser(cache.users.get(uid) ?? null);
            return;
        }

        let active = true;
        requestUser(baseUrl, uid, getAuthToken)
            .then(() => {
                if (active) setUser(getCache(baseUrl).users.get(uid) ?? null);
            })
            .catch(() => {
                if (active) setUser(null);
            });
        return () => {
            active = false;
        };
    }, [baseUrl, uid, getAuthToken]);

    return user;
}

/** Human-readable label for a resolved user. */
export function getUserLabel(user: User): string {
    return user.displayName || user.email || user.uid;
}
