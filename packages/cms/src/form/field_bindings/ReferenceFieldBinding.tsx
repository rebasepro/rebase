import { useSelectionDialog } from "../../hooks/useSelectionDialog";

import type { FieldProps } from "../../types/fields";
import type { Property, ReferenceProperty } from "@rebasepro/types";
import React, { useCallback, useMemo } from "react";

import { Entity, EntityReference } from "@rebasepro/types";
import { ErrorView } from "@rebasepro/app";
import { ReadOnlyFieldBinding } from "./ReadOnlyFieldBinding";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIconAndTooltip } from "../components/LabelWithIconAndTooltip";
import { EntityPreviewContainer } from "../../components/EntityPreviewBinding";
import { ReferencePreview } from "../../preview";
import { IconForView } from "@rebasepro/app";
import { getIconForProperty } from "../../util/property_utils";
import { getReferenceFrom } from "@rebasepro/common";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { cls } from "@rebasepro/ui";
import { useCollectionRegistryController } from "../../hooks/navigation/contexts/CollectionRegistryContext";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Field that opens a reference selection dialog.
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function ReferenceFieldBinding(props: FieldProps<ReferenceProperty>) {

    if (typeof props.property.path !== "string") {
        return <ReadOnlyFieldBinding {...props as FieldProps<Property>}/>
    }

    return <ReferenceFieldBindingInternal {...props}/>;

}

function ReferenceFieldBindingInternal({
    propertyKey,
    value,
    setValue,
    error,
    showError,
    isSubmitting,
    disabled,
    minimalistView,
    touched,
    autoFocus,
    property,
    includeDescription,
    hideLabel,
    size = "medium"
}: FieldProps<ReferenceProperty>) {
    if (!property.path) {
        throw new Error("Property path is required for ReferenceFieldBinding");
    }

    const refValue = value as EntityReference | null | undefined;

    useClearRestoreValue({
        property,
        value,
        setValue
    });

    const validValue = refValue && typeof refValue === "object" && "isEntityReference" in refValue && refValue.isEntityReference();

    const collectionRegistryController = useCollectionRegistryController();
    const collection: AdminCollection | undefined = useMemo(() => {
        return property.path ? collectionRegistryController.getCollection(property.path) : undefined;
    }, [property.path]);

    if (!collection) {
        throw Error(`Couldn't find the corresponding collection for the path: ${property.path}`);
    }

    const onSingleEntitySelected = useCallback((e: Entity<Record<string, unknown>> | null) => {
        const ref = e ? getReferenceFrom(e) : null;
        setValue(ref);
    }, [setValue, propertyKey]);

    const referenceDialogController = useSelectionDialog({
        multiselect: false,
        path: property.path,
        collection,
        onSingleEntitySelected,
        selectedEntityIds: validValue && refValue ? [refValue.id] : undefined,
        fixedFilter: property.admin?.fixedFilter
    }
    );

    const onEntryClick = (e: React.SyntheticEvent) => {
        e.preventDefault();
        referenceDialogController.open();
    };

    return (
        <>
            {!minimalistView && !hideLabel && <LabelWithIconAndTooltip
                propertyKey={propertyKey}
                icon={getIconForProperty(property, "small")}
                required={property.validation?.required}
                title={property.name ?? propertyKey}
                className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5"}/>}

            {!collection && <ErrorView
                error={"The specified collection does not exist. Check console"}/>}

            {collection && <>

                {refValue && <ReferencePreview
                    disabled={!property.path}
                    previewProperties={property.admin?.previewProperties}
                    hover={!disabled}
                    size={size}
                    onClick={disabled || isSubmitting ? undefined : onEntryClick}
                    reference={refValue}
                    includeEntityLink={property.admin?.includeEntityLink}
                    includeId={property.admin?.includeId}
                />}

                {!refValue && <div className="justify-center text-left">
                    <EntityPreviewContainer className={cls("px-6 h-12 text-sm font-medium flex items-center gap-6",
                        disabled || isSubmitting
                            ? "text-surface-accent-500"
                            : "cursor-pointer text-surface-accent-700 dark:text-surface-accent-300 hover:bg-surface-accent-50 dark:hover:bg-surface-800 group-hover:bg-surface-accent-50 dark:group-hover:bg-surface-800")}
                        onClick={onEntryClick}
                        size={"medium"}>
                        <IconForView collectionOrView={collection}
                            className={"text-surface-300 dark:text-surface-600"}/>
                        {`Edit ${property.name}`.toUpperCase()}
                    </EntityPreviewContainer>
                </div>}
            </>}

            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                disabled={disabled}
                property={property}/>

        </>
    );

}
