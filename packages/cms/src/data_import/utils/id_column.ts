import { Properties } from "@rebasepro/cms-types";

/**
 * The column an import uses as the row id before the user touches the mapping.
 *
 * The guess decides something destructive: the chosen column is taken out of
 * the values and sent as the id of an upsert, so every row overwrites the record
 * that already has that id. A header that merely *contained* "id" or "key" used
 * to qualify, so a file starting with `width`, `video` or `provider` wrote its
 * widths over the records whose ids they happened to equal.
 *
 * Only the first column is a candidate — the one the export writes the id to —
 * and only when its name says it is the id: the header is `id` (in any case),
 * or it maps onto a property the collection declares with `isId`. Anything else
 * is left for the user to choose in the mapping step.
 */
export function guessIdColumn(headers: string[],
    headersMapping: Record<string, string | null>,
    properties?: Properties): string | undefined {
    const firstKey = headers[0];
    if (firstKey === undefined) return undefined;

    if (firstKey.trim().toLowerCase() === "id") return firstKey;

    const mappedKey = headersMapping[firstKey];
    const mappedProperty = mappedKey ? properties?.[mappedKey] : undefined;
    if (mappedProperty && "isId" in mappedProperty && mappedProperty.isId) return firstKey;

    return undefined;
}

/**
 * The mapping and id column after the person importing picks where one column
 * goes, in that column's row of the mapping step: a property (`targetKey`), or
 * nothing (`null`, "Do not import this property").
 *
 * A property holds one column, so a column that held `targetKey` before lets
 * it go. And a column picked for a property, or for nothing, is no longer the
 * id: the row's select shows "Use this column as ID" while it is, and the
 * conversion takes the id column out of the values, so the pick was dropped.
 */
export function remapImportColumn({
    headersMapping,
    idColumn,
    column,
    targetKey
}: {
    headersMapping: Record<string, string | null>;
    idColumn: string | undefined;
    column: string;
    targetKey: string | null;
}): { headersMapping: Record<string, string | null>; idColumn: string | undefined } {
    const remapped: Record<string, string | null> = {};
    for (const [currentColumn, currentKey] of Object.entries(headersMapping)) {
        remapped[currentColumn] = currentColumn === column
            ? targetKey
            : targetKey !== null && currentKey === targetKey ? null : currentKey;
    }
    return {
        headersMapping: remapped,
        idColumn: idColumn === column ? undefined : idColumn
    };
}
