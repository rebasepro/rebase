import React from "react";
import { VirtualTableWhereFilterOp } from "@rebasepro/ui";
import { BooleanSwitchWithLabel } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

interface BooleanFieldProps {
    name: string,
    value?: [op: VirtualTableWhereFilterOp, fieldValue: unknown];
    setValue: (value?: [op: VirtualTableWhereFilterOp, newValue: unknown]) => void;
    title?: string;
    /**
     * Restrict the offered operators. This field only ever emits `["==", …]`,
     * so it renders nothing when `==` is not allowed.
     */
    operators?: readonly VirtualTableWhereFilterOp[];
}

export function BooleanFilterField({
    name,
    title,
    value,
    setValue,
    operators
}: BooleanFieldProps) {
    const { t } = useTranslation();

    if (operators && !operators.includes("==")) return null;

    function updateFilter(val?: boolean) {
        if (val !== undefined) {
            setValue(
                ["==", val]
            );
        } else {
            setValue(
                undefined
            );
        }
    }

    const valueSetToTrue = value && value[1];
    const valueSet = !!value;

    return (
        <div className="w-full">
            <BooleanSwitchWithLabel
                size={"medium"}
                value={valueSetToTrue as boolean | null}
                allowIndeterminate={true}
                onValueChange={(v: boolean | null) => updateFilter(v === null ? undefined : v)}
                label={!valueSet
                    ? t("no_filter")
                    : valueSetToTrue
                        ? `${title} ${t("is_true")}`
                        : `${title} ${t("is_false")}`}
            />
        </div>
    );
}
