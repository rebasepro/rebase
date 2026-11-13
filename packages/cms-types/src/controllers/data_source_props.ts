import type {
    CollectionConfig,
    DeleteProps,
    FetchCollectionProps,
    FetchOneProps,
    ListenCollectionProps,
    ListenOneProps,
    SaveProps
} from "@rebasepro/types";

/**
 * The admin panel's data calls, as a CMS data source receives them.
 *
 * The backend's `DataDriver` contract names a table by its `path` alone: the
 * Postgres driver resolves everything else from the compiled tables it was
 * opened with. A data source the admin panel talks to directly — the
 * Firestore driver, the MCP view's tool driver — has no such registry: it
 * reads what it needs (a Firestore `databaseId`, a property's type to convert
 * a value) from the collection the panel is showing, which the panel hands
 * beside the path. These props are the backend ones with that collection.
 *
 * @module
 */

/**
 * The collection the admin panel is showing, handed beside a data call's
 * path to a data source that reads it.
 *
 * @group Data
 */
export interface WithViewCollection<M extends Record<string, unknown> = Record<string, unknown>> {
    /** The panel's collection: the view model the call was made from. */
    collection?: CollectionConfig<M>;
}

/** {@link FetchOneProps} as a CMS data source receives them. @group Data */
export type CmsFetchOneProps<M extends Record<string, unknown> = Record<string, unknown>> = FetchOneProps<M> & WithViewCollection<M>;

/** {@link ListenOneProps} as a CMS data source receives them. @group Data */
export type CmsListenOneProps<M extends Record<string, unknown> = Record<string, unknown>> = ListenOneProps<M> & WithViewCollection<M>;

/** {@link FetchCollectionProps} as a CMS data source receives them. @group Data */
export type CmsFetchCollectionProps<M extends Record<string, unknown> = Record<string, unknown>> = FetchCollectionProps<M> & WithViewCollection<M>;

/** {@link ListenCollectionProps} as a CMS data source receives them. @group Data */
export type CmsListenCollectionProps<M extends Record<string, unknown> = Record<string, unknown>> = ListenCollectionProps<M> & WithViewCollection<M>;

/** {@link SaveProps} as a CMS data source receives them. @group Data */
export type CmsSaveProps<M extends Record<string, unknown> = Record<string, unknown>> = SaveProps<M> & WithViewCollection<M>;

/** {@link DeleteProps} as a CMS data source receives them. @group Data */
export type CmsDeleteProps<M extends Record<string, unknown> = Record<string, unknown>> = DeleteProps<M> & WithViewCollection<M>;
