import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, cls, FilterChip, Menu, MenuItem, Tooltip } from "@rebasepro/ui";
import type { FilterValues, OrderByTuple } from "@rebasepro/types";
import { normalizeOrderBy } from "@rebasepro/common";
import { useTranslation } from "@rebasepro/app";
import type { EntityTableController, PropertyPath, FilterPreset } from "@rebasepro/cms-types";

export interface FilterPresetsButtonProps<M extends Record<string, unknown>> {
    // Matches `admin.filterPresets`, which is keyed by property path — the
    // component is fed straight from the collection.
    filterPresets: FilterPreset<PropertyPath<M>>[];
    tableController: EntityTableController<M>;
    /**
     * No longer read: how many chips show is decided by the room the toolbar
     * has. Kept so existing callers still type-check.
     */
    compact?: boolean;
}

/** The gap between chips (`gap-1`), which the fit has to count. */
const CHIP_GAP = 4;

/** Max characters for a chip label before truncation. */
const MAX_LABEL_LENGTH = 22;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Deep equality without JSON.stringify.
 * Handles primitives, arrays, Dates, and plain objects recursively.
 */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.every((v, i) => deepEqual(v, b[i]));
    }
    if (typeof a === "object" && typeof b === "object") {
        const aKeys = Object.keys(a as Record<string, unknown>);
        const bKeys = Object.keys(b as Record<string, unknown>);
        if (aKeys.length !== bKeys.length) return false;
        return aKeys.every(k =>
            deepEqual(
                (a as Record<string, unknown>)[k],
                (b as Record<string, unknown>)[k]
            )
        );
    }
    return false;
}

/**
 * Check if a preset's filters are a subset of the controller's
 * current filter values (key-by-key deep comparison on the tuples).
 */
function isPresetActive(
    preset: FilterPreset<string>,
    controllerFilters: Record<string, unknown> | undefined
): boolean {
    if (!controllerFilters) return false;
    const entries = Object.entries(preset.filterValues);
    if (entries.length === 0) return false;
    for (const [key, presetTuple] of entries) {
        const controllerTuple = controllerFilters[key];
        if (!controllerTuple || !presetTuple) return false;
        if (!deepEqual(presetTuple, controllerTuple)) return false;
    }
    return true;
}

/**
 * Generate a human-readable label from filter keys when no explicit label is provided.
 */
function generateLabel(filterValues: FilterValues<string>, emptyLabel: string): string {
    const keys = Object.keys(filterValues);
    if (keys.length === 0) return emptyLabel;
    if (keys.length === 1) return keys[0].replace(/_/g, " ");
    if (keys.length === 2) return keys.map(k => k.replace(/_/g, " ")).join(" + ");
    return `${keys[0].replace(/_/g, " ")} +${keys.length - 1}`;
}

/**
 * Truncate a label if it exceeds MAX_LABEL_LENGTH.
 */
function truncateLabel(label: string): { display: string; truncated: boolean } {
    if (label.length <= MAX_LABEL_LENGTH) return { display: label,
truncated: false };
    return { display: label.slice(0, MAX_LABEL_LENGTH - 1) + "…",
truncated: true };
}

/**
 * How many of the chips, in order, fit in `available` — leaving room for the
 * overflow trigger whenever not all of them do.
 */
function fitCount(chips: number[], overflow: number, available: number): number {
    const total = chips.reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_GAP : 0), 0);
    if (total <= available) return chips.length;
    let used = 0;
    for (let k = 0; k < chips.length; k++) {
        const next = used + (k > 0 ? CHIP_GAP : 0) + chips[k];
        if (next + CHIP_GAP + overflow > available) return k;
        used = next;
    }
    return chips.length;
}

/**
 * The room left at the end of `parent` after its last child — what `element`
 * could still grow into. The chips are sized to what they show, so the room
 * they have is their own width plus this, not their width alone.
 */
function freeSpaceAfter(element: HTMLElement, parent: HTMLElement | null): number {
    if (!parent) return 0;
    const last = parent.lastElementChild;
    if (!last) return 0;
    const marginEnd = last === element ? 0 : parseFloat(getComputedStyle(last).marginRight) || 0;
    return Math.max(0, parent.getBoundingClientRect().right - last.getBoundingClientRect().right - marginEnd);
}

// ─── Overflow Menu ──────────────────────────────────────────────────

interface OverflowMenuProps {
    presets: { preset: FilterPreset<string>; originalIndex: number }[];
    activeSet: Set<number>;
    onToggle: (index: number) => void;
    /**
     * What the trigger says. Defaults to the number of presets behind it
     * ("+3"), which is right beside the inline chips and nowhere else.
     */
    triggerLabel?: string;
}

function OverflowMenu({ presets, activeSet, onToggle, triggerLabel }: OverflowMenuProps) {
    const { t } = useTranslation();
    const activeCount = presets.filter(p => activeSet.has(p.originalIndex)).length;

    const trigger = (
        <FilterChip
            active={activeCount > 0}
            icon={<ChevronsUpDownIcon size={12} />}
            size="small"
        >
            {triggerLabel !== undefined
                ? <span className="truncate max-w-[9rem]">{triggerLabel}</span>
                : `+${presets.length}`}
        </FilterChip>
    );

    return (
        <Menu trigger={trigger} side="bottom" align="start">
            <div className="min-w-[180px] max-w-[300px] max-h-[320px] overflow-y-auto">
                {presets.map(({ preset, originalIndex }) => {
                    const rawLabel = preset.label ?? generateLabel(preset.filterValues as FilterValues<string>, t("filter"));
                    const active = activeSet.has(originalIndex);

                    return (
                        <MenuItem
                            key={originalIndex}
                            dense
                            onClick={() => onToggle(originalIndex)}
                            className={cls(active && "bg-primary/10 dark:bg-primary/20")}
                        >
                            <span className="flex items-center gap-2 w-full min-w-0">
                                {active && <CheckIcon size={14} className="text-primary shrink-0" />}
                                <span className={cls("truncate", active ? "text-primary font-medium" : "")}>
                                    {rawLabel}
                                </span>
                            </span>
                        </MenuItem>
                    );
                })}
            </div>
        </Menu>
    );
}

// ─── Main Component ─────────────────────────────────────────────────

/**
 * Filter Presets — displayed as inline toggle chips in the collection toolbar.
 *
 * Active state is **derived** from the controller's actual filter values,
 * not tracked locally. A chip is "active" when ALL of its filter entries
 * match the current controller state (deep value comparison, no JSON.stringify).
 *
 * This means:
 * - Toggling a preset on adds its filters to the controller.
 * - Toggling it off removes its filter keys.
 * - Changing filters via the dialog automatically deactivates unmatched chips.
 * - Clearing all filters deactivates all chips.
 * - Multiple presets can be active simultaneously.
 *
 * As many chips show as fit in the room the toolbar has, in order; the rest go
 * into a "+N" menu. With no room for even one, a single chip names the active
 * preset (or says "Presets") and opens them all. The component takes the
 * toolbar's free space, up to the width all its chips need, and adds nothing
 * to the toolbar's own width — so it is the presets that give way first, before
 * any control loses its label.
 */
export function FilterPresetsButton<M extends Record<string, unknown>>({
    filterPresets,
    tableController
}: FilterPresetsButtonProps<M>) {
    const { t } = useTranslation();

    // ── Derive active state from controller ─────────────────────────
    const activeSet = useMemo(() => {
        const set = new Set<number>();
        if (!filterPresets.length || !tableController.setFilterValues) return set;
        for (let i = 0; i < filterPresets.length; i++) {
            if (isPresetActive(
                filterPresets[i] as FilterPreset<string>,
                tableController.filterValues as Record<string, unknown> | undefined
            )) {
                set.add(i);
            }
        }
        return set;
    }, [filterPresets, tableController.filterValues, tableController.setFilterValues]);

    // ── Toggle handler ──────────────────────────────────────────────
    const handleToggle = useCallback((index: number) => {
        const preset = filterPresets[index] as FilterPreset<string>;
        const currentFilters = { ...(tableController.filterValues ?? {}) } as Record<string, [string, unknown]>;
        const wasActive = isPresetActive(preset, currentFilters);

        if (wasActive) {
            // Toggle OFF: remove this preset's filter keys
            for (const key of Object.keys(preset.filterValues)) {
                delete currentFilters[key];
            }
            // Re-apply overlapping keys from other still-active presets
            for (let i = 0; i < filterPresets.length; i++) {
                if (i === index) continue;
                const other = filterPresets[i] as FilterPreset<string>;
                if (isPresetActive(other, currentFilters)) {
                    Object.assign(currentFilters, other.filterValues);
                }
            }
        } else {
            // Toggle ON: merge this preset's filters on top
            Object.assign(currentFilters, preset.filterValues);
        }

        // Apply
        if (Object.keys(currentFilters).length === 0) {
            if (tableController.clearFilter) {
                tableController.clearFilter();
            } else {
                tableController.setFilterValues?.(
                    {} as FilterValues<Extract<keyof M, string> | (string & {})>
                );
            }
            tableController.setSortBy?.(undefined);
        } else {
            tableController.setFilterValues?.(
                currentFilters as FilterValues<Extract<keyof M, string> | (string & {})>
            );

            // Resolve sort: use the toggled preset's sort if toggling on,
            // otherwise find sort from remaining active presets
            if (!wasActive && preset.sort) {
                tableController.setSortBy?.(
                    normalizeOrderBy(preset.sort) as OrderByTuple<Extract<keyof M, string> | (string & {})>[]
                );
            } else if (wasActive) {
                let remainingSort: OrderByTuple[] | undefined;
                for (let i = 0; i < filterPresets.length; i++) {
                    if (i === index) continue;
                    const other = filterPresets[i] as FilterPreset<string>;
                    if (isPresetActive(other, currentFilters) && other.sort) {
                        remainingSort = normalizeOrderBy(other.sort);
                    }
                }
                tableController.setSortBy?.(
                    remainingSort as OrderByTuple<Extract<keyof M, string> | (string & {})>[] | undefined
                );
            }
        }
    }, [filterPresets, tableController]);

    // ── Fit: measure every chip once, and the room there is ─────────
    const labels = filterPresets.map(preset =>
        preset.label ?? generateLabel(preset.filterValues as FilterValues<string>, t("filter")));
    const activeLabels = labels.filter((_, i) => activeSet.has(i));
    const foldedLabel = activeLabels.length === 0
        ? t("filter_presets")
        : activeLabels.length === 1
            ? activeLabels[0]
            : `${activeLabels[0]} +${activeLabels.length - 1}`;
    const measureKey = labels.join("\u0000") + "\u0001" + foldedLabel;

    const wrapperRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const [fit, setFit] = useState<{
        available: number;
        chips: number[];
        overflow: number;
        folded: number;
    } | undefined>(undefined);

    useLayoutEffect(() => {
        const wrapper = wrapperRef.current;
        const measure = measureRef.current;
        if (!wrapper || !measure) return undefined;
        const parent = wrapper.parentElement;
        const read = () => {
            // The measuring row holds every chip, then a "+N" trigger, then
            // the folded trigger. Fractional widths, so a sum of them is not
            // a pixel short and the last chip clipped.
            const widths = Array.from(measure.children).map(c => c.getBoundingClientRect().width);
            const next = {
                available: Math.floor(wrapper.getBoundingClientRect().width + freeSpaceAfter(wrapper, parent)),
                chips: widths.slice(0, -2),
                overflow: widths[widths.length - 2] ?? 0,
                folded: widths[widths.length - 1] ?? 0
            };
            setFit(prev => prev
                && prev.available === next.available
                && prev.overflow === next.overflow
                && prev.folded === next.folded
                && prev.chips.length === next.chips.length
                && prev.chips.every((w, i) => w === next.chips[i])
                ? prev
                : next);
        };
        read();
        if (typeof ResizeObserver === "undefined") return undefined;
        // The wrapper for the room, the measuring row for the chips — which
        // change width when the labels do, or when the font finishes loading.
        // The group around it too: the wrapper is only as wide as what it
        // shows, so the room growing reaches it only through its parent.
        const observer = new ResizeObserver(read);
        observer.observe(wrapper);
        observer.observe(measure);
        if (parent) observer.observe(parent);
        return () => observer.disconnect();
    }, [measureKey]);

    // ── Guard (after hooks to preserve Rules of Hooks) ──────────────
    if (!filterPresets.length || !tableController.setFilterValues) return null;

    const allPresets = filterPresets.map((preset, originalIndex) => ({
        preset: preset as FilterPreset<string>,
        originalIndex
    }));

    // Before the first measurement, every chip: the layout effect runs again
    // before paint and narrows it.
    const visibleCount = fit ? fitCount(fit.chips, fit.overflow, fit.available) : filterPresets.length;
    // As wide as what is shown, and no wider: the room left over goes after
    // the controls that follow (the count), not into a gap before them.
    const shownWidth = fit
        ? Math.ceil(
            fit.chips.slice(0, visibleCount).reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_GAP : 0), 0)
            + (visibleCount > 0 && visibleCount < fit.chips.length ? CHIP_GAP + fit.overflow : 0))
        : undefined;

    return (
        <div
            ref={wrapperRef}
            // `width: 0` with `flex-grow`: the chips add nothing to the
            // toolbar's width (which would only make it scroll), and take the
            // room it has, up to what the chips shown need. Never narrower
            // than the folded chip. py-0.5 gives the inset focus ring room
            // inside the clip.
            className="relative flex items-center gap-1 grow shrink-0 overflow-hidden py-0.5"
            style={{ width: 0, maxWidth: shownWidth, minWidth: fit ? Math.ceil(fit.folded) : undefined }}
        >
            {visibleCount === 0
                ? <OverflowMenu
                    presets={allPresets}
                    activeSet={activeSet}
                    onToggle={handleToggle}
                    triggerLabel={foldedLabel}
                />
                : <>
                    {labels.slice(0, visibleCount).map((rawLabel, index) => {
                        const { display, truncated } = truncateLabel(rawLabel);
                        const chip = (
                            <FilterChip
                                key={index}
                                active={activeSet.has(index)}
                                onClick={() => handleToggle(index)}
                                size="small"
                            >
                                {display}
                            </FilterChip>
                        );
                        return truncated
                            ? <Tooltip key={index} title={rawLabel}>{chip}</Tooltip>
                            : chip;
                    })}
                    {visibleCount < filterPresets.length && (
                        <OverflowMenu
                            presets={allPresets.slice(visibleCount)}
                            activeSet={activeSet}
                            onToggle={handleToggle}
                        />
                    )}
                </>}

            {/* Every form at its natural width, out of sight and out of reach:
                what the fit is computed from. */}
            <div
                ref={measureRef}
                aria-hidden={true}
                inert={true}
                className="absolute left-0 top-0 invisible pointer-events-none flex items-center gap-1 w-max"
            >
                {labels.map((rawLabel, index) => (
                    <FilterChip key={index} size="small" tabIndex={-1}>
                        {truncateLabel(rawLabel).display}
                    </FilterChip>
                ))}
                <FilterChip size="small" tabIndex={-1} icon={<ChevronsUpDownIcon size={12}/>}>
                    +{filterPresets.length}
                </FilterChip>
                <FilterChip size="small" tabIndex={-1} icon={<ChevronsUpDownIcon size={12}/>}>
                    <span className="truncate max-w-[9rem]">{foldedLabel}</span>
                </FilterChip>
            </div>
        </div>
    );
}
