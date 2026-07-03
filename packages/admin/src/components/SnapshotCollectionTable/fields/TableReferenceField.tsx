import { useSnapshotSelectionDialog } from "../../../hooks/useSnapshotSelectionDialog";
import type { SnapshotCollection } from "@rebasepro/types";
import React, { useCallback } from "react";
import { deepEqual as equal } from "fast-equals"

import { ReferencePreview } from "../../../preview";
import { CollectionSize, Snapshot, SnapshotReference, FilterValues } from "@rebasepro/types";

import { getPreviewSizeFrom } from "../../../preview/util";
import { useComponentOverride, ErrorView, CollectionComponentOverrideProvider } from "@rebasepro/core";
import { cls, PencilIcon } from "@rebasepro/ui";
import { SnapshotPreviewContainer } from "../../SnapshotPreview";
import { getReferenceFrom } from "@rebasepro/common";
import { useCollectionRegistryController } from "../../../index";

type TableReferenceFieldProps = {
    name: string;
    disabled: boolean;
    internalValue: SnapshotReference | SnapshotReference[] | undefined | null;
    updateValue: (newValue: (SnapshotReference | SnapshotReference[] | null)) => void;
    size: CollectionSize;
    multiselect: boolean;
    previewProperties?: string[];
    title?: string;
    path: string;
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeSnapshotLink?: boolean;
};

const DefaultMissingReference: React.FC<{ path: string }> = () => null;

function TableReferenceFieldResolver(props: TableReferenceFieldProps & { collection: SnapshotCollection | undefined }) {
    const ResolvedMissingReference = useComponentOverride("Snapshot.MissingReference", DefaultMissingReference);
    const { path, collection } = props;

    if (!collection) {
        if (ResolvedMissingReference !== DefaultMissingReference) {
            return <ResolvedMissingReference path={path}/>;
        } else {
            return <ErrorView error={`Collection not found: ${path}`}/>;
        }
    }
    return <TableReferenceFieldInternal {...props} collection={collection}/>;
}

export function TableReferenceField(props: TableReferenceFieldProps) {
    const collectionRegistryController = useCollectionRegistryController();
    const { path } = props;
    const collection = collectionRegistryController.getCollection(path);

    const content = (
        <TableReferenceFieldResolver
            {...props}
            collection={collection}
        />
    );

    if (collection?.components) {
        return (
            <CollectionComponentOverrideProvider overrides={collection.components}>
                {content}
            </CollectionComponentOverrideProvider>
        );
    }
    return content;
}

export const TableReferenceFieldInternal = React.memo(
    function TableReferenceFieldInternal(props: TableReferenceFieldProps & {
        collection: SnapshotCollection;
    }) {
        const {
            name,
            internalValue,
            updateValue,
            multiselect,
            path,
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
            updateValue(snapshot ? getReferenceFrom(snapshot) : null);
        }, [updateValue]);

        const onMultipleSnapshotsSelected = useCallback((snapshots: Snapshot<any>[]) => {
            updateValue(snapshots.map((e) => getReferenceFrom(e)));
        }, [updateValue]);

        const selectedSnapshotIds = internalValue
            ? (Array.isArray(internalValue)
                ? internalValue.map((ref) => ref.id)
                : internalValue.id ? [internalValue.id] : [])
            : [];

        const referenceDialogController = useSnapshotSelectionDialog({
            multiselect,
            path,
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
            referenceDialogController.open();
        };

        const valueNotSet = !internalValue || (Array.isArray(internalValue) && internalValue.length === 0);

        const buildSingleReferenceField = () => {
            if (internalValue && !Array.isArray(internalValue) && internalValue.isSnapshotReference && internalValue.isSnapshotReference())
                return <ReferencePreview
                    onClick={disabled ? undefined : handleOpen}
                    size={getPreviewSizeFrom(size)}
                    reference={internalValue as SnapshotReference}
                    hover={!disabled}
                    disabled={!path}
                    previewProperties={previewProperties}
                    includeId={includeId}
                    includeSnapshotLink={includeSnapshotLink}
                />;
            else
                return <SnapshotPreviewContainer
                    onClick={disabled ? undefined : handleOpen}
                    size={getPreviewSizeFrom(size)}>
                    <ErrorView title="Value is not a reference." error={"Click to edit"}/>
                </SnapshotPreviewContainer>;
        };

        const buildMultipleReferenceField = () => {
            if (Array.isArray(internalValue))
                return <>
                    {internalValue.map((reference, index) =>
                        <div className="w-full my-0.5"
                            key={`preview_array_ref_${name}_${index}`}>
                            <ReferencePreview
                                onClick={disabled ? undefined : handleOpen}
                                size={"small"}
                                reference={reference}
                                hover={!disabled}
                                disabled={!path}
                                previewProperties={previewProperties}
                                includeId={includeId}
                                includeSnapshotLink={includeSnapshotLink}
                            />
                        </div>
                    )
                    }
                </>;
            else
                return <ErrorView error={"Data is not an array of references"}/>;
        };

        if (!collection)
            return <ErrorView error={"The specified collection does not exist"}/>;

        return (
            <div className="w-full group">

                {internalValue && !multiselect && buildSingleReferenceField()}

                {internalValue && multiselect && buildMultipleReferenceField()}

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
