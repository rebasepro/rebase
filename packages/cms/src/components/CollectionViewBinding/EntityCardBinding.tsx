
import React, { useMemo } from "react";
import { Entity } from "@rebasepro/types";
import { CollectionSize, AdminCollection } from "@rebasepro/cms-types";
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
} from "@rebasepro/app";
import { useAnalyticsController } from "@rebasepro/app";
import { IconForView } from "@rebasepro/app";
import { useCollectionSlotKeys, useEntitySlots } from "./usePreviewSlots";
import { Highlighted } from "./SearchHighlight";
import { useSearchExplanation, MatchExplanation, fieldLabel } from "./SearchExplanation";
import { SlotValue, TagChips } from "./SlotValue";

export type EntityCardBindingProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    /** The active search, so a card can mark the hit and say where it was. */
    searchString?: string;
    entity: Entity<M>;
    collection: AdminCollection<M>;
    onClick?: (entity: Entity<M>) => void;
    selected?: boolean;
    highlighted?: boolean;
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void;
    selectionEnabled?: boolean;
    /**
     * Size of the card - affects checkbox styling
     */
    size?: CollectionSize;
};

/**
 * Card component for displaying a entity in a grid view.
 * Shows thumbnail, title, and preview properties via the shared slot system.
 */
export function EntityCardBinding<M extends Record<string, unknown> = Record<string, unknown>>({
    entity,
    collection,
    onClick,
    selected,
    highlighted,
    onSelectionChange,
    selectionEnabled,
    size = "m",
    searchString
}: EntityCardBindingProps<M>) {
    const authController = useAuthController();
    const analyticsController = useAnalyticsController();
    const customizationController = useCustomizationController();

    const slotKeys = useCollectionSlotKeys(
        collection as AdminCollection<Record<string, unknown>>,
        authController,
        customizationController.propertyConfigs
    );

    const slots = useEntitySlots(
        entity as Entity<Record<string, unknown>>,
        collection as AdminCollection<Record<string, unknown>>,
        slotKeys
    );

    // Same explanation the list shows, so a reader switching view modes does
    // not lose the reason a card is in front of them.
    const { terms, offSlot } = useSearchExplanation(
        entity,
        collection.properties as Record<string, unknown>,
        [slotKeys.titleKey, slotKeys.subtitleKey],
        searchString
    );

    const handleClick = (e?: React.MouseEvent) => {
        // Cmd+click (Mac) or Ctrl+click (Windows) toggles selection
        if (e && (e.metaKey || e.ctrlKey) && selectionEnabled) {
            e.preventDefault();
            onSelectionChange?.(entity, !selected);
            return;
        }
        if (onClick) {
            analyticsController.onAnalyticsEvent?.("card_view_entity_click", {
                path: entity.path,
                entityId: entity.id
            });
            onClick(entity);
        }
    };

    const handleCheckboxClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    const handleSelectionChange = (checked: boolean) => {
        onSelectionChange?.(entity, checked);
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
                        <SlotValue slot={slots.image} size="medium" fill={true}/>
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
                {/* No id line here.
                    A card used to print the row id above its title, always —
                    a truncated uuid (`isId: "uuid"` is the default) too short
                    to copy and not what a card is read for. The list row and
                    the board card show an id only when nothing else names the
                    record; the card was the one surface that showed it even
                    when it had a title, and the id is still the fallback below
                    for a record that has none. The table's ID column, which is
                    full width, copyable and governed by
                    `hideIdFromCollection`, is where an id is actually read. */}

                {/* Title slot */}
                <div className="truncate my-1 text-sm font-medium min-h-[20px]">
                    {slots.title ? (
                        terms.length > 0 && typeof slots.title.value === "string"
                            ? <Highlighted text={slots.title.value} terms={terms}/>
                            : <SlotValue slot={slots.title} size="small"/>
                    ) : (
                        <Typography variant="body2" className="text-surface-500">
                            {entity.id}
                        </Typography>
                    )}
                </div>

                {/* Subtitle slot — or, while searching, where the hit was. A
                    card whose match is in a field it does not show looks as
                    arbitrary as a list row does. */}
                {offSlot ? (
                    <MatchExplanation
                        match={offSlot}
                        label={fieldLabel(collection.properties as Record<string, unknown>, offSlot.field)}
                    />
                ) : slots.subtitle && (
                    <div className="line-clamp-3 [&_div]:line-clamp-3 text-xs text-surface-600 dark:text-surface-400 [&_p]:!my-1 [&_p:first-child]:!mt-0 [&_p:last-child]:!mb-0">
                        {terms.length > 0 && typeof slots.subtitle.value === "string"
                            ? <Highlighted text={slots.subtitle.value} terms={terms}/>
                            : <SlotValue slot={slots.subtitle} size="small"/>}
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

                {/* Status + tags slot — "free chips beside the status" */}
                {(slots.status || slots.tags) && (
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {slots.status && <SlotValue slot={slots.status} size="small"/>}
                        {slots.tags && <TagChips slot={slots.tags}/>}
                    </div>
                )}

                {/* Date slot — a card is a list row with the image on top, and the
                    row has always shown it. It was the one slot the card resolved
                    and never rendered. */}
                {slots.date && (
                    <div className="mt-1 text-[10px] text-surface-500 dark:text-surface-400">
                        {slots.date.formatted}
                    </div>
                )}
            </div>
        </Card>
    );
}
