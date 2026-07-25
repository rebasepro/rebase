import {
    ArrayProperty,
    AuthState,
    CollectionConfig,
    EnumValueConfig,
    EnumValues,
    NumberProperty,
    Properties,
    Property,
    Relation,
    RelationProperty,
    StringProperty,
    getDataSourceCapabilities,
    getDeclaredSubcollections,
    type EntityChildView
} from "@rebasepro/types";

type PropertyConfig = { property: unknown; [key: string]: unknown };
import { isPropertyBuilder } from "./entities";
import { enumToObjectEntries } from "./enums";
import { DEFAULT_ONE_OF_TYPE } from "./common";
import { isDefaultFieldConfigId } from "@rebasepro/utils";
import { getIn, mergeDeep } from "@rebasepro/utils";
import { isJunctionBackedRelation, resolveCollectionRelations } from "./relations";

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
    authController: AuthState;
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
    authController: AuthState;
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
    authController: AuthState;
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
    } else if (!property.columnType) {
        // An array with neither `of`/`oneOf` nor a `columnType` describes no element
        // type, so nothing can be generated or rendered from it.
        //
        // The escape hatch used to be `ui.Field` — "a custom component can render
        // anything" — which made a *presentation* field decide whether a schema was
        // valid, in code the Postgres generator runs. `columnType` is the same escape
        // hatch stated as data: `columnType: "text[]"` says what the column holds,
        // which is what both the generator and the form actually need.
        throw Error(`The array property (${propertyKey}) needs to declare an 'of' or a 'oneOf' property, or a \`columnType\` such as "text[]"`);
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
    authController: AuthState;
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


/**
 * Relation identities that only ever appear *below* the top level of
 * `properties` — inside a `map`, an `array`, or a `oneOf` branch.
 *
 * A relation declared at the top level is a list hanging off the record and
 * earns a tab. One declared inside a map is a field of that map. Both end up in
 * the collection's flat `relations` array after normalization, so the shape of
 * `properties` is the only remaining evidence of which is which.
 *
 * An identity declared in both places is *not* nested-only, and keeps its tab.
 */
function getNestedRelationIdentities(properties: Properties | undefined): Set<string> {
    const topLevel = new Set<string>();
    const nested = new Set<string>();

    const walk = (props: Properties | undefined, depth: number): void => {
        if (!props) return;
        for (const [key, property] of Object.entries(props as Record<string, Property>)) {
            if (!property) continue;
            if (property.type === "relation") {
                const relProp = property as RelationProperty;
                (depth === 0 ? topLevel : nested).add(relProp.relationName ?? key);
            } else if (property.type === "map") {
                walk(property.properties, depth + 1);
            } else if (property.type === "array") {
                const arrayProp = property as ArrayProperty;
                if (Array.isArray(arrayProp.of)) {
                    arrayProp.of.forEach(p => walk({ entry: p } as Properties, depth + 1));
                } else if (arrayProp.of) {
                    walk({ entry: arrayProp.of } as Properties, depth + 1);
                }
                if (arrayProp.oneOf?.properties) walk(arrayProp.oneOf.properties, depth + 1);
            }
        }
    };

    walk(properties, 0);

    for (const identity of topLevel) nested.delete(identity);
    return nested;
}

/**
 * The lists rendered inside an entity view of `collection` — its tabs.
 *
 * The single derivation. There used to be two that disagreed: this one, and a
 * copy in `CollectionRegistry.normalizeCollection` that stamped each child with
 * the *target collection's* slug instead of the relation key. Since the
 * registry ran first and cached its answer onto `childCollections`, its version
 * was the one that won, and the frontend addressed child listings by a segment
 * the backend could not resolve.
 *
 * Order of precedence:
 *   1. `childCollections` — the explicit escape hatch for custom drivers.
 *   2. `subcollections` on an engine that has real containment (Firestore).
 *   3. many-relations on an engine that has relations (SQL).
 */
export function getEntityChildViews<M extends Record<string, unknown> = Record<string, unknown>>(
    collection: CollectionConfig<M>
): EntityChildView[] {
    const asSubcollections = (collections: CollectionConfig<Record<string, unknown>>[]): EntityChildView[] =>
        collections.filter(Boolean).map(child => ({
            key: child.slug,
            collection: child,
            source: { kind: "subcollection" as const }
        }));

    if (collection.childCollections) {
        return asSubcollections(collection.childCollections() ?? []);
    }

    const capabilities = getDataSourceCapabilities(collection.engine);

    const declaredSubcollections = getDeclaredSubcollections(collection);
    if (capabilities.supportsSubcollections && declaredSubcollections) {
        return asSubcollections(declaredSubcollections() ?? []);
    }

    if (!capabilities.supportsRelations) return [];

    const resolvedRelations = resolveCollectionRelations(collection);
    const nestedOnly = getNestedRelationIdentities(collection.properties);
    const views: EntityChildView[] = [];
    const seen = new Set<string>();

    // Keyed by the map key, not by `relationName`: the map key is what
    // `findRelation` matches a path segment against, so it is the only one that
    // addresses the same relation on both sides of the wire. The map registers
    // some relations twice — once canonically, once under the declaring
    // property key — so dedupe on the underlying relation.
    for (const [relationKey, relation] of Object.entries(resolvedRelations)) {
        if (relation.cardinality !== "many") continue;

        const identity = relation.relationName ?? relationKey;
        if (seen.has(identity)) continue;

        // A relation declared inside a `map` is a field of that map, not a list
        // hanging off the record. `extractRelationsFromProperties` hoists it to
        // the collection's `relations` so the nested property can be stamped —
        // which had the side effect of giving it a tab of its own, keyed by the
        // inner property key.
        if (nestedOnly.has(identity)) continue;

        let target: CollectionConfig | undefined;
        try {
            target = relation.target();
        } catch {
            continue;
        }
        if (!target) continue;
        seen.add(identity);

        // A name given to the declaring property is the author naming the tab.
        const declaringProperty = Object.entries((collection.properties ?? {}) as Record<string, Property>)
            .find(([propKey, p]) => p.type === "relation" && (p.relationName ?? propKey) === identity);
        const customName = declaringProperty?.[1]?.name;

        const base: CollectionConfig<Record<string, unknown>> = {
            ...target,
            slug: relationKey,
            ...(customName ? { name: customName,
singularName: customName } : {})
        } as CollectionConfig<Record<string, unknown>>;

        views.push({
            key: relationKey,
            collection: (relation.overrides ? mergeDeep(base, relation.overrides) : base) as CollectionConfig<Record<string, unknown>>,
            source: {
                kind: "relation",
                relationKey,
                mode: isJunctionBackedRelation(relation) ? "linked" : "owned"
            }
        });
    }

    return views;
}

/**
 * The child views of `collection` as bare collections.
 *
 * The flattened view of {@link getEntityChildViews}, for navigation code that
 * only needs to match a path segment against a slug. Anything that cares *what
 * kind* of list it is showing — chiefly the admin, which must not offer a
 * global delete on a shared row — should read the views instead.
 */
export function getSubcollections<M extends Record<string, unknown> = Record<string, unknown>>(collection: CollectionConfig<M>): CollectionConfig<Record<string, unknown>>[] {
    return getEntityChildViews(collection).map(view => view.collection);
}
