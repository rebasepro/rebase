import { Entity, FilterValues } from "@rebasepro/types";

/**
 * How many (collection, filters) pairs keep a scroll position. Past it, the
 * one written least recently goes. Every combination of filters a user ever
 * applied used to keep an entry, with the rows it showed, for the rest of the
 * session.
 */
const SCROLL_CACHE_LIMIT = 20;

/** Key: path plus filters (`createCacheKey`). Emptied on sign-out. */
const collectionScrollCache = new Map<string, { scrollOffset: number, data: Entity<any>[] }>();

/**
 * Forget every collection's scroll position and the rows kept with it.
 *
 * The rows are what the signed-in user was allowed to read, and a table seeds
 * its first render from them, so they must not outlive that user's session.
 */
export function clearCollectionScrollCache(): void {
    collectionScrollCache.clear();
}

export type ScrollRestorationController = {

    getCollectionScroll: (path: string,
        filters?: FilterValues<any>) => {
            scrollOffset: number,
            data: Entity<any>[]
        } | undefined;

    updateCollectionScroll: (props: {
        path: string,
        scrollOffset: number,
        filters?: FilterValues<any>;
        data: Entity<any>[]
    }) => void;

}

export function useScrollRestoration(): ScrollRestorationController {

    const updateCollectionScroll = ({
        path,
        filters,
        scrollOffset,
        data
    }: {
        path: string;
        filters?: FilterValues<any>;
        sort?: [string, "asc" | "desc"];
        scrollOffset: number;
        data: Entity<any>[]
    }) => {
        const key = createCacheKey(path, filters);
        // Re-inserted, so the Map's order is the order of last use.
        collectionScrollCache.delete(key);
        collectionScrollCache.set(key, {
            scrollOffset,
            data
        });
        if (collectionScrollCache.size > SCROLL_CACHE_LIMIT) {
            const oldest = collectionScrollCache.keys().next().value;
            if (oldest !== undefined) collectionScrollCache.delete(oldest);
        }
    }

    const getCollectionScroll = (path: string,
        filters?: FilterValues<any>) => {
        return collectionScrollCache.get(createCacheKey(path, filters));
    }

    return {
        getCollectionScroll,
        updateCollectionScroll
    }
}

function createCacheKey(path: string, filters?: FilterValues<any>) {

    if (!filters) {
        return path;
    }

    // codify the filters into a url friendly string
    const filtersString = filters ? Object.keys(filters).map(key => {
        const value = JSON.stringify(filters[key]);
        return `${key}=${value}`;
    }).join("&") : "";

    return `${path}?${filtersString}`;
}
