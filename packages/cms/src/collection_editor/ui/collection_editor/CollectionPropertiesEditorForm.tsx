
import React, { useEffect, useMemo, useState } from "react";

import { Field, getIn, useFormex } from "@rebasepro/forms";
import {
    useLargeLayout
} from "@rebasepro/app";
import { useSafeSnackbarController } from "../../useSafeSnackbarController";
import { ErrorBoundary } from "@rebasepro/ui";
import {
    Button,
    CircularProgress,
    cls,
    CodeIcon,
    DebouncedTextField,
    defaultBorderMixin,
    FileSearchIcon,
    IconButton,
    iconSize,
    PlusIcon,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { MapProperty, Properties, Property, User } from "@rebasepro/types";
import { PropertyConfig, AdminCollection } from "@rebasepro/cms-types";
import { isPropertyBuilder } from "@rebasepro/common";

import { getFullId, idToPropertiesPath, namespaceToPropertiesOrderPath } from "./util";
import { OnPropertyChangedParams, PropertyForm, PropertyFormDialog } from "./PropertyEditView";
import { PropertyTree } from "./PropertyTree";
import { GetCodeDialog } from "./GetCodeDialog";
import { useAIModifiedPaths } from "./AIModifiedPathsContext";
import { useCollectionsConfigController } from "../../useCollectionsConfigController";
import type { PropertyTypePreset, PropertyType } from "../../extensibility_types";
import type { SerializableProperty, SerializableCollectionConfig } from "../../serializable_types";

type PropertyOrBuilder = Property | Record<string, unknown>;

type CollectionEditorFormProps = {
    showErrors: boolean;
    isNewCollection: boolean;
    propertyErrorsRef?: React.MutableRefObject<Record<string, unknown> | undefined>;
    onPropertyError: (propertyKey: string, namespace: string | undefined, error?: Record<string, unknown>) => void;
    setDirty?: (dirty: boolean) => void;
    extraIcon: React.ReactNode;
    getUser?: (uid: string) => User | null;
    getData?: () => Promise<object[]>;
    doCollectionInference?: (collection: AdminCollection) => Promise<Partial<AdminCollection> | null> | undefined;
    propertyConfigs: Record<string, PropertyConfig>;
    propertyTypePresets?: PropertyTypePreset[];
    hiddenPropertyTypes?: PropertyType[];
    renderExtraPropertyFields?: (params: {
        metadata: Record<string, unknown>;
        onMetadataChange: (key: string, value: unknown) => void;
        property: SerializableProperty;
        collection: SerializableCollectionConfig;
    }) => React.ReactNode;
    standalone?: boolean;
};

export function CollectionPropertiesEditorForm({
    showErrors,
    isNewCollection,
    propertyErrorsRef,
    onPropertyError,
    setDirty,
    extraIcon,
    getUser,
    getData,
    doCollectionInference,
    propertyConfigs,
    propertyTypePresets,
    hiddenPropertyTypes,
    renderExtraPropertyFields,
    standalone,

}: CollectionEditorFormProps) {

    const {
        values,
        setFieldValue,
        setFieldError,
        setFieldTouched,
        errors,
        dirty
    } = useFormex<AdminCollection>();

    const snackbarController = useSafeSnackbarController();
    const configControllerFromContext = useCollectionsConfigController();
    const configController = standalone ? { readOnly: false } : configControllerFromContext;

    const largeLayout = useLargeLayout();
    const asDialog = standalone ? false : !largeLayout

    // index of the selected property within the namespace
    const [selectedPropertyIndex, setSelectedPropertyIndex] = useState<number | undefined>();
    const [selectedPropertyKey, setSelectedPropertyKey] = useState<string | undefined>();
    const [selectedPropertyNamespace, setSelectedPropertyNamespace] = useState<string | undefined>();

    const selectedPropertyFullId = selectedPropertyKey ? getFullId(selectedPropertyKey, selectedPropertyNamespace) : undefined;
    const selectedProperty = selectedPropertyFullId ? getIn(values.properties, selectedPropertyFullId.replaceAll(".", ".properties.")) : undefined;
    const [codeDialogOpen, setCodeDialogOpen] = useState<boolean>(false);

    const [inferringProperties, setInferringProperties] = useState<boolean>(false);

    const [newPropertyDialogOpen, setNewPropertyDialogOpen] = useState<boolean>(false);
    const [inferredPropertyKeys, setInferredPropertyKeys] = useState<string[]>([]);

    const currentPropertiesOrderRef = React.useRef<{
        [key: string]: string[]
    }>(values.propertiesOrder ? { "": values.propertiesOrder } : {});

    useEffect(() => {
        if (setDirty)
            setDirty(dirty);
    }, [dirty]);

    const inferPropertiesFromData = doCollectionInference
        ? (): void => {
            const inferenceFn = doCollectionInference;
            if (!inferenceFn || configController?.readOnly)
                return;

            setInferringProperties(true);

            console.debug("CollectionEditor: inferring properties from data", values);
            const promise = inferenceFn(values);
            if (!promise) {
                setInferringProperties(false);
                return;
            }
            promise.then((newCollection) => {

                    if (!newCollection) {
                        snackbarController?.open?.({
                            type: "error",
                            message: "Could not infer properties from data"
                        });
                        return;
                    }

                    // Helper function to find all new property keys including nested ones
                    const findNewPropertyKeys = (
                        existingProps: Record<string, PropertyOrBuilder> | undefined,
                        newProps: Record<string, PropertyOrBuilder> | undefined,
                        namespace?: string
                    ): string[] => {
                        if (!newProps) return [];
                        const keys: string[] = [];

                        for (const key of Object.keys(newProps)) {
                            const fullKey = namespace ? `${namespace}.${key}` : key;
                            const existingProp = existingProps?.[key];
                            const newProp = newProps[key];

                            if (!existingProp) {
                                // This is a completely new property
                                keys.push(fullKey);
                            } else if (
                                typeof newProp === "object" &&
                                "type" in newProp &&
                                (newProp as MapProperty).type === "map" &&
                                (newProp as MapProperty).properties
                            ) {
                                // This is a map property, check for new nested properties
                                const existingMapProps = typeof existingProp === "object" &&
                                    "type" in existingProp &&
                                    (existingProp as MapProperty).type === "map"
                                    ? (existingProp as MapProperty).properties
                                    : undefined;
                                keys.push(...findNewPropertyKeys(existingMapProps, (newProp as MapProperty).properties as Record<string, PropertyOrBuilder>, fullKey));
                            }
                        }
                        return keys;
                    };

                    // Helper function to add only new properties without overwriting existing ones
                    // This preserves existing property configurations while adding missing nested properties
                    const addNewPropertiesOnly = (
                        existingProps: Record<string, PropertyOrBuilder> | undefined,
                        newProps: Record<string, PropertyOrBuilder> | undefined
                    ): Record<string, PropertyOrBuilder> => {
                        if (!newProps) return existingProps ?? {};
                        if (!existingProps) return newProps;

                        const result = { ...existingProps };

                        for (const key of Object.keys(newProps)) {
                            const existingProp = existingProps[key];
                            const newProp = newProps[key];

                            if (!existingProp) {
                                // This property doesn't exist, add it
                                result[key] = newProp;
                            } else if (
                                typeof existingProp === "object" &&
                                "type" in existingProp &&
                                (existingProp as MapProperty).type === "map" &&
                                typeof newProp === "object" &&
                                "type" in newProp &&
                                (newProp as MapProperty).type === "map" &&
                                (newProp as MapProperty).properties
                            ) {
                                // Both are map properties, recursively add new nested properties
                                // Only if the existing map has properties, merge them; otherwise keep existing as-is
                                const existingMapProps = (existingProp as MapProperty).properties as Record<string, PropertyOrBuilder> | undefined;
                                if (existingMapProps) {
                                    result[key] = {
                                        ...existingProp,
                                        properties: addNewPropertiesOnly(
                                            existingMapProps,
                                            (newProp as MapProperty).properties as Record<string, PropertyOrBuilder>
                                        ) as Properties
                                    } as MapProperty;
                                }
                                // If existingProp doesn't have properties, keep it as-is (don't overwrite with inferred)
                            }
                            // Otherwise, keep the existing property as-is (don't overwrite)
                        }

                        return result;
                    };

                    // Add only new properties from inferred collection without replacing existing ones
                    const updatedProperties = addNewPropertiesOnly(
                        values.properties ?? {},
                        newCollection.properties as Record<string, PropertyOrBuilder>
                    ) as { [key: string]: PropertyOrBuilder };

                    // Find all new property keys including nested ones
                    const allNewPropertyKeys = findNewPropertyKeys(
                        values.properties,
                        newCollection.properties as Record<string, PropertyOrBuilder>
                    );

                    // Find new top-level property keys for the properties order
                    const newTopLevelPropertyKeys = (newCollection.properties ? Object.keys(newCollection.properties) : [])
                        .filter((propertyKey) => !values.properties[propertyKey]);

                    // Check if there are any changes (new properties or modified nested properties)
                    if (allNewPropertyKeys.length === 0) {
                        snackbarController?.open?.({
                            type: "info",
                            message: "No new properties found in existing data"
                        });
                        return;
                    }

                    // Update properties order: keep existing order and append new keys at the beginning
                    // Use Object.keys from updatedProperties to ensure all properties are included
                    const allExistingKeys = values.propertiesOrder ?? Object.keys(values.properties ?? {});
                    const updatedPropertiesOrder = [
                        ...newTopLevelPropertyKeys,
                        ...allExistingKeys.filter(key => !newTopLevelPropertyKeys.includes(key))
                    ];

                    setFieldValue("properties", updatedProperties, false);
                    updatePropertiesOrder(updatedPropertiesOrder);
                    setInferredPropertyKeys(allNewPropertyKeys);

                    snackbarController?.open?.({
                        type: "success",
                        message: `Added ${allNewPropertyKeys.length} new ${allNewPropertyKeys.length === 1 ? "property" : "properties"}`
                    });
                })
                .finally(() => {
                    setInferringProperties(false);
                })
        }
        : undefined;

    const getCurrentPropertiesOrder = (namespace?: string) => {
        if (!namespace) return currentPropertiesOrderRef.current[""] ?? getIn(values, namespaceToPropertiesOrderPath());
        return currentPropertiesOrderRef.current[namespace] ?? getIn(values, namespaceToPropertiesOrderPath(namespace));
    };

    const updatePropertiesOrder = (newPropertiesOrder: string[], namespace?: string) => {
        const propertiesOrderPath = namespaceToPropertiesOrderPath(namespace);

        setFieldValue(propertiesOrderPath, newPropertiesOrder, false);
        currentPropertiesOrderRef.current[namespace ?? ""] = newPropertiesOrder;

    };

    const deleteProperty = (propertyKey?: string, namespace?: string) => {
        if (configController?.readOnly) return;
        const fullId = propertyKey ? getFullId(propertyKey, namespace) : undefined;
        if (!fullId)
            throw Error("collection editor miss config");

        setFieldValue(idToPropertiesPath(fullId), undefined, false);

        const currentPropertiesOrder = getCurrentPropertiesOrder(namespace);
        if (currentPropertiesOrder) {
            const newPropertiesOrder = currentPropertiesOrder.filter((p) => p !== propertyKey);
            updatePropertiesOrder(newPropertiesOrder, namespace);
        }

        setNewPropertyDialogOpen(false);

        setSelectedPropertyIndex(undefined);
        setSelectedPropertyKey(undefined);
        setSelectedPropertyNamespace(undefined);
    };

    const onPropertyMove = (propertiesOrder: string[], namespace?: string) => {
        if (configController?.readOnly) return;
        setFieldValue(namespaceToPropertiesOrderPath(namespace), propertiesOrder, false);
    };

    const onPropertyCreated = ({
        id,
        property
    }: {
        id?: string,
        property: Property
    }) => {
        if (configController?.readOnly) return;
        if (!id) {
            throw Error("Need to include an ID when creating a new property")
        }
        setFieldValue("properties", {
            ...(values.properties ?? {}),
            [id]: property
        }, false);

        const newPropertiesOrder = [...(values.propertiesOrder ?? Object.keys(values.properties)), id];
        updatePropertiesOrder(newPropertiesOrder);

        setNewPropertyDialogOpen(false);
        if (largeLayout) {
            setSelectedPropertyIndex(newPropertiesOrder.indexOf(id));
            setSelectedPropertyKey(id);
        }
        setSelectedPropertyNamespace(undefined);
    };

    const onPropertyChanged = ({
        id,
        property,
        previousId,
        namespace
    }: OnPropertyChangedParams) => {

        const fullId = id ? getFullId(id, namespace) : undefined;
        const propertyPath = fullId ? idToPropertiesPath(fullId) : undefined;

        // If the id has changed we need to a little cleanup
        if (previousId && previousId !== id) {

            const previousFullId = getFullId(previousId, namespace);
            const previousPropertyPath = idToPropertiesPath(previousFullId);

            const currentPropertiesOrder = getCurrentPropertiesOrder(namespace);

            // replace previousId with id in propertiesOrder
            const newPropertiesOrder = currentPropertiesOrder
                .map((p) => p === previousId ? id : p)
                .filter((p) => p !== undefined) as string[];

            updatePropertiesOrder(newPropertiesOrder, namespace);

            if (id) {
                setSelectedPropertyIndex(newPropertiesOrder.indexOf(id));
                setSelectedPropertyKey(id);
            }
            setFieldValue(previousPropertyPath, undefined, false);
            setFieldTouched(previousPropertyPath, false, false);
        }

        if (propertyPath) {
            setFieldValue(propertyPath, property, false);
            setFieldTouched(propertyPath, true, false);
        }

    };

    const onPropertyErrorInternal = (id: string, namespace?: string, error?: Record<string, unknown>) => {
        const propertyPath = id ? getFullId(id, namespace) : undefined;
        console.debug("onPropertyErrorInternal", {
            id,
            namespace,
            error,
            propertyPath
        });
        if (propertyPath) {
            const hasError = error && Object.keys(error).length > 0;
            onPropertyError(id, namespace, hasError ? error : undefined);
            setFieldError(idToPropertiesPath(propertyPath), hasError ? "Property error" : undefined);
        }
    }

    const closePropertyDialog = () => {
        setSelectedPropertyIndex(undefined);
        setSelectedPropertyKey(undefined);
    };

    const initialErrors = selectedPropertyKey && propertyErrorsRef?.current?.properties ? (propertyErrorsRef.current.properties as Record<string, unknown>)[selectedPropertyKey] as Record<string, any> | undefined : undefined;

    const emptyCollection = (values?.propertiesOrder === undefined || values.propertiesOrder.length === 0)
        && (!values?.properties || Object.keys(values.properties).length === 0);

    const usedPropertiesOrder = (values.propertiesOrder
        ? values.propertiesOrder
        : Object.keys(values.properties)) as string[];

    const owner = useMemo(() => values.ownerId && getUser ? getUser(values.ownerId) : null, [getUser, values.ownerId]);

    // Get AI generation counter for key to force remount on AI changes
    const aiModifiedPaths = useAIModifiedPaths();
    const generationCounter = aiModifiedPaths?.generationCounter ?? 0;

    const onPropertyClick = (propertyKey: string, namespace?: string) => {
        console.debug("CollectionEditor: onPropertyClick", {
            propertyKey,
            namespace
        });
        setSelectedPropertyIndex(usedPropertiesOrder.indexOf(propertyKey));
        setSelectedPropertyKey(propertyKey);
        setSelectedPropertyNamespace(namespace);
    };

    const body = (
        <div className={"grid grid-cols-12 h-full min-h-0 bg-surface-50 dark:bg-surface-800"}>
            <div className={cls(
                "col-span-12 lg:col-span-5 h-full min-h-0 flex flex-col bg-surface-50 dark:bg-surface-800",
                !asDialog && "border-r " + defaultBorderMixin
            )}>
                {/* Sidebar Header */}
                <div className={cls("flex items-center justify-between px-3 py-2 border-b bg-surface-50 dark:bg-surface-900 min-h-[48px] shrink-0", defaultBorderMixin)}>
                    <div className="flex-grow min-w-0 pr-2">
                        <Field
                            name={"name"}
                            as={DebouncedTextField}
                            invisible={true}
                            className="-ml-1"
                            inputClassName="text-sm font-semibold truncate bg-transparent border-0 outline-none focus:ring-0"
                            placeholder={"Collection name"}
                            size={"small"}
                            required
                            error={Boolean(errors?.name)}/>
                    </div>

                    {extraIcon && <div className="flex-shrink-0">{extraIcon}</div>}

                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {inferPropertiesFromData && (
                            <Tooltip title={"Add new properties based on data"} asChild={true}>
                                <IconButton
                                    size="small"
                                    disabled={inferringProperties}
                                    onClick={inferPropertiesFromData}
                                >
                                    {inferringProperties ? <CircularProgress size={"smallest"}/> : <FileSearchIcon size={iconSize.smallest}/>}
                                </IconButton>
                            </Tooltip>
                        )}
                        <Tooltip title={"Add new property"} asChild={true}>
                            <IconButton
                                size="small"
                                disabled={configController?.readOnly}
                                onClick={() => setNewPropertyDialogOpen(true)}
                            >
                                <PlusIcon size={iconSize.smallest}/>
                            </IconButton>
                        </Tooltip>
                    </div>
                </div>

                {/* Sidebar Content */}
                <div className="flex-grow overflow-y-auto p-3 space-y-3 bg-surface-50 dark:bg-surface-800">
                    {owner && (
                        <div className="px-1 py-0.5">
                            <Typography variant="body2" color="secondary">
                                Created by {owner.displayName}
                            </Typography>
                        </div>
                    )}
                    <ErrorBoundary>
                        <PropertyTree
                            inferredPropertyKeys={inferredPropertyKeys}
                            selectedPropertyKey={selectedPropertyKey ? getFullId(selectedPropertyKey, selectedPropertyNamespace) : undefined}
                            properties={values.properties}
                            additionalFields={values.additionalFields}
                            propertiesOrder={usedPropertiesOrder}
                            onPropertyClick={onPropertyClick}
                            onPropertyMove={onPropertyMove}
                            onPropertyRemove={(isNewCollection || (inferredPropertyKeys && inferredPropertyKeys.length > 0)) && !configController?.readOnly ? deleteProperty : undefined}
                            errors={errors}/>
                    </ErrorBoundary>

                    <Button className={"w-full"}
                        variant="outlined"
                        color="neutral"
                        disabled={configController?.readOnly}
                        onClick={() => setNewPropertyDialogOpen(true)}
                        startIcon={<PlusIcon/>}>
                        Add new property
                    </Button>
                </div>
            </div>

            {!asDialog &&
                <div className={"col-span-12 lg:col-span-7 p-4 md:py-8 md:px-4 h-full overflow-auto bg-surface-50 dark:bg-surface-800"}>
                    <div
                        className="sticky top-8 min-h-full w-full flex flex-col justify-center">

                        {selectedPropertyFullId &&
                            !!selectedProperty &&
                            !isPropertyBuilder(selectedProperty as Property) &&
                            <PropertyForm
                                inArray={false}
                                key={`edit_view_${selectedPropertyIndex}_${generationCounter}`}
                                existingProperty={!isNewCollection}
                                autoUpdateId={false}
                                allowDataInference={!isNewCollection}
                                autoOpenTypeSelect={false}
                                propertyKey={selectedPropertyKey}
                                propertyNamespace={selectedPropertyNamespace}
                                property={selectedProperty as Property}
                                onPropertyChanged={onPropertyChanged}
                                onDelete={deleteProperty}
                                onError={onPropertyErrorInternal}
                                forceShowErrors={showErrors}
                                initialErrors={initialErrors}
                                getData={getData}
                                propertyConfigs={propertyConfigs}
                                propertyTypePresets={propertyTypePresets}
                                hiddenPropertyTypes={hiddenPropertyTypes}
                                renderExtraPropertyFields={renderExtraPropertyFields}
                                collectionValues={values}

                            />}

                        {!selectedProperty &&
                            <div className={"w-full flex flex-col items-center justify-center h-full gap-4"}>
                                <Typography variant={"label"} className="">
                                    {emptyCollection
                                        ? "Now you can add your first property"
                                        : "Select a property to edit it"}
                                </Typography>
                                <Button
                                    disabled={configController?.readOnly}
                                    onClick={() => setNewPropertyDialogOpen(true)}
                                >
                                    <PlusIcon/>
                                    Add new property
                                </Button>
                            </div>}

                        {!!selectedProperty && isPropertyBuilder(selectedProperty as Property) &&
                            <Typography variant={"label"} className="flex items-center justify-center">
                                {"This property is defined as a property builder in code"}
                            </Typography>}
                    </div>
                </div>}

            {asDialog && <PropertyFormDialog
                inArray={false}
                open={selectedPropertyIndex !== undefined}
                key={`edit_view_${selectedPropertyIndex}_${generationCounter}`}
                autoUpdateId={!selectedProperty}
                allowDataInference={!isNewCollection}
                existingProperty={true}
                autoOpenTypeSelect={false}
                propertyKey={selectedPropertyKey}
                propertyNamespace={selectedPropertyNamespace}
                property={selectedProperty as Property | undefined}
                onPropertyChanged={onPropertyChanged}
                onDelete={deleteProperty}
                onError={onPropertyErrorInternal}
                forceShowErrors={showErrors}
                initialErrors={initialErrors}
                getData={getData}
                propertyConfigs={propertyConfigs}
                propertyTypePresets={propertyTypePresets}
                hiddenPropertyTypes={hiddenPropertyTypes}
                renderExtraPropertyFields={renderExtraPropertyFields}
                collectionValues={values}

                onCancel={closePropertyDialog}
                onOkClicked={asDialog
                    ? closePropertyDialog
                    : undefined
                }/>}

        </div>);

    return (<>

        {body}

        {/* This is the dialog used for new properties*/}
        <PropertyFormDialog
            inArray={false}
            existingProperty={false}
            autoOpenTypeSelect={true}
            autoUpdateId={true}
            forceShowErrors={showErrors}
            open={newPropertyDialogOpen}
            onCancel={() => setNewPropertyDialogOpen(false)}
            onPropertyChanged={onPropertyCreated}
            getData={getData}
            allowDataInference={!isNewCollection}
            propertyConfigs={propertyConfigs}
            propertyTypePresets={propertyTypePresets}
            hiddenPropertyTypes={hiddenPropertyTypes}
            renderExtraPropertyFields={renderExtraPropertyFields}
            collectionValues={values}
            existingPropertyKeys={values.propertiesOrder as string[]}/>

        <ErrorBoundary>
            <GetCodeDialog
                collection={values}
                open={codeDialogOpen}
                onOpenChange={setCodeDialogOpen}/>
        </ErrorBoundary>
    </>
    );
}
