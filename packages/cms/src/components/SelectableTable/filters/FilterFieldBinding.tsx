import React, { Suspense } from "react";
import {
    ArrayProperty,
    Property,
    ReferenceProperty,
    EntityRelation,
    RelationProperty,
    WhereFilterOp
} from "@rebasepro/types";
import {
    FilterFieldBindingProps,
    enumToObjectEntries
} from "@rebasepro/cms-types";
import { normalizeToEntityRelation } from "@rebasepro/common";
import { resolveFilterOperators } from "@rebasepro/app";
import { useCollectionScope, useComponentOverride } from "@rebasepro/app";
import { StringNumberFilterField } from "./StringNumberFilterField";
import { BooleanFilterField } from "./BooleanFilterField";
import { DateTimeFilterField } from "./DateTimeFilterField";
import { ReferenceFilterField } from "./ReferenceFilterField";
import { RelationFilterField } from "./RelationFilterField";
import { getDatePropertyMode, getDatePropertyTimezone } from "../../../preview/util";

export interface FilterFieldBindingInput {
    /** Key of the property being filtered (the column id). */
    propertyKey: string;
    /** The raw property — array properties are unwrapped internally. */
    property: Property;
    /**
     * Engine backing the collection (`collection.engine`). Drives which
     * operators the engine can execute. Usually omitted — it is read from
     * the surrounding {@link CollectionScopeProvider}; pass it explicitly
     * only when rendering outside any collection scope.
     */
    engine?: string;
    value?: [WhereFilterOp, unknown];
    setValue: (value?: [WhereFilterOp, unknown]) => void;
    /** Coordination flags for fields that open their own dialogs. */
    hidden?: boolean;
    setHidden?: (hidden: boolean) => void;
}

/**
 * The single entry point for rendering a collection filter field.
 * Used by both the table header filters ({@link SelectableTable}) and the
 * Filters dialog.
 *
 * Resolution order:
 * 1. `property.admin.Filter` — per-property replacement (rendered even when the
 *    resolved operator list is empty; the component owns filterability).
 * 2. `components["Collection.FilterField"]` — collection-level or app-level
 *    override (wrap mode supported via `OriginalComponent`).
 * 3. Built-in field dispatched by property type.
 *
 * The operators handed to the field are the intersection of the engine's
 * capabilities, the property-type defaults, and `property.admin.filterOperators`
 * (see `resolveFilterOperators`). When that intersection is empty and no
 * per-property `Filter` is set, nothing is rendered.
 *
 * @group Components
 */
export function FilterFieldBinding({
    propertyKey,
    property,
    engine,
    value,
    setValue,
    hidden,
    setHidden
}: FilterFieldBindingInput): React.ReactNode {

    const isArray = property.type === "array";
    const ofVal = isArray ? (property as ArrayProperty).of : undefined;
    const baseProperty: Property | undefined = isArray
        ? (Array.isArray(ofVal) ? ofVal[0] : ofVal) as Property | undefined
        : property;

    // Hooks must run unconditionally — before any early return.
    const scopeCollection = useCollectionScope();
    const ResolvedFilterField = useComponentOverride<FilterFieldBindingProps>("Collection.FilterField", DefaultFilterField);
    const PropertyFilter: React.ComponentType<FilterFieldBindingProps> | undefined = baseProperty?.admin?.Filter;

    if (!baseProperty) return null;

    const operators = resolveFilterOperators({
        property: baseProperty,
        isArray,
        engine: engine ?? scopeCollection?.engine
    });

    const bindingProps: FilterFieldBindingProps = {
        propertyKey,
        property: baseProperty,
        isArray,
        operators,
        value,
        setValue,
        title: property.name,
        hidden,
        setHidden
    };

    // 1. Per-property replacement — always rendered, the dev owns filterability.
    if (PropertyFilter) {
        return (
            <Suspense fallback={null}>
                <PropertyFilter {...bindingProps}/>
            </Suspense>
        );
    }

    // 2/3. Override or built-in — only when the property is filterable here.
    if (operators.length === 0) return null;

    return <ResolvedFilterField {...bindingProps}/>;
}

/**
 * Built-in filter field dispatch by property type. This is the
 * `OriginalComponent` received by `"Collection.FilterField"` overrides in
 * wrap mode.
 */
/**
 * A relation filter's value as `EntityRelation`s. The URL decoder builds them,
 * but a saved `defaultFilter` has been through JSON and holds plain
 * `{ __type: "relation", id, path }` objects. Returns `undefined` for anything
 * that is not a relation, so the field shows no selection rather than a wrong one.
 */
export function toRelationFilterValue(value: unknown): EntityRelation | EntityRelation[] | null | undefined {
    if (value === null) return null;
    if (value === undefined) return undefined;
    if (Array.isArray(value)) {
        const relations = value.map(item => normalizeToEntityRelation(item, "relation"));
        return relations.every((r): r is EntityRelation => r !== null) ? relations : undefined;
    }
    return normalizeToEntityRelation(value, "relation") ?? undefined;
}

function DefaultFilterField({
    propertyKey,
    property,
    isArray,
    operators,
    value,
    setValue,
    title,
    hidden,
    setHidden
}: FilterFieldBindingProps): React.ReactNode {

    if (property.type === "reference") {
        const referenceProperty = property as ReferenceProperty;
        return <ReferenceFilterField value={value}
            setValue={setValue}
            name={propertyKey}
            isArray={isArray}
            operators={operators}
            path={referenceProperty.path}
            title={title}
            includeId={referenceProperty.admin?.includeId}
            previewProperties={referenceProperty.admin?.previewProperties}
            hidden={hidden ?? false}
            setHidden={setHidden ?? (() => undefined)}/>;
    }

    if (property.type === "relation") {
        const relation = (property as RelationProperty).relation;
        if (!relation) return null;
        const relations = value ? toRelationFilterValue(value[1]) : undefined;
        return <RelationFilterField value={value && (relations !== undefined || value[1] === undefined) ? [value[0], relations] : undefined}
            setValue={setValue}
            name={propertyKey}
            operators={operators}
            relation={relation}
            hidden={hidden ?? false}
            setHidden={setHidden ?? (() => undefined)}/>;
    }

    if (property.type === "number" || property.type === "string") {
        const enumValues = property.enum ? enumToObjectEntries(property.enum) : undefined;
        return <StringNumberFilterField value={value}
            setValue={setValue}
            name={propertyKey}
            type={property.type}
            isArray={isArray}
            operators={operators}
            enumValues={enumValues}
            title={title}/>;
    }

    if (property.type === "boolean") {
        return <BooleanFilterField value={value}
            setValue={setValue}
            name={propertyKey}
            operators={operators}
            title={title}/>;
    }

    if (property.type === "date") {
        return <DateTimeFilterField value={value}
            setValue={setValue}
            name={propertyKey}
            mode={getDatePropertyMode(property)}
            timezone={getDatePropertyTimezone(property)}
            isArray={isArray}
            operators={operators}
            title={title}/>;
    }

    return null;
}
