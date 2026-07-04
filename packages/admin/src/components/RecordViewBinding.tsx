import type { Properties } from "@rebasepro/types";
import type { CollectionConfig } from "@rebasepro/types";
import type { CustomizationController } from "@rebasepro/types";
import React from "react";
import { Snapshot } from "@rebasepro/types";
import { cls, defaultBorderMixin, ExternalLinkIcon, IconButton, Typography } from "@rebasepro/ui";
;
import { useCustomizationController } from "@rebasepro/core";
import { useAuthController } from "@rebasepro/core";
import { PropertyCollectionView } from "./PropertyCollectionView";

/**
 * @group Components
 */
export interface RecordViewBindingProps<M extends Record<string, unknown>> {
    snapshot: Snapshot<M>;
    collection: CollectionConfig<M>;
    path: string;
    className?: string;
}

export function RecordViewBinding<M extends Record<string, unknown>>(
    {
        snapshot,
        collection,
        path,
        className
    }: RecordViewBindingProps<M>) {

    const customizationController: CustomizationController = useCustomizationController();

    const properties: Properties = collection.properties;

    return (
        <div className={"w-full " + className}>
            <div className={"w-full mb-4 p-4"}>

                <div className={`grid grid-cols-12 gap-x-4 py-4 items-start border-b ${defaultBorderMixin}`}>
                    <div className="col-span-4 pr-2">
                        <Typography variant="caption"
                            color={"secondary"}
                            component={"span"}
                            className="break-words">
                            Id
                        </Typography>
                    </div>
                    <div className="col-span-8">
                        <div
                            className="flex-grow text-surface-900 dark:text-white flex items-center">
                            <span className="flex-grow mr-2">{snapshot.id}</span>
                            {customizationController?.snapshotLinkBuilder &&
                                <a href={customizationController.snapshotLinkBuilder({ snapshot })}
                                    rel="noopener noreferrer"
                                    target="_blank">
                                    <IconButton>
                                        <ExternalLinkIcon/>
                                    </IconButton>
                                </a>}
                        </div>
                    </div>
                </div>

                <PropertyCollectionView data={snapshot.values} properties={properties} size={"medium"}/>

            </div>
        </div>
    );
}
