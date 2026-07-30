import { CollectionsConfigController, SaveCollectionParams, UpdateCollectionParams, DeleteCollectionParams, SavePropertyParams, DeletePropertyParams, UpdatePropertiesOrderParams } from "./types/config_controller";
import { Properties } from "@rebasepro/types";
import { getSubcollections } from "@rebasepro/common";

import React, { useMemo, useRef } from "react";
import type { AdminCollection } from "@rebasepro/admin-types";
import { DEFAULT_API_PATH } from "@rebasepro/app";
export function useLocalCollectionsConfigController(
    clientOrUrl: any,
    baseCollections: AdminCollection[] = [],
    options?: {
        readOnly?: boolean;
        getAuthToken?: () => Promise<string | null>;
    }
): CollectionsConfigController {

    const parsedCollections = baseCollections;
    
    // Store latest options in a ref to prevent stale closures in the `request` function
    // due to useMemo caching the saveCollection function.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    const request = async (endpoint: string, payload: Record<string, unknown>) => {
        try {
            let token = optionsRef.current?.getAuthToken ? await optionsRef.current.getAuthToken() : null;
            let baseUrl = typeof clientOrUrl === "string" ? clientOrUrl : "";
            // `/api` only by default — a backend configured with another
            // `basePath` mounts the schema editor under that instead.
            let apiPath = DEFAULT_API_PATH;

            if (typeof clientOrUrl === "object" && clientOrUrl !== null) {
                baseUrl = clientOrUrl.baseUrl || baseUrl;
                apiPath = clientOrUrl.apiPath || apiPath;
                if (!token && clientOrUrl.resolveToken) {
                    token = await clientOrUrl.resolveToken();
                }
            }

            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) {
                headers["Authorization"] = `Bearer ${token}`;
            }

            const response = await fetch(`${baseUrl.replace(/\/$/, "")}${apiPath}/schema-editor${endpoint}`, {
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

    return useMemo(() => ({
        loading: false,
        readOnly: options?.readOnly ?? false,
        readOnlyReason: "Local collection editing is only available in development mode.",
        collections: parsedCollections,
        getCollection: (id: string) => {
            const found = parsedCollections.find(c => (c as AdminCollection & { id?: string }).id === id || c.slug === id);
            if (found) return found;
            throw Error(`Collection ${id} not found in local mode`);
        },

        saveCollection: async ({ id, collectionData }: SaveCollectionParams) => {
            await request("/collection/save", { collectionId: id,
collectionData });
        },
        updateCollection: async ({ id, collectionData }: UpdateCollectionParams) => {
            await request("/collection/save", { collectionId: id,
collectionData });
        },
        deleteCollection: async ({ id }: DeleteCollectionParams) => {
            await request("/collection/delete", { collectionId: id });
        },

        saveProperty: async ({ path, propertyKey, property, newPropertiesOrder }: SavePropertyParams) => {
            await request("/property/save", { collectionId: path,
propertyKey,
propertyConfig: property });
            if (newPropertiesOrder) {
                await request("/collection/save", { collectionId: path,
collectionData: { propertiesOrder: newPropertiesOrder } });
            }
        },
        deleteProperty: async ({ path, propertyKey, newPropertiesOrder }: DeletePropertyParams) => {
            await request("/property/delete", { collectionId: path,
propertyKey });
            if (newPropertiesOrder) {
                await request("/collection/save", { collectionId: path,
collectionData: { propertiesOrder: newPropertiesOrder } });
            }
        },

        updatePropertiesOrder: async ({ collection, fullPath, newPropertiesOrder }: UpdatePropertiesOrderParams) => {
            const collectionId = (collection as AdminCollection & { id?: string }).id || fullPath.split("/").pop();
            await request("/collection/save", { collectionId,
collectionData: { propertiesOrder: newPropertiesOrder } });
        },
        updateKanbanColumnsOrder: async () => {
            // Kanban order mapping logic can be added later if needed natively.
        },

        navigationEntries: [],
        saveNavigationEntries: async () => { }
    }), [clientOrUrl, parsedCollections, options?.readOnly, options?.getAuthToken]);
}
