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
