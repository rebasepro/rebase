/**
 * A reference to one row of a table: its address, and the marker every reader
 * of a row recognises a relation value by.
 *
 * @group Data
 */
export interface RelationRef {
    readonly id: string | number;
    readonly path: string;
    readonly __type: "relation";
}

/**
 * Create a relation reference: `{ id, path, __type: "relation" }`, the one
 * spelling of it.
 *
 * @group Data
 */
export function createRelationRef(id: string | number, path: string): RelationRef {
    return { id, path, __type: "relation" };
}
