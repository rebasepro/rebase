
import type { EntityCustomViewParams, AdditionalFieldDelegateProps, AdminCollection } from "@rebasepro/admin-types";
import type { FormContext, PropertyFieldBindingProps } from "../types/fields";
import type { PropertyConfig } from "@rebasepro/admin-types";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import type { EntityFormProps, OnUpdateParams } from "../types/components/EntityFormProps";
import { deepEqual as equal } from "fast-equals";

import { ErrorBoundary } from "@rebasepro/ui";
import { AlignLeftIcon, CheckIcon, LoaderIcon, PencilIcon, useDebouncedCallback } from "@rebasepro/ui";
import { getDefaultValuesFor } from "@rebasepro/common";
import { isHidden, isReadOnly } from "@rebasepro/app";

import { useCustomizationController } from "@rebasepro/app";
import { getFormFieldKeys } from "@rebasepro/app";
import { Alert, Button, Chip, cls, Dialog, DialogActions, DialogContent, DialogTitle, iconSize, paperMixin, Tooltip, Typography } from "@rebasepro/ui";
import { Formex, FormexController, useCreateFormex } from "@rebasepro/forms";

import { FormEntry } from "./components/FormEntry";
import { FormLayout } from "./components/FormLayout";
import { LabelWithIconAndTooltip } from "./components/LabelWithIconAndTooltip";
import { PropertyFieldBinding } from "./PropertyFieldBinding";
import { flattenKeys } from "@rebasepro/app";
import { ErrorFocus } from "./components/ErrorFocus";
import { CustomFieldValidator, getEntitySchema } from "./validation";
import { EntityFormActions } from "./EntityFormActions";
import type { EntityFormActionsProps } from "../types/components/EntityFormActionsProps";
import { LocalChangesMenu } from "./components/LocalChangesMenu";

import { getEntityTitlePropertyKeyForEntity, isUserSelectProperty, resolveTitleToString } from "../util/previews";
import { getUserLabel, useResolvedUser } from "../hooks/useResolvedUsers";
import { getValueInPath, mergeDeep } from "@rebasepro/utils";
import {
    getChanges,
    zodToFormErrors
} from "./form_utils";

/**
 * Headless entity form component.
 *
 * Renders a form for a entity collection without any CMS or backend dependencies.
 * All backend concerns (save, caching, analytics, plugin slots) are provided via
 * callback props. For CMS-connected usage, use {@link EntityFormBinding} instead.
 *
 * @group Components
 */
export function EntityForm<M extends Record<string, unknown>>({
    path,
    entityId: entityIdProp,
    collection,
    onValuesModified,
    onIdChange,
    onSaved,
    entity,
    initialDirtyValues,
    onFormContextReady,
    forceActionsAtTheBottom,
    initialStatus,
    className,
    onStatusChange,
    onEntityChange,
    openEntityMode = "full_screen",
    formex: formexProp,
    disabled: disabledProp,
    Builder,
    EntityFormActionsComponent = EntityFormActions,
    showDefaultActions = true,
    showEntityPath = true,
    navigateBack: navigateBackProp,
    children,
    // Headless callback props
    onSubmit: onSubmitProp,
    onValuesChangeDeferred: onValuesChangeDeferredProp,
    onReset: onResetProp,
    uniqueFieldValidator: uniqueFieldValidatorProp,
    // Slots
    beforeFields,
    afterFields,
    pluginActions: pluginActionsProp,
    // Local changes (managed externally)
    computedInitialValues,
    hasLocalChanges: hasLocalChangesProp,
    localChangesData,
    manualApplyLocalChanges,
    localChangesCacheKey,
    onClearLocalChanges
}: EntityFormProps<M>) {

    const customizationController = useCustomizationController();

    const navigateBack = useCallback(() => {
        if (navigateBackProp) {
            navigateBackProp();
        }
    }, [navigateBackProp]);

    const [status, setStatus] = useState<EntityStatus>(initialStatus);

    const updateStatus = (status: EntityStatus) => {
        setStatus(status);
        onStatusChange?.(status);
    };

    const [valuesToBeSaved, setValuesToBeSaved] = useState<EntityValues<M> | undefined>(undefined);
    useDebouncedCallback(valuesToBeSaved, () => {
        if (valuesToBeSaved && onSubmitProp) {
            setIsSavingAutoSave(true);
            Promise.resolve(onSubmitProp(valuesToBeSaved, formex))
                .finally(() => setIsSavingAutoSave(false));
        }
    }, false, 2000);

    const [underlyingChanges] = useState<Partial<EntityValues<M>>>({});

    const initialEntityId: string | number | undefined = useMemo(() => {
        if (status === "new" || status === "copy") {
            return undefined;
        } else {
            return entityIdProp;
        }
    }, [entityIdProp, status]);

    const [entityId, setEntityId] = useState<string | number | undefined>(initialEntityId);
    const [entityIdError, setEntityIdError] = useState<boolean>(false);
    const [savingError, setSavingError] = useState<Error | undefined>();
    const [isSavingAutoSave, setIsSavingAutoSave] = useState<boolean>(false);
    const [discardDialogOpen, setDiscardDialogOpen] = useState<boolean>(false);

    const autoSave = collection.formAutoSave;

    // Use externally computed initial values if provided, otherwise compute from entity + collection
    const baseInitialValues = useMemo(() => {
        if (computedInitialValues !== undefined) {
            return computedInitialValues;
        }
        // Fallback: compute from entity/collection (requires authController from context)
        // In headless mode without computedInitialValues, use entity values or defaults
        if ((status === "existing" || status === "copy") && entity) {
            return entity.values ?? getDefaultValuesFor(collection.properties);
        }
        return getDefaultValuesFor(collection.properties);
    }, [computedInitialValues, collection.properties, status, entity]);

    const [localChangesCleared, setLocalChangesCleared] = useState<boolean>(false);

    const hasLocalChanges = hasLocalChangesProp !== undefined
        ? (hasLocalChangesProp && !localChangesCleared)
        : false;

    const onSubmit = (values: EntityValues<M>, formexController: FormexController<EntityValues<M>>) => {

        setSavingError(undefined);
        setEntityIdError(false);

        if (status === "existing") {
            if (!entity?.id) throw Error("Form misconfiguration when saving, no id for existing entity");
        } else if (status !== "new" && status !== "copy") {
            throw Error("New FormType added, check EntityForm");
        }

        if (!onSubmitProp) {
            console.warn("EntityForm: no onSubmit callback provided. Form submission has no effect.");
            formexController.setSubmitting(false);
            return;
        }

        return Promise.resolve(save(values))
            ?.then((savedEntity) => {
                if (savedEntity) {
                    formexController.resetForm({
                        values: savedEntity.values || values,
                        submitCount: 0,
                        touched: {}
                    });
                }
            })
            .finally(() => {
                formexController.setSubmitting(false);
            });
    };

    const [initialValues, initialDirty] = useMemo(() => {
        const initialValues = initialDirtyValues ? mergeDeep(baseInitialValues, initialDirtyValues) : baseInitialValues;
        const initialDirty = Boolean(initialDirtyValues) && initialDirtyValues && Object.keys(initialDirtyValues).length > 0;
        return [initialValues, initialDirty];
    }, [baseInitialValues, initialDirtyValues]);

    const internalFormex = useCreateFormex<M>({
        initialValues: initialValues as M,
        initialDirty,
        debugId: `EntityForm:${path}/${entityIdProp}`,
        initialTouched: initialDirtyValues ?
            flattenKeys(initialDirtyValues!)
                .reduce((previousValue, currentValue) => ({
                    ...previousValue,
                    [currentValue]: true
                }), {})
            : {},
        onSubmit,
        onReset: () => {
            onResetProp?.();
            onValuesModified?.(false, initialValues as M);
        },
        onValuesChangeDeferred: onValuesChangeDeferredProp,
        validation: async (values): Promise<Record<string, string>> => {
            if (!validationSchema) return {};
            const result = await validationSchema.safeParseAsync(values);
            if (result.success) return {};
            return zodToFormErrors(result.error);
        }
    });
    const formex: FormexController<M> = formexProp ?? internalFormex;

    useEffect(() => {

        const handleKeyDown = (e: KeyboardEvent) => {
            const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z";
            const isRedo =
                ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "z") ||
                ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "y");
            const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s";

            if (isSave && !disabled && formex.dirty) {
                e.preventDefault();
                formex.handleSubmit();
            } else if (isUndo && formex.canUndo) {
                e.preventDefault();
                formex.undo();
            } else if (isRedo && formex.canRedo) {
                e.preventDefault();
                formex.redo();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);

    }, [formex]);

    const afterSave = (updatedEntity: Entity<M>) => {
        onResetProp?.();
        onValuesModified?.(false, updatedEntity.values);
        onEntityChange?.(updatedEntity);
        updateStatus("existing");
        setEntityId(updatedEntity.id);

        if (onSaved) {
            onSaved({
                entity: updatedEntity,
                status,
                path,
                entityId: updatedEntity.id,
                collection
            });
        }
    };

    const lastSavedValues = useRef<EntityValues<M> | undefined>(entity?.values);
    const save = async (values: EntityValues<M>): Promise<Entity<M> | void> => {
        const valuesToSave = status === "existing"
            ? getChanges(values, entity?.values || {}) as EntityValues<M>
            : values;

        if (status === "existing" && Object.keys(valuesToSave).length === 0 && entity) {
            return Promise.resolve(entity);
        }

        lastSavedValues.current = values;

        if (!onSubmitProp) {
            return;
        }

        const autoSaveEnabled = autoSave ?? false;

        if (autoSaveEnabled) {
            setValuesToBeSaved(values);
            return Promise.resolve();
        }

        return Promise.resolve(onSubmitProp(valuesToSave as M, formex))
            .then((result) => {
                if (result) {
                    afterSave(result as Entity<M>);
                }
                return result as Entity<M> | void;
            })
            .catch(e => {
                console.error(e);
                setSavingError(e);
            });
    };

    const disabled = formex.isSubmitting || Boolean(disabledProp);

    const formContext: FormContext<M> = {
        setFieldValue: useCallback((key: string, value: unknown) => formex.setFieldValue(key, value), []),
        values: formex.values,
        collection,
        entityId: entityId as string,
        path,
        save,
        submit: formex.handleSubmit,
        formex,
        entity,
        savingError,
        status,
        openEntityMode,
        disabled
    };

    useEffect(() => {
        onFormContextReady?.(formContext);
    }, [formex.version, collection, entityId, path]);

    const actionsDisabled = disabled || formex.isSubmitting || (status === "existing" && !formex.dirty) || Boolean(disabledProp);

    const titlePropertyKey = getEntityTitlePropertyKeyForEntity(collection, formex.values as Record<string, unknown> | undefined, entityId);
    const rawTitle = formex.values && titlePropertyKey ? getValueInPath(formex.values, titlePropertyKey) : undefined;
    // A user picker stores an id: resolve it to the person, like a relation.
    const titleUser = useResolvedUser(isUserSelectProperty(collection, titlePropertyKey) && typeof rawTitle === "string"
        ? rawTitle
        : undefined);
    const title = titleUser
        ? getUserLabel(titleUser)
        : (rawTitle !== undefined && rawTitle !== null
            ? resolveTitleToString(rawTitle)
            : (collection.singularName ?? collection.name));

    const modified = formex.dirty;

    useEffect(() => {
        if (!autoSave) {
            onValuesModified?.(modified, formex.values);
        }
    }, [formex.dirty]);

    // Default no-op unique field validator — always passes
    const defaultUniqueFieldValidator: CustomFieldValidator = useCallback(async () => true, []);

    const uniqueFieldValidator: CustomFieldValidator = useMemo(() => {
        if (uniqueFieldValidatorProp) {
            return uniqueFieldValidatorProp as CustomFieldValidator;
        }
        return defaultUniqueFieldValidator;
    }, [uniqueFieldValidatorProp, defaultUniqueFieldValidator]);

    const validationSchema = useMemo(() => getEntitySchema(
        entityId,
        collection.properties,
        uniqueFieldValidator),
        [entityId, collection.properties, uniqueFieldValidator]);

    useOnAutoSave(autoSave, formex, lastSavedValues, save);

    useEffect(() => {
        if (!autoSave && !formex.isSubmitting && underlyingChanges && entity) {
            // we update the form fields from the driver data
            // if they were not touched
            Object.entries(underlyingChanges).forEach(([key, value]) => {
                const formValue = formex.values[key];
                if (!equal(value, formValue) && !formex.touched[key]) {
                    console.debug("Updated value from the driver:", key, value);
                    formex.setFieldValue(key, value !== undefined ? value : null);
                }
            });
        }
    }, [formex.isSubmitting, autoSave, underlyingChanges, entity, formex.values, formex.touched, formex.setFieldValue]);

    const formFieldKeys = getFormFieldKeys(collection);

    const formFields = () => {

        if (Builder) {
            return <Builder
                collection={collection}
                entity={entity}
                modifiedValues={formex.values}
                formContext={formContext}
            />;
        }
        const isNewEntity = status === "new" || status === "copy";
        let firstFocusableIndex = -1;

        return (
            <FormLayout>
                {formFieldKeys.map((key) => {
                    const property = collection.properties?.[key];
                    if (property) {

                        const underlyingValueHasChanged: boolean =
                            !!underlyingChanges &&
                            Object.keys(underlyingChanges).includes(key) &&
                            formex.touched[key];
                        const isNew = status === "new" || status === "copy";
                        const isStringOrNumber = property.type === "string" || property.type === "number";
                        const isIdAndAuto = isStringOrNumber && "isId" in property && typeof property.isId === "string" && property.isId !== "manual";
                        const disabled = disabledProp || (!autoSave && formex.isSubmitting) || isReadOnly(property) || Boolean(property.ui?.disabled) || (!isNew && "isId" in property && Boolean(property.isId)) || (isNew && isIdAndAuto);
                        const hidden = isHidden(property);
                        if (hidden) return null;
                        const widthPercentage = property.ui?.widthPercentage ?? 100;

                        const shouldAutoFocus = isNewEntity && !disabled && firstFocusableIndex === -1;
                        if (shouldAutoFocus) firstFocusableIndex = 0;

                        const cmsFormFieldProps: PropertyFieldBindingProps<M> = {
                            propertyKey: key,
                            disabled,
                            property,
                            includeDescription: Boolean(property.description),
                            underlyingValueHasChanged: underlyingValueHasChanged && !autoSave,
                            context: formContext,
                            partOfArray: false,
                            minimalistView: false,
                            autoFocus: shouldAutoFocus
                        };

                        return (
                            <FormEntry propertyKey={key}
                                widthPercentage={widthPercentage}
                                key={`field_${key}`}>
                                <PropertyFieldBinding {...cmsFormFieldProps}/>
                            </FormEntry>
                        );
                    }

                    const additionalField = collection.additionalFields?.find(f => f.key === key);
                    if (additionalField && entity) {
                        const AdditionalFieldBuilder = additionalField.Builder;
                        if (!AdditionalFieldBuilder && !additionalField.value) {
                            throw new Error("When using additional fields you need to provide a Builder or a value");
                        }
                        const additionalFieldContext = formContext as unknown as AdditionalFieldDelegateProps['context'];
                        const child = AdditionalFieldBuilder
                            ? <AdditionalFieldBuilder entity={entity} context={additionalFieldContext}/>
                            : <div className={"w-full"}>
                                {additionalField.value?.({
                                    entity,
                                    context: additionalFieldContext
                                })?.toString()}
                            </div>;

                        return (
                            <div key={`additional_${key}`} className={"w-full"}>
                                <LabelWithIconAndTooltip
                                    propertyKey={key}
                                    icon={<AlignLeftIcon size={iconSize.small}/>}
                                    title={additionalField.name}
                                    className={"text-text-secondary dark:text-text-secondary-dark ml-3.5"}/>
                                <div
                                    className={cls(paperMixin, "w-full min-h-14 p-4 md:p-6 overflow-x-scroll no-scrollbar")}>
                                    <ErrorBoundary>
                                        {child}
                                    </ErrorBoundary>
                                </div>
                            </div>
                        );
                    }

                    console.warn(`Property ${key} not found in collection ${collection.name} in properties or additional fields. Skipping.`);
                    return null;
                }).filter(Boolean)}
            </FormLayout>
        );
    };

    const formRef = useRef<HTMLDivElement>(null);

    const hasFormErrors = Object.keys(formex.errors).length > 0 && formex.submitCount > 0;

    const formView = <ErrorBoundary>
        <>
            {beforeFields}

            {!Builder && <div className={"w-full flex flex-col items-start my-4 lg:my-6"}>
                <Typography
                    className={"my-4 grow line-clamp-1 " + (collection.hideIdFromForm ? "mb-6" : "")}
                    variant={"h4"}>
                    {title ?? collection.singularName ?? collection.name}
                </Typography>

                {!entity?.values && initialStatus === "existing" &&
                    <Alert color={"warning"} size={"small"} outerClassName={"w-full mb-4 text-xs"}>
                        This entity does not exist yet
                    </Alert>}

                {showEntityPath && <Alert color={"base"} outerClassName={"w-full"} size={"small"}>
                    <code
                        className={"text-xs select-all text-text-secondary dark:text-text-secondary-dark"}>
                        {entity?.path ?? path}/{entityId}
                    </code>
                </Alert>}
            </div>}

            {children}

            {initialEntityId && !entity && initialStatus !== "new" && <Alert color={"info"} size={"small"}>
                This entity does not exist yet
            </Alert>}

            {hasFormErrors && <Alert color={"error"} size={"small"} outerClassName={"w-full mt-2"}>
                Please fix the highlighted errors before saving.
            </Alert>}

            {formContext && <>
                <div className="mt-12 flex flex-col gap-8" ref={formRef}>
                    {formFields()}
                    <ErrorFocus containerRef={formRef}/>
                </div>
            </>}

            {afterFields}

            {forceActionsAtTheBottom && <div className="h-16"/>}

            <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen} maxWidth={"sm"}>
                <DialogTitle>{status === "existing" ? "Discard changes?" : "Clear form?"}</DialogTitle>
                <DialogContent>
                    <Typography>
                        {status === "existing"
                            ? "All unsaved changes will be lost. This cannot be undone."
                            : "All entered values will be cleared. This cannot be undone."}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button variant={"text"} onClick={() => setDiscardDialogOpen(false)}>
                        Cancel
                    </Button>
                    <Button variant={"filled"} color={"error"} onClick={() => {
                        setDiscardDialogOpen(false);
                        formex.resetForm({ values: baseInitialValues as M });
                    }}>
                        {status === "existing" ? "Discard" : "Clear"}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    </ErrorBoundary>;

    useEffect(() => {
        if (entityId && onIdChange)
            onIdChange(entityId);
    }, [entityId, onIdChange]);

    if (!collection || !path) {
        throw Error("INTERNAL: Collection and path must be defined in form context");
    }

    const EntityFormActionsRender = EntityFormActionsComponent as React.FC<EntityFormActionsProps>;

    const dialogActions = <EntityFormActionsRender
        collection={collection}
        path={path}
        entity={entity}
        layout={forceActionsAtTheBottom ? "bottom" : "responsive"}
        savingError={savingError}
        formex={formex as FormexController<Record<string, unknown>>}
        disabled={actionsDisabled}
        status={status}
        pluginActions={pluginActionsProp ?? []}
        openEntityMode={openEntityMode}
        showDefaultActions={showDefaultActions}
        navigateBack={navigateBack}
        formContext={formContext as FormContext<Record<string, unknown>>}
    />;

    return (
        <Formex value={formex}>
            <form
                onSubmit={formex.handleSubmit}
                onReset={(e) => {
                    e.preventDefault();
                    if (formex.dirty) {
                        setDiscardDialogOpen(true);
                    } else {
                        formex.resetForm({ values: baseInitialValues as M });
                    }
                }}
                noValidate
                className={cls("@container flex-1 flex flex-row w-full overflow-y-auto justify-center", className)}>
                <div
                    id={`form_${path}`}
                    className={cls("relative flex flex-row max-w-4xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-6xl w-full h-fit")}>

                    <div className={cls(
                        "flex flex-col w-full",
                        openEntityMode === "dialog"
                            ? "pt-4 pb-12 px-6 sm:px-8"
                            : "pt-12 pb-16 px-4 sm:px-8 md:px-10"
                    )}>
                        <div
                            className={"flex flex-row gap-4 justify-end h-0 overflow-visible sticky top-4 z-10"}>

                            {manualApplyLocalChanges && hasLocalChanges && localChangesCacheKey &&
                                <LocalChangesMenu<M>
                                    cacheKey={localChangesCacheKey}
                                    properties={collection.properties}
                                    cachedData={localChangesData as Partial<M>}
                                    formex={formex}
                                    onClearLocalChanges={() => {
                                        setLocalChangesCleared(true);
                                        onClearLocalChanges?.();
                                    }}
                                />}

                            {isSavingAutoSave
                                ? <Tooltip title={"Saving…"}>
                                    <Chip size={"small"} className={"py-1"} colorScheme={"blueDarker"}>
                                        <LoaderIcon size={iconSize.smallest} className={"animate-spin"}/>
                                    </Chip>
                                </Tooltip>
                                : formex.dirty
                                    ? <Tooltip title={"Form has been modified"}>
                                        <Chip size={"small"} className={"py-1"} colorScheme={"orangeDarker"}>
                                            <PencilIcon size={iconSize.smallest}/>
                                        </Chip>
                                    </Tooltip>
                                    : <Tooltip title={"Form is in sync"}>
                                        <Chip size={"small"} className={"py-1"}>
                                            <CheckIcon size={iconSize.smallest}/>
                                        </Chip>
                                    </Tooltip>}
                        </div>

                        {formView}

                    </div>

                </div>

                {dialogActions}

            </form>

        </Formex>
    );
}

function useOnAutoSave<M extends Record<string, unknown>>(autoSave: undefined | boolean, formex: FormexController<M>, lastSavedValues: React.MutableRefObject<EntityValues<M> | undefined>, save: (values: EntityValues<M>) => Promise<Entity<M> | void>) {
    useEffect(() => {
        if (!autoSave) return;
        if (formex.values && !equal(formex.values, lastSavedValues.current)) {
            save(formex.values);
        }
    }, [autoSave, formex.values]);
}
