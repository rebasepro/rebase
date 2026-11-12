
import type { FormContext } from "../types/fields";
import React, { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import type { Properties, Property } from "@rebasepro/types";
import type { EntityFormProps } from "../types/components/EntityFormProps";
import { deepEqual as equal } from "fast-equals";

import { ErrorBoundary, isKeyHandled } from "@rebasepro/ui";
import { useDebouncedCallback } from "@rebasepro/ui";
import { getCopyValues } from "@rebasepro/common";
import { getDefaultValuesFor } from "@rebasepro/cms-types";
import { hasEntityId } from "../util/identity";
import { isDisabled, isReadOnly } from "@rebasepro/app";
import { useAuthController, useCustomizationController, useTranslation } from "@rebasepro/app";

import { getFormFieldKeys, resolveFormLayout } from "@rebasepro/app";
import type { ResolvedFormField, ResolvedFormLayout } from "@rebasepro/app";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Alert, Button, CircularProgressCenter, cls, defaultBorderMixin, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from "@rebasepro/ui";
import { Formex, FormexController, useCreateFormex } from "@rebasepro/forms";

import { FormRail, RecordMeta } from "./components/FormRail";
import { FormSections } from "./components/FormSections";
import { useRailVisible } from "./components/useRailVisible";
import { FormFieldsContext, renderFormField } from "./FormFieldsContext";
import type { FormFieldsContextValue } from "./FormFieldsContext";
import { domScopeFromId, FormDomScopeContext } from "./form_dom_ids";
import { propertiesOfFields } from "./resolve_cell_property";
import { collectionShowing } from "./collection_showing";
import { flattenKeys } from "@rebasepro/app";
import { ErrorFocus } from "./components/ErrorFocus";
import { applyValueTransforms, CustomFieldValidator, getEntitySchema, uniqueValueErrors } from "./validation";
import { formViewer, resolvePropertiesForValidation, withoutUnwritableDefaults } from "./resolve_form_properties";
import { EntityFormActions } from "./EntityFormActions";
import type { EntityFormActionsProps } from "../types/components/EntityFormActionsProps";
import { LocalChangesMenu } from "./components/LocalChangesMenu";
import { useUndoableDiscard } from "./useUndoableDiscard";
import { ownsKeystroke, registerKeyboardScope } from "./form_keyboard_scope";
import { createFormUploadTracker, FormUploadsContext } from "./form_uploads";
import { entityOfRow, idOfRow, rowOfEntity } from "@rebasepro/app";

import {
    getChangedProperties,
    overlayEdit,
    serverViolationErrors,
    withoutUnsetNulls,
    zodToFormErrors
} from "./form_utils";

type CollectionProperty = NonNullable<AdminCollection["properties"][string]>;

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
    id: entityIdProp,
    collection,
    onValuesModified,
    onIdChange,
    onSaved,
    row: rowProp,
    initialDirtyValues,
    onFormContextReady,
    initialStatus,
    className,
    onStatusChange,
    onRowChange,
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
    fields: fieldsProp,
    layout: customLayout,
    compact = false,
    // Headless callback props
    onSubmit: onSubmitProp,
    onValuesChangeDeferred: onValuesChangeDeferredProp,
    onReset: onResetProp,
    uniqueFieldValidator: uniqueFieldValidatorProp,
    lockedPropertyKeys,
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

    const authController = useAuthController();
    const [status, setStatus] = useState<EntityStatus>(initialStatus);

    // The record the row stands for: the admin's own, where the row came from
    // it — its relations' loaded targets, its dates and its version kept.
    const entityProp = useMemo(() => rowProp
        ? entityOfRow(rowProp, entityIdProp ?? idOfRow(rowProp, collection) ?? "", path, collection) as Entity<M>
        : undefined, [rowProp, entityIdProp, path, collection]);

    /**
     * The record as this form last saved it. A create turns the form into the
     * editor of the record it made, and the `row` prop names that record
     * only once the caller has caught up — a caller that never does (the form
     * used on its own) left an "existing" form with no record: it re-seeded
     * itself with the defaults and refused the next Save.
     */
    const [savedEntity, setSavedEntity] = useState<Entity<M> | undefined>(undefined);
    const entity = entityProp ?? (status === "existing" ? savedEntity : undefined);

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
        const errors = { ...await validationErrorsFor(values), ...unshownRequiredErrors() };
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
        setSavedEntity(updatedEntity);
        onResetProp?.();
        onValuesModified?.(false, updatedEntity.values);
        onRowChange?.({ row: rowOfEntity(updatedEntity, collection), id: String(updatedEntity.id) });
        updateStatus("existing");
        setEntityId(updatedEntity.id);

        if (onSaved) {
            onSaved({
                row: rowOfEntity(updatedEntity, collection),
                id: String(updatedEntity.id),
                status,
                path,
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
        // An existing record sends only what changed; a new one or a copy
        // sends what it holds, less what the user could not have written.
        const valuesToSave = status === "existing"
            ? getChangedProperties<M>(writtenValues, entity?.values || {}) as EntityValues<M>
            : withoutUnwritableDefaults<M>(
                status === "new"
                    ? withoutUnsetNulls(writtenValues, baseInitialValues as Partial<M>)
                    : writtenValues,
                baseInitialValues as Partial<M>,
                collection.properties,
                formViewer(authController)
            ) as EntityValues<M>;

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
                if (!result) return;
                const saved = entityOfRow(result.row, result.id, path, collection) as Entity<M>;
                afterSave(saved);
                return saved;
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
    // The record as app code is handed it: the form's context, a Builder.
    const row = entity ? rowOfEntity(entity, collection) : undefined;

    const formContext: FormContext<M> = {
        setFieldValue: useCallback((key: string, value: unknown) => formex.setFieldValue(key, value), []),
        values: formex.values,
        collection,
        id: entityId,
        path,
        save,
        submit: formex.handleSubmit,
        formex,
        row,
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
        id: entityId,
        path,
        row,
        savingError,
        status,
        openEntityMode,
        disabled,
        isSaving
        // `formex.version` is a key, not an input: a reset or re-seed has to
        // hand the fields a new context even though nothing above reads it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [formContext.setFieldValue, collection, entityId, path, row, savingError, status, openEntityMode, disabled, isSaving, formex.version]);

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
        const properties = resolvePropertiesForValidation<M>({
            properties: collection.properties,
            isNew: status === "new" || status === "copy",
            values,
            previousValues: baseInitialValues as Partial<M>,
            path,
            entityId,
            propertyConfigs: customizationController.propertyConfigs,
            authController
        });
        // A form that shows some of the fields judges those: an error on one
        // it does not show would block the save with nothing to fix. A
        // layout's fields come and go (a tab), so it also judges every field
        // this edit changed or touched, mounted now or not: what it saves.
        const shown = shownFieldKeys();
        if (!shown) return properties;
        return propertiesOfFields(properties, customLayout !== undefined ? [...shown, ...editedFieldKeys(values)] : shown);
    }

    /** The top-level fields this edit changed from the baseline, or touched. */
    function editedFieldKeys(values: M): string[] {
        const baseline: Record<string, unknown> = baseInitialValues ?? {};
        const current: Record<string, unknown> = values;
        const changed = Object.keys(current).filter(key => !equal(current[key], baseline[key]));
        const touched = Object.entries(formex.touched)
            .filter(([, isTouched]) => isTouched)
            .map(([key]) => key.split("[")[0]);
        return [...changed, ...touched];
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

    const shownCollection = useMemo(
        () => fieldsProp ? collectionShowing(collection, fieldsProp) : collection,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `fields` is an inline array at most call sites: its contents, not its identity
        [collection, fieldsProp?.join(",")]);
    const formFieldKeys = getFormFieldKeys(shownCollection);

    const layout = useMemo(() => resolveFormLayout({
        collection: shownCollection,
        fieldKeys: formFieldKeys,
        status
    }), [shownCollection, formFieldKeys.join(","), status]);

    const formElementRef = useRef<HTMLFormElement>(null);
    // Measured, not a breakpoint: the rail holds fields the resolver moved
    // out of the column, so when it cannot be shown they have to come back.
    const railVisible = useRailVisible(formElementRef);
    const generatedFields = !Builder && customLayout === undefined;
    const showRail = generatedFields && layout.hasRail && railVisible && !compact;

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
        if (!generatedFields) return undefined;
        const ordered = [...layout.sections.flatMap(s => s.fields), ...layout.sidebar];
        return ordered.find(field => {
            const property = collection.properties?.[field.key];
            return property ? !isFieldDisabled(field.key, property) : false;
        })?.key;
    }, [layout, collection, status, disabledProp, lockedPropertyKeys, generatedFields]);

    /**
     * Every rule that disables a field but a save in progress, which a field
     * reads from the form itself (see `FormFieldsContext`).
     */
    function isFieldDisabled(key: string, property: NonNullable<typeof collection.properties[string]>): boolean {
        const isNew = status === "new" || status === "copy";
        const isStringOrNumber = property.type === "string" || property.type === "number";
        const isIdAndAuto = isStringOrNumber && "isId" in property && typeof property.isId === "string" && property.isId !== "manual";
        return Boolean(
            disabledProp
            || isReadOnly(property)
            || isDisabled(property)
            || (!isNew && "isId" in property && Boolean(property.isId))
            || (isNew && isIdAndAuto)
            || (isNew && lockedPropertyKeys?.includes(key))
        );
    }

    // The fields a `<FormField>` has drawn, counted: one key can be drawn
    // twice. Read at validation time from the ref; the version re-renders the
    // form when a field comes or goes, for the create-time check below.
    const registeredFields = useRef(new Map<string, number>());
    const [registeredVersion, setRegisteredVersion] = useState(0);
    const registerField = useCallback((key: string) => {
        const registered = registeredFields.current;
        registered.set(key, (registered.get(key) ?? 0) + 1);
        setRegisteredVersion(v => v + 1);
        return () => {
            const count = (registered.get(key) ?? 1) - 1;
            if (count > 0) registered.set(key, count); else registered.delete(key);
            setRegisteredVersion(v => v + 1);
        };
    }, []);

    /**
     * The fields this form shows, when it shows some and not all: the ones a
     * `layout`'s `<FormField>`s draw, or the ones `fields` names. Undefined
     * for the generated form of every field, which judges them all.
     */
    function shownFieldKeys(): string[] | undefined {
        if (customLayout !== undefined) return [...registeredFields.current.keys()];
        if (fieldsProp) return layoutFieldKeys(layout);
        return undefined;
    }

    /**
     * What a new record needs that this form will not ask for: a required
     * field it does not show, opening empty — no default, no value handed in,
     * not filled by the server or the database (the validation properties
     * already relax those on create). Such a form can only fail to save, so
     * it says so when it opens.
     */
    const openingValues = (initialModifiedValues ?? baseInitialValues) as Partial<M>;
    const unshownRequired: { key: string, label: string }[] = useMemo(() => {
        if (status !== "new" && status !== "copy") return [];
        const shown = shownFieldKeys();
        if (!shown) return [];
        const shownSet = new Set(shown);
        const judged = resolvePropertiesForValidation<M>({
            properties: collection.properties,
            isNew: true,
            values: openingValues,
            previousValues: baseInitialValues as Partial<M>,
            path,
            entityId,
            propertyConfigs: customizationController.propertyConfigs,
            authController
        });
        return Object.entries(judged)
            .filter(([key, property]) => property.validation?.required
                && !shownSet.has(key)
                && !isGeneratedId(property)
                && isEmptyValue(openingValues[key]))
            .map(([key, property]) => ({ key, label: property.name ?? key }));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `shownFieldKeys` reads the registered fields, which `registeredVersion` counts
    }, [status, customLayout === undefined, layout, registeredVersion, collection, openingValues, path, entityId, customizationController.propertyConfigs, authController]);

    function unshownRequiredErrors(): Record<string, string> {
        if (unshownRequired.length === 0) return {};
        const message = t("form_required_fields_not_shown", { fields: unshownRequired.map(f => f.label).join(", ") });
        return Object.fromEntries(unshownRequired.map(({ key }) => [key, message]));
    }

    /**
     * The field for a key: as the generated layout places it, when it holds
     * the key, else at the property's declared span.
     */
    const fieldFor = useCallback((key: string): ResolvedFormField | undefined => {
        const placed = [...layout.sections.flatMap(s => s.fields), ...layout.sidebar].find(f => f.key === key);
        if (placed) return placed;
        const property = collection.properties?.[key];
        if (property) return { key, span: property.admin?.span ?? 4, additional: false };
        if (collection.additionalFields?.some(f => f.key === key)) return { key, span: 4, additional: true };
        return undefined;
    }, [layout, collection]);

    // Read through a ref so the fields' context keeps its identity; its inputs
    // are among the context's dependencies all the same.
    const isFieldDisabledRef = useRef(isFieldDisabled);
    isFieldDisabledRef.current = isFieldDisabled;
    const stableIsFieldDisabled = useCallback(
        (key: string, property: CollectionProperty) => isFieldDisabledRef.current(key, property),
        []);

    const fieldsContext: FormFieldsContextValue = useMemo(() => ({
        collection: collection as AdminCollection<Record<string, unknown>>,
        path,
        entityId,
        entity: entity as Entity<Record<string, unknown>> | undefined,
        status,
        fieldContext: fieldContext as FormContext<Record<string, unknown>>,
        previousValues: baseInitialValues as Partial<Record<string, unknown>>,
        underlyingChanges,
        autoSave: Boolean(autoSave),
        autoFocusKey,
        fieldSize: compact ? "medium" : "large",
        isFieldDisabled: stableIsFieldDisabled,
        renderField: renderFormField,
        fieldFor,
        register: registerField
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `isFieldDisabled` reads `disabledProp` and `lockedPropertyKeys` through its ref
    }), [collection, path, entityId, entity, status, fieldContext, baseInitialValues, underlyingChanges, autoSave, autoFocusKey, compact, stableIsFieldDisabled, fieldFor, registerField, disabledProp, lockedPropertyKeys]);

    const domScope = domScopeFromId(useId());

    const formFields = () => {

        // Your own arrangement of `<FormField>`s, rendered inside the form so
        // they bind to it and an error scrolls to them.
        if (customLayout !== undefined) {
            // Spaced as the generated fields are, so `<FormField>`s laid out
            // as siblings do not touch; a layout in a container of its own is
            // one child, and keeps its own spacing.
            return <div className={cls("flex flex-col", compact ? "gap-4" : "gap-6")}>{customLayout}</div>;
        }

        if (Builder) {
            // Its own boundary: a Builder is usually a lazy chunk, and without
            // one, loading it suspends the nearest boundary above the record
            // view — which takes the identity bar down with the form.
            return <Suspense fallback={<CircularProgressCenter/>}>
                <Builder
                    collection={collection}
                    parentCollectionSlugs={parentCollectionSlugs}
                    parentEntityIds={parentEntityIds}
                    row={row}
                    id={entity ? String(entity.id) : undefined}
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
                errorKeys={errorKeys}/>

            {/* Folded back with the rail's fields, and for the same reason. The
                rail renders only where it has been measured to fit, so on the
                split pane, the side panel and the dialog this block was dropped
                outright and the record's id was nowhere on screen but the
                truncated chip in the bar. */}
            {!showRail && !compact && layout.showRecordMeta && status === "existing" && entity && (
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
                    {t("entity_does_not_exist")}
                </Alert>}

            {children}

            {hasEntityId(initialEntityId) && !entity && initialStatus !== "new" && <Alert color={"info"} size={"small"}>
                {t("entity_does_not_exist")}
            </Alert>}

            {hasFormErrors && <Alert color={"error"} size={"small"} outerClassName={"w-full mt-2"}>
                {t("fix_errors_before_saving")}
            </Alert>}

            {unshownRequired.length > 0 &&
                <Alert color={"error"} size={"small"} outerClassName={"w-full mt-2"}>
                    {t("form_required_fields_not_shown", { fields: unshownRequired.map(f => f.label).join(", ") })}
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
        if (hasEntityId(entityId) && onIdChange)
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
            <FormDomScopeContext.Provider value={domScope}>
            <FormFieldsContext.Provider value={fieldsContext}>
            <form
                ref={formElementRef}
                data-form-path={path}
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
                            id={domScope}
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
                                compact
                                    ? "pt-3 pb-4 px-3"
                                    : openEntityMode === "dialog"
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
                        entity={entity as Entity<Record<string, unknown>> | undefined}/>}
                </div>

                {dialogActions}

            </form>
            </FormFieldsContext.Provider>
            </FormDomScopeContext.Provider>
            </FormUploadsContext.Provider>

        </Formex>
    );
}

/** Every field a resolved layout places, in the column and in the rail. */
function layoutFieldKeys(layout: ResolvedFormLayout): string[] {
    return [...layout.sections.flatMap(section => section.fields), ...layout.sidebar].map(field => field.key);
}

/** An id the data source or the database generates, which no form asks for. */
function isGeneratedId(property: Property): boolean {
    return "isId" in property && typeof property.isId === "string" && property.isId !== "manual";
}

function isEmptyValue(value: unknown): boolean {
    return value === undefined || value === null || value === ""
        || (Array.isArray(value) && value.length === 0);
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
