import { Button, Popover, Typography } from "@rebasepro/ui";
import { Filter } from "lucide-react";
import React, { useCallback, useState } from "react";
import {
    DatePreset,
    getDateRangeFromPreset,
    getInitialDateRange,
    loadDateRangePreference,
    saveDateRangePreference
} from "../utils/dates";
import { DatePickerWithRange } from "../components/DateRange";
import { DashboardFilterConfig, DataSource, FilterConfig, ParamFilter } from "../types";
import { FilterView } from "../components/FilterView";

import { paramHasValue } from "../utils/widgets";
import { getInitialParamFilters } from "../utils/filters";

interface UseFiltersStateViewParams {
    initialDateRange?: [Date | null, Date | null];
    initialParamFilters?: ParamFilter[];
    filters?: DashboardFilterConfig[];
    dashboardId?: string;
    dataSources?: DataSource[];
    onFilterUpdate?: (updatedFilter: FilterConfig) => void;
    onFilterRemove?: (removedFilter: FilterConfig) => void;
    onStartFilterPlacement?: (filter: FilterConfig) => void;
    onEndFilterPlacement?: () => void;
    onCreateFirstFilter?: () => void;
    includeFilters?: boolean;
}

function getRestoredDateRange(dashboardId?: string): { dateRange: [Date | null, Date | null], includeToday: boolean } {
    if (!dashboardId) return { dateRange: getInitialDateRange(), includeToday: false };
    const pref = loadDateRangePreference(dashboardId);
    if (!pref) return { dateRange: getInitialDateRange(), includeToday: false };
    if (pref.preset) {
        const range = getDateRangeFromPreset(pref.preset, pref.includeToday);
        return { dateRange: range, includeToday: pref.includeToday };
    }
    if (pref.from && pref.to) {
        return {
            dateRange: [new Date(pref.from), new Date(pref.to)],
            includeToday: pref.includeToday
        };
    }
    return { dateRange: getInitialDateRange(), includeToday: pref.includeToday };
}

export function useFiltersStateView({
    initialDateRange,
    initialParamFilters = [],
    filters = [],
    dashboardId,
    dataSources,
    onFilterUpdate,
    onFilterRemove,
    onStartFilterPlacement,
    onEndFilterPlacement,
    onCreateFirstFilter,
    includeFilters = true
}: UseFiltersStateViewParams) {

    const restored = React.useMemo(() => getRestoredDateRange(dashboardId), [dashboardId]);

    const [dateRange, setDateRangeRaw] = useState<[Date | null, Date | null]>(initialDateRange ?? restored.dateRange);
    const [includeToday, setIncludeTodayRaw] = useState<boolean>(restored.includeToday);
    const [currentPreset, setCurrentPreset] = useState<DatePreset | undefined>(
        dashboardId ? loadDateRangePreference(dashboardId)?.preset : undefined
    );
    const [paramFilters, setParamFilters] = useState<ParamFilter[]>(initialParamFilters);

    const setDateRange = useCallback((range: [Date | null, Date | null]) => {
        setDateRangeRaw(range);
        // When a custom date is picked (not via preset), save it
        if (dashboardId) {
            saveDateRangePreference(dashboardId, {
                from: range[0]?.toISOString(),
                to: range[1]?.toISOString(),
                includeToday,
            });
        }
    }, [dashboardId, includeToday]);

    const onPresetSelect = useCallback((preset: DatePreset) => {
        setCurrentPreset(preset);
        if (dashboardId) {
            saveDateRangePreference(dashboardId, {
                preset,
                includeToday,
            });
        }
    }, [dashboardId, includeToday]);

    const onIncludeTodayChange = useCallback((value: boolean) => {
        setIncludeTodayRaw(value);
        // Re-apply current preset with new includeToday value
        if (currentPreset) {
            const range = getDateRangeFromPreset(currentPreset, value);
            setDateRangeRaw(range);
            if (dashboardId) {
                saveDateRangePreference(dashboardId, {
                    preset: currentPreset,
                    includeToday: value,
                });
            }
        } else if (dashboardId) {
            // Save just the toggle change for custom ranges
            const pref = loadDateRangePreference(dashboardId);
            saveDateRangePreference(dashboardId, {
                ...pref,
                includeToday: value,
            });
        }
    }, [currentPreset, dashboardId]);

    // we make sure that param filters are always in sync with the filters
    const fixedParamFilters = getInitialParamFilters(filters ?? [])
        .map(filter => {
            const existingFilter = paramFilters.find(f => f.key === filter.key);
            return existingFilter ? {
                ...filter,
                value: existingFilter.value,
                operator: existingFilter.operator
            } : filter;
        })

    return {
        dateRange,
        setDateRange,
        includeToday,
        onIncludeTodayChange,
        onPresetSelect,
        paramFilters: fixedParamFilters,
        setParamFilters,
        filters
    }
}

export function DashboardFiltersBar({
    filters,
    paramFilters,
    setParamFilters,
    dashboardId,
    dataSources,
    onFilterUpdate,
    onFilterRemove,
    onStartFilterPlacement,
    onEndFilterPlacement,
    onCreateFirstFilter,
    includeFilters = true,
    dateRange,
    setDateRange,
    includeToday,
    onIncludeTodayChange,
    onPresetSelect
}: {
    filters: DashboardFilterConfig[];
    paramFilters: ParamFilter[];
    setParamFilters: (filters: ParamFilter[]) => void;
    dashboardId?: string;
    dataSources?: DataSource[];
    onFilterUpdate?: (updatedFilter: FilterConfig) => void;
    onFilterRemove?: (removedFilter: FilterConfig) => void;
    onStartFilterPlacement?: (filter: FilterConfig) => void;
    onEndFilterPlacement?: () => void;
    onCreateFirstFilter?: () => void;
    includeFilters?: boolean;
    dateRange: [Date | null, Date | null];
    setDateRange: (range: [Date | null, Date | null]) => void;
    includeToday?: boolean;
    onIncludeTodayChange?: (includeToday: boolean) => void;
    onPresetSelect?: (preset: DatePreset) => void;
}) {
    const paramsWithValue = paramFilters.filter(paramHasValue);
    const hasFilterValues = paramsWithValue.length > 0;
    const [popupOpen, setPopupOpen] = useState(false);

    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setPopupOpen(false);
                event.stopPropagation();
                event.preventDefault();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    return (
        <div className={"flex gap-2 items-center"}>

            {includeFilters && <Popover
                side={"bottom"}
                open={popupOpen}
                onOpenChange={setPopupOpen}
                align={"end"}
                modal={false}
                className={"rounded-xl"}
                trigger={
                    <Button
                        variant={"filled"}
                        color={"neutral"}
                        className={"rounded-xl"}>
                        <Filter size={"small"} color={hasFilterValues ? "primary" : undefined} />
                        {hasFilterValues ? `${paramsWithValue.length} filters` : "Filters"}
                    </Button>
                }>
                <div
                    className={"rounded-xl min-w-96 max-w-[600px] p-4 flex flex-col gap-2 text-text-primary dark:text-text-primary-dark"}>
                    <div className={"flex flex-col gap-2"}>
                        <Typography variant={"subtitle2"}>
                            Filters
                        </Typography>

                        {filters?.length === 0 && <>
                            <Typography variant={"body2"}>
                                Create filters in natural language in the chat UI
                            </Typography>
                            <Button
                                color={"neutral"}
                                onClick={() => {
                                    setPopupOpen(false);
                                    onCreateFirstFilter?.();
                                }}
                            >
                                Create your first filter
                            </Button>
                        </>}

                        {filters.map((filter) => {
                            const value = paramFilters.find(f => f.key === filter.key)?.value;
                            const operator = paramFilters.find(f => f.key === filter.key)?.operator;
                            const usedDataSources = ("dataSources" in filter ? filter.dataSources : undefined) ?? dataSources;
                            if (!usedDataSources) {
                                throw new Error("FilterView INTERNAL: No data sources found");
                            }
                            return <FilterView
                                key={filter.key}
                                value={value}
                                operator={operator}
                                dashboardId={dashboardId}
                                onSettingsOpen={(open) => {
                                    // setPopupOpen(!open);
                                }}
                                onChange={(newValue, newOperator) => {
                                    const newFilters = paramFilters.map(f =>
                                        f.key === filter.key
                                            ? {
                                                ...f,
                                                value: newValue,
                                                operator: newOperator
                                            }
                                            : f
                                    );

                                    if (!newFilters.some(f => f.key === filter.key)) {
                                        newFilters.push({
                                            key: filter.key,
                                            value: newValue,
                                            operator: newOperator,
                                            type: filter.type,
                                        });
                                    }

                                    setParamFilters(newFilters);
                                }}
                                onStartFilterPlacement={onStartFilterPlacement}
                                onEndFilterPlacement={onEndFilterPlacement}
                                onFilterRemove={onFilterRemove}
                                onFilterUpdate={onFilterUpdate}
                                filter={filter}
                                dataSources={usedDataSources} />
                        })}
                    </div>
                </div>
            </Popover>}
            <DatePickerWithRange
                className={"relative max-w-full bg-surface-accent-200/50 dark:bg-surface-800/60 hover:bg-surface-accent-200/70 dark:hover:bg-surface-700/40 h-[32px]  rounded-xl text-sm w-64"}
                dateRange={dateRange}
                setDateRange={setDateRange}
                includeToday={includeToday}
                onIncludeTodayChange={onIncludeTodayChange}
                onPresetSelect={onPresetSelect} />
        </div>
    );
}
