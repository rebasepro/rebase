/**
 * Reading a collection's `display` block.
 *
 * Two questions, kept apart because they are answered at different times: which
 * *property* fills a role (readable from values already in hand) and which
 * *resolver* fills it (may have to go to the network). A caller that cannot
 * await — a sort comparator, an export column, a server render — uses the key
 * and is documented to ignore resolvers.
 */
import type {
    AdminCollection,
    EntityDisplayResolver,
    EntityDisplayRole
} from "@rebasepro/admin-types";

/**
 * Collections that have already warned about a deprecated field, so a list of
 * fifty rows produces one line in the console rather than fifty.
 */
const deprecationWarned = new Set<string>();

function collectionId(collection: AdminCollection<never> | AdminCollection<any>): string {
    return (collection.slug ?? collection.name ?? "collection") as string;
}

function warnOnce(id: string, message: string): void {
    const key = `${id}:${message}`;
    if (deprecationWarned.has(key)) return;
    deprecationWarned.add(key);
    console.warn(message);
}

/**
 * What the collection declares for a role, before deciding which form it is.
 *
 * `display.title` wins over the deprecated `titleProperty`: a collection setting
 * both is mid-migration, and the new field is the one it means.
 */
function getDeclaredSource<M extends Record<string, unknown>>(
    collection: AdminCollection<M>,
    role: EntityDisplayRole
): string | EntityDisplayResolver<M, unknown> | undefined {

    const display = collection.display as Record<string, unknown> | undefined;
    const declared = display?.[role];
    if (declared !== undefined) return declared as string | EntityDisplayResolver<M, unknown>;

    if (role === "title" && collection.titleProperty) {
        const id = collectionId(collection);
        warnOnce(
            id,
            `[rebase] Collection "${id}" uses admin.titleProperty, which is deprecated. ` +
            `Move it to admin.display.title — the same string works there, and display.title ` +
            `also accepts a resolver for a title the record does not carry.`
        );
        return collection.titleProperty as string;
    }

    return undefined;
}

/**
 * The property path a role is declared to read, when it is declared as a path.
 *
 * Returns `undefined` for a role filled by a resolver — a resolver has no key —
 * and for a role the collection says nothing about, which is then derived.
 *
 * @group Collections
 */
export function getDisplayPropertyKey<M extends Record<string, unknown>>(
    collection: AdminCollection<M>,
    role: EntityDisplayRole
): string | undefined {
    const declared = getDeclaredSource(collection, role);
    return typeof declared === "string" ? declared : undefined;
}

/**
 * The resolver a role is declared to use, when it is declared as one.
 *
 * @group Collections
 */
export function getDisplayResolver<M extends Record<string, unknown>>(
    collection: AdminCollection<M>,
    role: EntityDisplayRole
): EntityDisplayResolver<M, unknown> | undefined {
    const declared = getDeclaredSource(collection, role);
    return typeof declared === "function" ? declared : undefined;
}

/**
 * True when the collection states this role at all, in either form.
 *
 * The derivation is a guess about what a collection probably means; a statement
 * outranks it, and the heuristics that look for "the first enum" or "the leading
 * relation" have to stand down when one exists.
 *
 * @group Collections
 */
export function hasDeclaredDisplay<M extends Record<string, unknown>>(
    collection: AdminCollection<M>,
    role: EntityDisplayRole
): boolean {
    return getDeclaredSource(collection, role) !== undefined;
}
