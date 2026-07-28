import React, { useId, useMemo, useState } from "react";
import { VirtualTableWhereFilterOp } from "@rebasepro/ui";
import { EntityRelation, Relation } from "@rebasepro/types";
import { Checkbox, Label, Select, SelectItem } from "@rebasepro/ui";
import { RelationSelector } from "../../RelationSelector";
import { isNullFilterOperator, nullFilterOperatorFor, valueOperatorFor } from "./null_filter";

/** Whether an authored relation yields many rows. Derived from its kind. */
function relationCardinality(relation: { kind?: string; cardinality?: string } | undefined): "one" | "many" | undefined {
    if (!relation) return undefined;
    if (relation.kind === "via") return relation.cardinality as "one" | "many" | undefined;
    if (relation.kind === "hasMany" || relation.kind === "manyToMany") return "many";
    if (relation.kind === "belongsTo" || relation.kind === "hasOne") return "one";
    return relation.cardinality as "one" | "many" | undefined;
}


interface RelationFilterFieldProps {
    name: string,
    value?: [VirtualTableWhereFilterOp, EntityRelation | EntityRelation[] | null];
    setValue: (value?: [VirtualTableWhereFilterOp, EntityRelation | EntityRelation[] | null]) => void;
    relation: Relation; // relation config provided externally
    hidden: boolean;
    setHidden: (value: boolean) => void;
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
    "is-null": "Is empty",
    "is-not-null": "Is not empty"
};

const multipleSelectOperations = ["array-contains-any", "in", "not-in"];

/**
 * What this field can render, before `operators` narrows it.
 *
 * Every relation gets the whole set. The value selector is told how many
 * values to take by the *operator* — see the `multiple` prop passed below —
 * so a to-many relation can be asked `== <one tag>` as readily as
 * `in <several>`, and the question of what shape the relation stores never
 * enters into it.
 *
 * That is a change: this list used to be split by the value the selector
 * produced, because the selector took its multiplicity from the relation's
 * cardinality and so a to-many one could only ever emit a list. Every
 * single-value operator had to be withheld to keep an array from reaching
 * `==`. `ReferenceFilterField` never had the problem — it has always sized its
 * dialog from the operator — which is what made the split look like a
 * property of relations rather than a limitation of one component.
 *
 * The array operators are the exception, and belong only to a to-many link,
 * which is the only one that *is* a list. On a to-one relation the filter
 * compiles to a comparison on a scalar foreign key, and `@>` against one is a
 * type error rather than an empty result.
 */
const RELATION_OPERATIONS: (keyof typeof operationLabels)[] =
    ["==", "!=", ">", "<", ">=", "<=", "in", "not-in", "is-null", "is-not-null"];
const LIST_ONLY_OPERATIONS: (keyof typeof operationLabels)[] =
    ["array-contains", "array-contains-any"];

/**
 * The operators this field will actually put on screen.
 *
 * Exported because the failure mode is silence: when the intersection of what
 * the field can render and what the engine can run comes out empty, the field
 * returns null and the filter control the table header offered opens onto
 * nothing. That is a rendering outcome no unit test of either side alone
 * catches, so the intersection itself is the thing worth pinning.
 */
export function renderableRelationOperators(
    relation: { kind?: string; cardinality?: string } | undefined,
    operators?: readonly VirtualTableWhereFilterOp[]
): (keyof typeof operationLabels)[] {
    const possible = relationCardinality(relation) === "many"
        ? [...RELATION_OPERATIONS, ...LIST_ONLY_OPERATIONS]
        : RELATION_OPERATIONS;
    if (!operators) return possible;
    return possible.filter(op => (operators as readonly string[]).includes(op));
}

export function RelationFilterField({
    value,
    setValue,
    relation,
    name: _name,
    hidden: _hidden,
    setHidden: _setHidden,
    operators
}: RelationFilterFieldProps) {

    const manyRelation = relationCardinality(relation) === "many";

    // The filters dialog renders every filterable property at once, and the
    // checkbox's id was the literal string "null-filter" — so clicking any
    // label toggled whichever checkbox the document matched first. Harmless
    // while one relation per table could show it; not once every relation can.
    const nullFilterId = useId();

    const possibleOperations = renderableRelationOperators(relation, operators);

    const [fieldOperation, fieldValue] = value || [possibleOperations[0], undefined];
    const [operation, setOperation] = useState<VirtualTableWhereFilterOp>(fieldOperation);
    const [internalValue, setInternalValue] = useState<EntityRelation | EntityRelation[] | undefined | null>(fieldValue);

    function updateFilter(op: VirtualTableWhereFilterOp, val?: EntityRelation | EntityRelation[] | null) {

        const prevOpIsArray = multipleSelectOperations.includes(operation);
        const newOpIsArray = multipleSelectOperations.includes(op);
        let newValue = val;
        if (prevOpIsArray !== newOpIsArray) {
            newValue = newOpIsArray ? (newValue instanceof EntityRelation ? [newValue] : []) : undefined;
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
            setValue([op, newValue ?? null]);
        } else {
            setValue(undefined);
        }
    }

    const multiple = multipleSelectOperations.includes(operation);
    const nullFiltered = isNullFilterOperator(operation);

    const relationSelectorValue = useMemo(() => {
        if (internalValue === null || internalValue === undefined) return undefined;
        if (Array.isArray(internalValue)) return internalValue.map(ref => new EntityRelation(ref.id, ref.path));
        return new EntityRelation(internalValue.id, internalValue.path);
    }, [internalValue]);

    const handleRelationSelectorChange = (newVal?: EntityRelation | EntityRelation[] | null) => {
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

    // All renderable operators were filtered out (engine/property narrowing).
    if (possibleOperations.length === 0) return null;

    return (
        <div className="flex flex-row">
            <div className="">
                <Select
                    value={operation}
                    fullWidth={true}
                    onValueChange={(newOp) => {
                        updateFilter(newOp as VirtualTableWhereFilterOp, internalValue);
                    }}
                    renderValue={(op) => operationLabels[op as keyof typeof operationLabels]}
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
                    // The operator, not the relation, decides how many values
                    // are being asked for — `updateFilter` already coerces the
                    // held value on the same test, so the two cannot disagree.
                    multiple={multiple}
                    value={relationSelectorValue}
                    onValueChange={handleRelationSelectorChange}
                    disabled={nullFiltered}
                    size={"medium"}
                />

                {/*
                  * Shown for a to-many relation too. It used to be hidden
                  * there because the only operators offered were the array
                  * ones, which have no null to ask about — but "posts with no
                  * tags" is the question a filter on a link is most often
                  * for, and the driver answers it with `NOT EXISTS`.
                  *
                  * It switches the operator to the matching null check rather
                  * than pairing a null value with whatever operator is
                  * selected. Only the operator travels to the driver, and
                  * `is-null` is a thing every engine implements; a null
                  * *operand* is not — see `nullFilterOperatorFor`.
                  */}
                <Label
                    className="border cursor-pointer rounded-md p-2 flex items-center gap-2 bg-surface-50 dark:bg-surface-900 hover:bg-surface-100 dark:hover:bg-surface-800"
                    htmlFor={nullFilterId}
                >
                    <Checkbox
                        id={nullFilterId}
                        checked={nullFiltered}
                        size={"small"}
                        onCheckedChange={() => {
                            if (!nullFiltered) updateFilter(nullFilterOperatorFor(operation), null);
                            else updateFilter(valueOperatorFor(operation, possibleOperations) ?? operation, undefined);
                        }}
                    />
                    {manyRelation ? "Filter for empty relations" : "Filter for null values"}
                </Label>
            </div>
        </div>
    );
}
