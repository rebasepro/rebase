
import type { AdditionalFieldDelegateProps } from "@rebasepro/admin-types";
import type { FormContext, PropertyFieldBindingProps } from "../types/fields";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import type { EntityFormProps } from "../types/components/EntityFormProps";
import { deepEqual as equal } from "fast-equals";

import { ErrorBoundary } from "@rebasepro/ui";
import { AlignLeftIcon, useDebouncedCallback } from "@rebasepro/ui";
import { getDefaultValuesFor } from "@rebasepro/common";
import { isReadOnly } from "@rebasepro/app";

import { getFormFieldKeys, resolveFormLayout } from "@rebasepro/app";
import type { ResolvedFormField } from "@rebasepro/app";
import { Alert, Button, cls, Dialog, DialogActions, DialogContent, DialogTitle, iconSize, paperMixin, Typography } from "@rebasepro/ui";
import { Formex, FormexController, useCreateFormex } from "@rebasepro/forms";

import { FieldBlock, isSelfLabellingProperty, spanClass } from "./components/FieldBlock";
import { AdditionalFieldValue } from "../components/AdditionalFieldValue";
import { FormRail } from "./components/FormRail";
import { FormSections } from "./components/FormSections";
import { useRailVisible } from "./components/useRailVisible";
import { LabelWithIconAndTooltip } from "./components/LabelWithIconAndTooltip";
import { PropertyFieldBinding } from "./PropertyFieldBinding";
import { flattenKeys } from "@rebasepro/app";
import { ErrorFocus } from "./components/ErrorFocus";
import { CustomFieldValidator, getEntitySchema } from "./validation";
import { EntityFormActions } from "./EntityFormActions";
import type { EntityFormActionsProps } from "../types/components/EntityFormActionsProps";
import { LocalChangesMenu } from "./components/LocalChangesMenu";

import { mergeDeep } from "@rebasepro/utils";
import {
    getChanges,
    zodToFormErrors
} from "./form_utils";

/**
 * Headless entity form component.
 *
 * Renders a form for a entity collection without any admin or backend dependencies.
 * All backend concerns (save, caching, analytics, plugin slots) are provided via
 * callback props. For admin-connected usage, use {@link EntityFormBinding} instead.
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
        disabled,
        isSaving: formex.isSubmitting || isSavingAutoSave
    };

    useEffect(() => {
        onFormContextReady?.(formContext);
        // `formex.version` only moves on `resetForm`, so these deps used to hand
        // the container one snapshot at mount and never another. That was
        // invisible while Save lived inside the form and read `formex` directly;
        // once the identity bar owned Save, its `dirty` was frozen false and the
        // button never enabled — for any field, not just the one that exposed
        // it. Custom entity views read `formContext.values` through the same
        // channel and were reading a stale copy too.
        //
        // Deps are the state *transitions* a container cares about, not
        // `formex.values`: re-publishing on every keystroke would re-render the
        // whole entity view per character.
    }, [
        formex.version, collection, entityId, path,
        formex.dirty, formex.isSubmitting, formex.submitCount, isSavingAutoSave
    ]);

    const actionsDisabled = disabled || formex.isSubmitting || (status === "existing" && !formex.dirty) || Boolean(disabledProp);

    // The record's title is resolved by the container that renders the identity
    // bar (see `useEntityDisplayTitle`), not here — the form no longer draws a
    // heading of its own.

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

    const layout = useMemo(() => resolveFormLayout({
        collection,
        fieldKeys: formFieldKeys,
        status
    }), [collection, formFieldKeys.join(","), status]);

    const formElementRef = useRef<HTMLFormElement>(null);
    // Measured, not a breakpoint: the rail holds fields the resolver moved
    // out of the column, so when it cannot be shown they have to come back.
    const railVisible = useRailVisible(formElementRef);
    const showRail = !Builder && layout.hasRail && railVisible;

    // Collapsed sections are per-section-key so a renamed title keeps its state,
    // and initial state comes from the config rather than being forced open.
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
        () => new Set(layout.sections.filter(s => s.collapsed).map(s => s.key))
    );
    const toggleSection = useCallback((key: string) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const errorKeys = useMemo(
        () => new Set(formex.submitCount > 0 ? Object.keys(formex.errors) : []),
        [formex.errors, formex.submitCount]
    );

    // Autofocus lands on the first field the user can actually type into. Tracked
    // across the whole layout rather than per section, so a collapsed leading
    // group does not steal it.
    const autoFocusKey = useMemo(() => {
        if (status !== "new" && status !== "copy") return undefined;
        const ordered = [...layout.sections.flatMap(s => s.fields), ...layout.sidebar];
        return ordered.find(field => {
            const property = collection.properties?.[field.key];
            return property ? !isFieldDisabled(property) : false;
        })?.key;
    }, [layout, collection, status, disabledProp]);

    function isFieldDisabled(property: NonNullable<typeof collection.properties[string]>): boolean {
        const isNew = status === "new" || status === "copy";
        const isStringOrNumber = property.type === "string" || property.type === "number";
        const isIdAndAuto = isStringOrNumber && "isId" in property && typeof property.isId === "string" && property.isId !== "manual";
        return Boolean(
            disabledProp
            || (!autoSave && formex.isSubmitting)
            || isReadOnly(property)
            || Boolean(property.admin?.disabled)
            || (!isNew && "isId" in property && Boolean(property.isId))
            || (isNew && isIdAndAuto)
        );
    }

    const renderField = (field: ResolvedFormField): React.ReactNode => {

        if (field.additional) {
            const additionalField = collection.additionalFields?.find(f => f.key === field.key);
            if (!additionalField || !entity) return null;

            const AdditionalFieldBuilder = additionalField.Builder;
            if (!AdditionalFieldBuilder && !additionalField.value) {
                throw new Error("When using additional fields you need to provide a Builder or a value");
            }
            const additionalFieldContext = formContext as unknown as AdditionalFieldDelegateProps["context"];
            const child = AdditionalFieldBuilder
                ? <AdditionalFieldBuilder entity={entity} context={additionalFieldContext}/>
                : <div className={"w-full"}>
                    <AdditionalFieldValue
                        field={additionalField}
                        entity={entity}
                        context={additionalFieldContext}/>
                </div>;

            return (
                <div key={`additional_${field.key}`}
                    className={spanClass(field.span)}>
                    <LabelWithIconAndTooltip
                        propertyKey={field.key}
                        icon={<AlignLeftIcon size={iconSize.small}/>}
                        title={additionalField.name}
                        className={"text-text-secondary dark:text-text-secondary-dark"}/>
                    <div className={cls(paperMixin, "w-full min-h-14 p-4 md:p-6 overflow-x-auto no-scrollbar")}>
                        <ErrorBoundary>
                            {child}
                        </ErrorBoundary>
                    </div>
                </div>
            );
        }

        const property = collection.properties?.[field.key];
        if (!property) {
            console.warn(`Property ${field.key} not found in collection ${collection.name} in properties or additional fields. Skipping.`);
            return null;
        }

        const underlyingValueHasChanged: boolean =
            !!underlyingChanges &&
            Object.keys(underlyingChanges).includes(field.key) &&
            formex.touched[field.key];

        const disabled = isFieldDisabled(property);
        // The panel-style editors carry their own header; everything else is
        // labelled by FieldBlock, which is what puts every label in one place.
        const selfLabelling = isSelfLabellingProperty(property);

        const cmsFormFieldProps: PropertyFieldBindingProps<M> = {
            propertyKey: field.key,
            disabled,
            property,
            // FieldBlock owns the description now, so the binding must not
            // repeat it — it still renders validation errors, which belong
            // against the control rather than under the label.
            includeDescription: false,
            hideLabel: !selfLabelling,
            underlyingValueHasChanged: underlyingValueHasChanged && !autoSave,
            context: formContext,
            partOfArray: false,
            minimalistView: false,
            // One height for every control in the form. Left to their own
            // defaults, a text field came out 48px, a select 44 and a switch 64.
            size: "large",
            autoFocus: autoFocusKey === field.key
        };

        return (
            <div key={`field_${field.key}`} className={spanClass(field.span)}>
                <FieldBlock propertyKey={field.key}
                    property={property}
                    showLabel={!selfLabelling}>
                    <PropertyFieldBinding {...cmsFormFieldProps}/>
                </FieldBlock>
            </div>
        );
    };

    const formFields = () => {

        if (Builder) {
            return <Builder
                collection={collection}
                entity={entity}
                modifiedValues={formex.values}
                formContext={formContext}
            />;
        }

        const sections = showRail || !layout.sidebar.length
            ? layout.sections
            : [
                ...layout.sections,
                // Trailing, not leading. Beside the column these read as
                // peripheral; stacked above it they pushed the record's own name
                // below its status, which is the wrong thing to meet first.
                // Settings come after the content they apply to.
                {
                    key: "__rail",
                    title: "Settings",
                    collapsible: false,
                    collapsed: false,
                    fields: layout.sidebar
                }
            ];

        return <FormSections
            sections={sections}
            collapsed={collapsedSections}
            onToggle={toggleSection}
            errorKeys={errorKeys}
            renderField={renderField}/>;
    };

    const formRef = useRef<HTMLDivElement>(null);

    const hasFormErrors = Object.keys(formex.errors).length > 0 && formex.submitCount > 0;

    const formView = <ErrorBoundary>
        <>
            {beforeFields}

            {/* The title, the `path/id` chip and the 72px gap under them used to
                live here — 219px above the first field, carrying nothing, and
                scrolling the record's identity away on the first wheel click.
                It is now in the persistent bar, where it stays put. */}

            {!entity?.values && initialStatus === "existing" &&
                <Alert color={"warning"} size={"small"} outerClassName={"w-full mb-4 text-xs"}>
                    This entity does not exist yet
                </Alert>}

            {children}

            {initialEntityId && !entity && initialStatus !== "new" && <Alert color={"info"} size={"small"}>
                This entity does not exist yet
            </Alert>}

            {hasFormErrors && <Alert color={"error"} size={"small"} outerClassName={"w-full mt-2"}>
                Please fix the highlighted errors before saving.
            </Alert>}

            {formContext && <>
                <div ref={formRef}>
                    {formFields()}
                    <ErrorFocus containerRef={formRef}/>
                </div>
            </>}

            {afterFields}

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
                ref={formElementRef}
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
                className={cls("@container/form flex-1 flex flex-col w-full min-h-0", className)}>

                {/* The actions bar is a sibling of this row rather than absolutely
                    positioned over it, so the scroll area ends where the bar
                    begins. As an overlay it hid the last field, and the bottom
                    padding that compensated was a guess at its height. */}
                <div className={"flex-1 min-h-0 flex flex-row w-full"}>

                    {/* Main column. Its own container scope, so a field's span
                        answers to the column it sits in rather than to the window —
                        the same form renders at four very different widths. */}
                    {/* `items-start`: the column is a flex item, so without it the cross-axis
                        default stretches it to the scroller's height. Its content then
                        overflows its own box and the bottom padding sits at the bottom of
                        the *viewport* instead of after the last field — which is why the
                        form appeared to have no padding however large `pb-*` grew. */}
                    <div className={"flex-1 min-w-0 overflow-y-auto flex justify-center items-start"}>
                        <div
                            id={`form_${path}`}
                            className={cls(
                                "@container/col w-full max-w-3xl 2xl:max-w-4xl flex flex-col",
                                openEntityMode === "dialog"
                                    ? "pt-5 pb-8 px-6 sm:px-8"
                                    : "pt-6 pb-12 px-5 sm:px-8"
                            )}>

                            {manualApplyLocalChanges && hasLocalChanges && localChangesCacheKey &&
                                <div className={"flex justify-end mb-3"}>
                                    <LocalChangesMenu<M>
                                        cacheKey={localChangesCacheKey}
                                        properties={collection.properties}
                                        cachedData={localChangesData as Partial<M>}
                                        formex={formex}
                                        onClearLocalChanges={() => {
                                            setLocalChangesCleared(true);
                                            onClearLocalChanges?.();
                                        }}
                                    />
                                </div>}

                            {formView}

                        </div>
                    </div>

                    {showRail && <FormRail
                        fields={layout.sidebar}
                        showRecordMeta={layout.showRecordMeta && status === "existing"}
                        entity={entity as Entity<Record<string, unknown>> | undefined}
                        renderField={renderField}/>}
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
