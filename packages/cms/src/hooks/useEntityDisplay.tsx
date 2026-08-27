import type { AdminCollection, EntityDisplayRole } from "@rebasepro/cms-types";
import type { Entity, Property } from "@rebasepro/types";
import { ENTITY_DISPLAY_ROLES } from "@rebasepro/cms-types";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
    EntityDisplayCache,
    entityDisplayKey,
    getDisplayPropertyKey,
    getDisplayResolver,
    getPropertyInPath,
    useRebaseContext
} from "@rebasepro/app";
import { getValueInPath } from "@rebasepro/utils";

import { getEntityTitlePropertyKeyForEntity, isUserSelectProperty, resolveTitleToString } from "../util/previews";
import { getUserLabel, useResolvedUser } from "./useResolvedUsers";

/**
 * What fills one display role for one record.
 *
 * `value` is `undefined` rather than a placeholder when nothing resolved,
 * because the substitute differs by surface and each one knows its own better
 * than this hook does: a page heading wants the singular collection name, a link
 * wants the id, a draft wants "New customer". A single baked-in fallback is
 * exactly what produced three different ones scattered across the consumers.
 */
export interface ResolvedDisplayValue<T = unknown> {
    /** What goes in the slot. `undefined` when the record has nothing for it. */
    value: T | undefined;
    /**
     * A resolver is in flight, and `value` currently holds the derived answer or
     * nothing. Surfaces that can show a skeleton may; none has to.
     */
    loading: boolean;
    /**
     * Set only when the value came from a property of this collection. Carries
     * what a rich renderer needs — a status shows as its enum's coloured chip,
     * an image as a storage thumbnail — which a bare resolved string cannot
     * describe.
     */
    source?: {
        key: string;
        property: Property | undefined;
        value: unknown;
    };
}

/**
 * One shared store, so every surface agrees on a record and resolves it once.
 *
 * Module-level rather than a provider: two app instances on one page share a
 * cache keyed by collection path and record id, which *is* the same record.
 * Nothing here is user-specific — a resolver that reads per-user data must
 * invalidate on sign-out, which {@link useEntityDisplayCache} exposes.
 */
let sharedCache: EntityDisplayCache | undefined;

/**
 * The store behind {@link useEntityDisplay}, for invalidating after a write.
 *
 * Built on first use rather than at module scope. Importing a module should not
 * construct anything: it runs during SSR where there is nothing to cache, and it
 * made this module unimportable from any test that stubs `@rebasepro/app` —
 * which several do, and which is a legitimate thing for them to do.
 */
export function useEntityDisplayCache(): EntityDisplayCache {
    if (!sharedCache) sharedCache = new EntityDisplayCache();
    return sharedCache;
}

export interface UseEntityDisplayParams<M extends Record<string, unknown>> {
    /**
     * Optional because several callers look the collection up in the registry by
     * path and may not find it — a relation into a collection the panel does not
     * register. A hook that could not be called until that succeeded would have
     * to sit below an early return, which is not where hooks go.
     */
    collection?: AdminCollection<M>;
    /**
     * The record. A resolver is handed the whole entity — its id and path are
     * how it reaches anything the record does not carry — so a computed value is
     * only available once there is an entity to compute it from.
     */
    entity?: Entity<M>;
    /**
     * Values to read a declared path from when they are newer than the entity:
     * the live form values while editing. Falls back to `entity.values`.
     */
    values?: Record<string, unknown>;
    /** Set false to skip resolver work entirely — a draft has nothing to show. */
    enabled?: boolean;
}

/**
 * What fills one display role of one record.
 *
 * This is the only implementation. Before it there were seven for the title
 * alone — the identity bar, the detail header, inline previews, reference cards,
 * list slots, relation chips and the headless view — each re-deriving it from
 * `collection.properties` and disagreeing about the answer.
 *
 * Resolution order, per role:
 *
 * 1. `admin.display[role]` as a **resolver** — awaited, cached per record and
 *    role, with the derived value showing meanwhile so nothing flickers empty.
 * 2. `admin.display[role]` as a **property path** (or, for the title, the
 *    deprecated `titleProperty`).
 * 3. The **derived** answer: for the title, the best-ranked property carrying a
 *    readable value; for the rest, today's per-role heuristics.
 *
 * A user-picker title resolves to the person behind the id, as it always did —
 * that path is now here rather than in two of the seven.
 */
export function useEntityDisplay<T = unknown, M extends Record<string, unknown> = Record<string, unknown>>(
    role: EntityDisplayRole,
    {
        collection,
        entity,
        values: valuesProp,
        enabled = true
    }: UseEntityDisplayParams<M>
): ResolvedDisplayValue<T> {

    const context = useRebaseContext();
    const cache = useEntityDisplayCache();

    const values = valuesProp ?? entity?.values;

    /* ---- the declared or derived key ------------------------------------- */

    // The title is the one role with a ranking behind it: several candidates,
    // best first, skipping the ones that hold nothing for *this* record. The
    // others are a single declared or derived key.
    const declaredKey = collection ? getDisplayPropertyKey(collection, role) : undefined;
    const propertyKey = collection && role === "title" && !declaredKey
        ? getEntityTitlePropertyKeyForEntity(collection, values, entity?.id)
        : declaredKey;

    const rawValue = values && propertyKey ? getValueInPath(values, propertyKey) : undefined;

    // A user picker stores an auth id and renders the person: resolved like a
    // relation, and hooked unconditionally so the hook order never changes.
    const titleUser = useResolvedUser(
        collection && role === "title" && isUserSelectProperty(collection, propertyKey) && typeof rawValue === "string"
            ? rawValue
            : undefined
    );

    const derived = useMemo<T | undefined>(() => {
        if (titleUser) return getUserLabel(titleUser) as T;
        if (rawValue === undefined || rawValue === null) return undefined;
        // Only text roles get flattened to a string; a date stays a date and an
        // image stays whatever the storage property holds, so the renderer can
        // still format them.
        if (role === "title" || role === "subtitle" || role === "status") {
            return (resolveTitleToString(rawValue) || undefined) as T | undefined;
        }
        return rawValue as T;
    }, [titleUser, rawValue, role]);

    /* ---- the computed answer --------------------------------------------- */

    const resolver = collection ? getDisplayResolver(collection, role) : undefined;
    const canResolve = Boolean(enabled && resolver && entity);
    const key = entity ? entityDisplayKey(entity.path, entity.id, role) : undefined;

    const resolved = useSyncExternalStore<unknown>(
        // Subscribing unconditionally keeps the hook order stable. The store
        // only notifies when an entry changes, so a collection with no resolver
        // never re-renders from it.
        cb => cache.subscribe(cb),
        () => (canResolve && key ? cache.peek(key) : undefined),
        // Server render: nothing is resolved, so every slot starts at its
        // fallback and hydration does not disagree with the markup.
        () => undefined
    );

    const loading = Boolean(canResolve && key && resolved === undefined);

    useEffect(() => {
        if (!canResolve || !key || !resolver || !entity) return;
        if (cache.peek(key) !== undefined) return;
        cache.resolve(key, () => resolver({
            entity,
            context
        })).catch(() => {
            // Unreachable, and kept only so it stays that way: `resolve` records a
            // failure as "nothing" and returns a RESOLVED promise, which is why
            // the warning that used to live here could never run — see the note on
            // `EntityDisplayCache.resolve`. The cache reports the failure itself
            // now, once per key. This exists so that if `resolve` ever starts
            // rejecting, it surfaces as a caught no-op rather than an unhandled
            // rejection during render.
        });
    }, [cache, canResolve, key, resolver, entity, context, role]);

    /* ---- the answer ------------------------------------------------------ */

    // A resolver that produced nothing falls back to the derived value rather
    // than to blank: it said this record has no computed answer for the role,
    // not that the role should be empty.
    const computed = canResolve && resolved !== null ? resolved as T | undefined : undefined;
    const value = computed ?? derived;

    return useMemo(() => ({
        value,
        loading,
        source: collection && propertyKey && value === derived && derived !== undefined
            ? {
                key: propertyKey,
                property: getPropertyInPath(collection.properties, propertyKey),
                value: rawValue
            }
            : undefined
    }), [value, loading, propertyKey, derived, collection, rawValue]);
}

/**
 * Every display role of a record at once — what a list row, a card or a board
 * card needs, in one call rather than six.
 *
 * The role list is iterated from {@link ENTITY_DISPLAY_ROLES} so the hook order
 * is fixed and adding a role does not mean editing every caller.
 */
export function useEntityDisplayValues<M extends Record<string, unknown>>(
    params: UseEntityDisplayParams<M>
): Record<EntityDisplayRole, ResolvedDisplayValue> & { loading: boolean } {

    // Not a loop over `useEntityDisplay`: the number of hooks a component calls
    // has to be fixed at compile time, and a role added to the array later would
    // silently change it. Written out, it is checked by the return type.
    const title = useEntityDisplay<string, M>("title", params);
    const subtitle = useEntityDisplay<string, M>("subtitle", params);
    const image = useEntityDisplay<string, M>("image", params);
    const status = useEntityDisplay<string, M>("status", params);
    const date = useEntityDisplay<Date | string | number, M>("date", params);
    const tags = useEntityDisplay<string[] | string, M>("tags", params);

    return useMemo(() => ({
        title,
        subtitle,
        image,
        status,
        date,
        tags,
        loading: title.loading || subtitle.loading || image.loading
            || status.loading || date.loading || tags.loading
    }), [title, subtitle, image, status, date, tags]);
}

/**
 * What the record is called — the one role asked for often enough on its own to
 * deserve a name.
 */
export function useEntityTitle<M extends Record<string, unknown>>(
    params: UseEntityDisplayParams<M>
): ResolvedDisplayValue<string> {
    return useEntityDisplay<string, M>("title", params);
}

/** Re-exported so a caller can iterate roles without reaching into types. */
export { ENTITY_DISPLAY_ROLES };
