import type { EntityCollection, Property, PropertyConfig } from "@rebasepro/types";
import { AuthController } from "@rebasepro/types";
import { isPropertyBuilder } from "@rebasepro/common";
import { isReferenceProperty, isRelationProperty } from "./property_utils";

export function getEntityPreviewKeys(
    authController: AuthController,
    targetCollection: EntityCollection<any>,
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
    } else {
        listProperties = allProperties;
        return listProperties
            .filter(key => {
                const prop = targetCollection.properties[key];
                const isIdProp = prop && typeof prop === "object" && "isId" in prop && Boolean((prop as { isId?: boolean }).isId);
                return !isIdProp;
            })
            .filter(key => {
                const property = targetCollection.properties[key];
                return property && !isPropertyBuilder(property) && !isReferenceProperty(property) && !isRelationProperty(property);
            }).slice(0, limit);
    }
}

export function getEntityTitlePropertyKey<M extends Record<string, unknown>>(collection: EntityCollection<M>, propertyConfigs: Record<string, PropertyConfig>): string | undefined {
    if (collection.titleProperty) {
        return collection.titleProperty as string;
    }
    
    const orderToSearch = (collection.propertiesOrder as string[]) || Object.keys(collection.properties);
    let firstStringCandidate: string | undefined;

    for (const key of orderToSearch) {
        const property = collection.properties[key];
        if (property && !isPropertyBuilder(property)) {
            const prop = property as Property;
            if (prop.type === "string" && !prop.ui?.multiline && !prop.ui?.markdown && !prop.storage && !prop.isId) {
                if (!firstStringCandidate) {
                    firstStringCandidate = key;
                }
                const lowerKey = key.toLowerCase();
                if (["name", "title", "label", "displayname", "username"].includes(lowerKey)) {
                    return key; // Immediate return if it's a strong title candidate
                }
            }
        }
    }
    return firstStringCandidate;
}

