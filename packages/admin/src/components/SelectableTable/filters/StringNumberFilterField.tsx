import React, { useState } from "react";
import { EnumValuesChip } from "../../../preview";
import {
    IconButton,
    MultiSelect,
    MultiSelectItem,
    Select,
    SelectItem,
    TextField,
    VirtualTableWhereFilterOp,
    XIcon
} from "@rebasepro/ui";
import { EnumValueConfig } from "@rebasepro/types";
import { useTranslation } from "@rebasepro/app";

interface StringNumberFilterFieldProps {
    name: string,
    type: "string" | "number";
    value?: [op: VirtualTableWhereFilterOp, fieldValue: unknown];
    setValue: (value?: [op: VirtualTableWhereFilterOp, newValue: unknown]) => void;
    isArray?: boolean;
    enumValues?: EnumValueConfig[];
    title?: string;
    /**
     * Restrict the offered operators (already resolved against engine
     * capabilities and property config). When omitted, all operators this
     * field can render are offered.
     */
    operators?: readonly VirtualTableWhereFilterOp[];
}

const operationLabels = {
    "==": "==",
    "!=": "!=",
    ">": ">",
    "<": "<",
    ">=": ">=",
    "<=": "<=",
    in: "In",
    "not-in": "Not in",
    "array-contains": "Contains",
    "array-contains-any": "Any",
    "ilike": "Contains",
    "not-ilike": "Not contains",
    "is-null": "Is null",
    "is-not-null": "Is not null"
};

const multipleSelectOperations = ["array-contains-any", "in", "not-in"];

/** Operators that match a substring, wrapped in SQL wildcards (`%value%`). */
const containsOperations = ["ilike", "not-ilike"];

/** Strip the surrounding `%` wildcards a contains-filter adds, for display. */
function unwrapContains(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.replace(/^%/, "").replace(/%$/, "");
}

export function StringNumberFilterField({
                                            name,
                                            value,
                                            setValue,
                                            type,
                                            isArray,
                                            enumValues,
                                            title,
                                            operators
                                        }: StringNumberFilterFieldProps) {
    const { t } = useTranslation();

    let possibleOperations: (keyof typeof operationLabels)[] = isArray
        ? ["array-contains"]
        : ["==", "!=", ">", "<", ">=", "<=", "is-null", "is-not-null"];

    // Case-insensitive substring matching is only meaningful for free-text
    // string columns (not numbers, arrays, or enums).
    if (!isArray && !enumValues && type === "string") {
        possibleOperations.push("ilike", "not-ilike");
    }

    if (enumValues) {
        if (isArray) {
            possibleOperations.push("array-contains-any");
        } else {
            possibleOperations.push("in", "not-in");
        }
    }

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
    const [internalValue, setInternalValue] = useState<string | number | string[] | number[] | null | undefined>(
        containsOperations.includes(fieldOperation) ? unwrapContains(fieldValue) : (fieldValue as string | number | string[] | number[] | null | undefined)
    );

    const isNullOperation = operation === "is-null" || operation === "is-not-null";

    // All renderable operators were filtered out (engine/property narrowing).
    if (possibleOperations.length === 0) return null;

    function updateFilter(op: VirtualTableWhereFilterOp, val: string | number | string[] | number[] | null | undefined) {
        // Null-testing operators ignore their value.
        if (op === "is-null" || op === "is-not-null") {
            setOperation(op);
            setInternalValue(null);
            setValue([op, null]);
            return;
        }

        // Substring matching: keep the raw text in the field, emit it wrapped
        // in SQL wildcards so the backend runs `column ILIKE '%value%'`.
        if (op === "ilike" || op === "not-ilike") {
            const raw = typeof val === "string" ? val : "";
            setOperation(op);
            setInternalValue(raw);
            if (raw.length > 0) {
                setValue([op, `%${raw}%`]);
            } else {
                setValue(undefined);
            }
            return;
        }

        let newValue = val;
        const prevOpIsArray = multipleSelectOperations.includes(operation);
        const newOpIsArray = multipleSelectOperations.includes(op);
        if (prevOpIsArray !== newOpIsArray) {
            if (newOpIsArray) {
                if (typeof val === "string") newValue = [val];
                else if (typeof val === "number") newValue = [val];
                else newValue = [];
            } else {
                newValue = undefined;
            }
        }

        if (typeof newValue === "number" && isNaN(newValue))
            newValue = undefined;

        setOperation(op);
        setInternalValue(newValue);

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

    const multiple = multipleSelectOperations.includes(operation);

    return (

        <div className="flex w-full">
            <div className={"w-[100px]"}>
                <Select value={operation}
                        size={"medium"}
                        fullWidth={true}
                        position={"item-aligned"}
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

                {!enumValues && <TextField
                    size={"medium"}
                    aria-label={`${title ?? name} filter value`}
                    type={type === "number" ? "number" : undefined}
                    value={internalValue !== undefined && internalValue != null ? String(internalValue) : ""}
                    disabled={isNullOperation}
                    placeholder={isNullOperation ? "null" : undefined}
                    onChange={(evt) => {
                        const val = type === "number"
                            ? parseFloat(evt.target.value)
                            : evt.target.value;
                        updateFilter(operation, val);
                    }}
                    endAdornment={internalValue !== undefined && internalValue != null && <IconButton
                        onClick={(e) => updateFilter(operation, undefined)}>
                        <XIcon/>
                    </IconButton>}
                />}

                {enumValues && !multiple &&
                    <Select
                        size={"medium"}
                        position={"item-aligned"}
                        fullWidth={true}
                        disabled={isNullOperation}
                        value={typeof internalValue === "string" ? internalValue : ""}
                        onValueChange={(value) => {
                            if (value !== "")
                                updateFilter(operation, type === "number" ? parseInt(value as string) : value as string)
                        }}
                        endAdornment={internalValue && <IconButton
                            onClick={(e) => updateFilter(operation, undefined)}>
                            <XIcon/>
                        </IconButton>}
                        renderValue={(enumKey) => {
                            if (enumKey === null)
                                return t("filter_for_null_values");
                            if (enumKey === undefined)
                                return null;

                            return <EnumValuesChip
                                key={`select_value_${name}_${enumKey}`}
                                enumKey={enumKey}
                                enumValues={enumValues}
                                size={"small"}/>;
                        }}>
                        {enumValues.map((enumConfig) => (
                            <SelectItem key={`select_item_${name}_${enumConfig.id}`}
                                        value={String(enumConfig.id)}>
                                <EnumValuesChip
                                    enumKey={String(enumConfig.id)}
                                    enumValues={enumValues}
                                    size={"small"}/>
                            </SelectItem>
                        ))}
                    </Select>
                }

                {enumValues && multiple &&
                    <MultiSelect
                        size={"medium"}
                        position={"item-aligned"}
                        value={Array.isArray(internalValue) ? internalValue.map(e => String(e)) : []}
                        disabled={isNullOperation}
                        onValueChange={(value) => {
                            updateFilter(operation, type === "number" ? (value ?? []).map(v => parseInt(v)) : value)
                        }}
                        multiple={multiple}
                        endAdornment={internalValue && <IconButton
                            className="absolute right-2 top-3"
                            onClick={(e) => updateFilter(operation, undefined)}>
                            <XIcon/>
                        </IconButton>}
                    >
                        {enumValues.map((enumConfig) => (
                            <MultiSelectItem key={`select_value_${name}_${enumConfig.id}`}
                                             value={String(enumConfig.id)}>
                                <EnumValuesChip
                                    enumKey={String(enumConfig.id)}
                                    enumValues={enumValues}
                                    size={"small"}/>
                            </MultiSelectItem>
                        ))}
                    </MultiSelect>
                }

            </div>

        </div>
    );

}
