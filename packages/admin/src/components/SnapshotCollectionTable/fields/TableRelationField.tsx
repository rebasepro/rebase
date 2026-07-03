import { useSnapshotSelectionDialog } from "../../../hooks/useSnapshotSelectionDialog";
import type { SnapshotCollection } from "@rebasepro/types";
import { getCollectionDataPath } from "@rebasepro/types";
import React, { useCallback } from "react";
import { deepEqual as equal } from "fast-equals"

import { RelationPreview } from "../../../preview";
import { CollectionSize, Snapshot, SnapshotRelation, FilterValues, Relation } from "@rebasepro/types";

import { getPreviewSizeFrom } from "../../../preview/util";
import { } from "@rebasepro/core";
import { ErrorView } from "@rebasepro/core";
import { cls, PencilIcon } from "@rebasepro/ui";
import { SnapshotPreviewContainer } from "../../SnapshotPreview";
import { getRelationFrom, normalizeToSnapshotRelation } from "@rebasepro/common";
import { TableMultipleRelationField } from "./TableMultipleRelationField";

type TableRelationFieldProps = {
    name: string;
    disabled: boolean;
    internalValue: SnapshotRelation | SnapshotRelation[] | undefined | null;
    updateValue: (newValue: (SnapshotRelation | SnapshotRelation[] | null)) => void;
    size: CollectionSize;
    multiselect: boolean;
    previewProperties?: string[];
    title?: string;
    relation: Relation;
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeSnapshotLink?: boolean;
};

export function TableRelationField(props: TableRelationFieldProps) {
    const collection = props.relation.target();

    // Check if this is a many-to-many relation
    const manyRelation = props.relation?.cardinality === "many";

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
            includeSnapshotLink={props.includeSnapshotLink}
        />;
    }

    return <TableRelationFieldInternal {...props} collection={collection}/>;
}

export const TableRelationFieldInternal = React.memo(
    function TableRelationFieldInternal(props: TableRelationFieldProps & {
        collection: SnapshotCollection;
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
            includeSnapshotLink
        } = props;

        const onSingleSnapshotSelected = useCallback((snapshot: Snapshot<any>) => {
            updateValue(snapshot ? getRelationFrom(snapshot) : null);
        }, [updateValue]);

        const onMultipleSnapshotsSelected = useCallback((snapshots: Snapshot<any>[]) => {
            updateValue(snapshots.map((e) => getRelationFrom(e)));
        }, [updateValue]);

        const selectedSnapshotIds = internalValue
            ? (Array.isArray(internalValue)
                ? internalValue.map((ref) => ref.id)
                : internalValue.id ? [internalValue.id] : [])
            : [];

        const relationDialogController = useSnapshotSelectionDialog({
            multiselect,
            path: getCollectionDataPath(collection),
            collection,
            onMultipleSnapshotsSelected,
            onSingleSnapshotSelected,
            selectedSnapshotIds,
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
            const normalizedRelation = normalizeToSnapshotRelation(internalValue);

            if (normalizedRelation)
                return <RelationPreview
                    onClick={disabled ? undefined : handleOpen}
                    size={getPreviewSizeFrom(size)}
                    relation={normalizedRelation}
                    hover={!disabled}
                    previewProperties={previewProperties}
                    includeId={includeId}
                    includeSnapshotLink={includeSnapshotLink}
                />;
            else
                return <SnapshotPreviewContainer
                    onClick={disabled ? undefined : handleOpen}
                    size={getPreviewSizeFrom(size)}>
                    <ErrorView title="Value is not a relation." error={"Click to edit"}/>
                </SnapshotPreviewContainer>;
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
                                includeSnapshotLink={includeSnapshotLink}
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
                    <SnapshotPreviewContainer
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
                    </SnapshotPreviewContainer>}

            </div>
        );
    }, equal);
