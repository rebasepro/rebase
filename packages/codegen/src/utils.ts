/**
 * Utility functions for the SDK generator
 */

/**
 * Convert a slug/snake_case string to PascalCase
 * e.g. "private_notes" → "PrivateNotes"
 *
 * Capitals already inside a word are meaningful and are kept: lowercasing the
 * tail of every chunk turned "TestEntities" into "Testentities", which is what
 * ended up in the generated type names. SHOUTING_CASE is the one shape where
 * the tail is not meaningful, so it is folded down.
 */
export function toPascalCase(str: string): string {
    return str
        .split(/[_\-\s]+/)
        .filter(Boolean)
        .map(word => {
            const rest = /^[A-Z0-9]+$/.test(word) ? word.slice(1).toLowerCase() : word.slice(1);
            return word.charAt(0).toUpperCase() + rest;
        })
        .join("");
}

/**
 * Convert a slug/snake_case string to camelCase
 * e.g. "private_notes" → "privateNotes"
 */
export function toCamelCase(str: string): string {
    if (!/[_\-\s]/.test(str)) {
        return str.charAt(0).toLowerCase() + str.slice(1);
    }
    const pascal = toPascalCase(str);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * Convert a slug to a safe JS identifier
 * e.g. "private-notes" → "privateNotes"
 */
export function toSafeIdentifier(str: string): string {
    return toCamelCase(str.replace(/[^a-zA-Z0-9_]/g, "_"));
}

/**
 * Property names `client.data` never serves as a collection: `collection` is
 * the dynamic `collection(slug)` function, and `then`, `toJSON` and `$$typeof`
 * answer `undefined` so promise and serialisation probes leave the proxy alone
 * (`packages/client/src/index.ts`).
 */
const RESERVED_ACCESSORS: ReadonlySet<string> = new Set(["collection", "then", "toJSON", "$$typeof"]);

/**
 * The property a slug is reachable under on `client.data` in the generated SDK:
 * its safe identifier, or `<name>Collection` when that identifier is one the
 * client reserves — the generated property would otherwise never work.
 * Anything that prints an accessor for a slug goes through here.
 */
export function toCollectionAccessor(slug: string): string {
    const safe = toSafeIdentifier(slug);
    return RESERVED_ACCESSORS.has(safe) ? `${safe}Collection` : safe;
}

/**
 * Indent a block of text by a given number of spaces
 */
export function indent(text: string, spaces: number): string {
    const pad = " ".repeat(spaces);
    return text
        .split("\n")
        .map(line => (line.trim() ? pad + line : line))
        .join("\n");
}
