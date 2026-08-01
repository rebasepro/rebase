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
