import React, { useMemo, useState } from "react";
import { VirtualTableWhereFilterOp } from "@rebasepro/ui";
import { EntityRelation, Relation } from "@rebasepro/types";
import { Checkbox, Label, Select, SelectItem } from "@rebasepro/ui";
import { RelationSelector } from "../../RelationSelector";

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
    "array-contains-any": "Contains Any"
};

const multipleSelectOperations = ["array-contains-any", "in", "not-in"];

/**
 * What this field can render, before `operators` narrows it.
 *
 * Split by the *value* the selector produces, not by the relation's meaning.
 * `RelationSelector` takes its multiplicity from the relation's cardinality, so
 * on a to-many relation it only ever emits a list — and an operator that wants
 * a single value would receive an array and compile to nonsense. The to-many
 * list is therefore the list-valued operators only.
 *
 * `in` and `not-in` are not a lesser `==`/`!=` here: on a to-many relation they
 * are "has any of these" and "has none of these", which is what a filter on a
 * multi-valued link means. A single value is the one-element case of each.
 *
 * The array operators stay for the property that is an *array of* relations,
 * where the column really does hold a list.
 */
const MULTI_VALUE_OPERATIONS: (keyof typeof operationLabels)[] =
    ["array-contains", "array-contains-any", "in", "not-in"];
const SINGLE_VALUE_OPERATIONS: (keyof typeof operationLabels)[] =
    ["==", "!=", ">", "<", ">=", "<=", "in", "not-in"];

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
        ? MULTI_VALUE_OPERATIONS
        : SINGLE_VALUE_OPERATIONS;
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
