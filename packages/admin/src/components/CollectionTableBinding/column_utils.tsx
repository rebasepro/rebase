import type { Properties, Property, RelationProperty } from "@rebasepro/types";
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
        .flatMap(({
            key,
            disabled
        }) => {
            const property = getResolvedPropertyInPath(properties, key) as Property | undefined;
            // One unresolvable key used to throw, and this runs inside the
            // memo that builds the table's columns — so a single bad column
            // took down the header, the rows and the empty state together,
            // leaving a blank pane with nothing to attribute it to. A column
            // that cannot be resolved is one column the table cannot offer;
            // say so and carry the rest. Same choice, and now the same
            // behaviour, as `getSortablePropertyOptions` below.
            if (!property) {
                console.warn(`No property found in path "${key}" — skipping that column.`);
                return [];
            }
            const filterable = filterableProperty(property, false, engine);
            return [{
                key: key as string,
                align: getTableCellAlignment(property),
                icon: getIconForProperty(property, "small"),
                title: property.name ?? key as string,
                sortable: sortable && sortableProperty(property),
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
            } satisfies VirtualTableColumn];
        });
}

export type SortablePropertyOption = {
    key: string;
    title: string;
    property: Property;
};

/**
 * The properties a sort can be applied to, as keys and titles.
 *
 * Only the table renders headers, so the list, card and split views had no way
 * to order anything — the controller has carried `sortBy` all along, with no
 * control bound to it outside the table. This is the same walk
 * `propertiesToColumns` makes, under the same keys and the same
 * `sortableProperty` authority, so a sort picked from the toolbar means exactly
 * what clicking the header would have meant, and the two cannot drift into
 * offering different columns.
 */
export function getSortablePropertyOptions(properties: Properties): SortablePropertyOption[] {
    return Object.entries<Property>(properties)
        .flatMap(([key, property]) => getColumnKeysForProperty(property, key))
        .flatMap(({ key }) => {
            // Unlike the table, a missing property here is not worth throwing
            // over: the sort control simply has one fewer option to offer.
            const property = getResolvedPropertyInPath(properties, key) as Property | undefined;
            if (!property || !sortableProperty(property)) return [];
            return [{
                key: key as string,
                title: property.name ?? key as string,
                property
            }];
        });
}

/**
 * Whether this column can be ordered by.
 *
 * `sortable` arrived as one flag for the whole table while `filter` was
 * computed per property, so every column advertised a sort — including the ones
 * no `ORDER BY` can be written for. A to-many relation is a *set* per row
 * (`posts.tags`), and there is no single value to order on; the driver used to
 * answer by silently dropping the sort and returning rows in whatever order
 * Postgres pleased, which is how a header that did nothing went unnoticed.
 *
 * Now that the driver refuses instead, offering the control would turn a
 * useless header into a failed request. Same authority as the filter side: ask
 * the property, not the table.
 */
function sortableProperty(property: Property): boolean {
    if (property.type !== "relation") return true;
    const relationProperty = property as RelationProperty;
    const kind = relationProperty.relation?.kind ?? relationProperty.resolvedRelation?.kind;
    // An unresolved relation keeps the benefit of the doubt — the same choice
    // `isFilterableRelation` makes for a kind it cannot see.
    if (!kind) return true;
    return kind === "belongsTo";
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
