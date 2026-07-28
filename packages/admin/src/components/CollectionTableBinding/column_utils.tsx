import type { Properties, Property } from "@rebasepro/types";
import React from "react";
import { getTableCellAlignment, getTablePropertyColumnWidth } from "./internal/common";
import { FilterValues } from "@rebasepro/types";
import { VirtualTableColumn } from "@rebasepro/ui";
import { getIconForProperty, getResolvedPropertyInPath } from "../../util/property_utils";
import { getColumnKeysForProperty, isFilterableRelation } from "@rebasepro/app";

export function buildIdColumn(largeLayout?: boolean): VirtualTableColumn {
    return {
        key: "id_ewcfedcswdf3",
        width: (largeLayout ? 160 : 130),
        title: "ID",
        resizable: false,
        frozen: largeLayout ?? false,
        headerAlign: "center",
        align: "center"
    };
}

export interface PropertiesToColumnsParams<M extends Record<string, unknown>> {
    properties: Properties;
    sortable?: boolean;
    fixedFilter?: FilterValues<keyof M extends string ? keyof M : never>;
    /**
     * The engine backing the collection (`collection.engine`). Decides which
     * relation kinds can be filtered — see `isFilterableRelation`. Omitted
     * falls back to the default engine's capabilities.
     */
    engine?: string;
    AdditionalHeaderWidget?: React.ComponentType<{
        property: Property,
        propertyKey: string,
        onHover: boolean,
    }>;
}

export function propertiesToColumns<M extends Record<string, unknown>>({ properties, sortable, fixedFilter, engine, AdditionalHeaderWidget }: PropertiesToColumnsParams<M>): VirtualTableColumn[] {
    const disabledFilter = Boolean(fixedFilter);
    return Object.entries<Property>(properties)
        .flatMap(([key, property]) => getColumnKeysForProperty(property, key))
        .map(({
            key,
            disabled
        }) => {
            const property = getResolvedPropertyInPath(properties, key) as Property;
            if (!property)
                throw Error("Internal error: no property found in path " + key);
            const filterable = filterableProperty(property, false, engine);
            return {
                key: key as string,
                align: getTableCellAlignment(property),
                icon: getIconForProperty(property, "small"),
                title: property.name ?? key as string,
                sortable: sortable,
                filter: !disabledFilter && filterable,
                width: getTablePropertyColumnWidth(property),
                resizable: true,
                custom: {
                    resolvedProperty: property,
                    disabled
                },
                AdditionalHeaderWidget: AdditionalHeaderWidget
                    ? ({ onHover }: { onHover: boolean }) => <AdditionalHeaderWidget property={property} propertyKey={key} onHover={onHover}/>
                    : undefined
            } satisfies VirtualTableColumn;
        });
}

function filterableProperty(property: Property, partOfArray = false, engine?: string): boolean {
    // A relation this engine's driver cannot compile into a `WHERE` has
    // nothing to filter on, so the header's filter control would open onto a
    // field that renders nothing (`FilterFieldBinding` returns null on an
    // empty operator list) — and, before the driver started failing closed,
    // sending one silently returned every row. Same authority as the operator
    // resolution, and engine-aware for the same reason: this table renders
    // over Postgres, Mongo, Firestore and anything a developer registers.
    if (!isFilterableRelation(property, engine)) return false;
    if (partOfArray) {
        return ["string", "number", "date", "reference", "relation"].includes(property.type);
    }
    if (property.type === "array") {
        if (property.of && !Array.isArray(property.of))
            return filterableProperty(property.of, true, engine);
        else
            return false;
    }
    return ["string", "number", "boolean", "date", "reference", "relation", "array"].includes(property.type);
}
