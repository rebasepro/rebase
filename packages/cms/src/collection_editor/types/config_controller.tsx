import type React from "react";
import type { Property, TableDescriptor, TablePatch, UnmappedTable } from "@rebasepro/types";
import { NavigationGroupMapping, AdminCollection } from "@rebasepro/cms-types";

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

    collections?: AdminCollection[];

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
     * Whether collections defined in the frontend (Firestore collections,
     * `defineFirestoreCollection` in frontend/src/cms) can be edited: the
     * backend runs a development server's source editor, which writes them.
     * Absent or false, the editor shows them read-only.
     */
    frontendCollectionsEditable?: boolean;

    /**
     * Status information about the automatic collections setup process.
     * Stored in the project config document at `collectionsSetup`.
     */
    collectionsSetup?: CollectionsSetupInfo;

    getCollection: (id: string) => AdminCollection;

    /**
     * How the schema editor reads a table's source: its file, and what in it
     * is edited in code (a config spread from a variable, a column built by a
     * helper, rules in a variable) — read-only in the editor, because the
     * server refuses to write there. `undefined` when the backend does not
     * say (live editing off, an older backend).
     */
    tableSource?: (slug: string) => TableSourceInfo | undefined;

    saveCollection: <M extends { [Key: string]: any }>(params: SaveCollectionParams<M>) => Promise<void>;
    updateCollection: <M extends { [Key: string]: any }>(params: UpdateCollectionParams<M>) => Promise<void>;

    saveProperty: (params: SavePropertyParams) => Promise<void>;
    deleteProperty: (params: DeletePropertyParams) => Promise<void>;

    deleteCollection: (props: DeleteCollectionParams) => Promise<void>;

    /**
     * Send table edits as they are — the RLS editor's one `replaceRule` —
     * through the same door as a save: planned and confirmed when live schema
     * editing is on, to the source-only editor when it is not. Absent on a
     * controller that does not write `backend/schema`.
     */
    applyTablePatches?: (table: string, patches: TablePatch[]) => Promise<void>;

    /**
     * The database's tables no declared table maps — what "Import an existing
     * table" offers — as the schema editor lists them. Absent on a controller
     * that does not write `backend/schema`.
     */
    listUnmappedTables?: () => Promise<UnmappedTable[]>;

    /**
     * One of those tables as introspection describes it, and projected as a
     * served table is: what the editor opens to import it.
     */
    describeUnmappedTable?: (schema: string, table: string) => Promise<ImportedTable>;

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

    /**
     * UI this controller needs on screen in order to do its job.
     *
     * A controller whose writes require a confirmation has to be able to ask,
     * and a hook cannot render. `ConfigControllerProvider` renders this beside
     * its children, so the confirmation belongs to whoever supplied the
     * controller rather than to every consumer of it. Optional: most
     * controllers write without asking anybody.
     */
    dialog?: React.ReactNode;
}

/**
 * A table the database has, read for "Import an existing table".
 */
export interface ImportedTable {
    /** What introspection found, the description included (`rlsRaised` when its posture was raised to `"admin-only"`). */
    table: UnmappedTable;
    /** The table as introspection described it: what the save adopts (`SaveCollectionParams.adopting`). */
    descriptor: TableDescriptor;
    /** Its projection, as a served table's: what the editor opens, and the baseline the person's edits are made against. */
    collection: AdminCollection;
}

/**
 * What the schema editor says about one table's source.
 */
export interface TableSourceInfo {
    /** The file the table is defined in, as the server names it. */
    file: string;
    /** Why the whole table is read-only, when it is. */
    editedInCode?: string;
    /** Why a column or relation is read-only, by key. */
    fields: Record<string, string>;
    /** Why the rules cannot be written, when they cannot. */
    rlsEditedInCode?: string;
}

export type UpdateCollectionParams<M extends Record<string, unknown> = Record<string, unknown>> = {
    id: string,
    collectionData: Partial<AdminCollection<M>>,
    previousId?: string,
    parentCollectionSlugs?: string[], parentEntityIds?: string[]
}

export type SaveCollectionParams<M extends Record<string, unknown> = Record<string, unknown>> = {
    id: string,
    collectionData: AdminCollection<M>,
    /**
     * The collection as the editor loaded it, before the person changed
     * anything.
     *
     * A controller that writes source saves only the difference between this
     * and `collectionData` — what the person changed. The whole collection is
     * JSON by the time it is sent, and writing it back whole deleted every
     * handler, shared property and imported value JSON could not carry.
     * Absent, the controller's own copy of the collection stands in for it.
     */
    baseline?: AdminCollection<M>,
    /**
     * The table this new collection adopts ("Import an existing table"), as
     * introspection described it. The save writes the table's source from it
     * (`adoptTable`) — so planning it changes nothing in the database — and
     * then the changes the person made to its projection (`baseline`, or the
     * projection itself when absent).
     */
    adopting?: TableDescriptor,
    previousId?: string,
    parentCollectionSlugs?: string[], parentEntityIds?: string[]
}

export type SavePropertyParams = {
    path: string,
    propertyKey: string,
    namespace?: string,
    newPropertiesOrder?: string[],
    property: Property,
    parentCollectionSlugs?: string[], parentEntityIds?: string[]
}

export type DeletePropertyParams = {
    path: string,
    propertyKey: string,
    namespace?: string,
    newPropertiesOrder?: string[],
    parentCollectionSlugs?: string[], parentEntityIds?: string[]
}

export type DeleteCollectionParams = {
    id: string,
    parentCollectionSlugs?: string[], parentEntityIds?: string[]
}

export type UpdatePropertiesOrderParams = {
    fullPath: string;
    parentCollectionSlugs: string[], parentEntityIds: string[];
    collection: AdminCollection;
    newPropertiesOrder: string[];
}

export type UpdateKanbanColumnsOrderParams = {
    fullPath: string;
    parentCollectionSlugs: string[], parentEntityIds: string[];
    collection: AdminCollection;
    kanbanColumnProperty: string;
    newColumnsOrder: string[];
}
