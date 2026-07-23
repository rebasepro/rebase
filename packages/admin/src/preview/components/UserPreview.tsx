import type { PropertyPreviewProps } from "../../types/components/PropertyPreviewProps";
import type { StringProperty } from "@rebasepro/types";
import React from "react";
import { EmptyValue } from "./EmptyValue";
import { Typography } from "@rebasepro/ui";
import { getUserLabel, useResolvedUser } from "../../hooks/useResolvedUsers";

/**
 * Preview component for displaying a user reference value.
 *
 * Resolves the stored auth user id to a name (or email) the same way a
 * relation resolves its target, and falls back to the raw id only while the
 * lookup is in flight or when the user cannot be resolved.
 *
 * @group Preview components
 */
export function UserPreview({ value }: PropertyPreviewProps<StringProperty>) {
    const uid = typeof value === "string" && value ? value : undefined;
    const user = useResolvedUser(uid);

    if (!uid) {
        return <EmptyValue/>;
    }

    return <Typography variant={"caption"}
        color={"secondary"}
        className={"truncate"}>
        {user ? getUserLabel(user) : uid}
    </Typography>;
}
