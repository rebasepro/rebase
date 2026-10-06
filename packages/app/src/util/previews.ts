import type { Property } from "@rebasepro/types";
import type { PropertyConfig, AdminCollection } from "@rebasepro/cms-types";
import { AuthController } from "@rebasepro/cms-types";
import { isPropertyBuilder, resolveCollectionRelations } from "@rebasepro/common";
import { getTitlePropertyKey } from "@rebasepro/app";
import { SUMMARY_RANK, isStorageProperty, rankSummaryProperty } from "../collections/summary-property";

function isReferenceProperty(property: Property) {
    if (!property) return null;
    if (property.type === "reference") return true;
    if (property.type === "array") {
        if (Array.isArray(property.of)) return false;
        else return property.of?.type === "reference";
    }
    return false;
}

function isRelationProperty(property: Property) {
    if (!property) return null;
    if (property.type === "relation") return true;
    if (property.type === "array") {
        if (Array.isArray(property.of)) return false;
        else return property.of?.type === "relation";
    }
    return false;
}

function isHiddenProperty(property: Property | undefined): boolean {
    if (!property) return false;
    return Boolean(property.admin?.hideFromCollection);
}

/**
 * The properties a preview surface should render for a record, best first.
 *
 * Three things decide the answer, in this order:
 *
 * 1. `previewProperties` — passed in, or declared on the collection. A stated
 *    list is returned verbatim, ranking and limit included: a developer who
 *    asks for the Markdown biography gets the Markdown biography.
 * 2. Whether the value has a one-line form at all. A map renders as a
 *    key/value table and a Markdown field as a document; neither fits a card
 *    line, so they never take a slot from a value that does. See
 *    {@link rankSummaryProperty}.
 * 3. `propertiesOrder`, which breaks ties.
 *
 * The middle step is the one that is easy to get wrong by leaving out.
 * `propertiesOrder` states the *column* order of a collection table — it is
 * not a statement that the first three columns summarise a record, and reading
 * it as one is how a card ends up rendering somebody's entire biography.
 */
export function getEntityPreviewKeys(
    authController: AuthController,
    targetCollection: AdminCollection<any>,
    fields: Record<string, PropertyConfig>,
    previewProperties?: string[],
    limit = 3) {
    const allProperties = Object.keys(targetCollection.properties);
    let listProperties = previewProperties?.filter(p => allProperties.includes(p as string));
    if (!listProperties && targetCollection.previewProperties) {
        listProperties = targetCollection.previewProperties?.filter(p => allProperties.includes(p as string));
    }
    if (listProperties && listProperties.length > 0) {
        return listProperties;
    }

    // Relations read as a link to somewhere else rather than as a value here,
    // so they are left to the dedicated relation chips — unless the collection
    // ordered its properties explicitly, which puts them back in play.
    const hasExplicitOrder = !!(targetCollection.propertiesOrder as string[] | undefined);
    const order = (targetCollection.propertiesOrder as string[]) || allProperties;

    const direct: string[] = [];
    const excerpt: string[] = [];

    for (const key of order) {
        const property = targetCollection.properties[key];
        if (!property || isPropertyBuilder(property)) continue;
        if (key === "id" || ("isId" in property && Boolean((property as { isId?: boolean }).isId))) continue;
        if (isReferenceProperty(property)) continue;
        if (!hasExplicitOrder && isRelationProperty(property)) continue;
        if (isHiddenProperty(property)) continue;
        if (isStorageProperty(property as Property)) continue;

        const rank = rankSummaryProperty(property as Property);
        if (rank === SUMMARY_RANK.UNUSABLE) continue;
        (rank === SUMMARY_RANK.EXCERPT ? excerpt : direct).push(key);

        // Every remaining slot can already be filled by a value that fits
        // whole, so nothing below can change the answer.
        if (direct.length >= limit) break;
    }

    // A long-text field is a poor summary but a fine last resort: better an
    // opening line than a card with nothing under the title.
    return [...direct, ...excerpt].slice(0, limit);
}

// Returned as-is rather than rebuilt per call, so the result is referentially
// stable and safe to use as a hook dependency.
const INCLUDE_ALL_RELATIONS: string[] = ["*"];

/**
 * Include lists handed out, interned by content.
 *
 * Key: the relation names, joined. A list is a pure function of its names, so
 * nothing ever invalidates an entry; the map holds one per distinct set of
 * names a session reads — one per collection shape, a handful in all. It is
 * what keeps the result referentially stable when a caller builds its
 * collection object afresh on every render: `useRelationSelector` lists the
 * include as an effect dependency, and a new array per render was a new read
 * per render.
 */
const INTERNED_INCLUDES = new Map<string, string[]>();

/**
 * The `include` a collection view's read sends, so a relation cell renders from
 * the row it arrived with instead of fetching once per cell.
 *
 * It names the relations a **property** of the collection declares — the ones
 * a table column, a list or card chip, a picker option or a board card can
 * render, because the view model only maps relation data onto property keys
 * (`toViewModelValues`). It used to be `["*"]`, which the server reads as
 * every relation the collection declares, one hop. That included the
 * relations declared only in `relations: []` for a record's tabs: no property
 * names them and no list surface shows them, yet every read embedded all of
 * their rows for every parent on the page — a `companies` table with one
 * `owner` column and a `hasMany activities` tab read 50 × 2,000 activity rows a
 * page, and again on every realtime re-read of the rows held.
 *
 * What a property renders is unchanged: each name here is exactly what `*`
 * loaded for that property, uncapped. Both transports read `include` — the
 * REST list and the realtime subscription run the same include loader on the
 * server.
 *
 * Only names the collection resolves as relations are sent: the server answers
 * an unknown one with a 400 `UNKNOWN_RELATION`. A collection whose relations
 * cannot be resolved here (a target that does not load in the browser) falls
 * back to `*` and lets the server decide, as before.
 */
export function getRelationIncludeParams(collection: AdminCollection<any>): string[] | undefined {
    const properties = collection.properties;
    if (!properties) return undefined;

    let relationNames: string[];
    try {
        relationNames = Object.keys(resolveCollectionRelations(collection));
    } catch (_e) {
        const hasRelations = Object.values(properties).some(property =>
            property && !isPropertyBuilder(property) &&
            (isRelationProperty(property as Property) || isReferenceProperty(property as Property)));
        return hasRelations ? INCLUDE_ALL_RELATIONS : undefined;
    }

    const names = relationNames.filter(name =>
        Object.prototype.hasOwnProperty.call(properties, name) && Boolean(properties[name]));
    if (names.length === 0) return undefined;

    const key = names.join("\u0000");
    const interned = INTERNED_INCLUDES.get(key);
    if (interned) return interned;
    INTERNED_INCLUDES.set(key, names);
    return names;
}

/**
 * The property that fills the title slot for a collection. Ranking lives in
 * `@rebasepro/common`, shared with the admin package so both agree on what an
 * entity is called.
 */
export function getEntityTitlePropertyKey<M extends Record<string, any>>(collection: AdminCollection<M>, propertyConfigs: Record<string, PropertyConfig>): string | undefined {
    return getTitlePropertyKey(collection as AdminCollection<Record<string, unknown>>);
}

