import type { EntityTableController, Properties } from "@rebasepro/cms-types";
import type { FilterValues } from "@rebasepro/types";
import React, { useState } from "react";
import { useTranslation } from "@rebasepro/app";
import { Badge, Button, cls, FilterIcon, IconButton, iconSize, Tooltip } from "@rebasepro/ui";
import { FiltersDialog } from "./FiltersDialog";

/**
 * The toolbar's filters control — labelled, or its icon-only form — with the
 * count of filters the person set, and the dialog it opens.
 */
export function FiltersButton<M extends Record<string, unknown>>({
    tableController,
    properties,
    fixedFilter,
    iconOnly
}: {
    tableController: EntityTableController<M>;
    properties: Properties;
    /** The collection's scope: not a filter the person set, so not counted. */
    fixedFilter?: FilterValues<string>;
    iconOnly: boolean;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    // Count active filters (excluding force filters)
    const filterValues = tableController.filterValues;
    const activeFilterCount = filterValues
        ? Object.keys(filterValues).filter(key => !fixedFilter || !(key in fixedFilter)).length
        : 0;

    if (!tableController.setFilterValues) return null;

    return (
        <>
            <Tooltip title={t("filters")}>
                {!iconOnly ? (
                    <Button
                        variant="text"
                        size="small"
                        onClick={() => setOpen(true)}
                        startIcon={<FilterIcon size={iconSize.small}/>}
                        className={cls(activeFilterCount > 0 && "bg-surface-active text-text-primary dark:text-text-primary-dark")}
                    >
                        <span>{t("filters")}</span>
                        {activeFilterCount > 0 && (
                            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md bg-primary/15 text-primary text-[11px] font-mono tabular-nums font-medium">
                                {activeFilterCount}
                            </span>
                        )}
                    </Button>
                ) : (
                    <Badge
                        color="primary"
                        invisible={activeFilterCount === 0}
                    >
                        <IconButton aria-label={t("filters")}
                            size={"small"}
                            onClick={() => setOpen(true)}
                            className={cls(activeFilterCount > 0 && "text-primary")}
                        >
                            <FilterIcon size={iconSize.smallest}/>
                        </IconButton>
                    </Badge>
                )}
            </Tooltip>
            <FiltersDialog
                open={open}
                onOpenChange={setOpen}
                properties={properties}
                filterValues={tableController.filterValues}
                setFilterValues={(values) => tableController.setFilterValues?.(values ?? {})}
                fixedFilter={fixedFilter}
            />
        </>
    );
}
