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

/**
 * The API name a database column is served under.
 *
 * The wire name of a field is its property key, and Rebase's property keys are
 * camelCase — `displayName`, `createdAt`, `photoURL`. Columns are snake_case,
 * because an unquoted Postgres identifier folds to lower case and a camelCase
 * column is therefore reachable only as `"authorId"` forever: in hand-written
 * SQL, in psql, in an RLS policy body, in a dump, and in every third-party tool
 * that ever touches the database. So the two conventions are both right, and
 * this is the function that crosses between them.
 *
 * It exists because two sources of field names never crossed: a foreign key
 * derived from a relation (`author_id`) and a column read back by introspection
 * (`user_id`) both landed on the wire under their column name, while every
 * hand-authored collection next to them used camelCase. One API, two
 * conventions, and no rule a caller could infer from outside — those names are
 * also the `where` and `orderBy` keys, so it was not a matter of taste.
 *
 * Rules, in the order they matter:
 *
 *  - **A name with no separator is returned unchanged.** `photoURL` stays
 *    `photoURL` and `id` stays `id`. Lower-casing a single token is what makes
 *    a "camelCase" helper destructive — `camelCase("photoURL")` is `photourl` —
 *    and this function is applied to names that are *already* keys.
 *  - **Each following segment keeps its own casing** apart from an upper-cased
 *    first letter, so `photo_URL` → `photoURL` rather than `photoUrl`.
 *  - **The result may still not be a JavaScript identifier.** `2fa_enabled`
 *    becomes `2faEnabled`, which is a perfectly good object key and still needs
 *    quoting where one is written into generated source.
 *
 * Not the inverse of {@link toSnakeCase}: `toSnakeCase` tokenises on case
 * boundaries and would turn `photoURL` into `photo_url`. Round-tripping is not
 * a property either function promises, which is why a column name that a
 * property maps explicitly is always read off `columnName` rather than derived.
 */
export function toWireKey(columnName: string): string {
    if (!columnName) return columnName;
    const segments = columnName.split(/[-_ ]+/).filter(Boolean);
    if (segments.length <= 1) return columnName;
    return segments
        .map((segment, index) =>
            index === 0
                ? segment.charAt(0).toLowerCase() + segment.slice(1)
                : segment.charAt(0).toUpperCase() + segment.slice(1))
        .join("");
}

/**
 * The first candidate key not already used, or a numbered fallback.
 *
 * Introspection turns a set of column names into a set of object keys, and the
 * mapping is not injective: `user_id` and `userId` are two columns and one
 * {@link toWireKey}, and two foreign keys can strip to the same relation name.
 * A duplicate key in a generated object literal is a TypeScript error, so the
 * whole collection stops compiling — and a duplicate key in a `Record` built at
 * runtime is worse, because it silently drops a column instead.
 *
 * The numbered tail is what makes this total: a function that returns a key it
 * cannot guarantee is free has only moved the duplicate one line down.
 *
 * Structurally typed on `has` so a `Map` of emitted blocks and a `Set` of taken
 * names both satisfy it. Lives here, in the package both introspection
 * producers and the admin's table import can reach, because they must resolve a
 * collision the same way or one database describes itself three ways.
 */
export function firstFreeKey(candidates: string[], taken: { has(key: string): boolean }): string {
    for (const candidate of candidates) {
        if (!taken.has(candidate)) return candidate;
    }
    const base = candidates[candidates.length - 1];
    for (let suffix = 2; ; suffix++) {
        const candidate = `${base}_${suffix}`;
        if (!taken.has(candidate)) return candidate;
    }
}
