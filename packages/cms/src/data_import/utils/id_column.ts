import { Properties } from "@rebasepro/types";

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
