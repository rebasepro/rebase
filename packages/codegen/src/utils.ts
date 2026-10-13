/**
 * Utility functions for the SDK generator
 */

/**
 * The naming rules shared with the server's data proxies, which resolve a
 * generated accessor back to its slug: one home, so the two cannot drift.
 */
export { toPascalCase, toCamelCase, toSafeIdentifier, toCollectionAccessor } from "@rebasepro/common";

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
