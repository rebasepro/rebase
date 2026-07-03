import { useSnapshotSelectionDialog } from "../../../hooks/useSnapshotSelectionDialog";
import type { SnapshotCollection } from "@rebasepro/types";
import { getCollectionDataPath } from "@rebasepro/types";
import React, { useCallback } from "react";
import { deepEqual as equal } from "fast-equals";

import { cls, PencilIcon } from "@rebasepro/ui";
import { getRelationFrom, normalizeToSnapshotRelation } from "@rebasepro/common";

import { RelationPreview } from "../../../preview";
import { CollectionSize, Snapshot, SnapshotRelation, FilterValues, Relation } from "@rebasepro/types";
import { } from "@rebasepro/core";
import { ErrorView } from "@rebasepro/core";
import { SnapshotPreviewContainer } from "../../SnapshotPreview";

type TableMultipleRelationFieldProps = {
    name: string;
    disabled: boolean;
    internalValue: SnapshotRelation[] | undefined | null;
    updateValue: (newValue: SnapshotRelation[] | null) => void;
    size: CollectionSize;
    previewProperties?: string[];
    title?: string;
    relation: Relation;
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeSnapshotLink?: boolean;
};

export function TableMultipleRelationField(props: TableMultipleRelationFieldProps) {
    const collection = props.relation.target();
    return <TableMultipleRelationFieldInternal {...props} collection={collection}/>;
}

export const TableMultipleRelationFieldInternal = React.memo(
    function TableMultipleRelationFieldInternal(props: TableMultipleRelationFieldProps & {
        collection: SnapshotCollection;
    }) {
        const {
            name,
            internalValue,
            updateValue,
            previewProperties,
            title,
            disabled,
            fixedFilter,
            collection,
            includeId,
            includeSnapshotLink
        } = props;

        const value = Array.isArray(internalValue) ? internalValue : [];

        const onMultipleSnapshotsSelected = useCallback((snapshots: Snapshot<any>[]) => {
            updateValue(snapshots.map(e => getRelationFrom(e)));
        }, [updateValue]);

        const selectedSnapshotIds = value.map((ref) => ref.id);

        const relationDialogController = useSnapshotSelectionDialog({
            multiselect: true,
            path: getCollectionDataPath(collection),
            collection,
            onMultipleSnapshotsSelected,
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

        const buildMultipleRelationField = () => {
            if (Array.isArray(internalValue))
                return <>
                    {internalValue.map((item, index) => {
                        const relationItem = normalizeToSnapshotRelation(item);

                        if (!relationItem) return null;

                        return (
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
                        );
                    })
                    }
                </>;
            else
                return <ErrorView error={"Data is not an array of relations"}/>;
        };

        if (!collection)
            return <ErrorView error={"The specified collection does not exist"}/>;

        return (
            <div className="w-full group">

                {internalValue && buildMultipleRelationField()}

                {valueNotSet &&
                    <SnapshotPreviewContainer
                        className={cls("px-3 py-2 text-sm font-medium flex items-center gap-4",
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
