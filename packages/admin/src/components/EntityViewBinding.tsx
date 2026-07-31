import type { Properties } from "@rebasepro/types";

import type { CustomizationController, AdminCollection } from "@rebasepro/admin-types";
import React from "react";
import { Entity } from "@rebasepro/types";
import { ExternalLinkIcon, IconButton, Tooltip } from "@rebasepro/ui";
import { useCustomizationController } from "@rebasepro/app";
import { PropertyCollectionView } from "./PropertyCollectionView";

/**
 * @group Components
 */
export interface EntityViewBindingProps<M extends Record<string, unknown>> {
    entity: Entity<M>;
    collection: AdminCollection<M>;
    path: string;
    className?: string;
}

/**
 * The read-only rendering of a record's values.
 *
 * This used to prepend a synthetic `Id` row of its own. Between that row, the
 * collection's own id property, and the `path/id` chip above it, the same UUID
 * appeared three times — and in the ~340px split pane each copy wrapped over
 * four lines, so most of the first screen was one id repeated. The id is now a
 * copyable chip in the identity bar, once.
 */
export function EntityViewBinding<M extends Record<string, unknown>>(
    {
        entity,
        collection,
        path,
        className
    }: EntityViewBindingProps<M>) {

    const customizationController: CustomizationController = useCustomizationController();

    // The id is the chip in the identity bar. Listing it again as the first row
    // of the value table is the same duplication the form removed — and here it
    // is the first thing you read about the record.
    const properties: Properties = React.useMemo(() => {
        const entries = Object.entries(collection.properties ?? {})
            .filter(([, property]) => !(property && "isId" in property && property.isId));
        return Object.fromEntries(entries) as Properties;
    }, [collection.properties]);
    const externalLink = customizationController?.entityLinkBuilder?.({ entity });

    return (
        <div className={"w-full " + (className ?? "")}>

            {externalLink && (
                <div className={"flex justify-end mb-2"}>
                    <Tooltip title={"Open in the live site"}>
                        <a href={externalLink} rel={"noopener noreferrer"} target={"_blank"}>
                            <IconButton size={"small"}>
                                <ExternalLinkIcon/>
                            </IconButton>
                        </a>
                    </Tooltip>
                </div>
            )}

            <PropertyCollectionView data={entity.values} properties={properties} size={"medium"}/>
        </div>
    );
}
