import React from "react";
import { FieldProps } from "../../types/fields";
import { MultiSelect, MultiSelectItem } from "@rebasepro/ui";
import { useTranslation, useInternalUserManagementController } from "@rebasepro/core";
import { RoleChip } from "./RoleChip";

export function UserRolesSelectField({
    propertyKey,
    value,
    setValue,
    disabled
}: FieldProps) {
    const { t } = useTranslation();
    const userManagement = useInternalUserManagementController();
    const roles = userManagement?.roles || [];

    const selectedRoleIds = (value || []).map((r: any) => {
        if (typeof r === "object" && r !== null) {
            return r.id;
        }
        return r;
    });

    const handleValueChange = (val: string[]) => {
        const references = val.map(id => ({
            id,
            path: "roles",
            __type: "relation"
        }));
        setValue(references);
    };

    return (
        <div className="col-span-12">
            <MultiSelect
                className="w-full"
                label={t("roles") || "Roles"}
                value={selectedRoleIds}
                onValueChange={handleValueChange}
                disabled={disabled}
            >
                {roles.map(role => (
                    <MultiSelectItem key={role.id} value={role.id}>
                        <RoleChip role={role}/>
                    </MultiSelectItem>
                ))}
            </MultiSelect>
        </div>
    );
}
