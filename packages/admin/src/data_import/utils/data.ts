import { getPropertyInPath } from "../../util";
import { Entity, EntityReference, CollectionRegistryController, Properties, Property, Vector } from "@rebasepro/types";
import { AuthController, AdminCollection } from "@rebasepro/admin-types";
import { isPropertyBuilder } from "@rebasepro/common";
import { unflattenObject } from "./file_to_json";
import { getIn } from "@rebasepro/forms";
import { inferTypeFromValue } from "@rebasepro/inference";
import { mergeDeep } from "@rebasepro/utils";

export function convertDataToEntity(authController: AuthController,
    navigation: CollectionRegistryController,
    data: Record<any, any>,
    idColumn: string | undefined,
    headersMapping: Record<string, string | null>,
    properties: Properties,
    path: string,
    defaultValues: Record<string, any>): Entity<any> {
    const flatObject = flattenEntry(data);
    if (idColumn)
        delete flatObject[idColumn];
    const mappedKeysObject = Object.entries(flatObject)
        .map(([key, value]) => {
            const mappedKey = (getIn(headersMapping, key) as string | undefined) ?? key;

            const mappedProperty = getPropertyInPath(properties, mappedKey);
            if (!mappedProperty) {
                return {};
            }
            const processedValue = processValueMapping(authController, value, navigation, mappedProperty);
            return ({
                [mappedKey]: processedValue
            });
        })
        .reduce((acc, curr) => ({ ...acc,
...curr }), {});

    const values = mergeDeep(defaultValues ?? {}, unflattenObject(mappedKeysObject));
    let id = idColumn ? data[idColumn] : undefined;
    if (typeof id === "string") {
        id = id.trim();
    } else if (typeof id === "number") {
        id = id.toString();
    } else if (typeof id === "boolean") {
        id = id.toString();
    } else if (id instanceof Date) {
        id = id.toISOString();
    } else if (id && "toString" in id) {
        id = id.toString();
    }

    return {
        id,
        values,
        path: path
    };
}

export function flattenEntry(obj: Record<string, unknown>, parent = ""): Record<string, unknown> {
    return Object.keys(obj).reduce<Record<string, unknown>>((acc, key) => {
        const prefixedKey = parent ? `${parent}.${key}` : key;

        if (typeof obj[key] === "object" && !(obj[key] instanceof Date) && obj[key] !== null && !Array.isArray(obj[key])) {
            Object.assign(acc, flattenEntry(obj[key] as Record<string, unknown>, prefixedKey));
        } else {
            acc[prefixedKey] = obj[key];
        }

        return acc;
    }, {});
}

export function processValueMapping(authController: AuthController, value: any, navigation: CollectionRegistryController, property?: Property): any {
    if (value === null) return null;

    if (property === undefined) return value;
    const usedProperty: Property | null = property;
    if (usedProperty === null) return value;
    const from = inferTypeFromValue(value);
    const to = usedProperty.type;

    if (to === "vector") {
        if (value && typeof value === "object" && "value" in value && Array.isArray(value.value)) {
            return new Vector(value.value);
        } else if (Array.isArray(value)) {
            return new Vector(value.map(Number));
        } else if (typeof value === "string") {
            let cleaned = value.trim();
            if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
                cleaned = cleaned.slice(1, -1);
            }
            if (cleaned === "") return null;
            return new Vector(cleaned.split(",").map(v => {
                const num = Number(v.trim());
                return isNaN(num) ? 0 : num;
            }));
        }
        return value;
    }

    if (from === "array" && to === "array" && Array.isArray(value) && usedProperty.of && !Array.isArray(usedProperty.of) && !isPropertyBuilder(usedProperty.of)) {
        return value.map(v => processValueMapping(authController, v, navigation, usedProperty.of as Property));
    } else if (from === "string" && to === "number" && typeof value === "string") {
        // `Number("")` is 0, so a blank cell used to import as a real zero — a
        // price of nothing rather than a price nobody filled in — and `Number`
        // of anything unreadable imported as NaN. Both are absent values, and
        // saying so lets the importer's own validation see them. The `vector`
        // branch above already draws the same distinction.
        const trimmed = value.trim();
        if (trimmed === "") return null;
        const num = Number(trimmed);
        return Number.isNaN(num) ? null : num;
    } else if (from === "string" && to === "array" && typeof value === "string" && usedProperty.of && !Array.isArray(usedProperty.of) && !isPropertyBuilder(usedProperty.of)) {
        return value.split(",").map((v: string) => processValueMapping(authController, v, navigation, usedProperty.of as Property));
    } else if (from === "string" && to === "boolean") {
        return value === "true";
    } else if (from === "number" && to === "boolean") {
        return value === 1;
    } else if (from === "boolean" && to === "number") {
        return value ? 1 : 0;
    } else if (from === "boolean" && to === "string") {
        return value ? "true" : "false";
    } else if (from === "number" && to === "string" && typeof value === "number") {
        return value.toString();
    } else if (from === "string" && to === "array" && typeof value === "string") {
        return value.split(",").map((v: string) => v.trim());
    } else if (from === "string" && to === "date" && typeof value === "string") {
        try {
            return new Date(value);
        } catch (e) {
            return value;
        }
    } else if (value instanceof Date && to === "string") {
        return value.toISOString();
    } else if (from === "number" && to === "date" && typeof value === "number") {
        try {
            return new Date(value);
        } catch (e) {
            return value;
        }
    } else if (from === "string" && to === "reference" && typeof value === "string") {
        // Parse optional database name in format: database_name:::path/to/entity
        // or simple format: path/to/entity
        let databaseId: string | undefined = undefined;
        let referencePath = value;

        if (value.includes(":::")) {
            const [dbName, pathPart] = value.split(":::");
            if (dbName && dbName !== "(default)") {
                databaseId = dbName;
            }
            referencePath = pathPart;
        }

        // split value into path and entityId (entityId is the last part of the path, after the last /)
        const path = referencePath.split("/").slice(0, -1).join("/");
        const entityId = referencePath.split("/").slice(-1)[0];

        // If no explicit database was provided in the string, try to get it from the collection
        if (databaseId === undefined) {
            const targetCollection: AdminCollection<any> | undefined = navigation.getCollection(path);
            databaseId = targetCollection?.databaseId;
        }

        return new EntityReference({ id: entityId,
path,
databaseId });

    } else if (from === to) {
        return value;
    } else if (from === "array" && to === "string" && Array.isArray(value)) {
        return value.join(",");
    }

    return value;
}
