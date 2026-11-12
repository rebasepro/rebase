/**
 * A projected table's names, derived from the name it was defined under.
 *
 * The rule itself — how an identifier reads — is `labelFromIdentifier` /
 * `singularLabel` in `@rebasepro/utils`, shared with the collections-to-tables
 * codemod so the two never disagree about what a "derived" label is.
 * `customizeTable` replaces any of them.
 */
import type { TableDescriptor } from "@rebasepro/types";
import { labelFromIdentifier, singularLabel } from "@rebasepro/utils";

/**
 * A table's plural and singular names: `order_items` → "Order Items" /
 * "Order Item". Read from the name the table was defined under, which is the
 * one an author chose; the slug and SQL name are derived from it.
 */
export function tableLabels(table: Pick<TableDescriptor, "name">): { name: string; singularName: string } {
    const name = labelFromIdentifier(table.name);
    return { name, singularName: singularLabel(name) };
}
