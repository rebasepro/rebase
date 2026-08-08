
import React, { useMemo } from "react";
import { CollectionSize, ViewMode } from "@rebasepro/admin-types";
import {
    Button,
    ColumnsIcon,
    iconSize,
    KanbanIcon,
    LayoutGridIcon,
    ListIcon,
    Popover,
    Select,
    SelectItem,
    TableIcon,
    ToggleButtonGroup,
    ToggleButtonOption
} from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

export type KanbanPropertyOption = {
    key: string;
    label: string;
};

export type ViewModeToggleProps = {
    viewMode?: ViewMode;
    onViewModeChange?: (mode: ViewMode) => void;
    /**
     * Which view modes are enabled for this collection.
     * Only these modes will appear in the toggle.
     * Defaults to all three: ["table", "cards", "kanban"].
     */
    enabledViews?: ViewMode[];
    /**
     * Current size for card/table views
     */
    size?: CollectionSize;
    /**
     * Callback when size changes
     */
    onSizeChanged?: (size: CollectionSize) => void;
    /**
     * Controlled open state for the popover
     */
    open?: boolean;
    /**
     * Callback when popover open state changes
     */
    onOpenChange?: (open: boolean) => void;
    /**
     * Available properties that can be used for kanban columns (enum properties)
     */
    kanbanPropertyOptions?: KanbanPropertyOption[];
    /**
     * Currently selected property for kanban columns
     */
    selectedKanbanProperty?: string;
    /**
     * Callback when the kanban column property changes
     */
    onKanbanPropertyChange?: (property: string) => void;
}

const ALL_VIEW_MODES: ViewMode[] = ["list", "table", "cards", "kanban"];

export function ViewModeToggle({
    viewMode = "table",
    onViewModeChange,
    enabledViews = ALL_VIEW_MODES,
    size,
    onSizeChanged,
    open,
    onOpenChange,
    kanbanPropertyOptions,
    selectedKanbanProperty,
    onKanbanPropertyChange
}: ViewModeToggleProps) {

    const { t } = useTranslation();


    // Get icon for current view mode.
    //
    // `small` on the trigger, matching the filters button beside it — the two
    // labelled buttons open the toolbar together, and at 16 against its 20 this
    // one read as the smaller of the pair. The options inside the popover stay
    // at `smallest`, which is the size every other menu icon uses.
    const getViewModeIcon = () => {
        if (viewMode === "kanban") return <KanbanIcon size={iconSize.small}/>;
        if (viewMode === "cards") return <LayoutGridIcon size={iconSize.small}/>;
        if (viewMode === "table") return <TableIcon size={iconSize.small}/>;
        return <ListIcon size={iconSize.small}/>;
    };

    const getViewModeName = () => {
        if (viewMode === "kanban") return t("board");
        if (viewMode === "cards") return t("cards");
        if (viewMode === "table") return t("table_view_mode");
        return t("list");
    };

    const showSizeSelector = size && onSizeChanged && (viewMode === "list" || viewMode === "table" || viewMode === "cards");
    const showKanbanPropertySelector = viewMode === "kanban" &&
        kanbanPropertyOptions &&
        kanbanPropertyOptions.length > 0 &&
        onKanbanPropertyChange;

    // Build toggle options
    const viewModeOptions: ToggleButtonOption<ViewMode>[] = useMemo(() => {
        const allOptions: ToggleButtonOption<ViewMode>[] = [
            {
                value: "list",
                label: t("list"),
                icon: <ListIcon size={iconSize.smallest}/>
            },
            {
                value: "table",
                label: t("table_view_mode"),
                icon: <TableIcon size={iconSize.smallest}/>
            },
            {
                value: "cards",
                label: t("cards"),
                icon: <LayoutGridIcon size={iconSize.smallest}/>
            },
            {
                value: "kanban",
                label: t("board"),
                icon: <KanbanIcon size={iconSize.smallest}/>
            }
        ];

        return allOptions;
    }, [t]);

    // ── Guard (after hooks to preserve Rules of Hooks) ──────────────
    if (!onViewModeChange) {
        return null;
    }

    return (
        <div className="overflow-visible">
            <Popover
                open={open}
                onOpenChange={onOpenChange}
                modal={false}
                trigger={
                    <Button size="small">
                        {getViewModeIcon()}
                        <span className="ml-1 text-sm">{getViewModeName()}</span>
                    </Button>
                }
            >
                <div className="p-3 flex flex-col gap-3 min-w-[240px]">
                    {/* View mode toggle using ToggleButtonGroup */}
                    {viewModeOptions.length > 1 && (
                        <ToggleButtonGroup
                            value={viewMode}
                            onValueChange={onViewModeChange}
                            options={viewModeOptions}
                        />
                    )}

                    {/* Size selector */}
                    {showSizeSelector && (
                        <div className="flex flex-row items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
                                <ColumnsIcon size={iconSize.smallest}/>
                                <span>{t("size_label")}</span>
                            </div>
                            <Select
                                value={size}
                                size="small"
                                className="w-20"
                                onValueChange={(v) => onSizeChanged?.(v as CollectionSize)}
                                renderValue={(v) => <span className="font-medium">{v.toUpperCase()}</span>}
                            >
                                {["xs", "s", "m", "l", "xl"].map((s) => (
                                    <SelectItem key={s} value={s} className="font-medium text-center">
                                        {s.toUpperCase()}
                                    </SelectItem>
                                ))}
                            </Select>
                        </div>
                    )}

                    {/* KanbanIcon column property selector */}
                    {showKanbanPropertySelector && (
                        <div className="flex flex-row items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
                                <KanbanIcon size={iconSize.smallest}/>
                                <span>{t("group_by")}</span>
                            </div>
                            <Select
                                value={selectedKanbanProperty}
                                size="small"
                                className="w-32"
                                onValueChange={(v) => onKanbanPropertyChange?.(v)}
                                renderValue={(v) => {
                                    const option = kanbanPropertyOptions?.find(o => o.key === v);
                                    return <span className="font-medium truncate">{option?.label ?? v}</span>;
                                }}
                            >
                                {kanbanPropertyOptions?.map((option) => (
                                    <SelectItem key={option.key} value={option.key}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </Select>
                        </div>
                    )}
                </div>
            </Popover>
        </div>
    );
}
