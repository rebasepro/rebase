import React, { useMemo } from "react";
import { deepEqual as equal } from "fast-equals";

import { CollectionsConfigController } from "./types/config_controller";
import { useBridgeRegistration } from "@rebasepro/app";
import type { StudioSchemaEditing } from "@rebasepro/app";

export const ConfigControllerContext = React.createContext<CollectionsConfigController>({} as CollectionsConfigController);

export interface ConfigControllerProviderProps {
    /**
     * Controller for the project's schema source: what the Studio's writers
     * (the RLS editor) save through, via plan → confirm → apply.
     */
    collectionConfigController: CollectionsConfigController;
}

/**
 * Hands the schema controller to everything under it, and to the Studio.
 *
 * It used to host the visual collection editor too — its dialogs, their
 * state, and the "Collections" Studio view's context. That editor is gone: a
 * table's schema lives in `backend/schema`, and the admin panel renders what
 * the server serves. What remains is the one writer the Studio still uses.
 */
export const ConfigControllerProvider = React.memo(
    function ConfigControllerProvider({
        children,
        collectionConfigController
    }: ConfigControllerProviderProps & { children?: React.ReactNode }) {

        /**
         * Studio's writers, routed through the plan/apply dialog.
         *
         * The RLS editor used to POST a mapped table's rules straight to
         * `/schema-editor/collection/save`: no plan, no confirmation, no sight
         * of the SQL. Studio cannot import this controller (`@rebasepro/cms`
         * is a *peer* of `@rebasepro/studio`, and Studio has to run without
         * it), so it arrives over the bridge, and `available` is what a caller
         * checks before reaching for it.
         */
        const schemaEditing = useMemo<StudioSchemaEditing>(() => {
            const apply = collectionConfigController.applyTablePatches;
            return {
                available: !collectionConfigController.readOnly && apply !== undefined,
                applyTablePatches: (table, patches) => apply
                    ? apply(table, patches)
                    : Promise.reject(new Error("This project's schema controller does not write backend/schema."))
            };
        }, [collectionConfigController]);
        useBridgeRegistration("schemaEditing", schemaEditing);

        return (
            <ConfigControllerContext.Provider value={collectionConfigController}>
                {children}
                {/* Rendered here rather than by each writer: a controller that
                    has to ask before it writes needs somewhere to ask. */}
                {collectionConfigController.dialog}
            </ConfigControllerContext.Provider>
        );
    }, equal);
