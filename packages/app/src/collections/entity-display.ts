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
 * What the collection declares for a role, before deciding which form it is.
 *
 * One field states it: `display[role]`. `admin.titleProperty` used to be a
 * second way to say `display.title` and is gone — a role with two spellings is
 * a role with two readers, and this one had grown seven.
 */
function getDeclaredSource<M extends Record<string, unknown>>(
    collection: AdminCollection<M>,
    role: EntityDisplayRole
): string | EntityDisplayResolver<M, unknown> | undefined {
    const display = collection.display as Record<string, unknown> | undefined;
    const declared = display?.[role];
    return declared === undefined
        ? undefined
        : declared as string | EntityDisplayResolver<M, unknown>;
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
