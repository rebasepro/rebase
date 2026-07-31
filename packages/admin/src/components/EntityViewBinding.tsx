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

    // A single surrogate id is the chip in the identity bar, so listing it again
    // as the first row here is the duplication the form already removed.
    //
    // A composite key is different: `entity.id` is then a synthesised address
    // (`a:::b`), and the real key columns are data — on a junction row they say
    // which two records this joins. Those stay in the table.
    const properties: Properties = React.useMemo(() => {
        const entries = Object.entries(collection.properties ?? {});
        const idKeys = entries.filter(([, p]) => p && "isId" in p && p.isId);
        if (idKeys.length !== 1) return collection.properties;
        return Object.fromEntries(entries.filter(([key]) => key !== idKeys[0][0])) as Properties;
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
