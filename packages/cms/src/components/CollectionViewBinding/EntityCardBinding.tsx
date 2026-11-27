
import React, { useMemo } from "react";
import { CollectionSize, AdminCollection, Entity } from "@rebasepro/cms-types";
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
import { useAnalyticsController, useTranslation } from "@rebasepro/app";
import { IconForView } from "@rebasepro/app";
import { useCollectionSlotKeys, useEntitySlots, useImagePlace } from "./usePreviewSlots";
import { Highlighted } from "./SearchHighlight";
import { useSearchExplanation, MatchExplanation, fieldLabel } from "./SearchExplanation";
import { SlotValue, TagChips } from "./SlotValue";

export type EntityCardBindingProps<M extends Record<string, unknown> = Record<string, unknown>> = {
    /** The active search, so a card can mark the hit and say where it was. */
    searchString?: string;
    entity: Entity<M>;
    collection: AdminCollection<M>;
    /**
     * The card was clicked.
     *
     * Carries the originating event as well as the entity, because the grid's
     * own handler needs it: `CardView` hands `renderCard` an
     * `(e: React.MouseEvent) => void` that reads `e.metaKey` / `e.ctrlKey` and
     * calls `e.preventDefault()`. That handler used to be passed here through
     * a cast of `onClick` to `any` and then invoked with the *entity*, so its modifier
     * branch read `entity.metaKey` — always undefined — and never ran.
     */
    onClick?: (entity: Entity<M>, event?: React.MouseEvent) => void;
    selected?: boolean;
    highlighted?: boolean;
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void;
    selectionEnabled?: boolean;
    /**
     * Size of the card - affects checkbox styling
     */
    size?: CollectionSize;
    /**
     * Draws the record's actions — the collection's `entityActions` with
     * Copy and Delete, placed as a table row places them. The card puts them
     * beside its title; a copy of this card calls it where it wants them.
     */
    renderActions?: (entity: Entity<M>) => React.ReactNode;
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
    searchString,
    renderActions
}: EntityCardBindingProps<M>) {
    const { t } = useTranslation();
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
    const imagePlace = useImagePlace(slotKeys.imageKey);

    // Same explanation the list shows, so a reader switching view modes does
    // not lose the reason a card is in front of them.
    const { terms, offSlot } = useSearchExplanation(
        entity,
        collection.properties as Record<string, unknown>,
        [slotKeys.titleKey, slotKeys.subtitleKey],
        searchString
    );

    // The event is optional because `Card` activates by keyboard too, calling
    // `onClick?.()` with nothing on Enter/Space. That path is real, and it is
    // why this cannot simply require one.
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
            onClick(entity, e);
        }
    };

    const handleCheckboxClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    const handleSelectionChange = (checked: boolean) => {
        onSelectionChange?.(entity, checked);
    };

    const checkbox = (
        <div onClick={handleCheckboxClick}>
            <Checkbox
                aria-label={t("select_row", { id: String(entity.id) })}
                checked={selected ?? false}
                onCheckedChange={handleSelectionChange}
                size={size === "xs" ? "smallest" : "small"}
            />
        </div>
    );

    const actions = renderActions?.(entity);

    return (
        <Card
            className={cls(
                "flex flex-col h-full cursor-pointer overflow-hidden group relative",
                "transition-colors duration-150",
                "hover:bg-surface-card-hover hover:border-hairline-strong",
                selected && "ring-1 ring-primary border-primary/50 bg-surface-raised",
                highlighted && !selected && "ring-1 ring-primary/50 bg-surface-card-hover"
            )}
            onClick={handleClick}
        >
            {/* Floating hover-revealed action bar — never sits beside the title
                where it would crush the headline to 12 characters. */}
            {actions && (
                <div className={cls(
                    "absolute top-2 right-2 z-10",
                    "opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100",
                    "transition-opacity duration-150",
                    "rounded-md p-0.5 border border-hairline",
                    imagePlace
                        ? "bg-surface-frame/80 backdrop-blur-md shadow-sm"
                        : "bg-surface-card/95 backdrop-blur-sm shadow-xs"
                )}>
                    {actions}
                </div>
            )}

            {/* Full-bleed cover image — edge-to-edge 16:10, no padded letterbox. */}
            {imagePlace && (
                <div className="aspect-[16/10] relative overflow-hidden bg-surface-well border-b border-hairline [&_img]:!object-cover [&_img]:!w-full [&_img]:!h-full [&_img]:transition-transform [&_img]:duration-300 group-hover:[&_img]:scale-[1.02]">
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

                    {/* Subtle hover scrim so floating controls stay legible */}
                    <div className={cls(
                        "absolute inset-0 bg-black/0 group-hover:bg-black/10 pointer-events-none",
                        "transition-colors duration-150"
                    )}/>

                    {selectionEnabled && (
                        <div className={cls(
                            "absolute z-10 transition-opacity duration-150",
                            size === "xs" || size === "s" ? "top-1.5 left-1.5" : "top-2 left-2",
                            "rounded-md bg-surface-frame/75 backdrop-blur-md p-0.5 border border-white/10 shadow-xs",
                            selected
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                        )}>
                            {checkbox}
                        </div>
                    )}
                </div>
            )}

            {/* Content area */}
            <div className="p-3.5 flex flex-col flex-1 gap-2 min-w-0">
                {/* Full-width title (up to 2 lines) */}
                <div className="flex items-start gap-2 min-w-0">
                    {selectionEnabled && !imagePlace && (
                        <div className={cls(
                            "pt-0.5 transition-opacity duration-150",
                            selected
                                ? "opacity-100"
                                : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                        )}>
                            {checkbox}
                        </div>
                    )}
                    <div className="flex-1 min-w-0 line-clamp-2 text-[14px] font-medium leading-snug tracking-[-0.01em] text-text-primary dark:text-text-primary-dark">
                        {slots.title ? (
                            terms.length > 0 && typeof slots.title.value === "string"
                                ? <Highlighted text={slots.title.value} terms={terms}/>
                                : <SlotValue slot={slots.title} size="small"/>
                        ) : (
                            <Typography variant="body2" color="disabled">
                                {entity.id}
                            </Typography>
                        )}
                    </div>
                </div>

                {/* Subtitle / excerpt — clean 2-line rhythm */}
                {offSlot ? (
                    <MatchExplanation
                        match={offSlot}
                        label={fieldLabel(collection.properties as Record<string, unknown>, offSlot.field)}
                    />
                ) : slots.subtitle && (
                    <div className="line-clamp-2 [&_div]:line-clamp-2 text-xs leading-relaxed text-text-secondary dark:text-text-secondary-dark [&_p]:!my-0">
                        {terms.length > 0 && typeof slots.subtitle.value === "string"
                            ? <Highlighted text={slots.subtitle.value} terms={terms}/>
                            : <SlotValue slot={slots.subtitle} size="small"/>}
                    </div>
                )}

                {/* Relation & tag chips — compact single-line ceiling */}
                {(slots.relations.length > 0 || slots.tags) && (
                    <div className="flex items-center gap-1 mt-0.5 overflow-hidden max-w-full flex-wrap">
                        {slots.relations.map((rel) => (
                            rel.items.map((item) => (
                                <Chip
                                    key={`${rel.propertyKey}-${item.id}`}
                                    size="smallest"
                                    colorScheme={rel.colorScheme}
                                    className="!text-[11px] !leading-tight shrink-0 max-w-[110px] truncate"
                                >
                                    {item.displayName}
                                </Chip>
                            ))
                        ))}
                        {slots.relations.some(r => r.totalCount > r.items.length) && (
                            <span className="text-[11px] text-text-disabled dark:text-text-disabled-dark shrink-0">
                                +{slots.relations.reduce((acc, r) => acc + Math.max(0, r.totalCount - r.items.length), 0)}
                            </span>
                        )}
                        {slots.tags && <TagChips slot={slots.tags} max={2}/>}
                    </div>
                )}

                {/* Anchored footer — status left, date right, aligned across the row */}
                {(slots.status || slots.date) && (
                    <div className="mt-auto pt-2.5 border-t border-hairline flex items-center justify-between gap-2 min-w-0">
                        <div className="min-w-0 truncate">
                            {slots.status && <SlotValue slot={slots.status} size="small"/>}
                        </div>
                        {slots.date && (
                            <span className="text-[11px] font-medium text-text-disabled dark:text-text-disabled-dark tabular-nums whitespace-nowrap shrink-0">
                                {slots.date.formatted}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </Card>
    );
}
