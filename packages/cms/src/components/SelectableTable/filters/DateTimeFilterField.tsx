import React, { useState } from "react";
import { VirtualTableWhereFilterOp } from "@rebasepro/ui";
import { DateTimeField, Select, SelectItem } from "@rebasepro/ui";
import { useCustomizationController } from "@rebasepro/app";

interface DateTimeFilterFieldProps {
    name: string,
    mode?: "date" | "date_time",
    value?: [op: VirtualTableWhereFilterOp, fieldValue: unknown];
    setValue: (value?: [op: VirtualTableWhereFilterOp, newValue: unknown]) => void;
    isArray?: boolean;
    title?: string;
    timezone?: string;
    /**
     * Restrict the offered operators (already resolved against engine
     * capabilities and property config). When omitted, all operators this
     * field can render are offered.
     */
    operators?: readonly VirtualTableWhereFilterOp[];
}

const operationLabels: Partial<Record<VirtualTableWhereFilterOp, string>> = {
    "==": "==",
    "!=": "!=",
    ">": ">",
    "<": "<",
    ">=": ">=",
    "<=": "<=",
    "not-in": "not in",
    in: "in",
    "array-contains": "Contains",
    "array-contains-any": "Any",
    "is-null": "Is null",
    "is-not-null": "Is not null"
};

const multipleSelectOperations = ["array-contains-any", "in"];

export function DateTimeFilterField({
    name,
    isArray,
    mode,
    value,
    setValue,
    title,
    timezone,
    operators
}: DateTimeFilterFieldProps) {

    const { locale } = useCustomizationController();
    let possibleOperations: (keyof typeof operationLabels)[] = isArray
        ? ["array-contains"]
        : ["==", "!=", ">", "<", ">=", "<=", "is-null", "is-not-null"];

    if (operators) {
        possibleOperations = possibleOperations.filter(op => (operators as readonly string[]).includes(op));
    }

    const [fieldOperation, fieldValue] = value || [possibleOperations[0], undefined];
    // Read back both the canonical null operators and the legacy `["==", null]` /
    // `["!=", null]` form saved by older filter presets.
    const [operation, setOperation] = useState<VirtualTableWhereFilterOp>(
        fieldOperation === "==" && fieldValue === null ? "is-null"
            : fieldOperation === "!=" && fieldValue === null ? "is-not-null"
                : fieldOperation
    );
    const [internalValue, setInternalValue] = useState<Date | null | undefined>(fieldValue as Date | null | undefined);

    const isNullOperation = operation === "is-null" || operation === "is-not-null";

    // All renderable operators were filtered out (engine/property narrowing).
    if (possibleOperations.length === 0) return null;

    function updateFilter(op: VirtualTableWhereFilterOp, val: Date | undefined | null) {
        // Null-testing operators ignore their value.
        if (op === "is-null" || op === "is-not-null") {
            setOperation(op);
            setInternalValue(null);
            setValue([op, null]);
            return;
        }

        let newValue: Date | Date[] | null | undefined = val;
        const prevOpIsArray = multipleSelectOperations.includes(operation);
        const newOpIsArray = multipleSelectOperations.includes(op);
        if (prevOpIsArray !== newOpIsArray) {
            newValue = newOpIsArray ? (val ? [val] : []) : undefined;
        }

        setOperation(op);
        setInternalValue(Array.isArray(newValue) ? newValue[0] ?? null : newValue);

        const hasNewValue = newValue !== null && Array.isArray(newValue)
            ? newValue.length > 0
            : newValue !== undefined;
        if (op && hasNewValue) {
            setValue(
                [op, newValue]
            );
        } else {
            setValue(
                undefined
            );
        }
    }

    return (

        <div className="flex w-full">
            <div className="w-[100px]">
                <Select value={operation}
                    size={"medium"}
                    fullWidth={true}
                    onValueChange={(value) => {
                        updateFilter(value as VirtualTableWhereFilterOp, internalValue);
                    }}
                    renderValue={(op) => operationLabels[op as keyof typeof operationLabels]}>
                    {possibleOperations.map((op) => (
                        <SelectItem key={op} value={op}>
                            {operationLabels[op]}
                        </SelectItem>
                    ))}
                </Select>
            </div>

            <div className="grow ml-2 flex flex-col gap-2">

                <DateTimeField
                    mode={mode}
                    size={"medium"}
                    locale={locale}
                    timezone={timezone}
                    disabled={isNullOperation}
                    value={isNullOperation ? undefined : (internalValue ?? undefined)}
                    onChange={(dateValue: Date | null) => {
                        updateFilter(operation, dateValue === null ? undefined : dateValue);
                    }}
                    clearable={true}
                />

            </div>

        </div>
    );

}
