
import React, { useMemo } from "react";
import { CollectionCustomView, CollectionSize, ViewMode } from "@rebasepro/admin-types";
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
import { getIcon, useTranslation } from "@rebasepro/app";

export type KanbanPropertyOption = {
    key: string;
    label: string;
};

export type ViewModeToggleProps = {
    viewMode?: ViewMode;
    onViewModeChange?: (mode: ViewMode) => void;
    /**
     * Which view modes are enabled for this collection, in the order they
     * should appear. Only these modes appear in the toggle.
     * Defaults to the four built-ins.
     */
    enabledViews?: ViewMode[];
    /**
     * Custom views this collection can render, already resolved. Their `key`s
     * appear in `enabledViews` alongside the built-ins, and each supplies the
     * name and icon its entry is drawn with.
     */
    customViews?: CollectionCustomView<any>[];
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
    customViews,
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
    const activeCustomView = customViews?.find((v) => v.key === viewMode);

    const getViewModeIcon = () => {
        if (activeCustomView) {
            // Falls back to the list glyph rather than rendering nothing, so a
            // custom view that declared no icon still gets a trigger the same
            // width as every other mode's.
            return getIcon(activeCustomView.icon, undefined, undefined, "small")
                ?? <ListIcon size={iconSize.small}/>;
        }
        if (viewMode === "kanban") return <KanbanIcon size={iconSize.small}/>;
        if (viewMode === "cards") return <LayoutGridIcon size={iconSize.small}/>;
        if (viewMode === "table") return <TableIcon size={iconSize.small}/>;
        return <ListIcon size={iconSize.small}/>;
    };

    const getViewModeName = () => {
        // The declared name, untranslated — it is app-supplied copy, and there
        // is no key for it in the admin's bundles.
        if (activeCustomView) return activeCustomView.name;
        if (viewMode === "kanban") return t("board");
        if (viewMode === "cards") return t("cards");
        if (viewMode === "table") return t("table_view_mode");
        return t("list");
    };

    const showSizeSelector = size && onSizeChanged &&
        (activeCustomView
            ? activeCustomView.sizeable
            : viewMode === "list" || viewMode === "table" || viewMode === "cards");
    const showKanbanPropertySelector = viewMode === "kanban" &&
        kanbanPropertyOptions &&
        kanbanPropertyOptions.length > 0 &&
        onKanbanPropertyChange;

    // Build toggle options, in `enabledViews` order.
    //
    // This used to return all four built-ins unconditionally: `enabledViews`
    // was destructured and then read nowhere, so a collection that asked for
    // `["list", "table"]` still offered cards and kanban, and picking one
    // rendered it. Honouring the prop is what the doc comment always claimed,
    // and it is what lets a custom-only `enabledViews` hide the switcher.
    const viewModeOptions: ToggleButtonOption<ViewMode>[] = useMemo(() => {
        const builtIns: Record<string, { label: string, icon: React.ReactNode }> = {
            list: { label: t("list"), icon: <ListIcon size={iconSize.smallest}/> },
            table: { label: t("table_view_mode"), icon: <TableIcon size={iconSize.smallest}/> },
            cards: { label: t("cards"), icon: <LayoutGridIcon size={iconSize.smallest}/> },
            kanban: { label: t("board"), icon: <KanbanIcon size={iconSize.smallest}/> }
        };

        return enabledViews.flatMap((mode) => {
            const builtIn = builtIns[mode];
            if (builtIn) return [{ value: mode, ...builtIn }];

            const custom = customViews?.find((v) => v.key === mode);
            // An `enabledViews` entry naming nothing registered is skipped
            // rather than drawn as a nameless button.
            if (!custom) return [];
            return [{
                value: mode,
                label: custom.name,
                icon: getIcon(custom.icon, undefined, undefined, "smallest")
                    ?? <ListIcon size={iconSize.smallest}/>
            }];
        });
    }, [t, enabledViews, customViews]);

    // ── Guard (after hooks to preserve Rules of Hooks) ──────────────
    if (!onViewModeChange) {
        return null;
    }

    // Nothing to switch between and nothing else in the popover: a trigger
    // that opens an empty panel is worse than no trigger. The size and
    // group-by selectors live behind the same button, so a single-mode
    // collection that still has one of those keeps it.
    if (viewModeOptions.length <= 1 && !showSizeSelector && !showKanbanPropertySelector) {
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
