import { BooleanSwitchWithLabel, cls, DateTimeField, defaultBorderMixin, IconButton, Label, Menu, MenuItem, MultiSelect, MultiSelectItem, Select, SelectItem, TextField, Tooltip, Typography, useDebounceValue } from "@rebasepro/ui";
import { Trash2, GripVertical, Filter, Settings, X, MoreVertical, Search, RefreshCw } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { DatePickerWithRange } from "./DateRange";
import { DashboardFilterConfig, DataSource, FilterConfig, FilterOp, FilterValue } from "../types";
import { makeSQLQuery } from "../api";
import { useDataki } from "../DatakiContext";
import { datasourceToString } from "../utils/datasource";
import { FilterConfigFormDialog } from "./FilterConfigFormDialog";
import { useConfirmationDialog } from "../hooks/useConfirmationDialog";

export interface FilterViewProps {
    filter: FilterConfig | DashboardFilterConfig;
    onFilterUpdate?: (newFilter: FilterConfig) => void;
    onStartFilterPlacement?: (filter: FilterConfig) => void;
    onEndFilterPlacement?: () => void;
    onFilterRemove?: (removedFilter: FilterConfig) => void;
    value?: FilterValue;
    operator?: FilterOp;
    onChange?: (value?: FilterValue, operator?: FilterOp) => void;
    className?: string;
    dashboardId?: string;
    dataSources: DataSource[];
    onSettingsOpen?: (open: boolean) => void;
    inDashboard?: boolean;  // When true, hide label/key/buttons, only show dropdown
}

export const FilterView = React.memo(function FilterView({
                                                             filter,
                                                             value,
                                                             onStartFilterPlacement,
                                                             onEndFilterPlacement,
                                                             onFilterUpdate,
                                                             onFilterRemove,
                                                             operator,
                                                             onChange,
                                                             className,
                                                             dashboardId,
                                                             dataSources,
                                                             onSettingsOpen,
                                                             inDashboard = false
                                                         }: FilterViewProps) {

    const [currentValue, setCurrentValue] = useState<FilterValue>(value ?? null);
    const [currentOperator, setCurrentOperator] = useState<FilterOp>(operator ?? "==");

    const [formOpen, setFormOpen] = useState(false);

    const removeFilterConfirmationDialog = useConfirmationDialog({
        confirmMessage: `Are you sure you want to remove the "${filter.label}" filter?`,
        onAccept: () => {
            // Extract FilterConfig properties (without position)
            const filterConfig: FilterConfig = {
                key: filter.key,
                label: filter.label,
                type: filter.type,
                dataSources: filter.dataSources,
                ...(filter.sqlQuery && { sqlQuery: filter.sqlQuery }),
                ...(filter.options && { options: filter.options }),
                ...(filter.placeholder && { placeholder: filter.placeholder }),
                ...(filter.defaultValue !== undefined && { defaultValue: filter.defaultValue })
            };
            onFilterRemove?.(filterConfig);
        }
    });

    useEffect(() => {
        setCurrentValue(value ?? null);
        setCurrentOperator(operator ?? "==");
    }, [value]);

    const handleValueChange = (newValue: any) => {
        setCurrentValue(newValue);
        onChange?.(newValue, currentOperator);
    };

    const handleOperatorChange = (newOperator: FilterOp) => {
        setCurrentOperator(newOperator);
        onChange?.(currentValue, newOperator);
    };

    const renderFilterInput = () => {
        switch (filter.type) {
            case "text_exact":
                return <TextExactFilterInput
                    value={currentValue}
                    onValueChange={handleValueChange}
                    placeholder={filter.placeholder}
                    dataSources={dataSources}
                />;
            case "text_search":
                return <TextSearchFilterInput
                    value={currentValue}
                    onValueChange={handleValueChange}
                    placeholder={filter.placeholder}
                    dataSources={dataSources}
                />;
            case "enum":
                return <EnumFilterInput
                    value={currentValue}
                    onValueChange={handleValueChange}
                    sqlQuery={filter.sqlQuery}
                    options={filter.options || []}
                    placeholder={filter.placeholder}
                    dataSources={dataSources}
                    dashboardId={dashboardId}
                />;
            case "number":
                return <NumberFilterInput
                    value={currentValue}
                    operator={currentOperator}
                    onValueChange={handleValueChange}
                    onOperatorChange={handleOperatorChange}
                    placeholder={filter.placeholder}
                    dataSources={dataSources}
                />;
            case "boolean":
                return <BooleanFilterInput
                    value={currentValue}
                    onValueChange={handleValueChange}
                    dataSources={dataSources}
                />;
            case "date":
                return <DateFilterInput
                    value={currentValue}
                    operator={currentOperator}
                    onValueChange={handleValueChange}
                    onOperatorChange={handleOperatorChange}
                    dataSources={dataSources}
                />;
            case "date_range":
                return <DateRangeFilterInput
                    value={currentValue}
                    onValueChange={handleValueChange}
                    dataSources={dataSources}
                />;
            default:
                return <Typography color="error">Unknown filter type: {filter.type}</Typography>;
        }
    };

    return (
        <div className="flex gap-2">
            <div
                className={cls(inDashboard ? "flex flex-col gap-1 rounded-xl" : "flex-1 flex flex-col gap-1 rounded-xl", defaultBorderMixin, className)}>
                {!inDashboard && (
                    <div className={"flex w-full items-center gap-1"}>
                        <Label className="font-medium flex-1">{filter.label}</Label>
                        <Typography variant={"caption"}
                                    color={"secondary"}>{filter.key}</Typography>
                        <Tooltip title={"Clear filter"}>
                            <IconButton
                                size={"smallest"}
                                onClick={() => {
                                    setCurrentValue(null);
                                }}>
                                <X size={"smallest"}/>
                            </IconButton>
                        </Tooltip>
                        {onStartFilterPlacement && (
                            <Tooltip title={"Drag to add filter to dashboard"}>
                                <div
                                    draggable={true}
                                    unselectable="on"
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData("text/plain", "");
                                        onStartFilterPlacement(filter);
                                    }}
                                    onDragEnd={() => {
                                        setTimeout(() => onEndFilterPlacement?.(), 0);
                                    }}
                                    className="cursor-move"
                                >
                                    <IconButton size={"smallest"} className="pointer-events-none">
                                        <GripVertical size={"smallest"}/>
                                    </IconButton>
                                </div>
                            </Tooltip>
                        )}
                        {(onFilterUpdate || onFilterRemove) && (
                            <Menu
                                className="z-[9999]"
                                trigger={
                                    <IconButton size={"smallest"}>
                                        <MoreVertical size={"smallest"}/>
                                    </IconButton>
                                }>
                                {onFilterUpdate && (
                                    <MenuItem dense onClick={() => {
                                        onSettingsOpen?.(true);
                                        setFormOpen(true);
                                    }}>
                                        <Settings size={"smallest"}/>
                                        Edit filter
                                    </MenuItem>
                                )}
                                {onFilterRemove && (
                                    <MenuItem dense onClick={() => {
                                        removeFilterConfirmationDialog.open();
                                    }}>
                                        <Trash2 size={"smallest"}/>
                                        Remove filter
                                    </MenuItem>
                                )}
                            </Menu>
                        )}
                    </div>
                )}

                <div className="flex items-center gap-2">
                    {renderFilterInput()}
                </div>
            </div>

            {onFilterUpdate && <FilterConfigFormDialog
                formOpen={formOpen}
                setFormOpen={(open) => {
                    onSettingsOpen?.(open);
                    setFormOpen(open);
                }}
                filter={{
                    key: filter.key,
                    label: filter.label,
                    type: filter.type,
                    dataSources: filter.dataSources,
                    ...(filter.sqlQuery && { sqlQuery: filter.sqlQuery }),
                    ...(filter.options && { options: filter.options }),
                    ...(filter.placeholder && { placeholder: filter.placeholder }),
                    ...(filter.defaultValue !== undefined && { defaultValue: filter.defaultValue })
                }}
                onSave={(newFilter) => {
                    onFilterUpdate?.(newFilter);
                    onSettingsOpen?.(false);
                    setFormOpen(false);
                }}
                onCancel={() => {
                    onSettingsOpen?.(false);
                    setFormOpen(false);
                }}
            />}

            {removeFilterConfirmationDialog.ConfirmationDialog}

        </div>

    );
});

interface BaseFilterInputProps {
    value: any;
    operator?: FilterOp;
    onValueChange: (value: any) => void;
    onOperatorChange?: (operator: FilterOp) => void;
    placeholder?: string;
    dashboardId?: string;
    dataSources: DataSource[];
}

const OperatorSelect = React.memo(function OperatorSelect({
                                                              value,
                                                              onChange,
                                                              operators = ["==", "!=", ">", ">=", "<", "<="]
                                                          }: {
    value: FilterOp;
    onChange: (op: FilterOp) => void;
    operators?: FilterOp[];
}) {
    return (
        <Select
            size={"medium"}
            value={value}
            onChange={(e) => onChange(e.target.value as FilterOp)}
            className={cls("min-w-[60px] max-w-[70px] rounded-xl", defaultBorderMixin)}
        >
            {operators.map((op) => (
                <SelectItem key={op} value={op}>
                    {op}
                </SelectItem>
            ))}
        </Select>
    );
});

const TextExactFilterInput = React.memo(function TextExactFilterInput({
                                                                          value,
                                                                          onValueChange,
                                                                          placeholder
                                                                      }: Omit<BaseFilterInputProps, "operator" | "onOperatorChange">) {
    const [localValue, setLocalValue] = useState(value || "");
    const debouncedValue = useDebounceValue(localValue, 300);

    // Only update local state when the external value changes and differs from current value
    useEffect(() => {
        if (value !== localValue && value !== debouncedValue) {
            setLocalValue(value || "");
        }
    }, [value]);

    // Only invoke the callback when the debounced value changes
    useEffect(() => {
        if (debouncedValue !== value) {
            onValueChange(debouncedValue || null);
        }
    }, [debouncedValue]);

    return (
        <TextField
            size={"medium"}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            placeholder={placeholder || "Enter exact text..."}
            className={cls("flex-grow rounded-xl", defaultBorderMixin)}
        />
    );
});

const TextSearchFilterInput = React.memo(function TextSearchFilterInput({
                                                                            value,
                                                                            onValueChange,
                                                                            placeholder
                                                                        }: Omit<BaseFilterInputProps, "operator" | "onOperatorChange">) {
    const [localValue, setLocalValue] = useState(value || "");
    const debouncedValue = useDebounceValue(localValue, 300);

    // Only update local state when the external value changes and differs from current value
    useEffect(() => {
        if (value !== localValue && value !== debouncedValue) {
            setLocalValue(value || "");
        }
    }, [value]);

    // Only invoke the callback when the debounced value changes
    useEffect(() => {
        if (debouncedValue !== value) {
            onValueChange(debouncedValue || null);
        }
    }, [debouncedValue]);

    return (
        <TextField
            value={localValue}
            size={"medium"}
            onChange={(e) => setLocalValue(e.target.value)}
            placeholder={placeholder || "Search text..."}
            className={cls("flex-grow rounded-xl", defaultBorderMixin)}
        />
    );
});

const NumberFilterInput = React.memo(function NumberFilterInput({
                                                                    value,
                                                                    operator,
                                                                    onValueChange,
                                                                    onOperatorChange,
                                                                    placeholder
                                                                }: BaseFilterInputProps) {
    const [localValue, setLocalValue] = useState<string | number>(value !== null ? value : "");
    const debouncedValue = useDebounceValue(localValue, 300);

    // Only update local state when the external value changes and differs from current value
    useEffect(() => {
        if (value !== localValue && value !== debouncedValue) {
            setLocalValue(value !== null ? value : "");
        }
    }, [value]);

    // Only invoke the callback when the debounced value changes
    useEffect(() => {
        if (debouncedValue !== value && debouncedValue !== "") {
            onValueChange(debouncedValue === "" ? null : Number(debouncedValue));
        }
    }, [debouncedValue]);

    useEffect(() => {
        if (!operator)
            onOperatorChange?.("==");
    }, [operator]);

    return (
        <div className="contents">
            <OperatorSelect
                value={operator || "=="}
                onChange={onOperatorChange!}
            />
            <TextField
                type="number"
                size={"medium"}
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                placeholder={placeholder || "Enter a number..."}
                className={cls("flex-grow rounded-xl", defaultBorderMixin)}
            />
        </div>
    );
});

const enumOptionsCache: Record<string, {
    data: { label: string; value: string | number | boolean }[],
    timestamp: number
}> = {};

// Create a cache key function
const createCacheKey = (sqlQuery: string, dataSources: DataSource[]): string => {
    return `${sqlQuery}_${dataSources.map(datasourceToString).join("_")}`;
};

const EnumFilterInput = React.memo(function EnumFilterInput({
                                                                value,
                                                                onValueChange,
                                                                sqlQuery,
                                                                options,
                                                                placeholder,
                                                                dataSources,
                                                                dashboardId,
                                                                isDragging = false
                                                            }: Omit<BaseFilterInputProps, "operator" | "onOperatorChange"> & {
    sqlQuery?: string;
    options: { label: string; value: string | number | boolean }[];
    isDragging?: boolean;
}) {
    const {
        apiEndpoint,
        embedApiKey,
        getDatakiAuthToken
    } = useDataki();

    const cacheKey = useMemo(() =>
            sqlQuery ? createCacheKey(sqlQuery, dataSources) : "",
        [sqlQuery, dataSources]
    );

    const cachedItem = cacheKey ? enumOptionsCache[cacheKey] : undefined;

    const [fetchedOptions, setFetchedOptions] = useState<{ label: string; value: string | number | boolean }[]>(
        cachedItem?.data || []
    );
    const [isLoading, setIsLoading] = useState<boolean>(!cachedItem);
    const [error, setError] = useState<string | null>(null);

    const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);

    const handlePointerDown = (e: React.PointerEvent) => {
        mouseDownPosRef.current = {
            x: e.clientX,
            y: e.clientY
        };
    };

    const handleClickCapture = (e: React.MouseEvent) => {
        // If mouse moved more than 5px between mousedown and click, it was a drag
        if (mouseDownPosRef.current) {
            const moved = Math.abs(e.clientX - mouseDownPosRef.current.x) +
                Math.abs(e.clientY - mouseDownPosRef.current.y);
            if (moved > 5) {
                e.preventDefault();
                e.stopPropagation();
                mouseDownPosRef.current = null;
                return;
            }
        }
        mouseDownPosRef.current = null;
    };

    async function fetchValues() {
        if (!sqlQuery || !apiEndpoint || !cacheKey) return;

        // If we have cached data, don't show loading state
        if (!cachedItem) {
            setIsLoading(true);
        }

        setError(null);
        const firebaseToken = await getDatakiAuthToken();

        makeSQLQuery({
            firebaseAccessToken: firebaseToken,
            apiEndpoint,
            sql: sqlQuery,
            dataSources,
            dashboardId,
            embedApiKey
        })
            .then(rows => {
                if (rows && rows.length > 0) {
                    const newOptions = rows.map(row => {
                        return {
                            label: String(row.label ?? row.name ?? row.value),
                            value: (row.value ?? row.id ?? row.label) as string | number | boolean
                        };
                    });

                    // Update component state
                    setFetchedOptions(newOptions);

                    // Update the static cache
                    enumOptionsCache[cacheKey] = {
                        data: newOptions,
                        timestamp: Date.now()
                    };
                }
            })
            .catch(error => {
                console.error("Failed to fetch filter options:", error);
                setError(error.message || "Failed to load filter options");
            })
            .finally(() => {
                setIsLoading(false);
            });
    }

    useEffect(() => {
        fetchValues();
    }, [sqlQuery, apiEndpoint]);

    // Memoize combined options
    const allOptions = useMemo(() => [...options, ...fetchedOptions], [options, fetchedOptions]);

    return (
        <div
            className="flex flex-col w-full"
            onPointerDownCapture={handlePointerDown}
            onClickCapture={handleClickCapture}
        >
            <MultiSelect
                value={value || []}
                onValueChange={onValueChange}
                size={"medium"}
                placeholder={isLoading ? "Loading options..." : placeholder || "Select..."}
                className={cls("flex-grow rounded-xl", defaultBorderMixin, error ? "border-error-500" : "")}
                disabled={isLoading}
                includeSelectAll={false}
            >
                {allOptions.map((option) => (
                    <MultiSelectItem key={String(option.value)} value={option.value?.toString()}>
                        {option.label}
                    </MultiSelectItem>
                ))}
            </MultiSelect>
            {error && (
                <div className="flex items-center mt-1">
                    <Tooltip title={error}>
                        <Typography variant="caption" color="error" className="text-xs">
                            Failed to load options
                        </Typography>
                    </Tooltip>
                    <IconButton
                        size="smallest"
                        className="ml-1"
                        onClick={fetchValues}>
                        <RefreshCw size="smallest"/>
                    </IconButton>
                </div>
            )}
        </div>
    );
});
const BooleanFilterInput = React.memo(function BooleanFilterInput({
                                                                      value,
                                                                      onValueChange
                                                                  }: Omit<BaseFilterInputProps, "operator" | "onOperatorChange">) {
    return (
        <BooleanSwitchWithLabel
            size={"small"}
            value={Boolean(value)}
            onValueChange={onValueChange}
            className={cls("rounded-xl", defaultBorderMixin)}
        />
    );
});

const DateFilterInput = React.memo(function DateFilterInput({
                                                                value,
                                                                operator,
                                                                onValueChange,
                                                                onOperatorChange
                                                            }: BaseFilterInputProps) {
    return (
        <div className="contents">
            <OperatorSelect
                value={operator || "=="}
                onChange={onOperatorChange!}
                operators={["==", "!=", ">", ">=", "<", "<="]}
            />
            <DateTimeField
                value={value}
                size={"small"}
                onChange={(date) => onValueChange(date)}
                className={cls("flex-grow rounded-xl", defaultBorderMixin)}
            />
        </div>
    );
});

const DateRangeFilterInput = React.memo(function DateRangeFilterInput({
                                                                          value,
                                                                          onValueChange
                                                                      }: Omit<BaseFilterInputProps, "operator" | "onOperatorChange">) {
    return (
        <DatePickerWithRange
            dateRange={(Array.isArray(value) ? value : [null, null]) as [Date | null, Date | null]}
            setDateRange={(dateRange) => onValueChange(dateRange)}
            className={cls("flex-grow rounded-xl", defaultBorderMixin)}
        />
    );
});
