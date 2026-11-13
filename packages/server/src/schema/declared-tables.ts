import {
    type AnyTableDef,
    type AnyViewDef,
    type CompiledTable,
    type DefaultRls,
    type TableDescriptor
} from "@rebasepro/types";
import { compileSchemaDefs, loadBackendSchema, type LoadBackendSchemaOptions } from "./load-schema";

/**
 * The tables a backend serves, compiled at boot.
 *
 * @group Schema
 */
export interface DeclaredTables {
    /** The definitions, as authored. Empty when nothing was declared. */
    defs: (AnyTableDef | AnyViewDef)[];
    /** The compiled tables, in definition order: what the data drivers run on. */
    tables: CompiledTable[];
    /** Their compiled descriptors, in definition order. */
    descriptors: TableDescriptor[];
    /** Where they came from, for the boot log. */
    source: "tables" | "schemaDir" | "none";
}

/**
 * Resolve what a backend serves: the `tables` it was given, else the
 * `backend/schema` directory it was pointed at, else nothing — in which case
 * the driver introspects the database.
 *
 * Every definition is compiled (fail closed: one `SchemaDefinitionError` with
 * every problem) through {@link compileSchemaDefs}.
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
    if (defs.length === 0) return { defs: [], tables: [], descriptors: [], source: "none" };

    const { tables, descriptors } = compileSchemaDefs(defs, defaultRls);
    return { defs, tables, descriptors, source };
}
