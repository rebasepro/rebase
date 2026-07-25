
import type { Property } from "@rebasepro/types";
import React, { useCallback, useMemo, useState } from "react";
import { FilterValues, WhereFilterOp } from "@rebasepro/types";
import { Button, cls, defaultBorderMixin, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@rebasepro/ui";
import { FilterIcon, VirtualTableWhereFilterOp } from "@rebasepro/ui";
import { resolveFilterOperators } from "@rebasepro/app";
import { useCollectionScope, useTranslation } from "@rebasepro/app";
import { FilterFieldBinding } from "../SelectableTable/filters/FilterFieldBinding";

/**
 * `WhereFilterOp` is declared twice: once in `@rebasepro/types` as the canonical
 * operator set every driver translates, and once in `@rebasepro/ui` for the
 * table's own props. That is deliberate — `ui` is a standalone design system and
 * depends on no Rebase package, so it cannot import the canonical one (and a
 * type-only import would not help: `ui` emits declarations with `tsc`, which
 * references external types rather than inlining them, so its published `.d.ts`
 * would demand `@rebasepro/types` from every consumer).
 *
 * This file is where the two meet and get cast into each other, so it is where
 * their agreement is checked. Adding an operator to one and not the other stops
 * this line compiling instead of silently producing a filter the table can build
 * and no driver can run — or one a driver supports and the table cannot offer.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _whereFilterOpDefinitionsAgree: MutuallyAssignable<WhereFilterOp, VirtualTableWhereFilterOp> = true;
void _whereFilterOpDefinitionsAgree;

export interface FiltersDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    properties: Record<string, Property>;
    filterValues: FilterValues<any> | undefined;
    setFilterValues: (filterValues?: FilterValues<any>) => void;
    fixedFilter?: FilterValues<any>;
}

/**
 * Dialog that displays all filterable properties from a collection
 * and allows setting filter values for each.
 */
export function FiltersDialog({
    open,
    onOpenChange,
    properties,
    filterValues,
    setFilterValues,
    fixedFilter
}: FiltersDialogProps) {
    const { t } = useTranslation();
    // Engine of the collection this dialog filters — read from the
    // surrounding CollectionScopeProvider mounted by the collection view.
    const engine = useCollectionScope()?.engine;
    // Local state for filters being edited
    const [localFilters, setLocalFilters] = useState<FilterValues<any>>(filterValues ?? {});

    // Track hidden state for reference fields (when reference dialog is open)
    const [hiddenFields, setHiddenFields] = useState<Record<string, boolean>>({});

    // Reset local state when dialog opens
    React.useEffect(() => {
        if (open) {
            setLocalFilters(filterValues ?? {});
        }
    }, [open, filterValues]);

    // Get list of filterable properties
    const filterableProperties = useMemo(() => {
        return Object.entries(properties).filter(([key, property]) => {
            if (!property) return false;
            // Force filter properties should not be editable
            if (fixedFilter && key in fixedFilter) return false;
            const isArray = property.type === "array";
            const ofProp = isArray && "of" in property ? property.of : undefined;
            const baseProperty = isArray ? (Array.isArray(ofProp) ? ofProp[0] : ofProp) as Property | undefined : property;
            if (!baseProperty) return false;
            // A property is filterable when it has a custom filter field, or
            // when at least one operator survives the engine ∩ type ∩
            // property-narrowing resolution.
            if (baseProperty.admin?.Filter) return true;
            return resolveFilterOperators({ property: baseProperty, isArray, engine }).length > 0;
        });
    }, [properties, fixedFilter, engine]);

    const handleFilterChange = useCallback((propertyKey: string, value?: [VirtualTableWhereFilterOp, any]) => {
        setLocalFilters(prev => {
            const newFilters = { ...prev };
            if (value) {
                newFilters[propertyKey] = value as [WhereFilterOp, any];
            } else {
                delete newFilters[propertyKey];
            }
            return newFilters;
        });
    }, []);

    const handleApply = useCallback(() => {
        const hasFilters = Object.keys(localFilters).length > 0;
        setFilterValues(hasFilters ? { ...localFilters,
...fixedFilter } : (fixedFilter || undefined));
        onOpenChange(false);
    }, [localFilters, setFilterValues, fixedFilter, onOpenChange]);

    const handleClearAll = useCallback(() => {
        setLocalFilters({});
    }, []);

    const setHiddenForField = useCallback((propertyKey: string, hidden: boolean) => {
        setHiddenFields(prev => ({
            ...prev,
            [propertyKey]: hidden
        }));
    }, []);

    // Check if any reference field's dialog is currently open (should hide this dialog)
    const isAnyFieldHidden = Object.values(hiddenFields).some(hidden => hidden);
    const activeFilterCount = Object.keys(localFilters).length;

    const renderFilterField = useCallback((propertyKey: string, property: Property) => {
        const filterValue = localFilters[propertyKey] as [WhereFilterOp, any] | undefined;
        const setValue = (value?: [WhereFilterOp, any]) => handleFilterChange(propertyKey, value as [VirtualTableWhereFilterOp, any] | undefined);

        return (
            <FilterFieldBinding
                propertyKey={propertyKey}
                property={property}
                engine={engine}
                value={filterValue}
                setValue={setValue}
                hidden={hiddenFields[propertyKey] ?? false}
                setHidden={(hidden) => setHiddenForField(propertyKey, hidden)}
            />
        );
    }, [localFilters, handleFilterChange, hiddenFields, setHiddenForField, engine]);

    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            maxWidth="3xl"
            fullWidth
            containerClassName={isAnyFieldHidden ? "hidden" : undefined}
        >
            <DialogTitle className="flex items-center gap-2" variant="h6">
                {t("filters")}
                {activeFilterCount > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-primary text-white">
                        {activeFilterCount}
                    </span>
                )}
            </DialogTitle>

            <DialogContent >
                {filterableProperties.length === 0 ? (
                    <Typography color="secondary" className="py-8 text-center">
                        {t("no_filterable_properties")}
                    </Typography>
                ) : (
                    <table className="w-full border-collapse">
                        <tbody>
                            {filterableProperties.map(([propertyKey, property], index) => {
                                const hasFilter = propertyKey in localFilters;

                                return (
                                    <tr key={propertyKey} className={cls(
                                        index > 0 && "border-t",
                                        defaultBorderMixin
                                    )}>
                                        {/* Property name on the left */}
                                        <td className="py-3 pr-4 align-middle w-[160px]">
                                            <Typography
                                                variant="body2"
                                                className={cls(
                                                    "font-medium",
                                                    hasFilter && "text-primary"
                                                )}
                                            >
                                                {property.name || propertyKey}
                                            </Typography>
                                        </td>

                                        {/* FilterIcon field on the right */}
                                        <td className="py-3">
                                            {renderFilterField(propertyKey, property)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </DialogContent>

            <DialogActions>
                <Button
                    variant="text"
                    onClick={handleClearAll}
                    disabled={activeFilterCount === 0}
                >
                    {t("clear_all")}
                </Button>
                <div className="flex-grow"/>
                <Button
                    variant="text"
                    onClick={() => onOpenChange(false)}
                >
                    {t("cancel")}
                </Button>
                <Button
                    variant="filled"
                    onClick={handleApply}
                >
                    {t("apply_filters")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
