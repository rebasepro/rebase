/**
 * How a record shows up: its title, image, subtitle, status, date and tags.
 *
 * Every surface that draws a record draws some subset of these six roles. A list
 * row is image + title + subtitle + status + date; a card is the same with the
 * image on top; a board card drops the image; a reference picker is title +
 * subtitle; a page heading is the title alone. The roles are stable — what fills
 * them is not.
 *
 * Before this block, the roles were derived and only derived. `titleProperty`
 * was the single exception, and it could only ever name a property of the
 * collection: seven separate implementations read that key, disagreed about the
 * fallback, and none of them could await. The other five roles could not be
 * stated at all — the image was whichever storage property came first, the
 * status whichever enum, the date whichever timestamp. Right often enough to
 * feel automatic, and wrong with no way to say so.
 *
 * So: one mechanism, six roles, two forms each.
 *
 * ```ts
 * admin: {
 *     display: {
 *         title: "name",                       // a property path
 *         image: "photos.0",                   // a dotted path
 *         subtitle: ({ entity }) =>            // computed
 *             `${entity.values.city}, ${entity.values.country}`,
 *         status: async ({ entity, context }) => {   // and may be async
 *             const latest = await context.data.audits.get(`${entity.id}/latest`);
 *             return latest?.state;
 *         }
 *     }
 * }
 * ```
 *
 * Anything left out is derived exactly as it is today, so an existing collection
 * renders identically, and a collection that needs one role fixed states that
 * one role.
 */
import type { Entity, User } from "@rebasepro/types";
import type { RebaseContext } from "../rebase_context";

/**
 * What a resolver is handed.
 *
 * The whole {@link RebaseContext}, matching `AdditionalFieldDelegate.value` and
 * `EntityAction.onClick` — so a resolver can reach `context.data` and
 * `context.client` and read anything the panel can read, including a document in
 * a subcollection that the entity itself never loads.
 */
export type EntityDisplayResolverParams<
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = {
    entity: Entity<M>;
    context: RebaseContext<USER>;
};

/**
 * Computes what fills one display role for one record.
 *
 * May be async. While a promise is in flight the surface shows the derived value
 * and swaps the resolved one in when it lands — a title is never a spinner.
 * Results are cached per record and per role, and concurrent calls for the same
 * pair share one execution, so a list of fifty rows resolves each row once
 * rather than once per render.
 *
 * Return `undefined` when this record has nothing for this role. Do not return a
 * placeholder: the surface's own fallback is better informed than the resolver
 * is about what belongs there instead — a heading wants the collection's
 * singular name, a link wants the id.
 *
 * A resolver that throws is treated as `undefined` and logged once. A title that
 * cannot be fetched must not take down the row that shows it.
 */
export type EntityDisplayResolver<
    M extends Record<string, unknown> = Record<string, unknown>,
    T = unknown,
    USER extends User = User
> = {
    /**
     * Declared as a *method* and then indexed back out, which is the only way to
     * write a standalone function type whose parameters stay bivariant.
     *
     * Not a style choice. `AdminCollectionOptions<M>` has to remain assignable
     * to `AdminCollectionOptions<Record<string, unknown>>` — every consumer that
     * takes a collection it did not author depends on it, and losing it breaks
     * `defineCollection`'s own overloads. A resolver takes `Entity<M>` in
     * parameter position, so written as `(params) => …` it makes the entire
     * admin block invariant in `M`, and a typed collection stops being usable as
     * a collection. Method syntax is bivariant under `strictFunctionTypes`; the
     * sibling callbacks (`EntityAction.onClick`, `AdditionalFieldDelegate.value`)
     * are all written this way, and `packages/types/__tests__/bivariance` is the
     * record of finding it out the hard way.
     */
    resolve(params: EntityDisplayResolverParams<M, USER>): T | undefined | Promise<T | undefined>;
}["resolve"];

/**
 * Where one display role gets its value: a property path on this collection, or
 * a resolver that computes it.
 *
 * The path arm is checked against `M` and read with `getValueInPath`, so
 * `"profile.displayName"` is as valid as `"title"`. It also keeps the property's
 * own rendering — an enum status stays a coloured chip, a date stays formatted,
 * a storage path stays a thumbnail — which a resolver returning a bare string
 * cannot. Prefer the path whenever the value is on the record.
 *
 * `Path` is a type parameter rather than `PropertyPath<M>` directly, so this
 * module does not import from `admin_collection`, which imports it.
 */
export type EntityDisplaySource<
    Path extends string,
    M extends Record<string, unknown> = Record<string, unknown>,
    T = unknown,
    USER extends User = User
> = Path | EntityDisplayResolver<M, T, USER>;

/**
 * The six roles, and what may fill each.
 *
 * The value types describe what the renderers accept, not what a resolver must
 * produce exactly: a `date` resolver may return a `Date`, an ISO string or an
 * epoch number, and `tags` takes a single string as shorthand for one tag. A
 * property path is not constrained by them at all — the property's own type
 * decides how it renders.
 */
export type EntityDisplay<
    Path extends string = string,
    M extends Record<string, unknown> = Record<string, unknown>,
    USER extends User = User
> = {
    /**
     * What the record is called: the heading, the breadcrumb, the row, and the
     * label of every relation chip and reference that points at it.
     */
    title?: EntityDisplaySource<Path, M, string, USER>;

    /**
     * The line under the title — a short description, a location, a summary.
     */
    subtitle?: EntityDisplaySource<Path, M, string, USER>;

    /**
     * The record's picture. A storage path or a URL: the same two things a
     * `storage` property holds, so a resolver may return either.
     */
    image?: EntityDisplaySource<Path, M, string, USER>;

    /**
     * The state chip — published, archived, paid. Rendered with the enum's own
     * colour when it comes from an enum property.
     */
    status?: EntityDisplaySource<Path, M, string, USER>;

    /**
     * The timestamp a row is stamped with, usually when it last changed.
     */
    date?: EntityDisplaySource<Path, M, Date | string | number, USER>;

    /**
     * Free chips beside the status: labels, categories, topics. A single string
     * is accepted as shorthand for one tag.
     */
    tags?: EntityDisplaySource<Path, M, string[] | string, USER>;
};

/**
 * The roles as data, so every consumer iterates the same list instead of
 * repeating it — the mistake that let `titleProperty` grow seven readers.
 */
export const ENTITY_DISPLAY_ROLES = [
    "title",
    "subtitle",
    "image",
    "status",
    "date",
    "tags"
] as const;

/** One of the six display roles. */
export type EntityDisplayRole = typeof ENTITY_DISPLAY_ROLES[number];
