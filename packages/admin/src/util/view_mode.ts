
import type { ViewMode, AdminCollection } from "@rebasepro/admin-types";

/**
 * Query param that carries the active collection view mode across navigations.
 */
export const VIEW_MODE_PARAM = "__view";

export const VIEW_MODES: ViewMode[] = ["list", "table", "cards", "kanban"];

export const DEFAULT_VIEW_MODE: ViewMode = "list";

export type OpenEntityMode = "side_panel" | "full_screen" | "split" | "dialog";

export const DEFAULT_OPEN_ENTITY_MODE: OpenEntityMode = "split";

export function isViewMode(value: string | null | undefined): value is ViewMode {
    return Boolean(value) && VIEW_MODES.includes(value as ViewMode);
}

/**
 * Read the active view mode from a query string, if it holds a valid one.
 *
 * @param search a query string (e.g. `location.search`). Falls back to the
 *        current browser location when omitted.
 */
export function getViewModeFromSearch(search?: string): ViewMode | null {
    const source = search ?? (typeof window !== "undefined" ? window.location.search : "");
    const value = new URLSearchParams(source).get(VIEW_MODE_PARAM);
    return isViewMode(value) ? value : null;
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
    const viewMode = getViewModeFromSearch(search);
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
    savedViewMode
}: {
    collection?: Pick<AdminCollection<any>, "defaultViewMode">;
    search?: string;
    savedViewMode?: ViewMode | null;
}): ViewMode {
    const fromUrl = getViewModeFromSearch(search);
    if (fromUrl) return fromUrl;
    if (isViewMode(savedViewMode)) return savedViewMode;
    return collection?.defaultViewMode ?? DEFAULT_VIEW_MODE;
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
    viewMode
}: {
    collection?: Pick<AdminCollection<any>, "openEntityMode">;
    viewMode?: ViewMode;
}): OpenEntityMode {
    if (collection?.openEntityMode) return collection.openEntityMode;
    if (viewMode === "kanban") return "side_panel";
    if (viewMode === "table" || viewMode === "cards") return "full_screen";
    return DEFAULT_OPEN_ENTITY_MODE;
}
