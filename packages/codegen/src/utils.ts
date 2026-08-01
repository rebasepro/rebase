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
 * Indent a block of text by a given number of spaces
 */
export function indent(text: string, spaces: number): string {
    const pad = " ".repeat(spaces);
    return text
        .split("\n")
        .map(line => (line.trim() ? pad + line : line))
        .join("\n");
}
