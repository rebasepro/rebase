/**
 * The UI preference layers this server knows, read the one way every
 * server-side consumer reads them: `GET /api/admin/ui-config` and the MCP
 * view payload (`mcp/mcp-view.ts`).
 *
 * Three layers, in the order the panel folds them (see `compose_collections`
 * in `@rebasepro/cms`):
 *
 * 1. **shipped** — `frontend/src/cms/ui-config.json`, the reviewed
 *    presentation the project's frontend imports as `<RebaseCMS uiConfig>`.
 *    In development the server reads it in the project's tree; deployed, it
 *    reads the copy a built bundle carries (`entry.uiConfig` in the bundle
 *    manifest). A server that knows neither has an empty layer.
 * 2. **workspace** — what the collection editor saved for everybody on the
 *    server: rows of `rebase.ui_preferences`. In development the editor
 *    writes the file instead, so this layer IS the file there.
 * 3. **user** — the caller's own rows.
 *
 * @module
 */
import type { UiPreferences } from "@rebasepro/types";
import { readUiConfigFile } from "./ui-config-routes";
import type { UiPreferencesStore } from "./ui-preferences-store";

/** Where the layers are read from. */
export interface UiPreferenceSources {
    /** The rows; `null` when the driver cannot run SQL. */
    store: UiPreferencesStore | null;
    /**
     * The project's `frontend/src/cms/ui-config.json`, when this server may
     * write the project's source (development): the workspace layer is the
     * file, and so is the shipped one.
     */
    workspaceFile?: string;
    /**
     * The copy of `ui-config.json` a built bundle carries (`entry.uiConfig`):
     * the shipped layer of a deployed server. Read only when there is no
     * {@link workspaceFile}.
     */
    shippedFile?: string;
}

/** The layers, as stored. */
export interface UiPreferenceLayers {
    /** `ui-config.json` as this server knows it; empty when it knows none. */
    shipped: UiPreferences;
    /** The workspace's preferences: the file in development, the rows deployed. */
    workspace: UiPreferences;
    /** The caller's own; empty for a caller that is not a person. */
    user: UiPreferences;
    /** Where workspace preferences are written. */
    workspaceTarget: "file" | "database" | "none";
    /** Where the caller's own preferences are written. */
    userTarget: "database" | "none";
}

const EMPTY: UiPreferences = { tables: {} };

/**
 * Read the layers for one caller. `uid` is the signed-in person's id, absent
 * for a caller that is not one (an API key, a platform token, the service
 * key): such a caller has no user layer.
 */
export async function readUiPreferenceLayers(sources: UiPreferenceSources, uid?: string): Promise<UiPreferenceLayers> {
    const { store, workspaceFile, shippedFile } = sources;
    const file = workspaceFile ?? shippedFile;
    const shipped = file ? await readUiConfigFile(file) : EMPTY;
    const workspace = workspaceFile
        ? shipped
        : store ? await store.list({ scope: "workspace" }) : EMPTY;
    const user = uid && store ? await store.list({ scope: "user", uid }) : EMPTY;
    return {
        shipped,
        workspace,
        user,
        workspaceTarget: workspaceFile ? "file" : store ? "database" : "none",
        userTarget: uid && store ? "database" : "none"
    };
}

/**
 * The layers as the panel folds them, for a consumer that composes them
 * itself (the MCP view): `<RebaseCMS uiConfig>`'s layer, then the server's
 * workspace layer, then the user's. In development the workspace layer is
 * the shipped file, so it is not repeated.
 */
export function composableLayers(layers: UiPreferenceLayers): { file: UiPreferences; workspace: UiPreferences; user: UiPreferences } {
    return {
        file: layers.shipped,
        workspace: layers.workspaceTarget === "file" ? EMPTY : layers.workspace,
        user: layers.user
    };
}
