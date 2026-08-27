import { useSelectionDialog } from "../../../hooks/useSelectionDialog";

import React, { useCallback } from "react";
import { deepEqual as equal } from "fast-equals"

import { ReferencePreview } from "../../../preview";
import { Entity, EntityReference, FilterValues } from "@rebasepro/types";
import { CollectionSize, AdminCollection } from "@rebasepro/cms-types";

import { getPreviewSizeFrom } from "../../../preview/util";
import { useComponentOverride, ErrorView, CollectionScopeProvider } from "@rebasepro/app";
import { cls, PencilIcon } from "@rebasepro/ui";
import { EntityPreviewContainer } from "../../EntityPreviewBinding";
import { getReferenceFrom } from "@rebasepro/common";
import { useCollectionRegistryController } from "../../../hooks/navigation/contexts/CollectionRegistryContext";

type TableReferenceFieldProps = {
    name: string;
    disabled: boolean;
    internalValue: EntityReference | EntityReference[] | undefined | null;
    updateValue: (newValue: (EntityReference | EntityReference[] | null)) => void;
    size: CollectionSize;
    multiselect: boolean;
    previewProperties?: string[];
    title?: string;
    path: string;
    fixedFilter?: FilterValues<string>;
    includeId?: boolean;
    includeEntityLink?: boolean;
};

const DefaultMissingReference: React.FC<{ path: string }> = () => null;

function TableReferenceFieldResolver(props: TableReferenceFieldProps & { collection: AdminCollection | undefined }) {
    const ResolvedMissingReference = useComponentOverride("Entity.MissingReference", DefaultMissingReference);
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

    if (collection) {
        return (
            <CollectionScopeProvider collection={collection}>
                {content}
            </CollectionScopeProvider>
        );
    }
    return content;
}

export const TableReferenceFieldInternal = React.memo(
    function TableReferenceFieldInternal(props: TableReferenceFieldProps & {
        collection: AdminCollection;
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
            includeEntityLink
        } = props;

        const onSingleEntitySelected = useCallback((entity: Entity<any>) => {
            updateValue(entity ? getReferenceFrom(entity) : null);
        }, [updateValue]);

        const onMultipleEntitiesSelected = useCallback((entities: Entity<any>[]) => {
            updateValue(entities.map((e) => getReferenceFrom(e)));
        }, [updateValue]);

        const selectedEntityIds = internalValue
            ? (Array.isArray(internalValue)
                ? internalValue.map((ref) => ref.id)
                : internalValue.id ? [internalValue.id] : [])
            : [];

        const referenceDialogController = useSelectionDialog({
            multiselect,
            path,
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
            referenceDialogController.open();
        };

        const valueNotSet = !internalValue || (Array.isArray(internalValue) && internalValue.length === 0);

        const buildSingleReferenceField = () => {
            if (internalValue && !Array.isArray(internalValue) && internalValue.isEntityReference && internalValue.isEntityReference())
                return <ReferencePreview
                    onClick={disabled ? undefined : handleOpen}
                    size={getPreviewSizeFrom(size)}
                    reference={internalValue as EntityReference}
                    hover={!disabled}
                    disabled={!path}
                    previewProperties={previewProperties}
                    includeId={includeId}
                    includeEntityLink={includeEntityLink}
                />;
            else
                return <EntityPreviewContainer
                    onClick={disabled ? undefined : handleOpen}
                    size={getPreviewSizeFrom(size)}>
                    <ErrorView title="Value is not a reference." error={"Click to edit"}/>
                </EntityPreviewContainer>;
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
                                includeEntityLink={includeEntityLink}
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
