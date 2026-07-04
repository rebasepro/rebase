import { CollectionsConfigController } from "./config_controller";
import { Snapshot, CollectionConfig, Property } from "@rebasepro/types";

/**
 * Controller to open the collection editor dialog.
 * @group Hooks and utilities
 */
export interface CollectionEditorController {

    editCollection: (props: {
        id?: string,
        path?: string,
        parentCollectionSlugs: string[], parentSnapshotIds: string[],
        parentCollection?: CollectionConfig,
        existingSnapshots?: Snapshot<any>[],
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
        copyFrom?: CollectionConfig,
        parentCollectionSlugs: string[], parentSnapshotIds: string[],
        parentCollection?: CollectionConfig,
        redirect: boolean,
        sourceClick?: string
    }) => void;

    editProperty: (props: {
        propertyKey?: string,
        property?: Property,
        currentPropertiesOrder?: string[],
        editedCollectionId: string,
        parentCollectionSlugs: string[], parentSnapshotIds: string[],
        collection: CollectionConfig,
        existingSnapshots: Snapshot<any>[]
    }) => void;

    /**
     * The config controller that this editor represents.
     */
    configController: CollectionsConfigController;

    pathSuggestions: string[] | undefined;

}
