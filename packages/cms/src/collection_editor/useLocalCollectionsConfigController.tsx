import { CollectionsConfigController, SaveCollectionParams, UpdateCollectionParams, DeleteCollectionParams, SavePropertyParams, DeletePropertyParams, UpdatePropertiesOrderParams } from "./types/config_controller";
import { Properties } from "@rebasepro/types";
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
    const forcedReadOnly = options?.readOnly;
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
        // The fallback the dialog offers when a change cannot be applied —
        // removing a property, most often, which the ensure path has no way to
        // carry out. Writing the source and leaving the database alone is what
        // the editor did before any of this existed.
        writeSourceOnly: async ({ collectionId, collection }) => {
            await request("/collection/save", { collectionId, collectionData: collection });
        }
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
        collection: Record<string, unknown>,
        sourceOnly: () => Promise<void>
    ): Promise<void> => {
        // `ready()`, not `status` — the rendered status is undefined for one
        // round trip after mount, so reading it here would send a save issued
        // in that window down the source-only path with no confirmation, while
        // the same save a second later would open a dialog. One round trip is
        // cheap; behaviour that depends on how fast somebody clicked is not.
        const available = await liveSchema.ready();
        if (!available.enabled) return sourceOnly();
        await liveSchema.reviewChange({ collectionId, collection });
    };

    const readOnly = forcedReadOnly
        ?? (availability.state === "known" ? !availability.enabled : buildModeGuess());

    const readOnlyReason = availability.state === "known" && availability.reason
        ? availability.reason
        : "Collections can only be edited against a backend running the schema editor, which is off in production.";

    const findCollection = (id: string): AdminCollection | undefined =>
        parsedCollections.find(c => (c as AdminCollection & { id?: string }).id === id || c.slug === id);

    /**
     * The whole collection as it should end up.
     *
     * Live editing computes the proposed state by replacing one collection in
     * the set, so it needs all of it: handed a patch, it would read every
     * property the patch does not mention as a removal and refuse the change.
     * A collection this does not recognise is a new one, and the patch is the
     * whole of it.
     */
    const wholeCollection = (id: string, patch: Record<string, unknown>): Record<string, unknown> => {
        const current = findCollection(id) as Record<string, unknown> | undefined;
        return current ? { ...current, ...patch } : patch;
    };

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

        saveCollection: async ({ id, collectionData }: SaveCollectionParams) => {
            await write(id, collectionData as unknown as Record<string, unknown>, () =>
                request("/collection/save", { collectionId: id, collectionData }));
        },
        updateCollection: async ({ id, collectionData }: UpdateCollectionParams) => {
            await write(id, wholeCollection(id, collectionData as Record<string, unknown>), () =>
                request("/collection/save", { collectionId: id, collectionData }));
        },
        deleteCollection: async ({ id }: DeleteCollectionParams) => {
            await request("/collection/delete", { collectionId: id });
        },

        // The follow-up write carries exactly one key, and `partial` is what says
        // so. Read as a whole-collection save it deletes everything it does not
        // mention — `securityRules` first, which then falls back to the
        // directory default and widens who can read the collection.
        saveProperty: async ({ path, propertyKey, property, newPropertiesOrder }: SavePropertyParams) => {
            // Assembled into the whole collection before it is planned. This is
            // the write that most often *is* a schema change — adding a field
            // to a collection is adding a column — and the one whose payload
            // says least about it on its own.
            const current = findCollection(path) as Record<string, unknown> | undefined;
            const properties = {
                ...(current?.properties as Record<string, unknown> | undefined ?? {}),
                [propertyKey]: property
            };
            const proposed = wholeCollection(path, {
                properties,
                ...(newPropertiesOrder ? { propertiesOrder: newPropertiesOrder } : {})
            });

            await write(path, proposed, async () => {
                await request("/property/save", { collectionId: path,
propertyKey,
propertyConfig: property });
                if (newPropertiesOrder) {
                    await request("/collection/save", { collectionId: path,
collectionData: { propertiesOrder: newPropertiesOrder },
partial: true });
                }
            });
        },
        deleteProperty: async ({ path, propertyKey, newPropertiesOrder }: DeletePropertyParams) => {
            await request("/property/delete", { collectionId: path,
propertyKey });
            if (newPropertiesOrder) {
                await request("/collection/save", { collectionId: path,
collectionData: { propertiesOrder: newPropertiesOrder },
partial: true });
            }
        },

        updatePropertiesOrder: async ({ collection, fullPath, newPropertiesOrder }: UpdatePropertiesOrderParams) => {
            const collectionId = (collection as AdminCollection & { id?: string }).id || fullPath.split("/").pop();
            await request("/collection/save", { collectionId,
collectionData: { propertiesOrder: newPropertiesOrder },
partial: true });
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
        // `write`, `request`, `findCollection` and `wholeCollection` are
        // rebuilt on every render, so listing them would defeat the memo
        // entirely. Each is already covered *transitively* by what is listed:
        // `request` closes over `editorUrl` and a ref, and `editorUrl` derives
        // from `clientOrUrl`; `findCollection` and `wholeCollection` close over
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
