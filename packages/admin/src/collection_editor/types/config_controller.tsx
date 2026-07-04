import { CollectionConfig, NavigationGroupMapping, Property } from "@rebasepro/types";

export interface CollectionsSetupInfo {
    status: "ongoing" | "complete" | "error";
    error: string | null;
}

/**
 * Use this controller to access the configuration that is stored externally,
 * and not defined in code.
 */
export interface CollectionsConfigController {

    loading: boolean;

    collections?: CollectionConfig[];

    /**
     * If true, the configuration cannot be modified.
     * Use readOnlyReason to explain why.
     */
    readOnly?: boolean;

    /**
     * Reason why the configuration is read-only.
     */
    readOnlyReason?: string;

    /**
     * Status information about the automatic collections setup process.
     * Stored in the project config document at `collectionsSetup`.
     */
    collectionsSetup?: CollectionsSetupInfo;

    getCollection: (id: string) => CollectionConfig;

    saveCollection: <M extends { [Key: string]: any }>(params: SaveCollectionParams<M>) => Promise<void>;
    updateCollection: <M extends { [Key: string]: any }>(params: UpdateCollectionParams<M>) => Promise<void>;

    saveProperty: (params: SavePropertyParams) => Promise<void>;
    deleteProperty: (params: DeletePropertyParams) => Promise<void>;

    deleteCollection: (props: DeleteCollectionParams) => Promise<void>;

    /**
     * Update the properties order of a collection (used for column reordering).
     */
    updatePropertiesOrder: (params: UpdatePropertiesOrderParams) => Promise<void>;

    /**
     * Update the Kanban columns order for a collection.
     */
    updateKanbanColumnsOrder: (params: UpdateKanbanColumnsOrderParams) => Promise<void>;

    navigationEntries: NavigationGroupMapping[];
    saveNavigationEntries: (entries: NavigationGroupMapping[]) => Promise<void>;

}

export type UpdateCollectionParams<M extends Record<string, unknown> = Record<string, unknown>> = {
    id: string,
    collectionData: Partial<CollectionConfig<M>>,
    previousId?: string,
    parentCollectionSlugs?: string[], parentSnapshotIds?: string[]
}

export type SaveCollectionParams<M extends Record<string, unknown> = Record<string, unknown>> = {
    id: string,
    collectionData: CollectionConfig<M>,
    previousId?: string,
    parentCollectionSlugs?: string[], parentSnapshotIds?: string[]
}

export type SavePropertyParams = {
    path: string,
    propertyKey: string,
    namespace?: string,
    newPropertiesOrder?: string[],
    property: Property,
    parentCollectionSlugs?: string[], parentSnapshotIds?: string[]
}

export type DeletePropertyParams = {
    path: string,
    propertyKey: string,
    namespace?: string,
    newPropertiesOrder?: string[],
    parentCollectionSlugs?: string[], parentSnapshotIds?: string[]
}

export type DeleteCollectionParams = {
    id: string,
    parentCollectionSlugs?: string[], parentSnapshotIds?: string[]
}

export type UpdatePropertiesOrderParams = {
    fullPath: string;
    parentCollectionSlugs: string[], parentSnapshotIds: string[];
    collection: CollectionConfig;
    newPropertiesOrder: string[];
}

export type UpdateKanbanColumnsOrderParams = {
    fullPath: string;
    parentCollectionSlugs: string[], parentSnapshotIds: string[];
    collection: CollectionConfig;
    kanbanColumnProperty: string;
    newColumnsOrder: string[];
}
