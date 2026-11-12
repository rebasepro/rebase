/**
 * The words an identifier reads as, for a person.
 *
 * One rule, shared by every party that derives a label from a name the
 * backend serves: the zero-config CMS (`@rebasepro/cms`, which labels every
 * projected table, column, relation and enum value with these) and the
 * collections-to-tables codemod (which drops a legacy label equal to the
 * derived one, so a migrated `customizeTable` file states only real deltas).
 * Two copies of the rule would disagree, and the codemod would then drop a
 * label the panel does not derive.
 *
 * Every label is a pure function of the identifier — no translation, because
 * an identifier has no language.
 */
import { singular } from "./plurals";
import { prettifyIdentifier } from "./strings";

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
 *
 * @group Labels
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
 * {@link singular} strips any trailing "s", so words that only look plural
 * are kept as they are: a double-s ending (`Address`, `Class`), and the Latin
 * `-us` / `-is` endings (`Status`, `Analysis`). The first letter keeps its
 * case, because `singular` lower-cases irregular forms ("People" → "person").
 *
 * @group Labels
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
 * The label of one value of a closed set (an enum): a string reads as its
 * identifier does (`needs_review` → "Needs Review"), a number as itself.
 *
 * @group Labels
 */
export function enumValueLabel(value: string | number): string {
    return typeof value === "string" ? labelFromIdentifier(value) : String(value);
}
