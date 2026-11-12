import { col, defineTable, type AnyColumn, type AnyTableDef, type AnyViewDef, type CollectionConfig, type ColumnDescriptor, type PostgresProperty } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";
import { buildRuntimeTable, type RuntimeTable } from "../../src/model/runtime-table";
import { FixtureTableRegistry } from "./tables";

/**
 * Columns and runtime tables for the codec tests (`serializeColumnToServer`,
 * `parseColumnFromServer`, `serializeDataToServer`, `normalizeDbValues`): the
 * codecs read a column's descriptor, so a test hands them one.
 */

/** The runtime table of one definition, over no catalogue table. */
export function runtimeTableOfDef(def: AnyTableDef | AnyViewDef): RuntimeTable {
    return buildRuntimeTable(compileSchema([def])[0], undefined);
}

/** The column `key` of a runtime table, or a throw naming it. */
export function columnAt(table: RuntimeTable, key: string): ColumnDescriptor {
    const column = table.columnsByKey.get(key);
    if (!column) throw new Error(`"${table.slug}" has no column "${key}"`);
    return column;
}

/** The descriptor of one column, compiled as the `value` column of a one-column table. */
export function columnOf(builder: AnyColumn): ColumnDescriptor {
    const def = defineTable("codec_probe", {
        columns: { id: col.integer().primaryKey(), value: builder },
        rls: "admin-only"
    });
    const column = buildRuntimeTable(compileSchema([def])[0], undefined).columnsByKey.get("value");
    if (!column) throw new Error("the probe table compiled without its `value` column");
    return column;
}

/**
 * The runtime table a legacy fixture collection compiles to (through
 * `FixtureTableRegistry`, with its relation targets). `others` are compiled
 * beside it, for fixtures whose relations point at them.
 */
export function runtimeTableOf(collection: CollectionConfig, ...others: CollectionConfig[]): RuntimeTable {
    return new FixtureTableRegistry([collection, ...others]).requireTable(collection.slug);
}

/** The column a legacy property compiles to, as the `value` column of a one-property collection. */
export function liftedColumnOf(property: PostgresProperty): ColumnDescriptor {
    const column = runtimeTableOf({
        slug: "codec_probe",
        name: "Codec probe",
        table: "codec_probe",
        properties: { id: { type: "number", isId: true }, value: property }
    }).columnsByKey.get("value");
    if (!column) throw new Error("the probe collection compiled without its `value` column");
    return column;
}
