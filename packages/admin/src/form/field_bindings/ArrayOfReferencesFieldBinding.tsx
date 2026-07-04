import { useSelectionDialog } from "../../hooks/useSelectionDialog";
import type { CollectionConfig } from "@rebasepro/types";
import type { FieldProps } from "../../types/fields";
import type { ArrayProperty, Property } from "@rebasepro/types";
import React, { useCallback, useMemo } from "react";
import { Snapshot, SnapshotReference } from "@rebasepro/types";
import { ReferencePreview } from "../../preview";
import { FieldHelperText, LabelWithIconAndTooltip } from "../components";
import { ArrayContainer, ArrayEntryParams } from "../../components/ArrayContainer";
import { getIconForProperty } from "../../util/property_utils";
import { getReferenceFrom } from "@rebasepro/common";

import { useTranslation, ErrorView } from "@rebasepro/core";
import { Button, cls, ExpandablePanel, fieldBackgroundMixin, PencilIcon, Typography } from "@rebasepro/ui";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { useCollectionRegistryController } from "../../index";

type ArrayOfReferencesFieldProps = FieldProps<ArrayProperty, SnapshotReference[]>;

/**
 * This field allows selecting multiple references.
 *
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function ArrayOfReferencesFieldBinding({
    propertyKey,
    value,
    error,
    showError,
    disabled,
    isSubmitting,
    minimalistView: minimalistViewProp,
    property,
    includeDescription,
    setValue,
    setFieldValue
}: ArrayOfReferencesFieldProps) {

    const minimalistView = minimalistViewProp || property.ui?.minimalistView;
    const { t } = useTranslation();

    const ofProperty = property.of as Property;
    if (ofProperty.type !== "reference") {
        throw Error("ArrayOfReferencesField expected a property containing references");
    }

    const expanded = property.ui?.expanded === undefined ? true : property.ui?.expanded;
    const selectedSnapshotIds = value && Array.isArray(value) ? value.map((ref) => ref.id) : [];

    useClearRestoreValue({
        property,
        value,
        setValue
    });

    const collectionRegistryController = useCollectionRegistryController();
    const collection: CollectionConfig | undefined = useMemo(() => {
        return ofProperty.path ? collectionRegistryController.getCollection(ofProperty.path) : undefined;
    }, [ofProperty.path]);

    if (!collection) {
        throw Error(`Couldn't find the corresponding collection for the path: ${ofProperty.path}`);
    }

    const onMultipleSnapshotsSelected = useCallback((snapshots: Snapshot<Record<string, unknown>>[]) => {
        const refs = snapshots.map(e => getReferenceFrom(e));
        setValue(refs);
    }, [setValue]);

    const referenceDialogController = useSelectionDialog({
        multiselect: true,
        path: ofProperty.path,
        collection,
        onMultipleSnapshotsSelected,
        selectedSnapshotIds,
        fixedFilter: ofProperty.fixedFilter
    }
    );

    const onEntryClick = (e: React.SyntheticEvent) => {
        e.preventDefault();
        referenceDialogController.open();
    };

    const buildEntry = useCallback(({
        index,
        internalId,
        storedProps,
        storeProps
    }: ArrayEntryParams) => {
        const entryValue = value && value.length > index ? value[index] : undefined;
        if (!entryValue)
            return <div>Internal ERROR</div>;
        return (
            <ReferencePreview
                key={internalId}
                disabled={!ofProperty.path}
                previewProperties={ofProperty.ui?.previewProperties}
                size={"medium"}
                onClick={onEntryClick}
                hover={!disabled}
                reference={entryValue}
                includeId={ofProperty.includeId}
                includeSnapshotLink={ofProperty.includeSnapshotLink}
            />
        );
    }, [ofProperty.path, ofProperty.ui?.previewProperties, value]);

    const title = (<>
        <LabelWithIconAndTooltip
            propertyKey={propertyKey}
            icon={getIconForProperty(property, "small")}
            required={property.validation?.required}
            title={property.name ?? propertyKey}
            className={"h-8 flex grow text-text-secondary dark:text-text-secondary-dark"}/>
        {Array.isArray(value) && <Typography variant={"caption"} className={"px-4"}>({value.length})</Typography>}
    </>);

    const body = <>
        {!collection && <ErrorView
            error={"The specified collection does not exist. Check console"}/>}

        {collection && <div className={"group"}>

            <ArrayContainer droppableId={propertyKey}
                value={value}
                disabled={isSubmitting}
                buildEntry={buildEntry}
                canAddElements={false}
                addLabel={property.name ? t("add_reference_to", { name: property.name }) : t("add_reference")}
                newDefaultEntry={property.of && "defaultValue" in property.of ? property.of?.defaultValue : null}
                onValueChange={(value) => setFieldValue(propertyKey, value)}
            />

            <Button
                className="ml-3.5 my-4 justify-center text-left"
                variant="text"
                disabled={isSubmitting}
                onClick={onEntryClick}>
                <PencilIcon size={16}/>
                {t("edit")} {property.name}
            </Button>
        </div>}
    </>;

    return (
        <>

            {!minimalistView &&
                <ExpandablePanel
                    titleClassName={fieldBackgroundMixin}
                    innerClassName={cls("px-2 md:px-4 pb-2 md:pb-4 pt-1 md:pt-2", fieldBackgroundMixin)}
                    initiallyExpanded={expanded}
                    title={title}>
                    {body}
                </ExpandablePanel>}

            {minimalistView && body}

            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                disabled={disabled}
                property={property}/>

        </>
    );
}
