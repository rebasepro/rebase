import type { SnapshotCollection } from "@rebasepro/types";
import type { SnapshotAction } from "@rebasepro/types";
import React, { MouseEvent, useCallback } from "react";

import { CollectionSize, Snapshot, SelectionController } from "@rebasepro/types";
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
import { useTranslation } from "@rebasepro/core";
import { getSnapshotFromCache } from "@rebasepro/core";
import { getLocalChangesBackup } from "@rebasepro/common";
import { useCMSContext } from "../../index";

/**
 *
 * @param snapshot
 * @param width
 * @param frozen
 * @param isSelected
 * @param selectionEnabled
 * @param size
 * @param toggleSnapshotSelection
 * @param hideId
 *
 * @group Collection components
 */
export const SnapshotCollectionRowActions = function SnapshotCollectionRowActions({
    snapshot,
    collection,
    path,
    width,
    frozen,
    isSelected,
    selectionEnabled,
    size,
    highlightSnapshot,
    onCollectionChange,
    unhighlightSnapshot,
    actions = [],
    hideId,
    selectionController,
    openSnapshotMode,
    sortableNodeRef,
    sortableStyle,
    sortableAttributes,
    isDragging,
    isDraggable
}:
    {
        snapshot: Snapshot<any>,
        collection?: SnapshotCollection<any>,
        path?: string,
        width: number,
        frozen?: boolean,
        size: CollectionSize,
        isSelected?: boolean,
        selectionEnabled?: boolean,
        actions?: SnapshotAction[],
        hideId?: boolean,
        onCollectionChange?: () => void,
        selectionController?: SelectionController;
        highlightSnapshot?: (snapshot: Snapshot<any>) => void;
        unhighlightSnapshot?: (snapshot: Snapshot<any>) => void;
        openSnapshotMode: "side_panel" | "full_screen" | "split" | "dialog";
        // Sortable props for dnd-kit integration
        sortableNodeRef?: (node: HTMLElement | null) => void;
        sortableStyle?: React.CSSProperties;
        sortableAttributes?: Record<string, any>;
        isDragging?: boolean;
        isDraggable?: boolean;
    }) {


    const context = useCMSContext();
    const sideSnapshotCtrl = context.sideSnapshotController;
    const { t } = useTranslation();

    const onCheckedChange = useCallback((checked: boolean) => {
        selectionController?.toggleSnapshotSelection(snapshot, checked);
    }, [snapshot, selectionController?.toggleSnapshotSelection]);

    const hasActions = actions.length > 0;
    const hasCollapsedActions = actions.some(a => a.collapsed || a.collapsed === undefined);

    const collapsedActions = actions.filter(a => a.collapsed || a.collapsed === undefined);
    const uncollapsedActions = actions.filter(a => a.collapsed === false);
    const enableLocalChangesBackup = collection ? getLocalChangesBackup(collection) : false;
    const hasDraft = enableLocalChangesBackup ? getSnapshotFromCache(path + "/" + snapshot.id) : false;
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
                                    snapshot,
                                    path,
                                    collection,
                                    context,
                                    sideSnapshotController: sideSnapshotCtrl,
                                    selectionController,
                                    highlightSnapshot,
                                    unhighlightSnapshot,
                                    onCollectionChange,
                                    openSnapshotMode: openSnapshotMode ?? collection?.openSnapshotMode
                                });
                            }}
                            size={iconSize}>
                            {action.icon}
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
                                            snapshot,
                                            path,
                                            collection,
                                            context,
                                            sideSnapshotController: sideSnapshotCtrl,
                                            selectionController,
                                            highlightSnapshot,
                                            unhighlightSnapshot,
                                            onCollectionChange,
                                            openSnapshotMode: openSnapshotMode ?? collection?.openSnapshotMode
                                        });
                                    }}>
                                    {action.icon}
                                    {action.name}
                                </MenuItem>
                            ))}
                        </Menu>
                    }

                    {selectionEnabled &&
                        <Tooltip title={`Select ${snapshot.id}`}>
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
                        {snapshot
                            ? snapshot.id
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
