import { singular } from "./plurals";
import { toSnakeCase } from "./strings";

/**
 * Generates a foreign key column name from a given string, typically a collection slug or name.
 * It singularizes the name, converts it to snake_case and appends '_id'.
 *
 * Singularization runs *before* snake-casing so that acronyms survive: `toSnakeCase`
 * splits on every capital, which turned "URLs" into "ur_ls" and then "ur_l_id".
 *
 * @param name The base name to convert to a foreign key.
 * @returns A foreign key name in the format 'singular_name_id'.
 *
 * @example
 * // returns "user_id"
 * generateForeignKeyName("users")
 *
 * @example
 * // returns "category_id"
 * generateForeignKeyName("categories")
 *
 * @example
 * // returns "product_id"
 * generateForeignKeyName("Product")
 *
 */
export function generateForeignKeyName(name: string): string {
    return `${toSnakeCase(singularizeForKey(name))}_id`;
}

/**
 * `singular()` handles real English plurals, but its final catch-all rule strips
 * any trailing "s", which mangles words that only look plural. Guard the two
 * cases that produce a column name nobody would recognise:
 *
 * - a double "s" ending is never a plural marker ("address", "class", "process"),
 *   so stripping it yields "addres";
 * - a name that singularizes to nothing (the literal "s") would yield "_id".
 */
function singularizeForKey(name: string): string {
    if (/ss$/i.test(name)) return name;
    const result = singular(name);
    return result.length > 0 ? result : name;
}

/**
 * What `generateForeignKeyName` returned before it learned to singularize:
 * snake-case the name, then chop one trailing "s".
 *
 * This is here to be *detected*, never to be generated. A database provisioned
 * under the old rule carries `categorie_id`, `addresse_id`, `children_id` or
 * `ur_l_id` where the current rule expects `category_id`, `address_id`,
 * `child_id` and `url_id` — and the boot-time schema ensure is additive, so it
 * would create the new column empty beside the populated old one and leave the
 * relation reading nothing. No error, no missing table: the failure is silent,
 * which is the only reason this function still exists.
 *
 * `ensureCollectionSchema` calls it to recognise that shape and say so.
 * Returns the same string as `generateForeignKeyName` for every regular plural,
 * so a caller can compare the two and act only when they differ.
 */
export function legacyForeignKeyName(name: string): string {
    const snake = toSnakeCase(name);
    return `${snake.endsWith("s") ? snake.slice(0, -1) : snake}_id`;
}

/**
 * Truncate an identifier to what Postgres will actually store.
 *
 * Postgres silently truncates identifiers at NAMEDATALEN-1 = 63 **bytes**, so a
 * name generated longer than that is not the name the database ends up holding.
 * Anything that later looks the object up by the name it generated then misses.
 *
 * Byte length, not string length: NAMEDATALEN is a byte bound, and a multi-byte
 * character straddling the boundary would be cut mid-sequence by `slice(0, 63)`.
 *
 * `TextEncoder` rather than `Buffer`, which is not a matter of taste: `Buffer`
 * is a Node global, and this package is imported by browser-facing ones. It
 * typechecked only where `@types/node` happened to be in scope, so
 * `packages/codegen` — whose tsconfig is `lib: ["ESNext", "dom"]` — could not
 * compile the file at all, and both of its suites failed to run. `TextEncoder`
 * and `TextDecoder` are standard in both runtimes and need no ambient types.
 */
export function toPostgresIdentifier(name: string): string {
    const bytes = new TextEncoder().encode(name);
    if (bytes.byteLength <= 63) return name;
    // Decoding a slice that ends mid-character yields U+FFFD; dropping it lands
    // on the last whole character that fits, which is what Postgres does.
    return new TextDecoder("utf-8").decode(bytes.subarray(0, 63)).replace(/�+$/, "");
}
