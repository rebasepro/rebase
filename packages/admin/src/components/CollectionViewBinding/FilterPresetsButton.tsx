import React, { useCallback, useMemo } from "react";
import { CheckIcon, ChevronsUpDownIcon, cls, FilterChip, Menu, MenuItem, Tooltip } from "@rebasepro/ui";
import type { FilterValues, FilterPreset, OrderByTuple } from "@rebasepro/types";
import { normalizeOrderBy } from "@rebasepro/common";
import type { EntityTableController, PropertyPath } from "@rebasepro/admin-types";

export interface FilterPresetsButtonProps<M extends Record<string, unknown>> {
    // Matches `admin.filterPresets`, which is keyed by property path — the
    // component is fed straight from the collection.
    filterPresets: FilterPreset<PropertyPath<M>>[];
    tableController: EntityTableController<M>;
    compact?: boolean;
}

/**
 * Maximum number of presets shown as inline toggle chips before the
 * rest are collapsed into an overflow menu.
 */
const MAX_VISIBLE_PRESETS = 4;

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
function generateLabel(filterValues: FilterValues<string>): string {
    const keys = Object.keys(filterValues);
    if (keys.length === 0) return "Filter";
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

// ─── Overflow Menu ──────────────────────────────────────────────────

interface OverflowMenuProps {
    presets: { preset: FilterPreset<string>; originalIndex: number }[];
    activeSet: Set<number>;
    onToggle: (index: number) => void;
}

function OverflowMenu({ presets, activeSet, onToggle }: OverflowMenuProps) {
    const activeCount = presets.filter(p => activeSet.has(p.originalIndex)).length;

    const trigger = (
        <FilterChip
            active={activeCount > 0}
            icon={<ChevronsUpDownIcon size={12} />}
        >
            +{presets.length}
        </FilterChip>
    );

    return (
        <Menu trigger={trigger} side="bottom" align="start">
            <div className="min-w-[180px] max-w-[300px] max-h-[320px] overflow-y-auto">
                {presets.map(({ preset, originalIndex }) => {
                    const rawLabel = preset.label ?? generateLabel(preset.filterValues as FilterValues<string>);
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
 */
export function FilterPresetsButton<M extends Record<string, unknown>>({
    filterPresets,
    tableController,
    compact
}: FilterPresetsButtonProps<M>) {

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

    // ── Guard (after hooks to preserve Rules of Hooks) ──────────────
    if (!filterPresets.length || !tableController.setFilterValues) return null;

    // ── Split visible vs overflow ───────────────────────────────────
    const maxVisible = compact ? 2 : MAX_VISIBLE_PRESETS;
    const needsOverflow = filterPresets.length > maxVisible;
    const visibleCount = needsOverflow ? maxVisible - 1 : filterPresets.length;

    const visiblePresets = filterPresets.slice(0, visibleCount);
    const overflowPresets = needsOverflow
        ? filterPresets.slice(visibleCount).map((preset, i) => ({
            preset: preset as FilterPreset<string>,
            originalIndex: visibleCount + i
        }))
        : [];

    const hasOverflow = overflowPresets.length > 0;

    return (
        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            {/* Scrollable chip area — on narrow screens chips scroll,
                on desktop there's enough space so no scroll occurs.
                py-0.5 gives the inset shadow breathing room inside the clip area. */}
            <div
                className="flex items-center gap-1 min-w-0 overflow-x-auto py-0.5"
                style={{ scrollbarWidth: "none" }}
            >
                {visiblePresets.map((preset, index) => {
                    const rawLabel = preset.label ?? generateLabel(preset.filterValues as FilterValues<string>);
                    const { display, truncated } = truncateLabel(rawLabel);
                    const active = activeSet.has(index);

                    const chip = (
                        <FilterChip
                            key={index}
                            active={active}
                            onClick={() => handleToggle(index)}
                            size="small"
                        >
                            {display}
                        </FilterChip>
                    );

                    if (truncated) {
                        return <Tooltip key={index} title={rawLabel}>{chip}</Tooltip>;
                    }
                    return chip;
                })}
            </div>

            {/* Overflow button — always pinned outside the scroll area */}
            {hasOverflow && (
                <OverflowMenu
                    presets={overflowPresets}
                    activeSet={activeSet}
                    onToggle={handleToggle}
                />
            )}
        </div>
    );
}
