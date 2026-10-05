import { CollectionsConfigController, SaveCollectionParams, UpdateCollectionParams, DeleteCollectionParams, SavePropertyParams, DeletePropertyParams, UpdatePropertiesOrderParams } from "./types/config_controller";
import { diffCollections, type CollectionPatch } from "@rebasepro/types";
import { getSubcollections } from "@rebasepro/common";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AdminCollection } from "@rebasepro/cms-types";
import { DEFAULT_API_PATH } from "@rebasepro/app";
import { useLiveSchemaEditing } from "./useLiveSchemaEditing";

/**
 * What the backend said about its schema editor, and how sure we are.
 *
 * `unknown` covers both "still asking" and "could not ask" — a backend too old
 * to have the endpoint, or one that is unreachable. Those fall back to the
 * build-mode guess below rather than locking the editor for someone whose
 * editor used to work.
 */
type SchemaEditorAvailability =
    | { state: "unknown" }
    | { state: "known", enabled: boolean, reason?: string };

/**
 * The guess this hook used to make on its own.
 *
 * `process.env.NODE_ENV` here is the *frontend bundle's* build mode. Whether
 * the schema editor exists is decided by a different process entirely — the
 * server's own `NODE_ENV`, its `collectionsDir`, whether its collections were
 * introspected, whether `ts-morph` is installed. The two disagree in every
 * ordinary setup: a dev frontend against a deployed API, a `baas` project, a
 * hosted console. When they did, the editor offered itself and every save came
 * back `404 Not Found`. It is kept only as the answer for a backend too old to
 * be asked.
 */
const buildModeGuess = (): boolean => process.env.NODE_ENV === "production";

export function useLocalCollectionsConfigController(
    clientOrUrl: any,
    baseCollections: AdminCollection[] = [],
    options?: {
        readOnly?: boolean;
        getAuthToken?: () => Promise<string | null>;
        /**
         * Identity of the signed-in user, if any.
         *
         * Only used to re-ask the backend when it changes: whether the editor
         * will accept a write depends on who is asking, and the answer to an
         * anonymous probe does not survive a sign-in.
         */
        authKey?: string | null;
        /**
         * Whether the signed-in user holds `schema:read`, which both
         * status routes require. `false` asks neither and leaves the editor
         * read-only, because a 403 is the only answer such a user can get.
         * Absent means ask.
         */
        mayReadSchema?: boolean;
    }
): CollectionsConfigController {

    const parsedCollections = baseCollections;

    // Store latest options in a ref to prevent stale closures in the `request` function
    // due to useMemo caching the saveCollection function.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    // `/api` only by default — a backend configured with another `basePath`
    // mounts the schema editor under that instead.
    const clientBaseUrl = typeof clientOrUrl === "string"
        ? clientOrUrl
        : (clientOrUrl?.baseUrl ?? "");
    const clientApiPath = (typeof clientOrUrl === "object" && clientOrUrl !== null && clientOrUrl.apiPath)
        || DEFAULT_API_PATH;
    const editorUrl = `${String(clientBaseUrl).replace(/\/$/, "")}${clientApiPath}/schema-editor`;

    const resolveToken = async (): Promise<string | null> => {
        let token = optionsRef.current?.getAuthToken ? await optionsRef.current.getAuthToken() : null;
        if (!token && typeof clientOrUrl === "object" && clientOrUrl !== null && clientOrUrl.resolveToken) {
            token = await clientOrUrl.resolveToken();
        }
        return token ?? null;
    };

    const request = async (endpoint: string, payload: Record<string, unknown>) => {
        try {
            const token = await resolveToken();

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const response = await fetch(`${editorUrl}${endpoint}`, {
                method: "POST",
                headers,
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const text = await response.text();
                let err: Record<string, unknown> = {};
                try {
                    err = JSON.parse(text);
                } catch (e) {
                    // ignore json parse error
                }

                if (Object.keys(err).length === 0) {
                    err = { message: text };
                }
                console.error("dev server error payload:", err);
                const errObj = err.error as Record<string, unknown> | string | undefined;
                const errMessage = typeof errObj === "object" && errObj !== null
                    ? (errObj.message as string)
                    : (typeof errObj === "string" ? errObj : (err.message as string | undefined));
                throw new Error(errMessage || "Error communicating with local dev server");
            }
        } catch (e) {
            console.error("fetch request failed", e);
            throw e;
        }
    };

    // ── Ask the backend whether it will accept an edit ────────────────
    const noSchemaAccess = options?.mayReadSchema === false;
    const forcedReadOnly = noSchemaAccess ? true : options?.readOnly;
    const authKey = options?.authKey ?? null;
    const [availability, setAvailability] = useState<SchemaEditorAvailability>({ state: "unknown" });

    useEffect(() => {
        // Nothing to ask about: the caller has already decided.
        if (forcedReadOnly === true) return;

        let cancelled = false;
        (async () => {
            try {
                const token = await resolveToken();
                const response = await fetch(`${editorUrl}/status`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
                if (cancelled) return;

                // A backend from before the endpoint existed. Guessing from the
                // bundle's build mode is wrong, but it is what that backend's
                // admin panel has always done, and locking the editor for
                // someone whose editor works would be worse.
                if (response.status === 404) {
                    setAvailability({ state: "unknown" });
                    return;
                }

                const body = await response.json().catch(() => ({})) as {
                    enabled?: boolean,
                    reason?: string,
                    error?: { message?: string }
                };
                if (cancelled) return;

                if (response.ok) {
                    setAvailability({
                        state: "known",
                        enabled: body.enabled === true,
                        reason: body.reason
                    });
                } else {
                    // 401/403 (not an admin) or 501 (no auth configured at all)
                    // — all of them mean this session cannot edit collections,
                    // and the body says why better than we could.
                    setAvailability({
                        state: "known",
                        enabled: false,
                        reason: body.error?.message
                            ?? `The backend refused to say whether collections are editable (HTTP ${response.status}).`
                    });
                }
            } catch {
                if (!cancelled) setAvailability({ state: "unknown" });
            }
        })();

        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editorUrl, forcedReadOnly, authKey]);

    // ── Live schema editing ───────────────────────────────────────────
    // The same edit, against a backend that can also change the database and
    // commit the result. When it is available, a save is planned and shown
    // before anything happens; when it is not, this is inert and writes go
    // straight to the source-only editor exactly as before.
    const liveSchema = useLiveSchemaEditing({
        baseUrl: `${String(clientBaseUrl).replace(/\/$/, "")}${clientApiPath}/admin/schema`,
        getAuthToken: resolveToken,
        authKey,
        // A read-only editor writes nothing, so there is nothing to ask.
        enabled: forcedReadOnly !== true
    });

    /**
     * Perform a write, through the live editor when there is one.
     *
     * `sourceOnly` is the write this controller has always done. It stays the
     * whole behaviour on a backend that cannot edit its schema — a bundle
     * deployment, a non-Postgres driver, a version too old to be asked — so
     * nothing about the editor depends on the feature being there.
     */
    const write = async (
        collectionId: string,
        change: { collection: Record<string, unknown> } | { patch: CollectionPatch }
    ): Promise<void> => {
        // Nothing changed: nothing to plan, commit or write.
        if ("patch" in change && change.patch.length === 0) return;
        // `ready()`, not `status` — the rendered status is undefined for one
        // round trip after mount, so reading it here would send a save issued
        // in that window down the source-only path with no confirmation, while
        // the same save a second later would open a dialog. One round trip is
        // cheap; behaviour that depends on how fast somebody clicked is not.
        const available = await liveSchema.ready();
        const proposed = { collectionId, ...change };
        if (!available.enabled) {
            await request("/collection/save", "patch" in change
                ? { collectionId, patch: change.patch }
                : { collectionId, collectionData: change.collection });
            return;
        }
        await liveSchema.reviewChange(proposed);
    };

    const readOnly = forcedReadOnly
        ?? (availability.state === "known" ? !availability.enabled : buildModeGuess());

    // No reason of our own for a user without schema access. Each surface
    // has a generic "editing is disabled" for that, and the user's scopes may
    // still be loading, so a specific reason could be wrong.
    const readOnlyReason = noSchemaAccess
        ? undefined
        : availability.state === "known" && availability.reason
            ? availability.reason
            : "Collections can only be edited against a backend running the schema editor, which is off in production.";

    const findCollection = (id: string): AdminCollection | undefined =>
        parsedCollections.find(c => (c as AdminCollection & { id?: string }).id === id || c.slug === id);

    /**
     * What to send for a collection that should end up as `saving`.
     *
     * For one that exists: the difference from `loaded` — what the person
     * changed — and nothing else. Both sides are the same view model, through
     * JSON, so whatever JSON cannot carry (a handler, a shared property, an
     * imported enum) is absent from both and never appears as a change; the
     * server writes only the keys the patch names. A collection this does not
     * recognise is a new one, and is sent whole.
     */
    const changeFor = (
        id: string,
        saving: Record<string, unknown>,
        loaded?: Record<string, unknown>
    ): { collection: Record<string, unknown> } | { patch: CollectionPatch } => {
        const current = loaded ?? findCollection(id) as Record<string, unknown> | undefined;
        return current
            ? { patch: diffCollections(current, saving) }
            : { collection: saving };
    };

    /** `findCollection`, as the record a patch is computed from. */
    const currentOf = (id: string): Record<string, unknown> =>
        (findCollection(id) as Record<string, unknown> | undefined) ?? {};

    return useMemo(() => ({
        loading: false,
        readOnly,
        readOnlyReason,
        collections: parsedCollections,
        dialog: liveSchema.dialog,
        getCollection: (id: string) => {
            const found = findCollection(id);
            if (found) return found;
            throw Error(`Collection ${id} not found in local mode`);
        },

        saveCollection: async ({ id, collectionData, baseline }: SaveCollectionParams) => {
            await write(id, changeFor(
                id,
                collectionData as Record<string, unknown>,
                baseline as Record<string, unknown> | undefined
            ));
        },
        // `collectionData` is a partial: the keys it names, set over the
        // collection as it is.
        updateCollection: async ({ id, collectionData }: UpdateCollectionParams) => {
            const current = findCollection(id) as Record<string, unknown> | undefined;
            await write(id, current
                ? { patch: diffCollections(current, { ...current, ...(collectionData as Record<string, unknown>) }) }
                : { collection: collectionData as Record<string, unknown> });
        },
        // Through the live door when there is one: planned (the table and its
        // rows stay, and the plan says so) and committed source-only, with the
        // collection's entry in `index.ts` removed alongside the file. It used
        // to unlink the file and nothing else, which stopped the project from
        // loading its collections and was never committed.
        deleteCollection: async ({ id }: DeleteCollectionParams) => {
            const available = await liveSchema.ready();
            if (!available.enabled) {
                await request("/collection/delete", { collectionId: id });
                return;
            }
            await liveSchema.reviewChange({ collectionId: id, remove: true });
        },

        // Every write below is the difference between the collection as it is
        // and as it should end up, through the same door as the editor's own
        // save: planned and confirmed when live editing is on, written as a
        // patch when it is not.
        saveProperty: async ({ path, propertyKey, property, newPropertiesOrder }: SavePropertyParams) => {
            const current = currentOf(path);
            await write(path, { patch: diffCollections(current, {
                ...current,
                properties: { ...(current.properties as Record<string, unknown> | undefined ?? {}), [propertyKey]: property },
                ...(newPropertiesOrder ? { propertiesOrder: newPropertiesOrder } : {})
            }) });
        },
        deleteProperty: async ({ path, propertyKey, newPropertiesOrder }: DeletePropertyParams) => {
            const current = currentOf(path);
            const { [propertyKey]: _removed, ...properties } = (current.properties as Record<string, unknown> | undefined) ?? {};
            await write(path, { patch: diffCollections(current, {
                ...current,
                properties,
                ...(newPropertiesOrder ? { propertiesOrder: newPropertiesOrder } : {})
            }) });
        },

        updatePropertiesOrder: async ({ collection, fullPath, newPropertiesOrder }: UpdatePropertiesOrderParams) => {
            const collectionId = (collection as AdminCollection & { id?: string }).id || fullPath.split("/").pop() || "";
            const current = currentOf(collectionId);
            await write(collectionId, { patch: diffCollections(current, { ...current, propertiesOrder: newPropertiesOrder }) });
        },
        updateKanbanColumnsOrder: async () => {
            // Kanban order mapping logic can be added later if needed natively.
        },

        navigationEntries: [],
        saveNavigationEntries: async () => { }
        // `liveSchema.dialog` and `liveSchema.status` both change as the flow
        // runs — a plan arrives, a dialog opens — and a controller memoised
        // without them would keep handing back a closed dialog and a stale
        // answer about whether the backend can edit its schema at all.
        //
        // `write`, `request`, `findCollection`, `changeFor` and `currentOf` are
        // rebuilt on every render, so listing them would defeat the memo
        // entirely. Each is already covered *transitively* by what is listed:
        // `request` closes over `editorUrl` and a ref, and `editorUrl` derives
        // from `clientOrUrl`; `findCollection`, `changeFor` and `currentOf` close over
        // `parsedCollections`; `write` closes over `liveSchema.status` and
        // `liveSchema.reviewChange`, and the latter is a `useCallback` keyed on
        // a client built from `clientOrUrl`. Every input that can change is in
        // the array under the name it actually varies with.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [
        clientOrUrl,
        parsedCollections,
        readOnly,
        readOnlyReason,
        options?.getAuthToken,
        liveSchema.dialog,
        liveSchema.status
    ]);
}
