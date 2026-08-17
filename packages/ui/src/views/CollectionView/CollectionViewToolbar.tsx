"use client";
import React, { useCallback, useState } from "react";
import { LayoutList, Table2, LayoutGrid, Kanban, Settings2 } from "lucide-react";
import { iconSize } from "../../icons/Icon";
import { SearchBar } from "../../components/SearchBar";
import { Popover } from "../../components/Popover";
import { ToggleButtonGroup } from "../../components/ToggleButtonGroup";
import type { ToggleButtonOption } from "../../components/ToggleButtonGroup";
import { Typography } from "../../components/Typography";
import { Select, SelectItem } from "../../components/Select";
import { IconButton } from "../../components/IconButton";
import { cls } from "../../util";
import type { CollectionViewMode, CollectionViewSize, KanbanPropertyOption } from "./CollectionViewTypes";

/**
 * Props for the {@link CollectionViewToolbar} component.
 * @group Collection View
 */
export type CollectionViewToolbarProps = {
    viewMode: CollectionViewMode;
    onViewModeChange?: (mode: CollectionViewMode) => void;
    enabledViews?: CollectionViewMode[];
    /**
     * Custom view modes, supplying the label and icon for their switcher
     * entries. Without these an `enabledViews` key outside the four built-ins
     * has no label and no icon to draw.
     */
    customViews?: { key: string, name: string, icon?: React.ReactNode }[];
    size?: CollectionViewSize;
    onSizeChange?: (size: CollectionViewSize) => void;
    searchString?: string;
    onSearchChange?: (search?: string) => void;
    loading?: boolean;
    actionsStart?: React.ReactNode;
    actionsEnd?: React.ReactNode;
    compact?: boolean;
    kanbanPropertyOptions?: KanbanPropertyOption[];
    selectedKanbanProperty?: string;
    onKanbanPropertyChange?: (property: string) => void;
};

const VIEW_MODE_ICONS: Record<string, React.ReactNode> = {
    list: <LayoutList size={iconSize.small} />,
    table: <Table2 size={iconSize.small} />,
    cards: <LayoutGrid size={iconSize.small} />,
    kanban: <Kanban size={iconSize.small} />,
};

const VIEW_MODE_LABELS: Record<string, string> = {
    list: "List",
    table: "Table",
    cards: "Cards",
    kanban: "Board",
};

const SIZE_LABELS: Record<CollectionViewSize, string> = {
    xs: "Extra Small",
    s: "Small",
    m: "Medium",
    l: "Large",
    xl: "Extra Large",
};

/**
 * Toolbar for the headless CollectionView.
 *
 * Renders a search bar, view mode toggle (popover with toggle button group),
 * optional size selector, optional kanban property selector, and action slots.
 *
 * @group Collection View
 */
export function CollectionViewToolbar({
    viewMode,
    onViewModeChange,
    enabledViews = ["list", "table", "cards", "kanban"],
    customViews,
    size = "m",
    onSizeChange,
    searchString,
    onSearchChange,
    loading,
    actionsStart,
    actionsEnd,
    compact,
    kanbanPropertyOptions,
    selectedKanbanProperty,
    onKanbanPropertyChange,
}: CollectionViewToolbarProps) {
    const [popoverOpen, setPopoverOpen] = useState(false);

    // A key outside the four built-ins takes its label and icon from the
    // custom view that declared it; without one it falls back to the key
    // itself and the list glyph, so an entry is never blank.
    const viewOptions: ToggleButtonOption<CollectionViewMode>[] = enabledViews.map((mode) => {
        const custom = customViews?.find((entry) => entry.key === mode);
        return {
            value: mode,
            label: VIEW_MODE_LABELS[mode] ?? custom?.name ?? mode,
            icon: VIEW_MODE_ICONS[mode] ?? custom?.icon ?? <LayoutList size={iconSize.small} />,
        };
    });

    const handleViewModeChange = useCallback(
        (mode: CollectionViewMode) => {
            onViewModeChange?.(mode);
        },
        [onViewModeChange]
    );

    const handleSizeChange = useCallback(
        (value: string) => {
            onSizeChange?.(value as CollectionViewSize);
        },
        [onSizeChange]
    );

    const handleKanbanPropertyChange = useCallback(
        (value: string) => {
            onKanbanPropertyChange?.(value);
        },
        [onKanbanPropertyChange]
    );

    const showViewToggle = onViewModeChange && enabledViews.length > 1;
    const showSizeSelector = onSizeChange && viewMode !== "kanban";
    const showKanbanSelector =
        kanbanPropertyOptions &&
        kanbanPropertyOptions.length > 0 &&
        viewMode === "kanban" &&
        onKanbanPropertyChange;
    const showPopover = showViewToggle || showSizeSelector || showKanbanSelector;

    return (
        <div
            className={cls(
                "flex items-center gap-2 px-2 flex-shrink-0",
                "border-b border-surface-200 dark:border-surface-800",
                compact ? "py-0.5 gap-1" : "py-1"
            )}
        >
            {actionsStart}

            {onSearchChange && (
                <SearchBar
                    onTextSearch={onSearchChange}
                    size="small"
                    initialValue={searchString}
                    loading={loading}
                    expandable
                />
            )}

            <div className="flex-1" />

            {actionsEnd}

            {showPopover && (
                <Popover
                    open={popoverOpen}
                    onOpenChange={setPopoverOpen}
                    side="bottom"
                    align="end"
                    trigger={
                        <IconButton
                            size="small"
                            onClick={() => setPopoverOpen((prev) => !prev)}
                        >
                            <Settings2 size={iconSize.small} />
                        </IconButton>
                    }
                >
                    <div className="p-3 min-w-[200px] flex flex-col gap-3">
                        {showViewToggle && (
                            <div className="flex flex-col gap-1">
                                <Typography
                                    variant="caption"
                                    color="secondary"
                                    className="font-medium uppercase tracking-wider"
                                >
                                    View
                                </Typography>
                                <ToggleButtonGroup<CollectionViewMode>
                                    value={viewMode}
                                    onValueChange={handleViewModeChange}
                                    options={viewOptions}
                                />
                            </div>
                        )}

                        {showSizeSelector && (
                            <div className="flex flex-col gap-1">
                                <Typography
                                    variant="caption"
                                    color="secondary"
                                    className="font-medium uppercase tracking-wider"
                                >
                                    Size
                                </Typography>
                                <Select
                                    value={size}
                                    onValueChange={handleSizeChange}
                                    size="small"
                                >
                                    {(Object.keys(SIZE_LABELS) as CollectionViewSize[]).map(
                                        (sizeKey) => (
                                            <SelectItem key={sizeKey} value={sizeKey}>
                                                {SIZE_LABELS[sizeKey]}
                                            </SelectItem>
                                        )
                                    )}
                                </Select>
                            </div>
                        )}

                        {showKanbanSelector && (
                            <div className="flex flex-col gap-1">
                                <Typography
                                    variant="caption"
                                    color="secondary"
                                    className="font-medium uppercase tracking-wider"
                                >
                                    Group by
                                </Typography>
                                <Select
                                    value={selectedKanbanProperty}
                                    onValueChange={handleKanbanPropertyChange}
                                    size="small"
                                >
                                    {kanbanPropertyOptions.map((option) => (
                                        <SelectItem key={option.key} value={option.key}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </Select>
                            </div>
                        )}
                    </div>
                </Popover>
            )}
        </div>
    );
}
