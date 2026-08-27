
import type { EntityAction, AdminCollection } from "@rebasepro/cms-types";
import React, { MouseEvent, useCallback } from "react";

import { Entity } from "@rebasepro/types";
import { CollectionSize, SelectionController } from "@rebasepro/cms-types";
import {
    Badge,
    Checkbox,
    cls,
    IconButton,
    Menu,
    MenuItem,
    MoreVerticalIcon,
    Skeleton,
    Tooltip
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";
import { getIcon } from "@rebasepro/app";
import { getEntityFromCache } from "@rebasepro/app";
import { getLocalChangesBackup } from "@rebasepro/app";
import { useAdminContext } from "../../hooks/useAdminContext";

/**
 *
 * @param entity
 * @param width
 * @param frozen
 * @param isSelected
 * @param selectionEnabled
 * @param size
 * @param toggleEntitySelection
 * @param hideId
 *
 * @group Collection components
 */
export const CollectionRowActions = function CollectionRowActions({
    entity,
    collection,
    path,
    width,
    frozen,
    isSelected,
    selectionEnabled,
    size,
    highlightEntity,
    onCollectionChange,
    unhighlightEntity,
    actions = [],
    hideId,
    selectionController,
    openEntityMode,
    sortableNodeRef,
    sortableStyle,
    sortableAttributes,
    isDragging,
    isDraggable
}:
    {
        entity: Entity<any>,
        collection?: AdminCollection<any>,
        path?: string,
        width: number,
        frozen?: boolean,
        size: CollectionSize,
        isSelected?: boolean,
        selectionEnabled?: boolean,
        actions?: EntityAction[],
        hideId?: boolean,
        onCollectionChange?: () => void,
        selectionController?: SelectionController;
        highlightEntity?: (entity: Entity<any>) => void;
        unhighlightEntity?: (entity: Entity<any>) => void;
        openEntityMode: "side_panel" | "full_screen" | "split" | "dialog";
        // Sortable props for dnd-kit integration
        sortableNodeRef?: (node: HTMLElement | null) => void;
        sortableStyle?: React.CSSProperties;
        sortableAttributes?: Record<string, any>;
        isDragging?: boolean;
        isDraggable?: boolean;
    }) {

    const context = useAdminContext();
    const sidePanelCtrl = context.sidePanelController;
    const { t } = useTranslation();

    const onCheckedChange = useCallback((checked: boolean) => {
        selectionController?.toggleEntitySelection(entity, checked);
    }, [entity, selectionController?.toggleEntitySelection]);

    const hasActions = actions.length > 0;
    const hasCollapsedActions = actions.some(a => a.collapsed || a.collapsed === undefined);

    const collapsedActions = actions.filter(a => a.collapsed || a.collapsed === undefined);
    const uncollapsedActions = actions.filter(a => a.collapsed === false);
    const enableLocalChangesBackup = collection ? getLocalChangesBackup(collection) : false;
    const hasDraft = enableLocalChangesBackup ? getEntityFromCache(path + "/" + entity.id) : false;
    const iconSize = "small" as const;

    const content = (
        <div
            className={cls(
                "h-full flex items-center justify-center flex-col z-10",
                isSelected
                    ? "bg-surface-accent-50 dark:bg-surface-accent-900"
                    : "bg-surface-50/90 dark:bg-surface-900/90",
                frozen ? "sticky left-0" : ""
            )}
            onClick={useCallback((event: React.MouseEvent) => {
                event.stopPropagation();
            }, [])}
            style={{
                width,
                position: frozen ? "sticky" : "initial",
                left: frozen ? 0 : "initial",
                contain: "strict"
            }}>

            {(hasActions || selectionEnabled) &&
                <div className="flex items-center justify-center gap-0.5">

                    {uncollapsedActions.map((action, index) => {
                        const isEditAction = action.key === "edit";
                        const tooltip = isEditAction && hasDraft ? t("unsaved_local_changes") : action.name;

                        let iconButton = <IconButton
                            onClick={(event: MouseEvent) => {
                                event.stopPropagation();
                                action.onClick({
                                    view: "collection",
                                    entity,
                                    path,
                                    collection,
                                    context,
                                    sidePanelController: sidePanelCtrl,
                                    selectionController,
                                    highlightEntity,
                                    unhighlightEntity,
                                    onCollectionChange,
                                    openEntityMode: openEntityMode ?? collection?.openEntityMode
                                });
                            }}
                            size={iconSize}>
                            {getIcon(action.icon, undefined, undefined, "smallest")}
                        </IconButton>;
                        if (isEditAction && hasDraft) {
                            iconButton = (
                                <Badge color={"warning"}>
                                    {iconButton}
                                </Badge>
                            );
                        }
                        return (
                            <Tooltip key={index}
                                title={tooltip}
                                asChild={true}>
                                {iconButton}
                            </Tooltip>
                        );
                    })}

                    {hasCollapsedActions &&
                        <Menu
                            trigger={<IconButton
                                size={iconSize}>
                                <MoreVerticalIcon/>
                            </IconButton>}>
                            {collapsedActions.map((action, index) => (
                                <MenuItem
                                    key={index}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        action.onClick({
                                            view: "collection",
                                            entity,
                                            path,
                                            collection,
                                            context,
                                            sidePanelController: sidePanelCtrl,
                                            selectionController,
                                            highlightEntity,
                                            unhighlightEntity,
                                            onCollectionChange,
                                            openEntityMode: openEntityMode ?? collection?.openEntityMode
                                        });
                                    }}>
                                    {getIcon(action.icon, undefined, undefined, "smallest")}
                                    {action.name}
                                </MenuItem>
                            ))}
                        </Menu>
                    }

                    {selectionEnabled &&
                        <Tooltip title={`Select ${entity.id}`}>
                            <Checkbox
                                size={"smallest"}
                                checked={Boolean(isSelected)}
                                onCheckedChange={onCheckedChange}
                            />
                        </Tooltip>}

                </div>}

            {!hideId && size !== "xs" && (
                <div
                    className="w-[138px] overflow-hidden truncate font-mono text-xs text-text-secondary dark:text-text-secondary-dark max-w-full text-ellipsis px-2 align-center justify-center flex items-center gap-1"
                    onClick={(event) => {
                        event.stopPropagation();
                    }}>
                    <span className="min-w-0 truncate text-center">
                        {entity
                            ? entity.id
                            : <Skeleton/>
                        }
                    </span>
                </div>
            )}

        </div>
    );

    // Wrap with sortable outer div when sortable props are provided
    // Remove tabIndex from attributes to avoid capturing focus before cell content
    if (sortableNodeRef) {
        const { tabIndex: _tabIndex, ...sortableAttrsWithoutTabIndex } = sortableAttributes ?? {};
        return (
            <div
                ref={sortableNodeRef}
                style={sortableStyle}
                className={cls(
                    "flex-shrink-0",
                    frozen && "sticky left-0 z-10 bg-white dark:bg-surface-900"
                )}
                {...sortableAttrsWithoutTabIndex}
            >
                {content}
            </div>
        );
    }

    return content;

};
