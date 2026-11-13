import type { ColumnDescriptor, JsonPathStep, JsonShape, TableDescriptor } from "@rebasepro/types";

/**
 * Walking the shape of a JSON document (`col.jsonb(json.object({...}))`).
 *
 * The shape is what lets the server validate a nested field, apply a nested
 * default, stamp a nested date and run a nested transform — the job today's
 * code does by recursing into a property's `properties`, `of` and
 * `oneOf.properties`. One walker, so every one of those visits the same
 * positions under the same paths.
 *
 * @module
 */

/**
 * One position of a shape, as {@link walkJsonShape} visits it.
 *
 * @group Table
 */
export interface JsonShapeVisit {
    /** The node at this position. */
    shape: JsonShape;
    /** From the document's root to here; `[]` for the root. */
    path: JsonPathStep[];
    /** The node this one is a field, item or variant of; absent at the root. */
    parent?: JsonShape;
}

/**
 * Visit every position of a JSON shape, the root first, then depth first in
 * declaration order: an object's fields, an array's item shape, a `oneOf`'s
 * variants.
 *
 * Return `false` from `visit` to skip what lies below that position.
 *
 * @group Table
 */
export function walkJsonShape(shape: JsonShape, visit: (node: JsonShapeVisit) => boolean | void): void {
    const step = (node: JsonShape, path: JsonPathStep[], parent: JsonShape | undefined): void => {
        const descend = visit(parent ? { shape: node, path, parent } : { shape: node, path });
        if (descend === false) return;
        switch (node.kind) {
            case "object":
                for (const [field, child] of Object.entries(node.fields)) step(child, [...path, { field }], node);
                break;
            case "array":
                step(node.of, [...path, { items: true }], node);
                break;
            case "oneOf":
                for (const [variant, child] of Object.entries(node.variants)) step(child, [...path, { variant }], node);
                break;
            default:
                break;
        }
    };
    step(shape, [], undefined);
}

/**
 * Every position of every JSON column of a table that satisfies `predicate`,
 * with the column it is in: what a stamp, default or validation pass over a
 * row starts from.
 *
 * @group Table
 */
export function jsonPositions(
    table: TableDescriptor,
    predicate: (shape: JsonShape) => boolean
): { column: ColumnDescriptor; shape: JsonShape; path: JsonPathStep[] }[] {
    const out: { column: ColumnDescriptor; shape: JsonShape; path: JsonPathStep[] }[] = [];
    for (const column of table.columns) {
        if (!column.json) continue;
        walkJsonShape(column.json, ({ shape, path }) => {
            if (predicate(shape)) out.push({ column, shape, path });
        });
    }
    return out;
}

/**
 * A path as text, for messages: `seo.title`, `blocks[].image.caption`.
 *
 * @group Table
 *
 * @internal Shared with @rebasepro/server's upload limits; not part of the public API.
 */
export function formatJsonPath(path: readonly JsonPathStep[]): string {
    let out = "";
    for (const step of path) {
        if ("field" in step) out += out.length > 0 ? `.${step.field}` : step.field;
        else if ("items" in step) out += "[]";
        else out += out.length > 0 ? `.${step.variant}` : step.variant;
    }
    return out;
}
