import { useSelectionDialog } from "../../../hooks/useSelectionDialog";

import { getCollectionDataPath } from "@rebasepro/types";
import React, { useCallback } from "react";
import { deepEqual as equal } from "fast-equals"

import { RelationPreview } from "../../../preview";
import { Entity, EntityRelation, FilterValues, Relation } from "@rebasepro/types";
import { CollectionSize, AdminCollection } from "@rebasepro/cms-types";

import { getPreviewSizeFrom } from "../../../preview/util";
import { } from "@rebasepro/app";
import { ErrorView } from "@rebasepro/app";
import { cls, PencilIcon } from "@rebasepro/ui";
import { EntityPreviewContainer } from "../../EntityPreviewBinding";
import { getRelationFrom, normalizeToEntityRelation } from "@rebasepro/common";
import { TableMultipleRelationField } from "./TableMultipleRelationField";

/** Whether an authored relation yields many rows. Derived from its kind. */
function relationCardinality(relation: { kind?: string; cardinality?: string } | undefined): "one" | "many" | undefined {
    if (!relation) return undefined;
    if (relation.kind === "via") return relation.cardinality as "one" | "many" | undefined;
    if (relation.kind === "hasMany" || relation.kind === "manyToMany") return "many";
    if (relation.kind === "belongsTo" || relation.kind === "hasOne") return "one";
    return relation.cardinality as "one" | "many" | undefined;
}


type TableRelationFieldProps = {
    name: string;
    disabled: boolean;
    internalValue: EntityRelation | EntityRelation[] | undefined | null;
    updateValue: (newValue: (EntityRelation | EntityRelation[] | null)) => void;
    size: CollectionSize;
    multiselect: boolean;
    previewProperties?: string[];
    title?: string;
    relation: Relation;
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeEntityLink?: boolean;
};

export function TableRelationField(props: TableRelationFieldProps) {
    const collection = props.relation.target();

    // Check if this is a many-to-many relation
    const manyRelation = relationCardinality(props.relation) === "many";

    if (manyRelation) {
        return <TableMultipleRelationField
            name={props.name}
            disabled={props.disabled}
            internalValue={Array.isArray(props.internalValue) ? props.internalValue : []}
            updateValue={(newValue) => props.updateValue(newValue)}
            size={props.size}
            previewProperties={props.previewProperties}
            title={props.title}
            relation={props.relation}
            fixedFilter={props.fixedFilter}
            includeId={props.includeId}
            includeEntityLink={props.includeEntityLink}
        />;
    }

    return <TableRelationFieldInternal {...props} collection={collection}/>;
}

export const TableRelationFieldInternal = React.memo(
    function TableRelationFieldInternal(props: TableRelationFieldProps & {
        collection: AdminCollection;
    }) {
        const {
            name,
            internalValue,
            updateValue,
            multiselect,
            relation,
            size,
            previewProperties,
            title,
            disabled,
            fixedFilter,
            collection,
            includeId,
            includeEntityLink
        } = props;

        const onSingleEntitySelected = useCallback((entity: Entity<any>) => {
            updateValue(entity ? getRelationFrom(entity) : null);
        }, [updateValue]);

        const onMultipleEntitiesSelected = useCallback((entities: Entity<any>[]) => {
            updateValue(entities.map((e) => getRelationFrom(e)));
        }, [updateValue]);

        const selectedEntityIds = internalValue
            ? (Array.isArray(internalValue)
                ? internalValue.map((ref) => ref.id)
                : internalValue.id ? [internalValue.id] : [])
            : [];

        const relationDialogController = useSelectionDialog({
            multiselect,
            path: getCollectionDataPath(collection),
            collection,
            onMultipleEntitiesSelected,
            onSingleEntitySelected,
            selectedEntityIds,
            fixedFilter
        }
        );

        const handleOpen = () => {
            if (disabled)
                return;
            relationDialogController.open();
        };

        const valueNotSet = !internalValue || (Array.isArray(internalValue) && internalValue.length === 0);

        const buildSingleRelationField = () => {
            const normalizedRelation = normalizeToEntityRelation(internalValue);

            if (normalizedRelation)
                return <RelationPreview
                    onClick={disabled ? undefined : handleOpen}
                    size={getPreviewSizeFrom(size)}
                    relation={normalizedRelation}
                    hover={!disabled}
                    previewProperties={previewProperties}
                    includeId={includeId}
                    includeEntityLink={includeEntityLink}
                />;
            else
                return <EntityPreviewContainer
                    onClick={disabled ? undefined : handleOpen}
                    size={getPreviewSizeFrom(size)}>
                    <ErrorView title="Value is not a relation." error={"Click to edit"}/>
                </EntityPreviewContainer>;
        };

        const buildMultipleRelationField = () => {
            if (Array.isArray(internalValue))
                return <>
                    {internalValue.map((relationItem, index) =>
                        <div className="w-full my-0.5"
                            key={`preview_array_ref_${name}_${index}`}>
                            <RelationPreview
                                onClick={disabled ? undefined : handleOpen}
                                size={"small"}
                                relation={relationItem}
                                hover={!disabled}
                                previewProperties={previewProperties}
                                includeId={includeId}
                                includeEntityLink={includeEntityLink}
                            />
                        </div>
                    )
                    }
                </>;
            else
                return <ErrorView error={"Data is not an array of relations"}/>;
        };

        if (!collection)
            return <ErrorView error={"The specified collection does not exist"}/>;

        return (
            <div className="w-full group">

                {internalValue && !multiselect && buildSingleRelationField()}

                {internalValue && multiselect && buildMultipleRelationField()}

                {valueNotSet &&
                    <EntityPreviewContainer
                        className={cls("px-3 py-2 text-sm font-medium flex items-center",
                            multiselect ? "gap-4" : "gap-6",
                            disabled
                                ? "text-surface-accent-500"
                                : "cursor-pointer text-text-secondary dark:text-text-secondary-dark hover:bg-surface-accent-50 dark:hover:bg-surface-800 group-hover:bg-surface-accent-50 dark:group-hover:bg-surface-800")}
                        onClick={handleOpen}
                        size={"medium"}>
                        <PencilIcon
                            className={"ml-2 mr-1 text-surface-300 dark:text-surface-600"}/>
                        {title}
                    </EntityPreviewContainer>}

            </div>
        );
    }, equal);
