import React, { useMemo, useState } from "react";
import { VirtualTableWhereFilterOp } from "@rebasepro/ui";
import { SnapshotRelation, Relation } from "@rebasepro/types";
import { Checkbox, Label, Select, SelectItem } from "@rebasepro/ui";
import { RelationSelector } from "../../RelationSelector";

interface RelationFilterFieldProps {
    name: string,
    value?: [VirtualTableWhereFilterOp, SnapshotRelation | SnapshotRelation[] | null];
    setValue: (value?: [VirtualTableWhereFilterOp, SnapshotRelation | SnapshotRelation[] | null]) => void;
    relation: Relation; // relation config provided externally
    hidden: boolean;
    setHidden: (value: boolean) => void;
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
    "array-contains-any": "Contains Any"
};

const multipleSelectOperations = ["array-contains-any", "in", "not-in"];

export function RelationFilterField({
    value,
    setValue,
    relation,
    name: _name,
    hidden: _hidden,
    setHidden: _setHidden
}: RelationFilterFieldProps) {

    const manyRelation = relation.cardinality === "many";

    const possibleOperations: (keyof typeof operationLabels)[] = manyRelation
        ? ["array-contains", "array-contains-any"]
        : ["==", "!=", ">", "<", ">=", "<=", "in", "not-in"];

    const [fieldOperation, fieldValue] = value || [possibleOperations[0], undefined];
    const [operation, setOperation] = useState<VirtualTableWhereFilterOp>(fieldOperation);
    const [internalValue, setInternalValue] = useState<SnapshotRelation | SnapshotRelation[] | undefined | null>(fieldValue);

    function updateFilter(op: VirtualTableWhereFilterOp, val?: SnapshotRelation | SnapshotRelation[] | null) {

        const prevOpIsArray = multipleSelectOperations.includes(operation);
        const newOpIsArray = multipleSelectOperations.includes(op);
        let newValue = val;
        if (prevOpIsArray !== newOpIsArray) {
            newValue = newOpIsArray ? (newValue instanceof SnapshotRelation ? [newValue] : []) : undefined;
        }

        setOperation(op);
        setInternalValue(newValue);

        const hasNewValue = newValue !== null && Array.isArray(newValue)
            ? newValue.length > 0
            : newValue !== undefined;
        if (op && hasNewValue) {
            setValue([op, newValue ?? null]);
        } else {
            setValue(undefined);
        }
    }

    const multiple = multipleSelectOperations.includes(operation);

    const relationSelectorValue = useMemo(() => {
        if (internalValue === null || internalValue === undefined) return undefined;
        if (Array.isArray(internalValue)) return internalValue.map(ref => new SnapshotRelation(ref.id, ref.path));
        return new SnapshotRelation(internalValue.id, internalValue.path);
    }, [internalValue]);

    const handleRelationSelectorChange = (newVal?: SnapshotRelation | SnapshotRelation[] | null) => {
        if (newVal === null) {
            updateFilter(operation, null);
            return;
        }
        if (newVal === undefined) {
            updateFilter(operation, undefined);
            return;
        }
        updateFilter(operation, newVal);
    };

    return (
        <div className="flex flex-row">
            <div className="">
                <Select
                    value={operation}
                    fullWidth={true}
                    onValueChange={(newOp) => {
                        updateFilter(newOp as VirtualTableWhereFilterOp, internalValue);
                    }}
                    renderValue={(op) => operationLabels[op as VirtualTableWhereFilterOp]}
                >
                    {possibleOperations.map((op) => (
                        <SelectItem key={op} value={op}>
                            {operationLabels[op]}
                        </SelectItem>
                    ))}
                </Select>
            </div>

            <div className="grow ml-2 h-full gap-2 flex flex-col w-[340px]">
                <RelationSelector
                    relation={relation}
                    value={relationSelectorValue}
                    onValueChange={handleRelationSelectorChange}
                    disabled={internalValue === null}
                    size={"medium"}
                />

                {!manyRelation && <Label
                    className="border cursor-pointer rounded-md p-2 flex items-center gap-2 bg-surface-50 dark:bg-surface-900 hover:bg-surface-100 dark:hover:bg-surface-800"
                    htmlFor="null-filter"
                >
                    <Checkbox
                        id="null-filter"
                        checked={internalValue === null}
                        size={"small"}
                        onCheckedChange={() => {
                            if (internalValue !== null) updateFilter(operation, null);
                            else updateFilter(operation, undefined);
                        }}
                    />
                    Filter for null values
                </Label>}
            </div>
        </div>
    );
}
