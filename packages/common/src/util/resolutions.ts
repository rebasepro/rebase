import {
    ArrayProperty,
    AuthController,
    CollectionWithRelations,
    CollectionWithSubcollections,
    EntityCollection,
    EnumValueConfig,
    EnumValues,
    NumberProperty,
    Properties,
    Property,
    Relation,
    RelationProperty,
    StringProperty,
    getDataSourceCapabilities
} from "@rebasepro/types";

type PropertyConfig = { property: unknown; [key: string]: unknown };
import { isPropertyBuilder } from "./entities";
import { enumToObjectEntries } from "./enums";
import { DEFAULT_ONE_OF_TYPE } from "./common";
import { isDefaultFieldConfigId } from "@rebasepro/utils";
import { getIn, mergeDeep } from "@rebasepro/utils";

/**
 * Resolve property builders, enums and arrays.
 */

export type ResolvePropertyProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    property: Property
    propertyKey?: string,
    values?: Partial<M>,
    previousValues?: Partial<M>,
    path?: string,
    entityId?: string | number,
    index?: number,
    propertyConfigs?: Record<string, PropertyConfig>;
    ignoreMissingFields?: boolean;
    authController: AuthController;
}

export function resolveProperty<M extends Record<string, unknown> = Record<string, unknown>>(props: ResolvePropertyProps<M>): Property | null {

    const {
        property,
        ignoreMissingFields = false,
        ...rest
    } = props;

    let resultProperty: Property;

    if (isPropertyBuilder(property)) {
        const path = rest.path;
        if (!path) {
            // When path is not available (e.g. in preview contexts), skip dynamic
            // resolution and use the property as-is without dynamic modifications.
            resultProperty = property as Property;
        } else {
            const usedPropertyValue = rest.propertyKey ? getIn(rest.values, rest.propertyKey) : undefined;
            const dynamicProps = property.dynamicProps?.({
                ...rest,
                path,
                propertyValue: usedPropertyValue,
                values: rest.values ?? {},
                previousValues: rest.previousValues ?? rest.values ?? {}
            });
            resultProperty = mergeDeep(property, dynamicProps ?? {});
        }
    } else {
        resultProperty = property as Property;
    }

    // Apply dynamic properties if they exist
    if (resultProperty?.dynamicProps && rest.path) {
        const path = rest.path;
        const usedPropertyValue = rest.propertyKey ? getIn(rest.values, rest.propertyKey) : undefined;
        const dynamicPropsResult = resultProperty.dynamicProps({
            ...rest,
            path,
            propertyValue: usedPropertyValue,
            values: rest.values ?? {},
            previousValues: rest.previousValues ?? rest.values ?? {}
        });

        if (dynamicPropsResult) {
            resultProperty = mergeDeep(resultProperty, dynamicPropsResult);
        }
    }

    let resolvedProperty: Property | null;

    if (resultProperty?.type === "map" && resultProperty.properties) {
        const properties = resolveProperties({
            ignoreMissingFields,
            ...rest,
            properties: resultProperty.properties
        });
        resolvedProperty = {
            ...resultProperty,
            properties
        } as Property;
    } else if (resultProperty?.type === "array") {
        resolvedProperty = resultProperty;
    } else if ((resultProperty?.type === "string" || resultProperty?.type === "number") && resultProperty.enum) {
        resolvedProperty = resolvePropertyEnum(resultProperty);
    } else {
        resolvedProperty = resultProperty;
    }

    if (resolvedProperty?.propertyConfig && !isDefaultFieldConfigId(resolvedProperty.propertyConfig)) {
        const cmsFields = rest.propertyConfigs;
        if (!cmsFields && !ignoreMissingFields) {
            throw Error(`Trying to resolve a property with key '${resolvedProperty.propertyConfig}' that inherits from a custom property config but no custom property configs were provided. Use the property 'propertyConfigs' in your app config to provide them`);
        }
        const customField: PropertyConfig | undefined = cmsFields?.[resolvedProperty.propertyConfig];
        if (!customField) {
            console.warn(`Trying to resolve a property with key '${resolvedProperty.propertyConfig}' that inherits from a custom property config but no custom property config with that key was found. Check the 'propertyConfigs' in your app config`)
            return resolvedProperty;
        }
        if (customField.property) {
            const restConfigProperty = { ...customField.property } as Record<string, unknown>;
            delete restConfigProperty.propertyConfig;
            const customFieldProperty = resolveProperty({
                property: { name: "",
...restConfigProperty } as Property,
                ignoreMissingFields,
                ...rest
            });
            if (customFieldProperty) {
                resolvedProperty = mergeDeep(customFieldProperty, resolvedProperty);
            }
        }

    }

    return resolvedProperty;
}

export function resolveRelationProperty(property: RelationProperty, relations: Relation[], propertyKey?: string) {
    // If the property already has a resolved relation, return as-is
    if (property.relation) {
        return property;
    }

    // Determine the relation name: explicit > property key
    const name = property.relationName || propertyKey;

    // Find the relation by name (it may have been extracted from the property during normalization)
    const relation = name ? relations.find((rel) => rel.relationName === name) : undefined;
    if (!relation) {
        throw Error(`Relation ${name ?? "(unnamed)"} not found`);
    }
    return {
        ...property,
        relation: relation
    } as RelationProperty;

}

/**
 * Resolve enum aliases for a string or number property
 * @param property
 */
export function resolvePropertyEnum(property: StringProperty | NumberProperty): StringProperty | NumberProperty {
    if (typeof property.enum === "object") {
        return {
            ...property,
            enum: enumToObjectEntries(property.enum)?.filter((value) => value && (value.id || value.id === 0) && value.label) ?? []
        };
    }
    return property as StringProperty | NumberProperty;
}

/**
 * Resolve enums and arrays for properties
 * @param properties
 * @param value
 */
export function resolveProperties<M extends Record<string, unknown>>({
    propertyKey,
    properties,
    ignoreMissingFields,
    ...props
}: {
    propertyKey?: string,
    properties: Properties,
    values?: Partial<M>,
    previousValues?: Partial<M>,
    path?: string,
    entityId?: string | number,
    index?: number,
    propertyConfigs?: Record<string, PropertyConfig>;
    ignoreMissingFields?: boolean;
    authController: AuthController;
}): Properties {
    return Object.entries<Property>(properties as Record<string, Property>)
        .map(([key, property]) => {
            const childResolvedProperty = resolveProperty({
                propertyKey: propertyKey ? `${propertyKey}.${key}` : undefined,
                property: property,
                ignoreMissingFields,
                ...props
            });
            if (!childResolvedProperty) return {};
            return {
                [key]: childResolvedProperty
            };
        })
        .filter((a) => a !== null)
        .reduce((a, b) => ({ ...a,
...b }), {}) as Properties;
}

export function resolveArrayProperties<M>({
    propertyKey,
    property,
    ignoreMissingFields = false,
    ...props
}: {
    propertyKey?: string,
    property: ArrayProperty,
    values?: Partial<M>,
    previousValues?: Partial<M>,
    path?: string,
    entityId?: string | number,
    index?: number,
    propertyConfigs?: Record<string, PropertyConfig>;
    ignoreMissingFields?: boolean;
    authController: AuthController;
}): Property[] {
    const propertyValue = propertyKey ? getIn(props.values, propertyKey) : undefined;

    if (property.of) {
        if (Array.isArray(property.of)) {
            return property.of.map((p, index) => {
                return resolveProperty({
                    propertyKey: `${propertyKey}.${index}`,
                    property: p as Property,
                    ignoreMissingFields,
                    ...props,
                    index
                });
            }) as Property[];
        } else {
            const of = property.of;
            const resolvedProperties = getArrayResolvedProperties({
                propertyValue,
                propertyKey,
                property,
                ignoreMissingFields,
                ...props
            });
            const {
                values,
                previousValues,
                ...rest
            } = props;
            const ofProperty = resolveProperty({ // we don't want to pass the values of the parent entity
                property: of,
                ignoreMissingFields,
                ...rest
            });
            if (!ofProperty && !ignoreMissingFields)
                throw Error("When using a property builder as the 'of' prop of an ArrayProperty, you must return a valid child property")
            return resolvedProperties;
        }
    } else if (property.oneOf) {
        const typeField = property.oneOf?.typeField ?? DEFAULT_ONE_OF_TYPE;
        const resolvedProperties: Property[] = Array.isArray(propertyValue)
            ? propertyValue.map((v, index) => {
                const type = v && v[typeField];
                const childProperty = property.oneOf?.properties[type];
                if (!type || !childProperty) return null;
                return resolveProperty({
                    propertyKey: `${propertyKey}.${index}`,
                    property: childProperty,
                    ignoreMissingFields,
                    ...props
                });
            }).filter(e => Boolean(e)) as Property[]
            : [];
        return resolvedProperties;
    } else if (!("Field" in (property.ui || {}) && property.ui?.Field)) {
        throw Error(`The array property (${propertyKey}) needs to declare an 'of' or a 'oneOf' property, or provide a custom \`Field\` component`);
    } else {
        return [];
    }

}

export function getArrayResolvedProperties({
    propertyKey,
    propertyValue,
    property,
    ...props
}: {
    propertyValue: unknown,
    propertyKey?: string,
    property: ArrayProperty,
    ignoreMissingFields: boolean,
    values?: object;
    previousValues?: object;
    path?: string;
    entityId?: string | number;
    index?: number;
    propertyConfigs?: Record<string, PropertyConfig>;
    authController: AuthController;
}) {

    const of = property.of;
    if (!of)
        throw Error(
            `Trying to resolve an array property (${propertyKey}) without providing an 'of' property`
        )
    return Array.isArray(propertyValue)
        ? propertyValue.map((v: unknown, index: number) => {
            return resolveProperty({
                propertyKey: `${propertyKey}.${index}`,
                property: Array.isArray(of) ? of[index] : of,
                ...props,
                index
            });
        }).filter(e => Boolean(e)) as Property[]
        : [];
}

export function resolveEnumValues(input: EnumValues): EnumValueConfig[] | undefined {
    if (typeof input === "object") {
        return Object.entries(input).map(([id, value]) =>
        (typeof value === "string"
            ? {
                id,
                label: value
            }
            : value));
    } else if (Array.isArray(input)) {
        return input as EnumValueConfig[];
    } else {
        return undefined;
    }
}


export function getSubcollections<M extends Record<string, unknown> = Record<string, unknown>>(collection: EntityCollection<M>): EntityCollection<Record<string, unknown>>[] {
    if (collection.childCollections) {
        return collection.childCollections() ?? [];
    }

    if (getDataSourceCapabilities(collection.driver).supportsSubcollections && (collection as CollectionWithSubcollections).subcollections) {
        return (collection as CollectionWithSubcollections).subcollections!() ?? [];
    }

    if (getDataSourceCapabilities(collection.driver).supportsRelations && ((collection as CollectionWithRelations).relations)) {
        const manyRelations = ((collection as CollectionWithRelations).relations)!.filter((r: Relation) => r.cardinality === "many");
        return manyRelations.map((r: Relation) => {
            const target = r.target();
            if (!target) return undefined;
            const relationKey = r.relationName || target.slug;

            // Try to find corresponding property to get custom name
            let customName: string | undefined;
            if (collection.properties) {
                const prop = Object.entries(collection.properties as Record<string, Property>).find(
                    ([_, p]) => p.type === "relation" && p.relationName === relationKey
                );
                if (prop && prop[1].name) {
                    customName = prop[1].name;
                }
            }

            const baseOverrides: Partial<EntityCollection> = { slug: relationKey };
            if (customName) {
                baseOverrides.name = customName;
                baseOverrides.singularName = customName;
            }

            const targetWithOverrides = { ...target, ...baseOverrides };
            return (r.overrides ? mergeDeep(targetWithOverrides, r.overrides) : targetWithOverrides) as EntityCollection<Record<string, unknown>>;
        }).filter((c: EntityCollection<Record<string, unknown>> | undefined): c is EntityCollection<Record<string, unknown>> => Boolean(c));
    }

    return [];
}
