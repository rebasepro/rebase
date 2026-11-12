import type { UiPreferences, UiTablePreferences } from "@rebasepro/types";

/**
 * The signed-in user's own preferences, and the panel's per-browser state.
 *
 * A table's preferences are a {@link UiTablePreferences} delta in the
 * `customizeTable` vocabulary — a resized column (`fields.x.columnWidth`), a
 * reordered one (`fieldOrder`), the view mode a table was left in
 * (`defaultViewMode`), the board's column (`kanban.columnField`) — folded in
 * last, over the code customizations and the workspace's preferences. They are
 * stored on the server (`/api/admin/ui-config/user/:slug`) for a signed-in
 * user, and in the browser otherwise.
 *
 * @group Models
 */
export interface UserConfigurationPersistence {
    /** The user's preferences for a table (by slug or collection path), `{}` when there are none. */
    getTablePreferences: (slug: string) => UiTablePreferences;
    /** Merge `delta` into the user's preferences for a table. */
    saveTablePreferences: (slug: string, delta: UiTablePreferences) => void;
    recentlyVisitedPaths: string[];
    setRecentlyVisitedPaths: (paths: string[]) => void;
    favouritePaths: string[];
    setFavouritePaths: (paths: string[]) => void;
    collapsedGroups: string[];
    setCollapsedGroups: (paths: string[]) => void;
}

/**
 * Where the workspace's UI preferences are written: `frontend/src/cms/ui-config.json`
 * on a server that may write the project's source (development), rows of
 * `rebase.ui_preferences` when deployed, nowhere when the server stores none.
 *
 * @group Models
 */
export type UiPreferencesTarget = "file" | "database" | "none";

/**
 * The workspace's UI preferences: how every user's panel presents each table,
 * as the collection editor wrote them.
 *
 * @group Models
 */
export interface UiPreferencesController {
    /** `true` until the server has answered. */
    loading: boolean;
    /** The workspace's preferences, by table slug. */
    workspace: UiPreferences;
    /** Where {@link saveWorkspace} writes. */
    workspaceTarget: UiPreferencesTarget;
    /** Whether this caller may change the workspace's preferences (`schema:write`). */
    canWriteWorkspace: boolean;
    /** Merge `delta` into the workspace's preferences for `slug`. Rejects with the server's refusal. */
    saveWorkspace: (slug: string, delta: UiTablePreferences) => Promise<void>;
}
