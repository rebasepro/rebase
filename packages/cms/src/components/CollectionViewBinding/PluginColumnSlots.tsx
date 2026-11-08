import type { Property } from "@rebasepro/types";
import type { AdminCollection, SlotContribution, TableController } from "@rebasepro/cms-types";
import React from "react";
import { ErrorBoundary } from "@rebasepro/ui";

export const EMPTY_ARRAY: never[] = [];

/** What the plugins contributed to the table's add-column slot, for {@link PluginAddColumnComponents}. */
export const PluginAddColumnsContext = React.createContext<React.ReactNode[]>(EMPTY_ARRAY);

export function PluginAddColumnComponents() {
    const components = React.useContext(PluginAddColumnsContext);
    return (
        <div className="flex flex-row items-center gap-2">
            {components}
        </div>
    );
}

/**
 * What the plugins' column-header actions are handed besides their column:
 * this render's collection and table controller. `null` when no plugin
 * contributes one.
 */
export type HeaderActionsScope = {
    contributions: SlotContribution<"collection.header.action">[],
    path: string,
    collection: AdminCollection,
    tableController: TableController,
    parentCollectionSlugs: string[],
    parentEntityIds: string[]
};
export const PluginHeaderActionsContext = React.createContext<HeaderActionsScope | null>(null);

/**
 * The `collection.header.action` contributions for one column. One component
 * type for the life of the view, like {@link PluginAddColumnComponents}: the
 * table's columns are built once, and their headers re-render only when their
 * own props change, so what the actions are handed reaches them through
 * context. It was closed over when the header was built — the table controller
 * of the first render (a search, filter or sort typed since never reached a
 * header action) and the collection of the render before.
 */
export function PluginHeaderActions({
    property,
    propertyKey,
    onHover
}: {
    property: Property,
    propertyKey: string,
    onHover: boolean
}) {
    const scope = React.useContext(PluginHeaderActionsContext);
    if (!scope) return null;
    const headerSlotProps = {
        property,
        propertyKey,
        onHover,
        path: scope.path,
        collection: scope.collection,
        tableController: scope.tableController,
        parentCollectionSlugs: scope.parentCollectionSlugs,
        parentEntityIds: scope.parentEntityIds
    };
    return <>{scope.contributions.map((s, i) => (
        <ErrorBoundary key={`header_action_${propertyKey}_${i}`}>
            <s.Component {...headerSlotProps} {...(s.props ?? {})}/>
        </ErrorBoundary>
    ))}</>;
}
