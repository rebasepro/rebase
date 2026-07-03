import type { SnapshotCollection } from "@rebasepro/types";
import React, { useMemo } from "react";
import { CollectionSize, Snapshot } from "@rebasepro/types";
import {
    Card,
    Checkbox,
    Chip,
    cls,
    Typography
} from "@rebasepro/ui";
import { PropertyPreview } from "../../preview";
import {
    useAuthController,
    useCustomizationController
} from "@rebasepro/core";
import { useAnalyticsController } from "@rebasepro/core";
import { IconForView } from "@rebasepro/core";
import { useCollectionSlotKeys, resolveSnapshotSlots } from "./useSnapshotPreviewSlots";

export type SnapshotCardProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    snapshot: Snapshot<M>;
    collection: SnapshotCollection<M>;
    onClick?: (snapshot: Snapshot<M>) => void;
    selected?: boolean;
    highlighted?: boolean;
    onSelectionChange?: (snapshot: Snapshot<M>, selected: boolean) => void;
    selectionEnabled?: boolean;
    /**
     * Size of the card - affects checkbox styling
     */
    size?: CollectionSize;
};

/**
 * Card component for displaying a snapshot in a grid view.
 * Shows thumbnail, title, and preview properties via the shared slot system.
 */
export function SnapshotCard<M extends Record<string, unknown> = Record<string, unknown>>({
    snapshot,
    collection,
    onClick,
    selected,
    highlighted,
    onSelectionChange,
    selectionEnabled,
    size = "m"
}: SnapshotCardProps<M>) {
    const authController = useAuthController();
    const analyticsController = useAnalyticsController();
    const customizationController = useCustomizationController();

    const slotKeys = useCollectionSlotKeys(
        collection as SnapshotCollection<Record<string, unknown>>,
        authController,
        customizationController.propertyConfigs
    );

    const slots = useMemo(
        () => resolveSnapshotSlots(
            snapshot as Snapshot<Record<string, unknown>>,
            collection as SnapshotCollection<Record<string, unknown>>,
            slotKeys
        ),
        [snapshot, collection, slotKeys]
    );

    const handleClick = (e?: React.MouseEvent) => {
        // Cmd+click (Mac) or Ctrl+click (Windows) toggles selection
        if (e && (e.metaKey || e.ctrlKey) && selectionEnabled) {
            e.preventDefault();
            onSelectionChange?.(snapshot, !selected);
            return;
        }
        if (onClick) {
            analyticsController.onAnalyticsEvent?.("card_view_snapshot_click", {
                path: snapshot.path,
                snapshotId: snapshot.id
            });
            onClick(snapshot);
        }
    };

    const handleCheckboxClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    const handleSelectionChange = (checked: boolean) => {
        onSelectionChange?.(snapshot, checked);
    };

    return (
        <Card
            className={cls(
                "cursor-pointer overflow-hidden group relative",
                "transition-all duration-200",
                "hover:shadow-lg hover:-translate-y-0.5",
                selected && "ring-2 ring-primary bg-surface-accent-50 dark:bg-surface-accent-900",
                highlighted && !selected && "ring-2 ring-primary ring-opacity-50 bg-surface-accent-50/50 dark:bg-surface-accent-900"
            )}
            onClick={handleClick}
        >
            {/* Thumbnail area — image slot */}
            <div className="aspect-[4/3] relative overflow-hidden bg-surface-100 dark:bg-surface-900">
                {slots.image ? (
                    <div className="w-full h-full">
                        <PropertyPreview
                            property={slots.image.property}
                            propertyKey={slots.image.propertyKey}
                            size="medium"
                            value={slots.image.value}
                            fill={true}
                        />
                    </div>
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <IconForView
                            collectionOrView={collection}
                            color="disabled"
                        />
                    </div>
                )}

                {/* Hover overlay */}
                <div className={cls(
                    "absolute inset-0 bg-black/0 group-hover:bg-black/10",
                    "transition-colors duration-200"
                )}/>

                {/* Selection checkbox */}
                {selectionEnabled && (
                    <div
                        className={cls(
                            "absolute",
                            size === "xs" || size === "s" ? "top-1 left-1" : "top-2 left-2"
                        )}
                        onClick={handleCheckboxClick}
                    >
                        <Checkbox
                            checked={selected ?? false}
                            onCheckedChange={handleSelectionChange}
                            size={size === "xs" ? "smallest" : "small"}
                        />
                    </div>
                )}

            </div>

            {/* Content area */}
            <div className="p-3">
                {/* Snapshot ID */}
                <Typography
                    variant="caption"
                    color="disabled"
                    className="font-mono truncate block"
                >
                    {snapshot.id}
                </Typography>

                {/* Title slot */}
                <div className="truncate my-1 text-sm font-medium min-h-[20px]">
                    {slots.title ? (
                        <PropertyPreview
                            propertyKey={slots.title.propertyKey}
                            value={slots.title.value}
                            property={slots.title.property}
                            size="small"
                        />
                    ) : (
                        <Typography variant="body2" className="text-surface-500">
                            {snapshot.id}
                        </Typography>
                    )}
                </div>

                {/* Subtitle slot */}
                {slots.subtitle && (
                    <div className="line-clamp-3 [&_div]:line-clamp-3 text-xs text-surface-600 dark:text-surface-400 [&_p]:!my-1 [&_p:first-child]:!mt-0 [&_p:last-child]:!mb-0">
                        <PropertyPreview
                            propertyKey={slots.subtitle.propertyKey}
                            value={slots.subtitle.value}
                            property={slots.subtitle.property}
                            size="small"
                        />
                    </div>
                )}

                {/* Relation chips slot */}
                {slots.relations.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 overflow-hidden max-w-full flex-wrap">
                        {slots.relations.map((rel) => (
                            rel.items.map((item) => (
                                <Chip
                                    key={`${rel.propertyKey}-${item.id}`}
                                    size="smallest"
                                    colorScheme={rel.colorScheme}
                                    className="!text-[10px] !leading-tight !py-0 shrink-0 max-w-[100px] truncate"
                                >
                                    {item.displayName}
                                </Chip>
                            ))
                        ))}
                        {slots.relations.some(r => r.totalCount > r.items.length) && (
                            <span className="text-[10px] text-surface-400 dark:text-surface-500 shrink-0">
                                +{slots.relations.reduce((acc, r) => acc + Math.max(0, r.totalCount - r.items.length), 0)}
                            </span>
                        )}
                    </div>
                )}

                {/* Status slot */}
                {slots.status && (
                    <div className="mt-1">
                        <PropertyPreview
                            propertyKey={slots.status.propertyKey}
                            value={slots.status.value}
                            property={slots.status.property}
                            size="small"
                        />
                    </div>
                )}
            </div>
        </Card>
    );
}
