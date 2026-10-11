
import type { AdditionalFieldDelegateProps } from "@rebasepro/cms-types";
import type { FormContext, PropertyFieldBindingProps } from "../types/fields";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import type { Properties, Property } from "@rebasepro/types";
import type { EntityFormProps } from "../types/components/EntityFormProps";
import { deepEqual as equal } from "fast-equals";

import { ErrorBoundary, isKeyHandled } from "@rebasepro/ui";
import { AlignLeftIcon, useDebouncedCallback } from "@rebasepro/ui";
import { getCopyValues, getDefaultValuesFor } from "@rebasepro/common";
import { isDisabled, isHidden, isReadOnly } from "@rebasepro/app";
import { useAuthController, useCustomizationController, useRebaseContext, useTranslation } from "@rebasepro/app";

import { getFormFieldKeys, resolveFormLayout } from "@rebasepro/app";
import type { ResolvedFormField } from "@rebasepro/app";
import { Alert, Button, CircularProgressCenter, cls, defaultBorderMixin, Dialog, DialogActions, DialogContent, DialogTitle, paperMixin, Typography } from "@rebasepro/ui";
import { Formex, FormexController, useCreateFormex } from "@rebasepro/forms";

import { FieldBlock, isSelfLabellingProperty, LABEL_ICON_SIZE, spanClass } from "./components/FieldBlock";
import { AdditionalFieldValue } from "../components/AdditionalFieldValue";
import { FormRail, RecordMeta } from "./components/FormRail";
import { FormSections } from "./components/FormSections";
import { useRailVisible } from "./components/useRailVisible";
import { PropertyFieldBinding } from "./PropertyFieldBinding";
import { flattenKeys } from "@rebasepro/app";
import { ErrorFocus } from "./components/ErrorFocus";
import { applyValueTransforms, CustomFieldValidator, getEntitySchema, uniqueValueErrors } from "./validation";
import { resolveFormProperty, resolvePropertiesForValidation } from "./resolve_form_properties";
import { EntityFormActions } from "./EntityFormActions";
import type { EntityFormActionsProps } from "../types/components/EntityFormActionsProps";
import { LocalChangesMenu } from "./components/LocalChangesMenu";
import { useUndoableDiscard } from "./useUndoableDiscard";
import { ownsKeystroke, registerKeyboardScope } from "./form_keyboard_scope";
import { createFormUploadTracker, FormUploadsContext } from "./form_uploads";

import {
    getChangedProperties,
    overlayEdit,
    serverViolationErrors,
    withoutUnsetNulls,
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
    parentCollectionSlugs,
    parentEntityIds,
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

    /**
     * The autosave due: what it writes, and the whole form it was taken from
     * — which is what validation judges.
     */
    const [valuesToBeSaved, setValuesToBeSaved] = useState<{ toSave: EntityValues<M>, values: M } | undefined>(undefined);
    useDebouncedCallback(valuesToBeSaved, () => {
        if (!valuesToBeSaved || !onSubmitProp) return;
        const pending = valuesToBeSaved;
        setIsSavingAutoSave(true);
        // An autosave is a save, and is held to what Save is held to. It
        // wrote every edit unchecked; a form that does not validate now shows
        // why, and writes nothing until it does.
        validateForSave(pending.values)
            .then((errors) => {
                if (Object.keys(errors).length > 0) {
                    formex.validate();
                    return;
                }
                return onSubmitProp(pending.toSave, formex);
            })
            .catch((e) => {
                console.error(e);
                setSavingError(e);
                // The fields the server refused, marked as a Save marks them;
                // an autosave has no submit to make them show, so it counts one.
                const fieldErrors = serverViolationErrors(e, Object.keys(collection.properties ?? {}));
                if (Object.keys(fieldErrors).length > 0) {
                    for (const [key, message] of Object.entries(fieldErrors)) formex.setFieldError(key, message);
                    formex.setSubmitCount(formex.submitCount + 1);
                }
            })
            .finally(() => setIsSavingAutoSave(false));
    }, false, 2000);

    /**
     * The properties the record changed underneath an edit of the user's own,
     * keyed to the value they changed to — each one shown as "updated
     * elsewhere" while the form still holds something else. Filled by the
     * effect that follows the baseline, below.
     */
    const [underlyingChanges, setUnderlyingChanges] = useState<Record<string, unknown>>({});

    /**
     * Rules the stored record already broke, on fields this edit leaves alone —
     * shown, and not held against the save. Keyed like `formex.errors`.
     */
    const [predatingViolations, setPredatingViolations] = useState<Record<string, unknown>>({});

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

    const discard = useUndoableDiscard();

    const autoSave = collection.formAutoSave;

    // Use externally computed initial values if provided, otherwise compute from entity + collection
    const baseInitialValues = useMemo(() => {
        if (computedInitialValues !== undefined) {
            return computedInitialValues;
        }
        // Fallback: compute from entity/collection (requires authController from context)
        // In headless mode without computedInitialValues, use entity values or defaults
        if (status === "copy" && entity) {
            return getCopyValues(collection, entity.values ?? getDefaultValuesFor(collection.properties));
        }
        if (status === "existing" && entity) {
            return entity.values ?? getDefaultValuesFor(collection.properties);
        }
        return getDefaultValuesFor(collection.properties);
    }, [computedInitialValues, collection, status, entity]);

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

    /**
     * What the form opens showing, when that is not what is stored — an edit
     * carried over from the side panel's "open full screen", or a draft
     * restored from the local-changes backup.
     *
     * The merge is deliberately *not* folded into the baseline. `mergeDeep`
     * used to produce a single `initialValues` that served as both, with a
     * `initialDirty: true` bolted on beside it to say what the baseline could
     * no longer show — and that flag survived exactly one render, because the
     * record's data arriving replaced the baseline and the form recomputed
     * dirty as false against a baseline that already contained the edit.
     *
     * Read once, at mount: this is a handoff, and re-reading it every render
     * tied the form to a cache that is cleared as soon as it has been consumed.
     */
    const initialModifiedValues = useRef(
        initialDirtyValues && Object.keys(initialDirtyValues).length > 0
            ? overlayEdit(baseInitialValues as Partial<M>, initialDirtyValues as Partial<M>)
            : undefined
    ).current;

    /**
     * Every key of the handed-over edit, marked touched. Read once, at mount,
     * like the edit itself: it was rebuilt on every render — a key-value map
     * of 1,000 entries cost ~60 ms per keystroke — by a spread that copied the
     * map once per key.
     */
    const [initialTouched] = useState<Record<string, boolean>>(() => {
        const touched: Record<string, boolean> = {};
        if (initialDirtyValues) {
            for (const key of flattenKeys(initialDirtyValues)) touched[key] = true;
        }
        return touched;
    });

    // A Save waits for a file still uploading: its path reaches the values
    // only when the upload ends. See `form_uploads.ts`.
    const [uploadTracker] = useState(createFormUploadTracker);

    const internalFormex = useCreateFormex<M>({
        initialValues: baseInitialValues as M,
        beforeSubmit: uploadTracker.wait,
        initialModifiedValues: initialModifiedValues as M | undefined,
        debugId: `EntityForm:${path}/${entityIdProp}`,
        initialTouched,
        onSubmit,
        onReset: () => {
            setUnderlyingChanges({});
            onResetProp?.();
            // The stored values — a reset returns the form to them, and by now
            // that is the baseline whether or not it was at mount.
            onValuesModified?.(false, baseInitialValues as M);
        },
        onValuesChangeDeferred: onValuesChangeDeferredProp,
        validation: (values) => validateForSave(values)
    });
    const formex: FormexController<M> = formexProp ?? internalFormex;

    /**
     * The errors that stop a save of `values`. Formex runs it on submit, and
     * the autosave runs it before each write.
     */
    async function validateForSave(values: M): Promise<Record<string, string>> {
        const errors = await validationErrorsFor(values);
        if (status !== "existing" || !entity?.values || Object.keys(errors).length === 0) {
            setPredatingViolations({});
            return errors;
        }
        // A record stored before a rule existed still breaks it, and the
        // server — which judges only what is sent — would take an
        // unrelated edit. So a field the user did not change, that the
        // stored record already broke, is a warning and not a refusal. A
        // field they changed must be valid, and so must one their edit
        // made invalid: a rule that reads the edited value is the edit's.
        const edited = getChangedProperties<M>(values, entity.values as Partial<M>);
        const storedErrors = await validationErrorsFor(entity.values as M);
        const blocking: Record<string, string> = {};
        const predating: Record<string, string> = {};
        for (const [key, error] of Object.entries(errors)) {
            if (!(key in edited) && key in storedErrors) predating[key] = error;
            else blocking[key] = error;
        }
        setPredatingViolations(predating);
        return blocking;
    }

    // One form takes a shortcut: the one the focus is in, else the one
    // mounted last (the top panel). Registered once per mount, so the order
    // is the order the forms opened in. See `form_keyboard_scope.ts`.
    const keyboardScope = useRef<ReturnType<typeof registerKeyboardScope> | undefined>(undefined);
    useEffect(() => {
        const scope = registerKeyboardScope(() => formElementRef.current);
        keyboardScope.current = scope;
        return () => {
            scope.unregister();
            keyboardScope.current = undefined;
        };
    }, []);

    useEffect(() => {

        const handleKeyDown = (e: KeyboardEvent) => {
            // A layer above the form (a dialog, a menu) already acted on it.
            if (isKeyHandled(e)) return;
            if (!keyboardScope.current || !ownsKeystroke(keyboardScope.current, e)) return;
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

    // What the form opened with counts as saved: a New form nobody touched
    // has nothing to autosave. Seeded with `entity?.values`, which a new
    // record does not have, the first autosave wrote a record of defaults.
    const lastSavedValues = useRef<EntityValues<M> | undefined>(baseInitialValues as EntityValues<M>);
    const save = async (values: EntityValues<M>): Promise<Entity<M> | void> => {
        // The string transforms a property declares change what is written;
        // validation has already judged the transformed value.
        const writtenValues = applyValueTransforms(values, collection.properties);
        const valuesToSave = status === "existing"
            ? getChangedProperties<M>(writtenValues, entity?.values || {}) as EntityValues<M>
            : status === "new"
                ? withoutUnsetNulls(writtenValues, baseInitialValues as Partial<M>)
                : writtenValues;

        if (status === "existing" && Object.keys(valuesToSave).length === 0 && entity) {
            return Promise.resolve(entity);
        }

        lastSavedValues.current = values;

        if (!onSubmitProp) {
            return;
        }

        const autoSaveEnabled = autoSave ?? false;

        if (autoSaveEnabled) {
            setValuesToBeSaved({ toSave: valuesToSave, values: values as M });
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
                // The fields the server refused, marked where the user can
                // see them — not only the sentence in the footer.
                const fieldErrors = serverViolationErrors(e, Object.keys(collection.properties ?? {}));
                for (const [key, message] of Object.entries(fieldErrors)) formex.setFieldError(key, message);
            });
    };

    const disabled = formex.isSubmitting || Boolean(disabledProp);

    // The context an `additionalFields` Builder is documented to receive, and
    // the one `CollectionTableBinding` already hands it. This form used to pass
    // its own `FormContext` instead, laundered through
    // `formContext as unknown as AdditionalFieldDelegateProps["context"]` —
    // two unrelated types, so a Builder reading anything off `RebaseContext`
    // worked in the table view and read `undefined` in the form.
    const rebaseContext = useRebaseContext();

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

    /**
     * The context the fields get. Not `formContext`: that one is a new object
     * per render, and a field memoised on its own value would re-render for it
     * on every keystroke anywhere in the form.
     *
     * This one changes identity only with what a field may draw from it — the
     * record, its status, the form's `version` (a reset or re-seed) — and reads
     * `values`, `formex` and `save` through a ref, so a field that did not
     * re-render still sees the current ones from its callbacks (a storage path
     * builder, a markdown file name). A field that reads another field's value
     * *while rendering* has to re-render with it; `PropertyFieldBinding` keeps
     * those — custom `Field`s, `dynamicProps`, `conditions` — on that path.
     */
    const latestRef = useRef({ formex, save });
    latestRef.current = { formex, save };
    const isSaving = formex.isSubmitting || isSavingAutoSave;
    const fieldContext: FormContext<M> = useMemo(() => ({
        get values() {
            return latestRef.current.formex.values;
        },
        get formex() {
            return latestRef.current.formex;
        },
        setFieldValue: formContext.setFieldValue,
        save: (values: M) => latestRef.current.save(values),
        submit: () => latestRef.current.formex.handleSubmit(),
        collection,
        entityId: entityId as string,
        path,
        entity,
        savingError,
        status,
        openEntityMode,
        disabled,
        isSaving
        // `formex.version` is a key, not an input: a reset or re-seed has to
        // hand the fields a new context even though nothing above reads it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [formContext.setFieldValue, collection, entityId, path, entity, savingError, status, openEntityMode, disabled, isSaving, formex.version]);

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

    const authController = useAuthController();
    const customizationController = useCustomizationController();
    const { t } = useTranslation();

    async function validationErrorsFor(values: M): Promise<Record<string, string>> {
        const properties = validationPropertiesFor(values);
        const result = await getEntitySchema(entityId, properties, uniqueFieldValidator).safeParseAsync(values);
        const errors: Record<string, string> = result.success ? {} : zodToFormErrors(result.error);
        // `validation.unique` asks the data source, so it runs here — on
        // submit — and only for values this edit changed that are otherwise
        // valid. It was built and threaded through, and never called.
        const notUnique = await uniqueValueErrors({
            properties,
            values,
            storedValues: status === "existing" ? entity?.values : undefined,
            entityId,
            errors,
            validator: uniqueFieldValidator
        });
        return { ...errors, ...notUnique };
    }

    /**
     * What the save is judged against: the properties as the form shows them
     * for these values — `dynamicProps` and `conditions` applied — and only
     * the ones the user can change. Built per call because both depend on the
     * values being judged.
     */
    function validationPropertiesFor(values: M) {
        return resolvePropertiesForValidation<M>({
            properties: collection.properties,
            isNew: status === "new" || status === "copy",
            values,
            previousValues: baseInitialValues as Partial<M>,
            path,
            entityId,
            propertyConfigs: customizationController.propertyConfigs,
            authController
        });
    }

    useOnAutoSave(autoSave, formex, lastSavedValues, save);

    /**
     * The record changed while the form was open: someone else saved it, and
     * the listener delivered the new version as a new baseline.
     *
     * An unmodified form follows it whole — formex does that. A modified one
     * keeps the edit, and formex keeps *everything* it holds: a property the
     * user never changed would still show the old value, differ from the new
     * stored one, and be written back by the next save, reverting the other
     * change without a word.
     *
     * So each top-level property that changed underneath is judged on its own,
     * against the baseline the form last followed. One the user has not changed
     * follows the record. One the user has changed keeps the edit — that is
     * what a save writes — and is marked as updated elsewhere, so the overwrite
     * is not a surprise.
     */
    const followedBaseline = useRef(baseInitialValues);
    useEffect(() => {
        const previous: Record<string, unknown> = followedBaseline.current ?? {};
        const next: Record<string, unknown> = baseInitialValues ?? {};
        followedBaseline.current = baseInitialValues;
        if (previous === next) return;

        const current: Record<string, unknown> = formex.values;
        if (equal(previous, current)) return;

        const conflicts: Record<string, unknown> = {};
        const changedUnderneath = new Set([...Object.keys(previous), ...Object.keys(next)]);
        for (const key of changedUnderneath) {
            if (equal(previous[key], next[key])) {
                changedUnderneath.delete(key);
            } else if (equal(current[key], previous[key])) {
                formex.setFieldValue(key, next[key]);
            } else if (!equal(current[key], next[key])) {
                conflicts[key] = next[key];
            }
        }
        if (changedUnderneath.size === 0) return;

        setUnderlyingChanges(prev => {
            const updated = { ...prev };
            changedUnderneath.forEach(key => {
                if (key in conflicts) updated[key] = conflicts[key];
                else delete updated[key];
            });
            return updated;
        });
    }, [baseInitialValues]);

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
            || isDisabled(property)
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
            const child = AdditionalFieldBuilder
                ? <AdditionalFieldBuilder entity={entity} context={rebaseContext}/>
                : <div className={"w-full"}>
                    <AdditionalFieldValue
                        field={additionalField}
                        entity={entity}
                        context={rebaseContext}/>
                </div>;

            return (
                // Through FieldBlock like every other cell, so a computed
                // column is labelled at the same size, with the same gap to its
                // box, as the property next to it on the grid.
                <div key={`additional_${field.key}`}
                    className={spanClass(field.span)}>
                    <FieldBlock propertyKey={field.key}
                        showLabel={true}
                        label={additionalField.name}
                        icon={<AlignLeftIcon size={LABEL_ICON_SIZE}/>}>
                        <div className={cls(paperMixin, "w-full min-h-12 p-4 md:p-6 overflow-x-auto no-scrollbar")}>
                            {child}
                        </div>
                    </FieldBlock>
                </div>
            );
        }

        const property = collection.properties?.[field.key];
        if (!property) {
            console.warn(`Property ${field.key} not found in collection ${collection.name} in properties or additional fields. Skipping.`);
            return null;
        }
        // A field a rule hides for these values takes its label with it: the
        // binding renders nothing, and a heading over nothing is worse.
        if (property.conditions?.hidden) {
            const shown = resolveFormProperty({
                propertyKey: field.key,
                property,
                values: formex.values,
                previousValues: baseInitialValues as Partial<M>,
                path,
                entityId,
                propertyConfigs: customizationController.propertyConfigs,
                ignoreMissingFields: true,
                authController
            });
            if (!shown || isHidden(shown)) return null;
        }

        const underlyingValueHasChanged: boolean =
            field.key in underlyingChanges &&
            !equal(formex.values[field.key], underlyingChanges[field.key]);

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
            context: fieldContext,
            partOfArray: false,
            minimalistView: false,
            // One height for every control in the form. Left to their own
            // defaults, a text field came out 48px, a select 44 and a switch 64.
            // `large` (48px, 14px text): the record-form density. 0.20.0 took
            // the form to `small` (32px) to match the reference, and the fields
            // read as cramped next to what they had been; see DESIGN.md "Form
            // density".
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
            // Its own boundary: a Builder is usually a lazy chunk, and without
            // one, loading it suspends the nearest boundary above the record
            // view — which takes the identity bar down with the form.
            return <Suspense fallback={<CircularProgressCenter/>}>
                <Builder
                    collection={collection}
                    parentCollectionSlugs={parentCollectionSlugs}
                    parentEntityIds={parentEntityIds}
                    entity={entity}
                    modifiedValues={formex.values}
                    formContext={formContext}
                />
            </Suspense>;
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

        return <>
            <FormSections
                sections={sections}
                collapsed={collapsedSections}
                onToggle={toggleSection}
                errorKeys={errorKeys}
                renderField={renderField}/>

            {/* Folded back with the rail's fields, and for the same reason. The
                rail renders only where it has been measured to fit, so on the
                split pane, the side panel and the dialog this block was dropped
                outright and the record's id was nowhere on screen but the
                truncated chip in the bar. */}
            {!showRail && layout.showRecordMeta && status === "existing" && entity && (
                <div className={cls("mt-8 pt-5 border-t max-w-sm", defaultBorderMixin)}>
                    <RecordMeta entity={entity as Entity<Record<string, unknown>>}/>
                </div>
            )}
        </>;
    };

    const formRef = useRef<HTMLDivElement>(null);

    const hasFormErrors = Object.keys(formex.errors).length > 0 && formex.submitCount > 0;

    const predatingViolationLines = useMemo(
        () => errorLines(predatingViolations, collection.properties),
        [predatingViolations, collection.properties]
    );

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

            {predatingViolationLines.length > 0 &&
                <Alert color={"warning"} size={"small"} outerClassName={"w-full mt-2"}>
                    <Typography variant={"caption"} component={"div"}>
                        {t("form_predating_rule_violations")}
                    </Typography>
                    <ul className={"list-disc pl-5 mt-1"}>
                        {predatingViolationLines.map(({ path: errorPath, label, message }) =>
                            <li key={errorPath}><Typography variant={"caption"}>{`${label}: ${message}`}</Typography></li>)}
                    </ul>
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
                            ? "All unsaved changes will be lost. "
                            : "All entered values will be cleared. "}
                        You can bring them back with Undo (⌘Z / Ctrl+Z), or from
                        the notification, for as long as this form stays open.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button variant={"text"} onClick={() => setDiscardDialogOpen(false)}>
                        Cancel
                    </Button>
                    <Button variant={"filled"} color={"error"} onClick={() => {
                        setDiscardDialogOpen(false);
                        discard(formex, status, baseInitialValues);
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
            <FormUploadsContext.Provider value={uploadTracker}>
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
                                // Two rules widen the column, and they answer to
                                // different things on purpose. `@7xl/form` measures
                                // the form itself: full screen on a laptop is ~1400px
                                // of form, which after the 304px rail leaves room for
                                // the wider column with real gutters either side — and
                                // it stays 768 in the split pane and the side panel,
                                // which never get that wide. `2xl` is the older
                                // viewport rule, kept so a panel on a large monitor
                                // does not get *narrower* than it is today.
                                "@container/col w-full max-w-3xl @7xl/form:max-w-4xl 2xl:max-w-4xl flex flex-col",
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
            </FormUploadsContext.Provider>

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

/**
 * A nested error map — the shape `zodToFormErrors` builds — as one line per
 * failing field, labelled with the property's name.
 */
function errorLines(
    errors: Record<string, unknown>,
    properties: Properties
): { path: string; label: string; message: string }[] {
    const lines: { path: string; label: string; message: string }[] = [];
    const walk = (value: unknown, path: string[], label: string[], props: Properties | undefined) => {
        if (typeof value === "string") {
            lines.push({ path: path.join("."), label: label.join(" › "), message: value });
            return;
        }
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            const property = props?.[key] as Property | undefined;
            const childProps = property?.type === "map" ? property.properties as Properties | undefined : undefined;
            walk(child, [...path, key], [...label, property?.name ?? key], childProps);
        }
    };
    walk(errors, [], [], properties);
    return lines;
}
