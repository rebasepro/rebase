import type { EntityCollection } from "@rebasepro/types";
import React, { memo, useCallback, useMemo } from "react";
import { Entity } from "@rebasepro/types";
import { Checkbox, Chip, cls, defaultBorderMixin, Markdown } from "@rebasepro/ui";
import { PropertyPreview } from "../../preview";
import { useAuthController, useCustomizationController } from "@rebasepro/core";
import { IconForView } from "@rebasepro/core";
import { BoardItemViewProps } from "./board_types";
import { useCollectionSlotKeys, resolveEntitySlots } from "./useEntityPreviewSlots";

export type EntityBoardCardProps<M extends Record<string, unknown> = Record<string, unknown>> = BoardItemViewProps<M> & {
    collection: EntityCollection<M>;
    onClick?: (entity: Entity<M>) => void;
    selected?: boolean;
    onSelectionChange?: (entity: Entity<M>, selected: boolean) => void;
    selectionEnabled?: boolean;
};

/**
 * Compact card component for displaying an entity in a Kanban board.
 * Uses the shared slot system for consistent preview rendering.
 *
 * Selection UX: The checkbox overlays on top of the image/icon thumbnail area,
 * revealed on card hover or when the card is selected. This keeps the card
 * layout clean while providing intuitive selection affordance.
 */
function EntityBoardCardInner<M extends Record<string, unknown> = Record<string, unknown>>({
    item,
    isDragging,
    isGroupedOver,
    style,
    collection,
    onClick,
    selected,
    onSelectionChange,
    selectionEnabled = false
}: EntityBoardCardProps<M>) {
    const entity = item.entity;
    const authController = useAuthController();
    const customizationController = useCustomizationController();

    const slotKeys = useCollectionSlotKeys(
        collection as EntityCollection<Record<string, unknown>>,
        authController,
        customizationController.propertyConfigs
    );

    const slots = useMemo(
        () => resolveEntitySlots(
            entity as Entity<Record<string, unknown>>,
            collection as EntityCollection<Record<string, unknown>>,
            slotKeys
        ),
        [entity, collection, slotKeys]
    );

    const handleClick = useCallback((e: React.MouseEvent) => {
        // Cmd+click (Mac) or Ctrl+click (Windows) toggles selection
        if ((e.metaKey || e.ctrlKey) && selectionEnabled) {
            e.preventDefault();
            e.stopPropagation();
            onSelectionChange?.(entity, !selected);
            return;
        }
        if (onClick) {
            e.stopPropagation();
            onClick(entity);
        }
    }, [entity, onClick, onSelectionChange, selected, selectionEnabled]);

    const handleThumbnailClick = useCallback((e: React.MouseEvent) => {
        if (!selectionEnabled) return;
        e.stopPropagation();
        e.preventDefault();
        onSelectionChange?.(entity, !selected);
    }, [entity, onSelectionChange, selected, selectionEnabled]);

    const handleSelectionChange = useCallback((checked: boolean) => {
        onSelectionChange?.(entity, checked);
    }, [entity, onSelectionChange]);

    // Memoize className computations
    const backgroundColor = useMemo((): string => {
        if (isDragging) {
            return "bg-surface-100 dark:bg-surface-800";
        }
        if (isGroupedOver) {
            return "bg-surface-200";
        }
        return "bg-white dark:bg-surface-900 hover:bg-surface-50 dark:hover:bg-surface-800";
    }, [isDragging, isGroupedOver]);

    const borderColor = useMemo((): string =>
        isDragging ? "ring-2 ring-primary" : "", [isDragging]);

    // Memoize the card className — use CSS group for hover-reveal of checkbox
    const cardClassName = useMemo(() => cls(
        "group/card p-2 flex items-start border rounded-lg cursor-pointer transition-all duration-200",
        defaultBorderMixin,
        borderColor,
        backgroundColor,
        selected
            ? "ring-2 ring-primary bg-primary/[0.03] dark:bg-primary/[0.06]"
            : "hover:shadow-sm"
    ), [borderColor, backgroundColor, selected]);

    return (
        <div
            style={style}
            className="py-1"
            data-is-dragging={isDragging}
            data-testid={item.id}
            onClick={handleClick}
        >
            <div className={cardClassName}>
                {/* Thumbnail area with selection overlay */}
                <div
                    className="relative w-10 h-10 rounded-md shrink-0 mr-2"
                    onClick={handleThumbnailClick}
                >
                    {/* Image or fallback icon */}
                    {slots.image ? (
                        <div className={cls(
                            "w-10 h-10 rounded-md overflow-hidden transition-opacity duration-200",
                            selectionEnabled && "group-hover/card:opacity-30",
                            selected && "opacity-0"
                        )}>
                            <PropertyPreview
                                property={slots.image.property}
                                propertyKey={slots.image.propertyKey}
                                size="small"
                                value={slots.image.value}
                                fill={true}
                            />
                        </div>
                    ) : (
                        <div className={cls(
                            "w-10 h-10 rounded-md bg-surface-100 dark:bg-surface-800 flex items-center justify-center transition-opacity duration-200",
                            selectionEnabled && "group-hover/card:opacity-30",
                            selected && "opacity-0"
                        )}>
                            <IconForView
                                collectionOrView={collection}
                                color="disabled"
                                size="small"
                            />
                        </div>
                    )}

                    {/* Selection checkbox overlay — visible on hover or when selected */}
                    {selectionEnabled && (
                        <div className={cls(
                            "absolute inset-0 flex items-center justify-center rounded-md transition-all duration-200",
                            selected
                                ? "opacity-100 bg-primary/10 dark:bg-primary/20"
                                : "opacity-0 group-hover/card:opacity-100"
                        )}>
                            <div className={cls(
                                "transition-transform duration-200",
                                selected
                                    ? "scale-100"
                                    : "scale-75 group-hover/card:scale-100"
                            )}>
                                <Checkbox
                                    checked={selected ?? false}
                                    onCheckedChange={handleSelectionChange}
                                    size="small"
                                    padding={false}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    {/* Title slot */}
                    <div className="line-clamp-2 text-sm font-medium">
                        {slots.title ? (
                            <PropertyPreview
                                propertyKey={slots.title.propertyKey}
                                value={slots.title.value}
                                property={slots.title.property}
                                size="small"
                            />
                        ) : (
                            <span className="text-surface-500">{entity.id}</span>
                        )}
                    </div>
                    {/* Subtitle / Description */}
                    {slots.subtitle ? (
                        <div className="text-xs text-surface-500 mt-1 line-clamp-3 opacity-80">
                            {typeof slots.subtitle.value === "string" ? (
                                <Markdown source={slots.subtitle.value} size="small" />
                            ) : (
                                <PropertyPreview
                                    propertyKey={slots.subtitle.propertyKey}
                                    value={slots.subtitle.value}
                                    property={slots.subtitle.property}
                                    size="small"
                                />
                            )}
                        </div>
                    ) : (
                        <div className="text-xs text-surface-500 font-mono truncate mt-1">
                            {entity.id}
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
                                        className="!text-[10px] !leading-tight !py-0 shrink-0 max-w-[90px] truncate"
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
                </div>
            </div>
        </div>
    );
}

// Memoized to prevent unnecessary re-renders when other cards in the board change
export const EntityBoardCard = memo(EntityBoardCardInner) as typeof EntityBoardCardInner;

/**
 * Wrapper component that adapts EntityBoardCard to BoardItemViewProps interface
 */
export function createEntityBoardCardComponent<M extends Record<string, unknown>>(
    collection: EntityCollection<M>,
    options: {
        onClick?: (entity: Entity<M>) => void;
        isEntitySelected?: (entity: Entity<M>) => boolean;
        onSelectionChange?: (entity: Entity<M>, selected: boolean) => void;
        selectionEnabled?: boolean;
    }
): React.ComponentType<BoardItemViewProps<M>> {
    return function EntityBoardCardWrapper(props: BoardItemViewProps<M>) {
        return (
            <EntityBoardCard
                {...props}
                collection={collection}
                onClick={options.onClick}
                selected={options.isEntitySelected?.(props.item.entity)}
                onSelectionChange={options.onSelectionChange}
                selectionEnabled={options.selectionEnabled}
            />
        );
    };
}
