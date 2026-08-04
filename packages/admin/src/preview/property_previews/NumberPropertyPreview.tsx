import type { NumberProperty } from "@rebasepro/types";
import React from "react";

import { EnumValuesChip } from "../components/EnumValuesChip";
import type { PropertyPreviewProps } from "../../types/components/PropertyPreviewProps";
import { enumToObjectEntries } from "@rebasepro/common";
import { useCustomizationController } from "@rebasepro/app";
import { formatNumber } from "../../util/number_format";

/**
 * @group Preview components
 */
export function NumberPropertyPreview({
    value,
    property,
    size
}: PropertyPreviewProps<NumberProperty>): React.ReactElement {

    const customizationController = useCustomizationController();
    const numValue = value as number;

    if (property.enum) {
        const enumKey = numValue;
        const enumValues = enumToObjectEntries(property.enum);
        if (!enumValues)
            return <span className={size === "small" ? "text-sm" : ""}>{numValue}</span>;
        return <EnumValuesChip
            enumKey={enumKey}
            enumValues={enumValues}
            size={size !== "medium" ? "small" : "medium"}/>;
    } else {
        // `admin.format` only — an undeclared number renders as the number that
        // is in the database, which is the only thing we can honestly claim to
        // know about it.
        return <span className={size === "small" ? "text-sm" : ""}>
            {formatNumber(numValue, property.admin?.format, customizationController?.locale)}
        </span>;
    }
}
