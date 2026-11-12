import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UiPreferencesController, UiPreferencesTarget, UserConfigurationPersistence } from "@rebasepro/cms-types";
import type { UiPreferences, UiTablePreferences } from "@rebasepro/types";
import { isUiTablePreferences, mergeUiTablePreferences } from "@rebasepro/types";
import { stripCollectionPath } from "@rebasepro/cms-types";
import { DEFAULT_API_PATH } from "./ApiConfigContext";

/** How the hook reaches the server: the Rebase client, or its parts. */
export interface UiPreferencesTransport {
    baseUrl?: string;
    apiPath?: string;
    resolveToken?: () => Promise<string | null | undefined>;
}

/** Options of {@link useUiPreferences}. */
export interface UseUiPreferencesOptions {
    transport: UiPreferencesTransport | null | undefined;
    getAuthToken?: () => Promise<string | null>;
    /** The signed-in user's id: the preferences are re-read when it changes. */
    authKey?: string | null;
    /** `false` asks nothing: no workspace preferences, the user's kept in `local`. */
    enabled: boolean;
    /** The browser's store, for a user the server keeps no preferences for, and for favourites and recent paths. */
    local: UserConfigurationPersistence | undefined;
    /** How long a user's writes to one table are gathered before they are sent. Default 400 ms. */
    debounceMs?: number;
}

/** What {@link useUiPreferences} gives the panel. */
export interface UiPreferencesState {
    /** The workspace layer, and the collection editor's writer to it. */
    controller: UiPreferencesController;
    /** The user's own layer: the server's for a signed-in user it keeps them for, the browser's otherwise. */
    userPersistence: UserConfigurationPersistence | undefined;
}

const EMPTY: UiPreferences = { tables: {} };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/** A `{ tables }` document from the wire, keeping only valid preferences. */
function preferencesOf(value: unknown): UiPreferences {
    const tables: UiPreferences["tables"] = {};
    const listed = isRecord(value) && isRecord(value.tables) ? value.tables : {};
    for (const [slug, preferences] of Object.entries(listed)) {
        if (isUiTablePreferences(preferences)) tables[slug] = preferences;
    }
    return { tables };
}

const targetOf = (value: unknown): UiPreferencesTarget =>
    value === "file" || value === "database" ? value : "none";

/**
 * The panel's UI preferences, from `/api/admin/ui-config`.
 *
 * Two layers, folded over the code customizations in this order: the
 * workspace's (what the collection editor saved: `frontend/src/cms/ui-config.json`
 * in development, `rebase.ui_preferences` deployed), then the signed-in
 * user's own (what the views remember: column widths, order, view mode). A
 * user the server keeps no preferences for — signed out, or a server whose
 * driver cannot run SQL — keeps theirs in the browser.
 *
 * @group Hooks and utilities
 */
export function useUiPreferences({ transport, getAuthToken, authKey, enabled, local, debounceMs = 400 }: UseUiPreferencesOptions): UiPreferencesState {
    const base = `${String(transport?.baseUrl ?? "").replace(/\/$/, "")}${transport?.apiPath || DEFAULT_API_PATH}/admin/ui-config`;

    const tokenRef = useRef({ transport, getAuthToken });
    tokenRef.current = { transport, getAuthToken };
    const headers = useCallback(async (): Promise<Record<string, string>> => {
        const { transport: t, getAuthToken: get } = tokenRef.current;
        const token = (get ? await get() : null) ?? (t?.resolveToken ? await t.resolveToken() : null);
        return token ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` } : { "Content-Type": "application/json" };
    }, []);

    const [loading, setLoading] = useState(enabled);
    const [workspace, setWorkspace] = useState<UiPreferences>(EMPTY);
    const [user, setUser] = useState<UiPreferences>(EMPTY);
    const [workspaceTarget, setWorkspaceTarget] = useState<UiPreferencesTarget>("none");
    const [userOnServer, setUserOnServer] = useState(false);
    const [canWriteWorkspace, setCanWriteWorkspace] = useState(false);

    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                const response = await fetch(base, { headers: await headers() });
                if (cancelled) return;
                if (!response.ok) {
                    // An older backend (404), or one that keeps no preferences:
                    // the panel runs on the code customizations and the browser.
                    setWorkspace(EMPTY);
                    setUser(EMPTY);
                    setWorkspaceTarget("none");
                    setUserOnServer(false);
                    setCanWriteWorkspace(false);
                    return;
                }
                const body: unknown = await response.json();
                if (cancelled || !isRecord(body)) return;
                setWorkspace(preferencesOf(body.workspace));
                setUser(preferencesOf(body.user));
                setWorkspaceTarget(targetOf(body.workspaceTarget));
                setUserOnServer(body.userTarget === "database");
                setCanWriteWorkspace(body.canWriteWorkspace === true);
            } catch {
                if (!cancelled) setWorkspaceTarget("none");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [base, enabled, authKey, headers]);

    const put = useCallback(async (scope: "workspace" | "user", slug: string, preferences: UiTablePreferences): Promise<void> => {
        const response = await fetch(`${base}/${scope}/${encodeURIComponent(slug)}`, {
            method: "PUT",
            headers: await headers(),
            body: JSON.stringify({ preferences })
        });
        if (response.ok) return;
        const body: unknown = await response.json().catch(() => undefined);
        const error = isRecord(body) && isRecord(body.error) ? body.error : undefined;
        throw new Error(typeof error?.message === "string" ? error.message : `Saving the preferences of "${slug}" failed (HTTP ${response.status}).`);
    }, [base, headers]);

    const saveWorkspace = useCallback(async (slug: string, delta: UiTablePreferences) => {
        if (workspaceTarget === "none") {
            throw new Error("This server stores no UI preferences. Customize the table with customizeTable in the frontend instead.");
        }
        await put("workspace", slug, delta);
        setWorkspace(current => ({ tables: { ...current.tables, [slug]: mergeUiTablePreferences(current.tables[slug] ?? {}, delta) } }));
    }, [put, workspaceTarget]);

    // A user's writes — a column being resized fires many — are gathered per
    // table and sent once they settle; the views see them at once.
    const pending = useRef(new Map<string, { delta: UiTablePreferences; timer: ReturnType<typeof setTimeout> }>());
    useEffect(() => () => {
        for (const entry of pending.current.values()) clearTimeout(entry.timer);
    }, []);

    const saveUser = useCallback((path: string, delta: UiTablePreferences) => {
        const slug = stripCollectionPath(path);
        setUser(current => ({ tables: { ...current.tables, [slug]: mergeUiTablePreferences(current.tables[slug] ?? {}, delta) } }));
        const queued = pending.current.get(slug);
        if (queued) clearTimeout(queued.timer);
        const gathered = queued ? mergeUiTablePreferences(queued.delta, delta) : delta;
        const timer = setTimeout(() => {
            pending.current.delete(slug);
            put("user", slug, gathered).catch(error => console.warn(`[rebase] Could not save your preferences for "${slug}":`, error));
        }, debounceMs);
        pending.current.set(slug, { delta: gathered, timer });
    }, [put, debounceMs]);

    const userPersistence = useMemo<UserConfigurationPersistence | undefined>(() => {
        if (!local) return undefined;
        if (!enabled || !userOnServer) return local;
        return {
            ...local,
            getTablePreferences: (path: string) => user.tables[stripCollectionPath(path)] ?? {},
            saveTablePreferences: saveUser
        };
    }, [local, enabled, userOnServer, user, saveUser]);

    const controller = useMemo<UiPreferencesController>(() => ({
        loading,
        workspace,
        workspaceTarget,
        canWriteWorkspace,
        saveWorkspace
    }), [loading, workspace, workspaceTarget, canWriteWorkspace, saveWorkspace]);

    return { controller, userPersistence };
}
