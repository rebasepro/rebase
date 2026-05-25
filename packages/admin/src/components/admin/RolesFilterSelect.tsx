import React from "react";
import { CollectionActionsProps } from "@rebasepro/types";
import { Select, SelectItem } from "@rebasepro/ui";
import { useTranslation, useInternalUserManagementController } from "@rebasepro/core";

export function RolesFilterSelect({
    tableController
}: CollectionActionsProps<any>) {
    const { t } = useTranslation();
    const userManagement = useInternalUserManagementController();
    const roles = userManagement?.roles || [];

    const currentFilterValue = (tableController.filterValues?.roles?.[1] as string) || "";

    const handleRoleChange = (newRole: string) => {
        const filterVal = newRole === "" ? undefined : newRole;
        if (filterVal) {
            tableController.setFilterValues?.({
                ...tableController.filterValues,
                roles: ["array-contains", filterVal]
            });
        } else {
            const nextFilters = { ...tableController.filterValues };
            delete nextFilters.roles;
            tableController.setFilterValues?.(nextFilters);
        }
    };

    if (!roles || roles.length === 0) return null;

    return (
        <Select
            value={currentFilterValue || "__all__"}
            onValueChange={(v) => handleRoleChange(v === "__all__" ? "" : v)}
            placeholder={t("all_roles") || "All Roles"}
            size="small"
            className="w-48"
        >
            <SelectItem value="__all__">{t("all_roles") || "All Roles"}</SelectItem>
            {roles.map(role => (
                <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
            ))}
        </Select>
    );
}
