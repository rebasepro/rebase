import { useSelectionDialog } from "../../../hooks/useSelectionDialog";

import React, { useId, useMemo, useState } from "react";
import { VirtualTableWhereFilterOp } from "@rebasepro/ui";
import { Entity, EntityReference } from "@rebasepro/types";
import { ReferencePreview } from "../../../preview";
import { Button, Checkbox, Label, Select, SelectItem } from "@rebasepro/ui";
import { getReferenceFrom } from "@rebasepro/common";
import { useTranslation } from "@rebasepro/app";
import { useCollectionRegistryController } from "../../../hooks/navigation/contexts/CollectionRegistryContext";
import type { AdminCollection } from "@rebasepro/cms-types";
import { isNullFilterOperator, nullFilterOperatorFor, valueOperatorFor } from "./null_filter";

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
    "array-contains-any": "Contains Any",
    "is-null": "Is null",
    "is-not-null": "Is not null"
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

    // The null checks take no operand, so they apply either way.
    possibleOperations.push("is-null", "is-not-null");

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

        // A null check takes no operand, so it is complete on its own — the
        // value gate below would otherwise clear the filter the moment one is
        // chosen from the dropdown, where there is no value to accompany it.
        if (isNullFilterOperator(op)) {
            setValue([op, null]);
            return;
        }

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
    const collection: AdminCollection | undefined = useMemo(() => {
        return path ? collectionRegistryController.getCollection(path) : undefined;
    }, [path]);

    const onSingleEntitySelected = (entity: Entity<Record<string, unknown>>) => {
        updateFilter(operation, getReferenceFrom(entity));
    };

    const onMultipleEntitiesSelected = (entities: Entity<Record<string, unknown>>[]) => {
        updateFilter(operation, entities.map(e => getReferenceFrom(e)));
    };

    const multiple = multipleSelectOperations.includes(operation);
    const nullFiltered = isNullFilterOperator(operation);

    // The filters dialog renders every filterable property at once, and this
    // id was the literal string "null-filter" — so clicking any label toggled
    // whichever checkbox the document matched first, never the one clicked.
    const nullFilterId = useId();

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

                {/*
                  * Switches the operator to the matching null check rather
                  * than pairing a null value with whatever operator is
                  * selected. Only the operator travels to the driver, and a
                  * null *operand* means different things to different ones —
                  * Mongo rejects `$in: null` outright. See
                  * `nullFilterOperatorFor`.
                  */}
                {!isArray && <Label
                    className="border cursor-pointer rounded-md p-2 flex items-center gap-2 bg-surface-50 dark:bg-surface-900 hover:bg-surface-100 dark:hover:bg-surface-800"
                    htmlFor={nullFilterId}
                >
                    <Checkbox id={nullFilterId}
                        checked={nullFiltered}
                        size={"small"}
                        onCheckedChange={() => {
                            if (!nullFiltered) updateFilter(nullFilterOperatorFor(operation), null);
                            else updateFilter(valueOperatorFor(operation, possibleOperations) ?? operation, undefined);
                        }}/>
                    {t("filter_for_null_values")}
                </Label>}

            </div>

        </div>
    );

}
