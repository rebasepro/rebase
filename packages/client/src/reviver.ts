import { EntityReference, EntityRelation, GeoPoint, Vector } from "@rebasepro/types";

export function rebaseReviver(_key: string, value: unknown): unknown {
    if (value && typeof value === "object" && "__type" in value) {
        const record = value as Record<string, unknown>;
        switch (record.__type) {
            case "date":
            case "Date": {
                if (typeof record.value !== "string") {
                    return value;
                }
                const date = new Date(record.value);
                return isNaN(date.getTime()) ? null : date;
            }
            case "reference":
            case "EntityReference":
                return new EntityReference({
                    id: String(record.id),
                    path: record.path as string,
                    driver: record.driver as string | undefined,
                    databaseId: record.databaseId as string | undefined
                });
            case "relation":
            case "EntityRelation":
                return new EntityRelation(
                    record.id as string | number,
                    record.path as string,
                    record.data as Record<string, unknown> | undefined
                );
            case "GeoPoint":
                return new GeoPoint(record.latitude as number, record.longitude as number);
            case "Vector":
                return new Vector(record.value as number[]);
            default:
                return value;
        }
    }
    return value;
}

/**
 * Could `text` hold an object with a `__type` key — the only values
 * {@link rebaseReviver} changes?
 *
 * A key is spelled either literally or with `\u` escapes, so a body with
 * neither cannot contain one. The check is two substring scans, which run at
 * memory speed; a false positive only costs the walk below.
 */
function mayHoldTypedValues(text: string): boolean {
    return text.includes("\"__type\"") || text.includes("\\u");
}

/**
 * Set a property the way `JSON.parse`'s reviver does: as an own data property.
 * A plain assignment to a key named `__proto__` would call the setter and swap
 * the object's prototype instead.
 */
function setRevived(target: Record<string, unknown> | unknown[], key: string | number, value: unknown): void {
    if (key === "__proto__") {
        Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
    } else {
        (target as Record<string | number, unknown>)[key] = value;
    }
}

/**
 * {@link rebaseReviver}, applied bottom-up to an already parsed value, in
 * place: every child is revived before its parent, so a relation's `data` holds
 * its own revived values by the time the relation is built from it — the order
 * `JSON.parse` calls a reviver in. Primitives are never visited; the reviver
 * hands every one of them back unchanged.
 */
function reviveTree(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const item: unknown = value[i];
            if (item !== null && typeof item === "object") {
                const revived = reviveTree(item);
                if (revived !== item) value[i] = revived;
            }
        }
        return value;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        const item = record[key];
        if (item !== null && typeof item === "object") {
            const revived = reviveTree(item);
            if (revived !== item) setRevived(record, key, revived);
        }
    }
    return rebaseReviver("", record);
}

/**
 * `JSON.parse(text, rebaseReviver)`, without the reviver's cost where it has
 * nothing to do.
 *
 * Handing `JSON.parse` a reviver takes V8 off its fast path and calls back for
 * every key and every value, primitives included: about 7× a plain parse on a
 * 1,000-row page, 10 ms of main thread per 600 KB. The reviver only ever
 * changes objects carrying `__type`, and a REST page of flat rows has none. So
 * this parses plainly and walks the result only when the text can hold one —
 * and the walk visits objects, never primitives.
 *
 * Same result, instance for instance: the same values revived, bottom-up, as
 * own data properties, and nothing deleted (the reviver never answers
 * `undefined`).
 *
 * @throws SyntaxError exactly where `JSON.parse` does.
 */
export function parseRebaseJson<T = unknown>(text: string): T {
    const parsed: unknown = JSON.parse(text);
    if (!mayHoldTypedValues(text)) return parsed as T;
    return reviveTree(parsed) as T;
}
