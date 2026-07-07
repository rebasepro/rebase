import { useSelectionDialog } from "../../../hooks/useSelectionDialog";
import type { CollectionConfig } from "@rebasepro/types";
import React, { useMemo, useState } from "react";
import { VirtualTableWhereFilterOp } from "@rebasepro/ui";
import { Entity, EntityReference } from "@rebasepro/types";
import { ReferencePreview } from "../../../preview";
import { Button, Checkbox, Label, Select, SelectItem } from "@rebasepro/ui";
import { getReferenceFrom } from "@rebasepro/common";
import { useTranslation } from "@rebasepro/core";
import { useCollectionRegistryController } from "../../../index";

interface ReferenceFilterFieldProps {
    name: string,
    value?: [op: VirtualTableWhereFilterOp, fieldValue: unknown];
    setValue: (filterValue?: [VirtualTableWhereFilterOp, unknown]) => void;
    isArray?: boolean;
    path?: string;
    title?: string;
    includeId?: boolean;
    previewProperties?: string[];
    hidden: boolean;
    setHidden: (hidden: boolean) => void;
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
    "array-contains-any": "Contains Any"
};

const multipleSelectOperations = ["array-contains-any", "in", "not-in"];

export function ReferenceFilterField({
    value,
    setValue,
    isArray,
    path,
    includeId = true,
    previewProperties,
    setHidden,
    operators
}: ReferenceFilterFieldProps) {
    const { t } = useTranslation();

    let possibleOperations: (keyof typeof operationLabels)[] = isArray
        ? ["array-contains"]
        : ["==", "!=", ">", "<", ">=", "<="];

    if (isArray) {
        possibleOperations.push("array-contains-any");
    } else {
        possibleOperations.push("in", "not-in");
    }

    if (operators) {
        possibleOperations = possibleOperations.filter(op => (operators as readonly string[]).includes(op));
    }

    const [fieldOperation, fieldValue] = value || [possibleOperations[0], undefined];
    const [operation, setOperation] = useState<VirtualTableWhereFilterOp>(fieldOperation);
    const [internalValue, setInternalValue] = useState<EntityReference | EntityReference[] | undefined | null>(fieldValue as EntityReference | EntityReference[] | undefined | null);

    const selectedEntityIds = internalValue
        ? (Array.isArray(internalValue) ? internalValue.map((ref) => {
            if (!(ref?.isEntityReference && ref?.isEntityReference())) {
                return null;
            }
            return ref.id;
        }).filter(Boolean) as string[] : [internalValue.id])
        : [];

    function updateFilter(op: VirtualTableWhereFilterOp, val?: EntityReference | EntityReference[] | null) {

        const prevOpIsArray = multipleSelectOperations.includes(operation);
        const newOpIsArray = multipleSelectOperations.includes(op);
        let newValue = val;
        if (prevOpIsArray !== newOpIsArray) {
            newValue = newOpIsArray
                ? (newValue && !Array.isArray(newValue) && newValue.isEntityReference?.() ? [newValue] : [])
                : undefined;
        }

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

    const collectionRegistryController = useCollectionRegistryController();
    const collection: CollectionConfig | undefined = useMemo(() => {
        return path ? collectionRegistryController.getCollection(path) : undefined;
    }, [path]);

    const onSingleEntitySelected = (entity: Entity<Record<string, unknown>>) => {
        updateFilter(operation, getReferenceFrom(entity));
    };

    const onMultipleEntitiesSelected = (entities: Entity<Record<string, unknown>>[]) => {
        updateFilter(operation, entities.map(e => getReferenceFrom(e)));
    };

    const multiple = multipleSelectOperations.includes(operation);

    const referenceDialogController = useSelectionDialog({
        multiselect: multiple,
        path,
        collection,
        onSingleEntitySelected,
        onMultipleEntitiesSelected,
        selectedEntityIds,
        onClose: () => {
            setHidden(false);
        }
    }
    );

    const doOpenDialog = () => {
        setHidden(true);
        referenceDialogController.open();
    };

    const buildEntry = (reference: EntityReference) => {
        return (
            <ReferencePreview
                disabled={!path}
                previewProperties={previewProperties}
                size={"medium"}
                onClick={doOpenDialog}
                reference={reference}
                hover={true}
                includeId={includeId}
                includeEntityLink={false}
            />
        );
    };

    // All renderable operators were filtered out (engine/property narrowing).
    if (possibleOperations.length === 0) return null;

    return (

        <div className="flex w-full flex-row">
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

            <div className="grow ml-2 h-full gap-2 flex flex-col">

                {internalValue && Array.isArray(internalValue) && <div>
                    {internalValue.map((ref, index) => buildEntry(ref))}
                </div>}

                {internalValue && !Array.isArray(internalValue) && <div>
                    {buildEntry(internalValue)}
                </div>}

                {(!internalValue || (Array.isArray(internalValue) && internalValue.length === 0)) &&
                    <Button onClick={doOpenDialog}

                        size={"medium"}
                        className="h-full w-full">
                        {multiple ? t("select_references") : t("select_reference")}
                    </Button>
                }

                {!isArray && <Label
                    className="border cursor-pointer rounded-md p-2 flex items-center gap-2 bg-surface-50 dark:bg-surface-900 hover:bg-surface-100 dark:hover:bg-surface-800"
                    htmlFor="null-filter"
                >
                    <Checkbox id="null-filter"
                        checked={internalValue === null}
                        size={"small"}
                        onCheckedChange={(checked) => {
                            if (internalValue !== null)
                                updateFilter(operation, null);
                            else updateFilter(operation, undefined);
                        }}/>
                    {t("filter_for_null_values")}
                </Label>}

            </div>

        </div>
    );

}
