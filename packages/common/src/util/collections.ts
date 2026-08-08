import {
    CollectionConfig,
    Properties,
    Property
} from "@rebasepro/types";
import { isPropertyBuilder } from "./entities";

export function sortProperties<M extends Record<string, unknown>>(properties: Properties, propertiesOrder?: string[]): Properties {
    try {
        const propertiesKeys = Object.keys(properties);
        // If no propertiesOrder, just use the original keys order
        if (!propertiesOrder || propertiesOrder.length === 0) {
            return propertiesKeys
                .map((key) => {
                    const property = properties[key] as Property;
                    if (!isPropertyBuilder(property) && property?.type === "map" && property.properties) {
                        return ({
                            [key]: {
                                ...property,
                                properties: sortProperties(property.properties, property.propertiesOrder)
                            }
                        });
                    } else {
                        return ({ [key]: property });
                    }
                })
                .reduce((a: Properties, b: Properties) => ({ ...a,
...b }), {}) as Properties;
        }

        // Filter propertiesOrder to only include TOP-LEVEL property keys that exist
        // (ignore nested keys like "data.mode" - they are for column ordering, not property filtering)
        const validOrderKeys = (propertiesOrder as string[]).filter(key => {
            // Only include top-level keys (no dots) that exist in properties
            return !key.includes(".") && properties[key];
        });

        // Track which properties we've processed
        const processedKeys = new Set<string>(validOrderKeys);

        // Build result starting with ordered properties
        const orderedResult = validOrderKeys
            .map((key) => {
                const property = properties[key] as Property;
                if (!isPropertyBuilder(property) && property?.type === "map" && property.properties) {
                    return ({
                        [key]: {
                            ...property,
                            properties: sortProperties(property.properties, property.propertiesOrder)
                        }
                    });
                } else {
                    return ({ [key]: property });
                }
            })
            .reduce((a: Properties, b: Properties) => ({ ...a,
...b }), {}) as Properties;

        // Append any properties that were NOT in propertiesOrder (so they don't disappear!)
        const missingProperties = propertiesKeys
            .filter(key => !processedKeys.has(key))
            .map((key) => {
                const property = properties[key] as Property;
                if (!isPropertyBuilder(property) && property?.type === "map" && property.properties) {
                    return ({
                        [key]: {
                            ...property,
                            properties: sortProperties(property.properties, property.propertiesOrder)
                        }
                    });
                } else {
                    return ({ [key]: property });
                }
            })
            .reduce((a: Properties, b: Properties) => ({ ...a,
...b }), {}) as Properties;

        return { ...orderedResult,
...missingProperties };
    } catch (e) {
        console.error("Error sorting properties", e);
        return properties;
    }
}

/**
 * A copy of `collections` ordered by slug.
 *
 * Every generator that turns collections into a file is order-dependent, and
 * every one of them is compared against its own output — `rebase doctor`
 * regenerates in memory and diffs, `generate-sdk && git diff --exit-code` gates
 * CI. While only the *writers* sorted, a project whose `readdirSync` order
 * differed from its slug order was reported permanently out of date, and the
 * fix the message printed rewrote the file in the order it was already in. The
 * generators sort themselves now, so no caller can get this wrong.
 *
 * A slug-less collection is left to the generator's own validation, which names
 * the offending collection; sorting must not throw first.
 */
export function sortCollectionsBySlug<C extends { slug?: string }>(collections: readonly C[]): C[] {
    return [...collections].sort((a, b) => (a.slug ?? "").localeCompare(b.slug ?? ""));
}

export function getPrimaryKeys<M extends Record<string, unknown>>(collection: CollectionConfig<M>): Extract<keyof M, string>[] {
    const properties = collection.properties;
    if (!properties) {
        return ["id"] as Extract<keyof M, string>[];
    }
    const ids = Object.entries(properties)
        .filter(([key, prop]) => typeof prop === "object" && prop !== null && "isId" in prop && Boolean(prop.isId))
        .map(([key]) => key);

    if (ids.length > 0) {
        return ids as Extract<keyof M, string>[];
    }
    return ["id"] as Extract<keyof M, string>[];
}
