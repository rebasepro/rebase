import { useSelectionDialog } from "../../hooks/useSelectionDialog";
import type { FieldProps } from "../../types/fields";
import type { RelationProperty } from "@rebasepro/types";
import { Entity, getCollectionDataPath, getDataSourceCapabilities, Relation } from "@rebasepro/types";
import React, { useCallback } from "react";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIconAndTooltip } from "../components/LabelWithIconAndTooltip";
import { EntityPreviewContainer } from "../../components/EntityPreviewBinding";
import { ErrorView, IconForView } from "@rebasepro/app";
import { getIconForProperty } from "../../util/property_utils";
import { getRelationFrom, normalizeToEntityRelation, resolveRelationProperty } from "@rebasepro/common";
import { cls } from "@rebasepro/ui";
import { RelationPreview } from "../../preview";
import { RelationSelector } from "../../components/RelationSelector";
import { MultipleRelationFieldBinding } from "./MultipleRelationFieldBinding";

export function RelationFieldBinding(props: FieldProps<RelationProperty>) {
    const { property, propertyKey, context } = props;

    if (property.type !== "relation") {
        throw Error("RelationFieldBinding expected a property containing a relation");
    }
    const collection = context.collection;
    const capabilities = collection ? getDataSourceCapabilities(collection.engine) : undefined;
    // Only two things have to hold here: there is a collection, and its engine
    // has relations at all. Whether *this* property's relation can be resolved
    // is `resolveRelationProperty`'s question, and it answers it across all
    // three forms — a pre-stamped `resolvedRelation`, an inline `relation`, or
    // a lookup by name in the collection's `relations` array — with an error
    // naming the property and the collection when it cannot.
    //
    // This used to demand the `relations` array as well, which the inline form
    // does not produce. That is the documented way to declare a relation, so
    // every collection using it threw here and rendered the error boundary
    // instead of the field.
    if (!collection || !capabilities?.supportsRelations) {
        throw Error("RelationFieldBinding expected a collection whose engine supports relations");
    }
    const resolvedProperty = resolveRelationProperty(property, collection, propertyKey);
    const relation = resolvedProperty;

    const manyRelation = relation?.cardinality === "many";
    const widget = property.admin?.widget ?? "select";

    if (widget === "select" && relation) {
        return <RelationSelectorBinding {...props} relation={relation} manyRelation={manyRelation} />;
    }

    if (manyRelation) {
        return <MultipleRelationFieldBinding {...props} />;
    }

    return <SingleRelationFieldBinding {...props} relation={relation} />;
}

function RelationSelectorBinding({
    propertyKey,
    value,
    size,
    error,
    showError,
    disabled,
    isSubmitting,
    property,
    includeDescription,
    hideLabel,
    setValue,
    relation,
    manyRelation
}: FieldProps<RelationProperty> & { relation: Relation; manyRelation: boolean }) {
    const normalizedSingle = (!manyRelation && value && !Array.isArray(value)) ? normalizeToEntityRelation(value) : null;
    const singleValue = normalizedSingle ?? null;
    const multipleValue = (manyRelation && Array.isArray(value)) ? value : [];

    // Passed straight through. Mapping the form's `large` onto the selector's
    // `medium` produced a 56px box next to 48px text fields — the labels lined
    // up and the boxes did not.
    const selectorSize = size;

    return (
        <div className="">
            {!hideLabel && <LabelWithIconAndTooltip
                propertyKey={propertyKey}
                icon={getIconForProperty(property, "small")}
                required={property.validation?.required}
                title={property.name ?? propertyKey}
                className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5"}/>}

            <RelationSelector
                relation={relation}
                value={manyRelation ? multipleValue : singleValue}
                onValueChange={(newVal) => {
                    if (manyRelation) {
                        setValue(Array.isArray(newVal) ? newVal : []);
                    } else {
                        setValue(!Array.isArray(newVal) ? (newVal ?? null) : null);
                    }
                }}
                disabled={disabled || isSubmitting}
                fixedFilter={property.admin?.fixedFilter}
                size={selectorSize}
            />

            <FieldHelperText includeDescription={includeDescription}
                showError={showError}
                error={error}
                disabled={disabled}
                property={property}/>
        </div>
    );
}

function SingleRelationFieldBinding({
    propertyKey,
    value,
    size,
    error,
    showError,
    disabled,
    isSubmitting,
    property,
    includeDescription,
    hideLabel,
    setValue,
    relation
}: FieldProps<RelationProperty> & { relation: Relation | undefined }) {
    const normalizedValue = value && !Array.isArray(value) ? normalizeToEntityRelation(value) : null;
    const validValue = !!normalizedValue;

    const collection = relation?.target();

    if (!collection) {
        throw Error(`Couldn't find the corresponding collection for the relation: ${propertyKey}`);
    }

    const onSingleEntitySelected = useCallback((e: Entity<Record<string, unknown>> | null) => {
        setValue(e ? getRelationFrom(e) : null);
    }, [setValue]);

    const referenceDialogController = useSelectionDialog({
        multiselect: false,
        path: getCollectionDataPath(collection),
        collection,
        onSingleEntitySelected,
        selectedEntityIds: validValue && normalizedValue ? [normalizedValue.id] : undefined,
        fixedFilter: property.admin?.fixedFilter
    });

    const onEntryClick = (e: React.SyntheticEvent) => {
        e.preventDefault();
        referenceDialogController.open();
    };

    const usedRelation = Array.isArray(value) ? undefined : normalizedValue ?? undefined;

    return (
        <>
            {!hideLabel && <LabelWithIconAndTooltip
                propertyKey={propertyKey}
                icon={getIconForProperty(property, "small")}
                required={property.validation?.required}
                title={property.name ?? propertyKey}
                className={"h-8 text-text-secondary dark:text-text-secondary-dark ml-3.5"}/>}

            {!collection && <ErrorView
                error={"The specified collection does not exist. Check console"}/>}

            {collection && <>

                {usedRelation && <RelationPreview
                    disabled={!usedRelation}
                    previewProperties={property.admin?.previewProperties}
                    hover={!disabled}
                    size={size}
                    onClick={disabled || isSubmitting ? undefined : onEntryClick}
                    relation={usedRelation}
                    includeEntityLink={property.admin?.includeEntityLink}
                    includeId={property.admin?.includeId}
                />}

                {!value && <div className="justify-center text-left">
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
