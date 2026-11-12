import { compileTables, type AnySchemaDef } from "@rebasepro/common";
import type { ColumnDescriptor, RelationDescriptor, TableDescriptor } from "@rebasepro/types";
import { generateTypedefs } from "../../src/generate-types";

/** `generateTypedefs` over the descriptors `compileTables` makes of `defs`. */
export function generate(...defs: AnySchemaDef[]): string {
    return generateTypedefs(compileTables(defs));
}

/** The descriptors of `defs`, keeping only the tables named in `keep` (a run that leaves some targets out). */
export function compiledOnly(defs: AnySchemaDef[], keep: string[]): TableDescriptor[] {
    return compileTables(defs).filter(table => keep.includes(table.name));
}

/**
 * A table descriptor written by hand — what a remote `GET /api/schema/tables`
 * may send, which no `defineTable` validated: the generator must stay safe on it.
 */
export function rawTable(slug: string, columns: Partial<ColumnDescriptor>[] = [], relations: RelationDescriptor[] = []): TableDescriptor {
    const described: ColumnDescriptor[] = columns.map(column => ({
        key: "id",
        column: column.key ?? "id",
        type: { kind: "text" },
        nullable: true,
        ...column
    }));
    return {
        name: slug,
        slug,
        table: slug,
        schema: "public",
        kind: "table",
        columns: described,
        primaryKey: described.filter(column => column.primaryKey).map(column => column.key),
        relations,
        rls: { posture: "admin-only", rules: [], defaultPolicies: true }
    };
}

/**
 * The body of one block of one table, so an assertion cannot match the wrong
 * one. Tables are emitted in slug order, so anchor on the table's accessor.
 */
export function block(ts: string, name: "Row" | "Insert" | "Update" | "Relations", accessor: string): string {
    const table = ts.indexOf(`\n  ${accessor}: {`);
    if (table < 0) throw new Error(`no table ${accessor} in:\n${ts}`);
    const start = ts.indexOf(`    ${name}: `, table);
    if (start < 0) throw new Error(`no ${name} block in ${accessor}`);
    const end = ts.indexOf("\n    }", start);
    const single = ts.indexOf(";\n", start);
    return ts.slice(start, ts[start + name.length + 6] === "{" ? end : single + 1);
}

/** The keys one block declares, ignoring the types they carry. */
export function keysOf(body: string): string[] {
    return [...body.matchAll(/^ {6}"?([^"?:]+)"?\??:/gm)].map(match => match[1]);
}
