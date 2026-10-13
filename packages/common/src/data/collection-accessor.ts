import { toSnakeCase } from "@rebasepro/utils";

/**
 * The names a collection is reachable under as a property: `client.data.<name>`
 * in the generated SDK, the key of the generated `Database`, and
 * `context.data.<name>` / `rebase.dataAsAdmin.<name>` on the server.
 *
 * One rule, in one place. Codegen names the generated accessors with it and
 * the server's data proxies resolve a property back to its slug with it, so a
 * name the types offer is a name the server serves.
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
 * A property of a server-side data proxy (`context.data.myNotes`), as the slug
 * it names.
 *
 * The collections' own accessor names come first: `myNotes` is the `my-notes`
 * collection, whatever table it is stored in, because that is the key the
 * generated `Database` gives it. A name no collection answers to, or one two
 * collections would both answer to, is the slug's snake_case
 * (`companyMembers` → `company_members`), the rule these proxies have always
 * applied.
 *
 * `collections` is read on every call, so a collection registered or renamed
 * later (a schema edit) is served without rebuilding the proxy; the map is
 * rebuilt only when the list it returns is a different array.
 */
export function createAccessorSlugResolver(
    collections: () => readonly { slug: string }[] | undefined
): (property: string) => string {
    let source: readonly { slug: string }[] | undefined;
    let bySlug = new Map<string, string | null>();
    return (property: string): string => {
        const list = collections();
        if (list !== source) {
            source = list;
            bySlug = new Map();
            for (const { slug } of list ?? []) {
                if (typeof slug !== "string" || slug.length === 0) continue;
                const name = toCollectionAccessor(slug);
                const known = bySlug.get(name);
                // Two slugs on one name: neither is the answer, so the name
                // keeps the snake_case rule rather than picking one by order.
                bySlug.set(name, known === undefined || known === slug ? slug : null);
            }
        }
        return bySlug.get(property) ?? toSnakeCase(property);
    };
}
