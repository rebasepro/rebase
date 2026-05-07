import { Trash2 } from "lucide-react";
import React from "react";
import { DryFilterWidgetConfig, FilterConfig, FilterOp, FilterValue } from "../../types";
import { FilterView } from "../FilterView";
import { IconButton, Tooltip, cls } from "@rebasepro/ui";

export function FilterWidgetView({
    dryConfig,
    value,
    operator,
    onChange,
    onRemoveClick,
    onUpdated,
    readOnly,
    dashboardId,
    selected,
    actions
}: {
    dryConfig: DryFilterWidgetConfig;
    value?: any;
    operator?: FilterOp;
    onChange?: (value: any, operator?: FilterOp) => void;
    onRemoveClick?: () => void;
    onUpdated?: (newConfig: DryFilterWidgetConfig) => void;
    readOnly?: boolean;
    dashboardId?: string;
    selected?: boolean;
    actions?: React.ReactNode;
}) {
    // Convert DryFilterWidgetConfig to FilterConfig format that FilterView expects
    const filterConfig: FilterConfig = {
        key: dryConfig.key,
        label: dryConfig.label,
        type: dryConfig.filterType,
        dataSources: dryConfig.dataSources,
        ...(dryConfig.sqlQuery && { sqlQuery: dryConfig.sqlQuery }),
        ...(dryConfig.options && { options: dryConfig.options }),
        ...(dryConfig.placeholder && { placeholder: dryConfig.placeholder }),
        ...(dryConfig.defaultValue !== undefined && { defaultValue: dryConfig.defaultValue })
    };

    return (
        <div
            className={cls("group flex w-full h-full rounded-lg overflow-visible relative items-end",
                selected ? " ring-offset-transparent ring-2 ring-primary/50 ring-offset-2" : ""
            )}
        >
            {/* Toolbar menu - absolutely positioned above the filter with hover bridge */}
            {!readOnly && (
                <div className={cls(
                    "absolute -top-10 right-0 z-20 nodrag",
                    selected ? "flex" : "hidden group-hover:flex"
                )}>
                    {/* Invisible bridge to prevent menu from disappearing when moving mouse */}
                    <div className="absolute top-full right-0 w-full h-2"/>

                    <div
                        className="flex flex-row gap-1 bg-white/95 dark:bg-surface-950/95 rounded-lg p-1 shadow-sm backdrop-blur-sm border border-surface-200/40 dark:border-surface-700/40">
                        {onRemoveClick && (
                            <Tooltip title={"Remove this filter"}>
                                <IconButton size={"small"} onClick={onRemoveClick}>
                                    <Trash2 size={"small"} />
                                </IconButton>
                            </Tooltip>
                        )}

                        {actions}
                    </div>
                </div>
            )}

            <div className="w-full p-1">
                <FilterView
                    filter={filterConfig}
                    value={value}
                    operator={operator}
                    onChange={onChange as ((value?: FilterValue, operator?: FilterOp) => void) | undefined}
                    dashboardId={dashboardId}
                    dataSources={dryConfig.dataSources}
                    className="w-full"
                    inDashboard={true}
                />
            </div>
        </div>
    );
}

