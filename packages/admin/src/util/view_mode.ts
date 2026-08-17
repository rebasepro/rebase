
import type { ViewMode, AdminCollection, CollectionCustomView } from "@rebasepro/admin-types";

/**
 * Query param that carries the active collection view mode across navigations.
 */
export const VIEW_MODE_PARAM = "__view";

/** The view modes every collection has, before custom views are added. */
export const VIEW_MODES: ViewMode[] = ["list", "table", "cards", "kanban"];

export const DEFAULT_VIEW_MODE: ViewMode = "list";

export type OpenEntityMode = "side_panel" | "full_screen" | "split" | "dialog";

export const DEFAULT_OPEN_ENTITY_MODE: OpenEntityMode = "split";

/**
 * Whether `value` names a view mode this collection can actually render.
 *
 * `customKeys` are the keys of the collection's resolved custom views. They
 * have to be passed in rather than looked up: a custom view is registered per
 * collection, so there is no global set to check against, and validating
 * against the built-ins alone is what would send `?__view=map` to the table.
 *
 * Omitting them checks the built-ins only, which is the right answer for
 * callers that have no collection in hand.
 */
export function isViewMode(value: string | null | undefined, customKeys?: readonly string[]): value is ViewMode {
    if (!value) return false;
    return VIEW_MODES.includes(value as ViewMode) || Boolean(customKeys?.includes(value));
}

/**
 * Read the active view mode from a query string, if it holds one this
 * collection can render.
 *
 * @param search a query string (e.g. `location.search`). Falls back to the
 *        current browser location when omitted.
 * @param customKeys keys of the collection's custom views, if any.
 */
export function getViewModeFromSearch(search?: string, customKeys?: readonly string[]): ViewMode | null {
    const source = search ?? (typeof window !== "undefined" ? window.location.search : "");
    const value = new URLSearchParams(source).get(VIEW_MODE_PARAM);
    return isViewMode(value, customKeys) ? value : null;
}

/**
 * Append the active view mode to a URL so the target route keeps rendering the
 * view the user was last looking at.
 *
 * Every entity/collection navigation must go through this — a missed call site
 * silently resets the user's view mode mid-session.
 *
 * @param url the URL to decorate. May already contain a query string and/or hash.
 * @param search query string to read the view mode from. Defaults to the
 *        current browser location.
 */
export function withViewMode(url: string, search?: string): string {
    // Carries whatever the param holds rather than validating it. These call
    // sites are navigations — they have no collection in hand, so they cannot
    // know whether `map` is one of *this* collection's custom views. Checking
    // against the built-ins here would drop every custom view on the first
    // record click. The binding validates on read, which is where the answer
    // is knowable.
    const source = search ?? (typeof window !== "undefined" ? window.location.search : "");
    const viewMode = new URLSearchParams(source).get(VIEW_MODE_PARAM);
    if (!viewMode) return url;

    // Preserve any hash — the param belongs to the query, which precedes it.
    const hashIndex = url.indexOf("#");
    const hash = hashIndex >= 0 ? url.substring(hashIndex) : "";
    const base = hashIndex >= 0 ? url.substring(0, hashIndex) : url;

    if (new URLSearchParams(base.split("?")[1] ?? "").has(VIEW_MODE_PARAM)) {
        return url;
    }

    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}${VIEW_MODE_PARAM}=${viewMode}${hash}`;
}

/**
 * Carry the whole of the collection list's URL state onto a navigation target.
 *
 * `withViewMode` exists because losing the view mode mid-session is jarring.
 * Everything else the list writes to the URL — the search string, the filters,
 * the sort — is state the user built up deliberately, and losing *that* is
 * worse: opening a record from a search and pressing back returned an
 * unfiltered list with an empty search box, so the search had to be retyped
 * for every record they wanted to look at.
 *
 * Copies every param the list currently has rather than an allowlist, because
 * filters are encoded under the field's own name — there is no fixed set to
 * list. Params already on the target win: the caller is more specific.
 *
 * @param url the URL to decorate. May carry a query string and/or a hash.
 * @param search query string to read from. Defaults to the browser location.
 */
export function withListState(url: string, search?: string): string {
    const source = search ?? (typeof window !== "undefined" ? window.location.search : "");
    const carried = new URLSearchParams(source);
    if ([...carried].length === 0) return url;

    const hashIndex = url.indexOf("#");
    const hash = hashIndex >= 0 ? url.substring(hashIndex) : "";
    const base = hashIndex >= 0 ? url.substring(0, hashIndex) : url;

    const [pathname, existing] = base.split("?");
    const target = new URLSearchParams(existing ?? "");
    for (const [key, value] of carried) {
        if (!target.has(key)) target.set(key, value);
    }

    const query = target.toString();
    return query ? `${pathname}?${query}${hash}` : `${pathname}${hash}`;
}

/**
 * Resolve the view mode for a collection, honouring the documented priority:
 * URL param > saved user config > collection default.
 */
export function resolveViewMode({
    collection,
    search,
    savedViewMode,
    customKeys
}: {
    collection?: Pick<AdminCollection<any>, "defaultViewMode">;
    search?: string;
    savedViewMode?: ViewMode | null;
    /** Keys of the collection's resolved custom views. */
    customKeys?: readonly string[];
}): ViewMode {
    const fromUrl = getViewModeFromSearch(search, customKeys);
    if (fromUrl) return fromUrl;
    if (isViewMode(savedViewMode, customKeys)) return savedViewMode;
    // A `defaultViewMode` naming a custom view that is no longer registered
    // would leave the collection on a mode nothing renders, so it gets the
    // same check the other two sources get.
    const configured = collection?.defaultViewMode;
    if (isViewMode(configured, customKeys)) return configured;
    return DEFAULT_VIEW_MODE;
}

/**
 * Resolve how clicking an entity should present it.
 *
 * An explicit `collection.openEntityMode` always wins. Otherwise the mode is
 * derived from the active view mode, so the presentation suits the surface the
 * user is looking at: a board keeps its columns behind an overlay, a wide table
 * hands the entity the full width, and list/card views use master-detail.
 *
 * This is the single source of truth — row clicks, find-by-id and the router
 * must all resolve through it, otherwise the same entity opens differently
 * depending on how it was reached.
 */
export function resolveOpenEntityMode({
    collection,
    viewMode,
    customView
}: {
    collection?: Pick<AdminCollection<any>, "openEntityMode">;
    viewMode?: ViewMode;
    /** The resolved custom view, when `viewMode` names one. */
    customView?: Pick<CollectionCustomView, "openEntityMode">;
}): OpenEntityMode {
    if (collection?.openEntityMode) return collection.openEntityMode;
    // A custom view gets to say, because only it knows whether it owns its
    // surface. Falls to the board's answer: a map or a calendar keeps its
    // canvas and shows the record over it, where "split" would halve it.
    if (customView) return customView.openEntityMode ?? "side_panel";
    if (viewMode === "kanban") return "side_panel";
    if (viewMode === "table" || viewMode === "cards") return "full_screen";
    return DEFAULT_OPEN_ENTITY_MODE;
}
