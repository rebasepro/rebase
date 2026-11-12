import {
    isAuthTableDef,
    type AnyTableDef,
    type AnyViewDef,
    type AuthTableOptions,
    type CollectionCallbacks,
    type DefaultRls,
    type PostgresCollectionConfig,
    type TableDescriptor,
    type TableHooks
} from "@rebasepro/types";
import { lowerHooks } from "@rebasepro/common";
import { compileSchemaDefs, loadBackendSchema, type LoadBackendSchemaOptions } from "./load-schema";

/**
 * The tables a backend serves, compiled and lowered at boot.
 *
 * @group Schema
 */
export interface DeclaredTables {
    /** The definitions, as authored. Empty when nothing was declared. */
    defs: (AnyTableDef | AnyViewDef)[];
    /** Their compiled descriptors, in definition order. */
    descriptors: TableDescriptor[];
    /** Their lowering: what the registry, the routes and the drivers read. */
    collections: PostgresCollectionConfig[];
    /** Where they came from, for the boot log. */
    source: "tables" | "schemaDir" | "none";
    /** The table defined with `defineAuthTable`, when there is one. */
    authTable?: {
        descriptor: TableDescriptor;
        collection: PostgresCollectionConfig;
        options: AuthTableOptions;
    };
}

/**
 * Resolve what a backend serves: the `tables` it was given, else the
 * `backend/schema` directory it was pointed at, else nothing — in which case
 * the driver introspects the database.
 *
 * Every definition is compiled (fail closed: one `SchemaDefinitionError` with
 * every problem) and lowered through {@link compileSchemaDefs}, so hooks get
 * their table's descriptor.
 *
 * @group Schema
 */
export async function resolveDeclaredTables(options: {
    tables?: readonly (AnyTableDef | AnyViewDef)[];
    defaultRls?: DefaultRls;
    schemaDir?: string;
    load?: LoadBackendSchemaOptions;
}): Promise<DeclaredTables> {
    let defs: (AnyTableDef | AnyViewDef)[] = [];
    let defaultRls: DefaultRls | undefined;
    let source: DeclaredTables["source"] = "none";
    if (options.tables && options.tables.length > 0) {
        defs = [...options.tables];
        defaultRls = options.defaultRls;
        source = "tables";
    } else if (options.schemaDir) {
        const loaded = await loadBackendSchema(options.schemaDir, options.load);
        defs = loaded.defs;
        defaultRls = loaded.defaultRls;
        if (defs.length > 0) source = "schemaDir";
    }
    if (defs.length === 0) return { defs: [], descriptors: [], collections: [], source: "none" };

    const { descriptors, collections } = compileSchemaDefs(defs, defaultRls);
    const authIndex = defs.findIndex(def => isAuthTableDef(def));
    const authDef = authIndex >= 0 ? defs[authIndex] : undefined;
    const authTable = authDef && isAuthTableDef(authDef)
        ? { descriptor: descriptors[authIndex], collection: collections[authIndex], options: authDef.auth }
        : undefined;
    return { defs, descriptors, collections, source, ...(authTable ? { authTable } : {}) };
}

/** The slug a legacy callback was called for: its collection's, or the path's first segment. */
function slugOfCall(props: { collection?: { slug?: string }; path: string }): string {
    return props.collection?.slug ?? props.path.replace(/^\/+/, "").split("/")[0] ?? "";
}

/**
 * Global table hooks as the legacy global `callbacks` the registries and
 * drivers run for every collection.
 *
 * Each call is dispatched to {@link lowerHooks} for the slug it runs on — the
 * one adapter from table hooks to callbacks — so a global hook receives the
 * descriptor of the table it is running for, exactly as a table's own hook does.
 *
 * @group Schema
 */
export function globalHooksAsCallbacks(
    hooks: TableHooks,
    describe: (slug: string) => TableDescriptor | undefined
): CollectionCallbacks {
    const cache = new Map<string, CollectionCallbacks>();
    const forCall = (props: { collection?: { slug?: string }; path: string }): CollectionCallbacks => {
        const slug = slugOfCall(props);
        let callbacks = cache.get(slug);
        if (!callbacks) {
            callbacks = lowerHooks(hooks, slug, describe) ?? {};
            cache.set(slug, callbacks);
        }
        return callbacks;
    };
    const out: CollectionCallbacks = {};
    if (hooks.beforeQuery) out.beforeQuery = props => forCall(props).beforeQuery?.(props);
    if (hooks.afterRead) out.afterRead = props => forCall(props).afterRead?.(props) ?? props.row;
    if (hooks.beforeSave) out.beforeSave = props => forCall(props).beforeSave?.(props) ?? props.values;
    if (hooks.afterSave) out.afterSave = props => forCall(props).afterSave?.(props);
    if (hooks.afterSaveError) out.afterSaveError = props => forCall(props).afterSaveError?.(props);
    if (hooks.beforeDelete) out.beforeDelete = props => forCall(props).beforeDelete?.(props);
    if (hooks.afterDelete) out.afterDelete = props => forCall(props).afterDelete?.(props);
    return out;
}
