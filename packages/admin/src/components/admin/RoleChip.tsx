import React from "react";
import { Chip, ChipColorScheme } from "@rebasepro/ui";
import { Role } from "@rebasepro/types";
import { getColorSchemeForSeed, getColorSchemeForKey } from "@rebasepro/ui";

export function RoleChip({ role }: { role: Role }) {
    let colorScheme: ChipColorScheme;
    if (role.isAdmin) {
        colorScheme = getColorSchemeForKey("blue");
    } else if (role.id === "editor") {
        colorScheme = getColorSchemeForKey("yellow");
    } else if (role.id === "viewer") {
        colorScheme = getColorSchemeForKey("gray");
    } else {
        colorScheme = getColorSchemeForSeed(role.id);
    }

    return (
        <Chip colorScheme={colorScheme} key={role.id}>
            {role.name}
        </Chip>
    );
}
