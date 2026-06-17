import type { PropertyPreviewProps } from "../../types/components/PropertyPreviewProps";
import type { StringProperty } from "@rebasepro/types";
import React from "react";
import { EmptyValue } from "./EmptyValue";
import { Typography } from "@rebasepro/ui";

/**
 * Preview component for displaying a user reference value.
 *
 * Shows the raw user ID. Collection-based user management means
 * user records are fetched through the standard data layer.
 *
 * @group Preview components
 */
export function UserPreview({ value }: PropertyPreviewProps<StringProperty>) {
    if (typeof value !== "string" || !value) {
        return <EmptyValue/>;
    }

    return <Typography variant={"caption"} color={"secondary"}>{value}</Typography>;
}
