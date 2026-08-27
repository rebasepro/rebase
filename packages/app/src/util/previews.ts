import type { Property } from "@rebasepro/types";
import type { PropertyConfig, AdminCollection } from "@rebasepro/cms-types";
import { AuthController } from "@rebasepro/cms-types";
import { isPropertyBuilder } from "@rebasepro/common";
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
 * The `include` params that eager-load a collection's relations in the same
 * request as its rows, so previews never fetch once per relation cell.
 *
 * Only the REST transport reads `include`; the realtime transport embeds
 * relation data unconditionally and ignores it. Passing it either way keeps a
 * realtime-less deployment rendering the same cells as a realtime one.
 */
export function getRelationIncludeParams(collection: AdminCollection<any>): string[] | undefined {
    if (!collection.properties) return undefined;
    const hasRelations = Object.values(collection.properties).some(property =>
        property && !isPropertyBuilder(property) &&
        (isRelationProperty(property as Property) || isReferenceProperty(property as Property)));
    return hasRelations ? INCLUDE_ALL_RELATIONS : undefined;
}

/**
 * The property that fills the title slot for a collection. Ranking lives in
 * `@rebasepro/common`, shared with the admin package so both agree on what an
 * entity is called.
 */
export function getEntityTitlePropertyKey<M extends Record<string, any>>(collection: AdminCollection<M>, propertyConfigs: Record<string, PropertyConfig>): string | undefined {
    return getTitlePropertyKey(collection as AdminCollection<Record<string, unknown>>);
}

