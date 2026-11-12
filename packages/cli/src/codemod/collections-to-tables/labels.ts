/**
 * The labels the zero-config CMS derives from identifiers, so the codemod can
 * drop a legacy label that only restates one and write real deltas only.
 *
 * The projector's own functions live in `@rebasepro/cms` (`tables/labels.ts`),
 * which a CLI may not import — the BaaS install has no React. These are the
 * same rule on the same `@rebasepro/utils` primitives; `labels.test.ts` holds
 * them to the projector's examples.
 */
import { prettifyIdentifier, singular } from "@rebasepro/utils";

/** Words that read as initialisms, as the projector spells them. */
const INITIALISMS: Readonly<Record<string, string>> = {
    id: "ID",
    ids: "IDs",
    url: "URL",
    urls: "URLs",
    uuid: "UUID",
    api: "API",
    ip: "IP"
};

/** `first_name` / `firstName` → "First Name"; `author_id` → "Author ID"; `__order` → "Order". */
export function defaultLabel(identifier: string): string {
    return prettifyIdentifier(identifier)
        .split(" ")
        .filter(word => word.length > 0)
        .map(word => INITIALISMS[word.toLowerCase()] ?? word)
        .join(" ");
}

/** The singular of a plural label, changing its last word only. */
export function defaultSingularLabel(label: string): string {
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

/** The label the projector gives one enum value. */
export function defaultEnumLabel(value: string | number): string {
    return typeof value === "string" ? defaultLabel(value) : String(value);
}
