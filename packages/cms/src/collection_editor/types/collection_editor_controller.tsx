import { CollectionsConfigController } from "./config_controller";
import { Entity, Property } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Controller to open the collection editor dialog.
 * @group Hooks and utilities
 */
export interface CollectionEditorController {

    editCollection: (props: {
        id?: string,
        path?: string,
        parentCollectionSlugs: string[], parentEntityIds: string[],
        parentCollection?: AdminCollection,
        existingEntities?: Entity<any>[],
        /**
         * Initial view to open: "general", "display", or "properties"
         */
        initialView?: "general" | "display" | "properties",
        /**
         * If true, expand the Kanban configuration section
         */
        expandKanban?: boolean
    }) => void;

    createCollection: (props: {
        initialValues?: {
            group?: string,
            path?: string,
            name?: string,
            databaseId?: string
        },
        /**
         * A collection to duplicate from. If provided, the new collection will be
         * pre-populated with the same properties (but with empty name, path, and id).
         */
        copyFrom?: AdminCollection,
        parentCollectionSlugs: string[], parentEntityIds: string[],
        parentCollection?: AdminCollection,
        redirect: boolean,
        sourceClick?: string
    }) => void;

    editProperty: (props: {
        propertyKey?: string,
        property?: Property,
        currentPropertiesOrder?: string[],
        editedCollectionId: string,
        parentCollectionSlugs: string[], parentEntityIds: string[],
        collection: AdminCollection,
        existingEntities: Entity<any>[]
    }) => void;

    /**
     * The config controller that this editor represents.
     */
    configController: CollectionsConfigController;

    pathSuggestions: string[] | undefined;

}
