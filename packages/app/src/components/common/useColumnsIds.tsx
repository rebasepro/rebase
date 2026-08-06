import type { Property, MapProperty, Properties, RelationProperty } from "@rebasepro/types";
import { useMemo } from "react";
;
import { getChildViewRelationPropertyKeys, getSubcollections } from "@rebasepro/common";
import type { AdminCollection } from "@rebasepro/admin-types";
import { getPropertyInPath } from "../../collections/property-path";
import { isDisabled } from "../../collections/property_presentation";

export type PropertyColumnConfig = {
    key: string;
    disabled: boolean;
};

export function getSubcollectionColumnId(collection: AdminCollection<any>) {
    return `subcollection:${collection.slug}`;
}
export function useColumnIds<M extends Record<string, any>>(collection: AdminCollection<M>, includeSubcollections: boolean): PropertyColumnConfig[] {
    return useMemo(() => {
        if (collection.propertiesOrder) {
            return hideAndExpandKeys(collection, collection.propertiesOrder);
        }
        return getDefaultColumnKeys(collection, includeSubcollections);
    }, [collection, includeSubcollections]);
}

function hideAndExpandKeys<M extends Record<string, any>>(collection: AdminCollection<M>, keys: string[]): PropertyColumnConfig[] {

    // First, figure out which spread map roots have individual child keys in the order
    // If so, we should NOT auto-expand them - just use the explicit child keys
    const rootsWithExplicitChildren = new Set<string>();
    for (const key of keys) {
        if (key.includes(".")) {
            const rootKey = key.split(".")[0];
            const rootProperty = collection.properties[rootKey];
            if (rootProperty && rootProperty.type === "map" && rootProperty.admin?.spreadChildren && rootProperty.properties) {
                rootsWithExplicitChildren.add(rootKey);
            }
        }
    }

    // Track processed keys to avoid duplicates
    const processedPropertyKeys = new Set<string>();

    const result = keys.flatMap((key) => {
        // Skip if already processed (handles duplicates in propertiesOrder)
        if (processedPropertyKeys.has(key)) return [null];

        // Check if it's a top-level property
        const property = collection.properties[key];
        if (property) {
            processedPropertyKeys.add(key);
            if (property.admin?.hideFromCollection)
                return [null];
            if (property.admin?.disabled && typeof property.admin?.disabled === "object" && property.admin?.disabled.hidden)
                return [null];

            if (property.type === "map" && property.admin?.spreadChildren && property.properties) {
                // Check if this spread map has explicit child keys in propertiesOrder
                if (rootsWithExplicitChildren.has(key)) {
                    // DON'T auto-expand - the children are explicitly listed elsewhere
                    return [null];
                }
                // Auto-expand all children
                const childConfigs = getColumnKeysForProperty(property, key);
                childConfigs.forEach(c => processedPropertyKeys.add(c.key));
                return childConfigs;
            }
            return [{
                key,
                disabled: isDisabled(property) || Boolean(property.admin?.readOnly)
            }];
        }

        // Check if it's a nested key like "data.mode" (for spread map properties)
        if (key.includes(".")) {
            const rootKey = key.split(".")[0];
            const rootProperty = collection.properties[rootKey];

            if (rootProperty && rootProperty.type === "map" && rootProperty.properties) {
                const nestedProperty = getPropertyInPath(collection.properties, key) as Property | undefined;
                if (nestedProperty) {
                    processedPropertyKeys.add(key);
                    // Mark root as seen
                    processedPropertyKeys.add(rootKey);

                    if (nestedProperty.admin?.hideFromCollection)
                        return [null];
                    if (nestedProperty.admin?.disabled && typeof nestedProperty.admin?.disabled === "object" && nestedProperty.admin?.disabled.hidden)
                        return [null];

                    return [{
                        key,
                        disabled: isDisabled(rootProperty) || Boolean(rootProperty.admin?.readOnly) ||
                            isDisabled(nestedProperty) || Boolean(nestedProperty.admin?.readOnly)
                    }];
                }
            }
        }

        // Check additional fields
        const additionalField = collection.additionalFields?.find(field => field.key === key);
        if (additionalField) {
            return [{
                key,
                disabled: true
            }];
        }

        // Check subcollections
        const subcollections = getSubcollections(collection);
        if (subcollections) {
            const subCollection = subcollections
                .find(subCol => getSubcollectionColumnId(subCol) === key);
            if (subCollection) {
                return [{
                    key,
                    disabled: true
                }];
            }
        }

        return [null];
    }).filter(Boolean) as PropertyColumnConfig[];

    // Add any missing properties that weren't in propertiesOrder
    // This ensures properties NEVER disappear
    for (const propKey of Object.keys(collection.properties)) {
        // Skip if already processed
        if (processedPropertyKeys.has(propKey)) continue;

        const property = collection.properties[propKey];
        if (!property) continue;
        if (property.admin?.hideFromCollection) continue;
        if (property.admin?.disabled && typeof property.admin?.disabled === "object" && property.admin?.disabled.hidden) continue;

        if (property.type === "map" && property.admin?.spreadChildren && property.properties) {
            // For spread maps, add all children that weren't already added
            const allChildConfigs = getColumnKeysForProperty(property as MapProperty, propKey);
            for (const childConfig of allChildConfigs) {
                if (!processedPropertyKeys.has(childConfig.key)) {
                    result.push(childConfig);
                    processedPropertyKeys.add(childConfig.key);
                }
            }
        } else {
            result.push({
                key: propKey,
                disabled: isDisabled(property) || Boolean(property.admin?.readOnly)
            });
            processedPropertyKeys.add(propKey);
        }
    }

    return result;
}

function getDefaultColumnKeys<M extends Record<string, any> = any>(collection: AdminCollection<M>, includeSubCollections: boolean) {
    const propertyKeys = Object.keys(collection.properties);

    const additionalFields = collection.additionalFields ?? [];
    const subCollections: AdminCollection[] = getSubcollections(collection) ?? [];

    const columnIds: string[] = [
        ...propertyKeys,
        // Filter out additional fields whose key already exists in propertyKeys to avoid duplicate column keys
        ...additionalFields.filter((field) => !propertyKeys.includes(field.key)).map((field) => field.key)
    ];

    if (includeSubCollections) {
        const subCollectionIds = subCollections
            .map((collection) => getSubcollectionColumnId(collection));
        columnIds.push(...subCollectionIds.filter((subColId) => !columnIds.includes(subColId)));
    }

    return hideAndExpandKeys(collection, columnIds);
}

export function getColumnKeysForProperty(property: Property, key: string, disabled?: boolean): PropertyColumnConfig[] {
    // A key with no property behind it describes no column. Callers walk whole
    // property maps here to build a table's columns, so reading `.type` off a
    // hole threw away every other column with it.
    if (!property) return [];
    if (property.type === "map" && property.admin?.spreadChildren && property.properties) {
        return Object.entries(property.properties)
            .flatMap(([childKey, childProperty]) => getColumnKeysForProperty(
                childProperty as Readonly<Property>,
                `${key}.${childKey}`,
                disabled || isDisabled(property) || Boolean(property.admin?.readOnly))
            );
    }
    return [{
        key,
        disabled: disabled || isDisabled(property) || Boolean(property.admin?.readOnly)
    }];
}

export function getFormFieldKeys(collection: AdminCollection): string[] {
    const properties = collection.properties ?? {};
    // A many-relation the entity view already lists as a tab is not an input:
    // the tab is the treatment, and rendering the same declaration again as a
    // picker asked the author to select a collection's own children from a
    // dropdown. `renderInForm` is how a project that wants the picker asks for
    // it back — opt in, because the tab is the default.
    const consumedByChildView = getChildViewRelationPropertyKeys(collection);
    const propertyKeys = Object.keys(properties).filter(key => {
        if (!consumedByChildView.has(key)) return true;
        return (properties[key] as RelationProperty).admin?.renderInForm === true;
    });
    const additionalFields = collection.additionalFields ?? [];
    const allKeys = [
        ...propertyKeys,
        ...additionalFields.map((field) => field.key)
    ];

    if (collection.propertiesOrder) {
        return collection.propertiesOrder.filter(key => allKeys.includes(key));
    }
    return allKeys;
}
