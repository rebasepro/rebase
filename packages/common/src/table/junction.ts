import type { TableDescriptor } from "@rebasepro/types";

import type { RelationOfKind } from "./relations";

/**
 * The junction of a `manyToMany` relation, as the table its link columns
 * (`pivot`) belong to.
 *
 * @module
 */

/**
 * The columns a `manyToMany` link carries (`through.pivot`, served as
 * `_pivot`), as a table descriptor: what a write of `_pivot` is checked
 * against, by the same column rules (`access`, `private`, `readOnly`,
 * `validate`, `oneOf`, `nullable`) a row of any table is.
 *
 * Only the columns and the table's names are the junction's: it has no
 * descriptor of its own (it is the platform's table, not the author's), so the
 * result states no key, no relation, and the closed row-level security posture
 * — nothing grants a row of it through this value, which is never served and
 * never planned from.
 *
 * Replaces `getJunctionConfigForRelation(relation.through)`, the synthetic
 * collection the legacy readers built for the same purpose.
 *
 * @group Table
 */
export function pivotTable(owner: Pick<TableDescriptor, "schema">, relation: RelationOfKind<"manyToMany">): TableDescriptor {
    const { through } = relation;
    return {
        name: through.table,
        slug: through.table,
        table: through.table,
        schema: owner.schema,
        kind: "table",
        columns: through.pivot,
        primaryKey: [],
        relations: [],
        rls: { posture: "rules", rules: [], defaultPolicies: false }
    };
}
