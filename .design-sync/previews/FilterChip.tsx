import React from "react";
import { FilterChip, FilterIcon } from "@rebasepro/ui";

export const ActiveInactive = () => (
    <div className="flex flex-wrap gap-2 items-center p-4">
        <FilterChip active>Active</FilterChip>
        <FilterChip>Inactive</FilterChip>
        <FilterChip icon={<FilterIcon size={12}/>} active>With icon</FilterChip>
    </div>
);

export const Sizes = () => (
    <div className="flex flex-wrap gap-2 items-center p-4">
        <FilterChip size="medium" active>Medium</FilterChip>
        <FilterChip size="small" active>Small</FilterChip>
    </div>
);

export const Disabled = () => (
    <div className="flex flex-wrap gap-2 items-center p-4">
        <FilterChip disabled>Disabled</FilterChip>
        <FilterChip disabled active>Disabled active</FilterChip>
    </div>
);

export const FilterBar = () => (
    <div className="flex flex-wrap gap-2 items-center p-4">
        <FilterChip active>All</FilterChip>
        <FilterChip>Published</FilterChip>
        <FilterChip>Draft</FilterChip>
        <FilterChip>Archived</FilterChip>
    </div>
);
