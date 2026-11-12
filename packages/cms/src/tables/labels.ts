/**
 * The words a projected table is shown with, derived from its identifiers.
 *
 * Every label here is a pure function of a name the backend serves, so the same
 * table reads the same way on every load and for every caller. `customizeTable`
 * replaces any of them; nothing here is a translation, because an identifier
 * has no language.
 */
import type { TableDescriptor } from "@rebasepro/types";
import { prettifyIdentifier, singular } from "@rebasepro/utils";

/**
 * Words that read as initialisms. `prettifyIdentifier` title-cases them
 * (`author_id` → "Author Id"), which is the one place its output looks wrong.
 */
const INITIALISMS: Readonly<Record<string, string>> = {
    id: "ID",
    ids: "IDs",
    url: "URL",
    urls: "URLs",
    uuid: "UUID",
    api: "API",
    ip: "IP"
};

/**
 * A human label for a column, relation or table key.
 *
 * `first_name`, `firstName` and `FirstName` all read "First Name"; `author_id`
 * reads "Author ID"; leading underscores are dropped (`__order` → "Order").
 */
export function labelFromIdentifier(identifier: string): string {
    return prettifyIdentifier(identifier)
        .split(" ")
        .filter(word => word.length > 0)
        .map(word => INITIALISMS[word.toLowerCase()] ?? word)
        .join(" ");
}

/**
 * The singular of a plural label, changing only its last word.
 *
 * `@rebasepro/utils`' `singular` strips any trailing "s", so words that only
 * look plural are kept as they are: a double-s ending (`Address`, `Class`), and
 * the Latin `-us` / `-is` endings (`Status`, `Analysis`). The first letter keeps
 * its case, because `singular` lower-cases irregular forms ("People" →
 * "person").
 */
export function singularLabel(label: string): string {
    const words = label.split(" ");
    const last = words[words.length - 1];
    if (!last || /(ss|us|is)$/i.test(last)) return label;
    const single = singular(last);
    if (single.length === 0) return label;
    const cased = last[0] === last[0].toUpperCase()
        ? single.charAt(0).toUpperCase() + single.slice(1)
        : single;
    return [...words.slice(0, -1), cased].join(" ");
}

/**
 * A table's plural and singular names: `order_items` → "Order Items" /
 * "Order Item". Read from the name the table was defined under, which is the
 * one an author chose; the slug and SQL name are derived from it.
 */
export function tableLabels(table: Pick<TableDescriptor, "name">): { name: string; singularName: string } {
    const name = labelFromIdentifier(table.name);
    return { name, singularName: singularLabel(name) };
}
