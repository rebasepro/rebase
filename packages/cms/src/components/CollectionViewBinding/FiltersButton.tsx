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
                <Badge
                    color="primary"
                    invisible={activeFilterCount === 0}
                >
                    {!iconOnly ? (
                        <Button
                            variant="text"
                            size="small"
                            onClick={() => setOpen(true)}
                            startIcon={<FilterIcon size={iconSize.small}/>}
                            className={cls(activeFilterCount > 0 && "text-primary")}
                        >
                            {activeFilterCount > 0 ? `(${activeFilterCount})` : t("filters")}
                        </Button>
                    ) : (
                        <IconButton aria-label={t("filters")}
                            size={"small"}
                            onClick={() => setOpen(true)}
                            className={cls(activeFilterCount > 0 && "text-primary")}
                        >
                            <FilterIcon size={iconSize.smallest}/>
                        </IconButton>
                    )}
                </Badge>
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
