import type { CollectionConfig, Property } from "@rebasepro/types";
import { fieldKeyForColumn, findRelation, resolveCollectionRelations } from "../util/relations";
import { apiHiddenFieldNames } from "./field-access";

/**
 * The answers a query gets for naming a field that does not exist — written
 * once, here, because two layers give them.
 *
 * The driver gives them for a typo. The REST check gives the same ones for a
 * field marked `excludeFromApi`: OpenAPI, `list_collections` and the generated
 * SDK all leave such a field out, so anything but the typo's answer — "not
 * readable", a different message, a list that names it — confirms it exists.
 * Both build the answer from these functions, so the two cannot drift apart by
 * a byte. Each returns the parts of the 400 (`message`, `code`, `details`) and
 * the caller wraps them in its own error type.
 *
 * @module
 */

export interface UnknownFieldAnswer {
    message: string;
    code: string;
    details: Record<string, unknown>;
}

/**
 * The fields an unknown-field answer offers as valid, sorted: what a query on
 * this collection can name as a column. A relation contributes its foreign key
 * (`authorId`) when the key is on this table, and nothing otherwise. An
 * `excludeFromApi` field is never offered.
 *
 * Read off the collection rather than the table, so the REST check — which
 * holds no table — lists exactly what the driver lists.
 */
export function queryableFieldNames(collection: CollectionConfig): string[] {
    const hidden = apiHiddenFieldNames(collection);
    const names = new Set<string>();
    let relations: ReturnType<typeof resolveCollectionRelations> | undefined;
    for (const [key, property] of Object.entries(collection.properties ?? {})) {
        if ((property as Property | undefined)?.type === "relation") {
            relations ??= resolveCollectionRelations(collection);
            const relation = findRelation(relations, key);
            if (relation?.kind === "belongsTo") names.add(fieldKeyForColumn(collection, relation.localKey));
            continue;
        }
        names.add(key);
    }
    return [...names].filter(name => !hidden.has(name)).sort();
}

const validList = (validFields: string[]): string =>
    validFields.length > 0 ? `. Valid fields: ${validFields.join(", ")}` : "";

/** A filter key that resolves to nothing on `collectionPath`. */
export function unknownFilterField(field: string, collectionPath: string, validFields: string[]): UnknownFieldAnswer {
    return {
        message: `Unknown filter field '${field}' on collection '${collectionPath}'${validList(validFields)}`,
        code: "UNKNOWN_FILTER_FIELD",
        details: { field, collection: collectionPath, ...(validFields.length > 0 && { validFields }) }
    };
}

/** `author.emial` — a relation path whose last segment names nothing on the relation's target. */
export function unknownRelationTargetField(
    path: { field: string; relationKey: string; fieldKey: string },
    target: { slug: string; validFields: string[] },
    collectionPath: string
): UnknownFieldAnswer {
    return {
        message: `Unknown field '${path.fieldKey}' on '${target.slug}', the target of relation ` +
            `'${path.relationKey}' on collection '${collectionPath}'${validList(target.validFields)}`,
        code: "UNKNOWN_FILTER_FIELD",
        details: {
            field: path.field,
            collection: collectionPath,
            relation: path.relationKey,
            targetCollection: target.slug,
            ...(target.validFields.length > 0 && { validFields: target.validFields })
        }
    };
}

/** An `orderBy` key that resolves to nothing. `collectionName` is absent when the read carries no collection. */
export function unknownOrderByField(orderBy: string, collectionName: string | undefined, validFields: string[]): UnknownFieldAnswer {
    const onCollection = collectionName ? ` on collection '${collectionName}'` : "";
    return {
        message: `Unknown orderBy field '${orderBy}'${onCollection}${validList(validFields)}`,
        code: "UNKNOWN_ORDER_BY_FIELD",
        details: {
            field: orderBy,
            ...(collectionName && { collection: collectionName }),
            ...(validFields.length > 0 && { validFields })
        }
    };
}

/** A `fields` entry that names nothing. */
export function unknownProjectionField(name: string, collectionName: string, validFields: string[]): UnknownFieldAnswer {
    return {
        message: `Unknown field '${name}' in \`fields\` on collection '${collectionName}'. Valid fields: ${validFields.join(", ")}`,
        code: "UNKNOWN_FIELD",
        details: { field: name, collection: collectionName }
    };
}

/**
 * An `include` naming no relation of the collection. `validRelations` is what
 * the collection declares, never an `excludeFromApi` relation.
 */
export function unknownIncludeRelation(key: string, collectionName: string, validRelations: string[]): UnknownFieldAnswer {
    return {
        message: `Unknown relation '${key}' on collection '${collectionName}'`
            + (validRelations.length > 0
                ? `. Its relations are: ${validRelations.join(", ")}`
                : ". It declares no relations."),
        code: "UNKNOWN_RELATION",
        details: { relation: key, collection: collectionName, ...(validRelations.length > 0 && { validRelations }) }
    };
}

/** The relations an unknown-relation answer offers, sorted — never an `excludeFromApi` one. */
export function includableRelationNames(collection: CollectionConfig): string[] {
    const hidden = apiHiddenFieldNames(collection);
    return Object.keys(resolveCollectionRelations(collection)).filter(key => !hidden.has(key)).sort();
}
