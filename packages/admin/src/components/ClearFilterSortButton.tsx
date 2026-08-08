import { FilterXIcon, iconSize, IconButton, Tooltip } from "@rebasepro/ui";
import { EntityTableController } from "@rebasepro/admin-types";
import { useTranslation } from "@rebasepro/app";

export function ClearFilterSortButton({
    tableController,
    enabled,
    compact
}: {
    enabled: boolean;
    tableController: EntityTableController;
    /**
     * Narrow toolbar (split view). Only decides the icon size, which follows
     * the neighbouring controls — see `CollectionViewStartActions`.
     */
    compact?: boolean;
}) {
    const { t } = useTranslation();

    if (!enabled) {
        return null;
    }

    const filterIsSet = !!tableController.filterValues && Object.keys(tableController.filterValues).length > 0;
    const sortIsSet = !!tableController.sortBy && tableController.sortBy.length > 0;

    if ((filterIsSet || sortIsSet) && (tableController.clearFilter || tableController.setSortBy)) {
        let label;
        if (filterIsSet && sortIsSet) {
            label = t("clear_filter_sort");
        } else if (filterIsSet) {
            label = t("clear_filter");
        } else {
            label = t("clear_sort");
        }
        return (
            <Tooltip title={label}>
                {/* An `IconButton`, like every other icon-only control in this
                    toolbar. As a `Button` it was a rounded-md box with text
                    padding sitting between two circular icon buttons. */}
                <IconButton
                    size={"small"}
                    aria-label={label}
                    onClick={() => {
                        tableController.clearFilter?.();
                        tableController.setSortBy?.(undefined);
                    }}
                >
                    <FilterXIcon size={compact ? iconSize.smallest : iconSize.small}/>
                </IconButton>
            </Tooltip>
        );
    }
    return null;
}
