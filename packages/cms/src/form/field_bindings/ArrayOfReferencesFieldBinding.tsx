import { useSelectionDialog } from "../../hooks/useSelectionDialog";

import type { FieldProps } from "../../types/fields";
import type { ArrayProperty, Property } from "@rebasepro/types";
import React, { useCallback, useMemo } from "react";
import { Entity, EntityReference } from "@rebasepro/types";
import { ReferencePreview } from "../../preview";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIconAndTooltip } from "../components/LabelWithIconAndTooltip";
import { ArrayContainer, ArrayEntryParams } from "../../components/ArrayContainer";
import { getIconForProperty } from "../../util/property_utils";
import { getReferenceFrom } from "@rebasepro/common";

import { useTranslation, ErrorView } from "@rebasepro/app";
import { Button, cls, ExpandablePanel, fieldBackgroundMixin, PencilIcon, Typography } from "@rebasepro/ui";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { useCollectionRegistryController } from "../../hooks/navigation/contexts/CollectionRegistryContext";
import type { AdminCollection } from "@rebasepro/cms-types";

type ArrayOfReferencesFieldProps = FieldProps<ArrayProperty, EntityReference[]>;

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

    const minimalistView = minimalistViewProp || property.admin?.minimalistView;
    const { t } = useTranslation();

    const ofProperty = property.of as Property;
    if (ofProperty.type !== "reference") {
        throw Error("ArrayOfReferencesField expected a property containing references");
    }

    const expanded = property.admin?.expanded === undefined ? true : property.admin?.expanded;
    const selectedEntityIds = value && Array.isArray(value) ? value.map((ref) => ref.id) : [];

    useClearRestoreValue({
        property,
        value,
        setValue
    });

    const collectionRegistryController = useCollectionRegistryController();
    const collection: AdminCollection | undefined = useMemo(() => {
        return ofProperty.path ? collectionRegistryController.getCollection(ofProperty.path) : undefined;
    }, [ofProperty.path]);

    if (!collection) {
        throw Error(`Couldn't find the corresponding collection for the path: ${ofProperty.path}`);
    }

    const onMultipleEntitiesSelected = useCallback((entities: Entity<Record<string, unknown>>[]) => {
        const refs = entities.map(e => getReferenceFrom(e));
        setValue(refs);
    }, [setValue]);

    const referenceDialogController = useSelectionDialog({
        multiselect: true,
        path: ofProperty.path,
        collection,
        onMultipleEntitiesSelected,
        selectedEntityIds,
        fixedFilter: ofProperty.admin?.fixedFilter
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
                previewProperties={ofProperty.admin?.previewProperties}
                size={"medium"}
                onClick={onEntryClick}
                hover={!disabled}
                reference={entryValue}
                includeId={ofProperty.admin?.includeId}
                includeEntityLink={ofProperty.admin?.includeEntityLink}
            />
        );
    }, [ofProperty.path, ofProperty.admin?.previewProperties, value]);

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
