/**
 * The answers a query gets for naming a field that does not exist — written
 * once, here, because two layers give them.
 *
 * The driver gives them for a typo. The REST check gives the same ones for a
 * field marked `excludeFromApi`: OpenAPI, MCP's `describe_table` and the generated
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

const validList = (validFields: string[]): string =>
    validFields.length > 0 ? `. Valid fields: ${validFields.join(", ")}` : "";

/** A filter key that resolves to nothing on `collectionPath`. */
export function unknownFilterField(field: string, collectionPath: string, validFields: string[]): UnknownFieldAnswer {
    return {
        message: `Unknown filter field '${field}' on table '${collectionPath}'${validList(validFields)}`,
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
            `'${path.relationKey}' on table '${collectionPath}'${validList(target.validFields)}`,
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
    const onCollection = collectionName ? ` on table '${collectionName}'` : "";
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
        message: `Unknown field '${name}' in \`fields\` on table '${collectionName}'. Valid fields: ${validFields.join(", ")}`,
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
        message: `Unknown relation '${key}' on table '${collectionName}'`
            + (validRelations.length > 0
                ? `. Its relations are: ${validRelations.join(", ")}`
                : ". It declares no relations."),
        code: "UNKNOWN_RELATION",
        details: { relation: key, collection: collectionName, ...(validRelations.length > 0 && { validRelations }) }
    };
}

/**
 * An aggregate's `select` field or `groupBy` key that names no column.
 * `forWhat` is where it was named: `sum()`, `count()`, `groupBy`.
 * `validFields` is `queryableColumnKeys` (table/query-names.ts), never a private column.
 */
export function unknownAggregateField(field: string, forWhat: string, validFields: string[]): UnknownFieldAnswer {
    return {
        message: `Unknown field '${field}' in ${forWhat}${validList(validFields)}`,
        code: "UNKNOWN_AGGREGATE_FIELD",
        details: { field, ...(validFields.length > 0 && { validFields }) }
    };
}

/** A `vector_search` naming no vector property. `vectorProperties` is `vectorColumnKeys` (table/query-names.ts). */
export function unknownVectorProperty(property: string, vectorProperties: string[]): UnknownFieldAnswer {
    return {
        message: `Unknown vector property "${property}". ` +
            (vectorProperties.length > 0
                ? `This collection's vector properties are: ${vectorProperties.join(", ")}.`
                : "This collection declares no `vector` property to search."),
        code: "UNKNOWN_VECTOR_PROPERTY",
        details: { property, ...(vectorProperties.length > 0 && { vectorProperties }) }
    };
}
