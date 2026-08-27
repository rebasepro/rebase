
import type { PluginFormActionProps, AdminCollection } from "@rebasepro/cms-types";
import type { FormContext } from "../types/fields";
import React, { useCallback, useMemo, useState } from "react";
import { Entity, EntityStatus, EntityValues } from "@rebasepro/types";
import { AnalyticsEvent } from "@rebasepro/cms-types";
import type { EntityFormProps, OnUpdateParams } from "../types/components/EntityFormProps";
import type { EntityFormActionsProps } from "../types/components/EntityFormActionsProps";

import { getLocalChangesBackup } from "@rebasepro/app";

import {
    saveEntityWithCallbacks,
    useAuthController,
    useCustomizationController,
    useData,
    useSnackbarController,
    useTranslation,
    useSlot
} from "@rebasepro/app";
import { FormexController } from "@rebasepro/forms";
import { useAnalyticsController } from "@rebasepro/app";

import {
    getEntityFromCache,
    removeEntityFromCache,
    removeEntityFromMemoryCache,
    saveEntityToCache
} from "@rebasepro/app";

import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useSidePanel } from "../hooks/useSidePanel";
import { useAdminContext } from "../hooks/useAdminContext";
import { EntityForm } from "./EntityForm";
import {
    extractTouchedValues,
    removeEmptyContainers,
    getInitialEntityValues,
    getUnappliedLocalChanges,
} from "./form_utils";
import { mergeDeep } from "@rebasepro/utils";

/**
 * Props for the admin-connected EntityFormBinding wrapper.
 * Extends EntityFormProps — you can pass all the same props as EntityForm,
 * but the binding provides admin context (save, caching, analytics, plugin slots)
 * automatically.
 */
export type EntityFormBindingProps<M extends Record<string, unknown>> = Omit<EntityFormProps<M>,
    | "onSubmit"
    | "onValuesChangeDeferred"
    | "onReset"
    | "uniqueFieldValidator"
    | "beforeFields"
    | "afterFields"
    | "pluginActions"
    | "computedInitialValues"
    | "hasLocalChanges"
    | "localChangesData"
    | "manualApplyLocalChanges"
    | "localChangesCacheKey"
    | "onClearLocalChanges"
>;

/**
 * admin-connected wrapper around EntityForm.
 *
 * Provides all backend concerns that the headless EntityForm delegates via callbacks:
 * - Save via the data layer (`saveEntityWithCallbacks`)
 * - Unique field validation via the data layer
 * - Entity caching (local changes backup/restore)
 * - Plugin slots (form.before, form.after, form.actions)
 * - Snackbar notifications on save success/error
 * - Analytics events
 * - Navigation via side entity controller
 *
 * Use this component inside the admin (`<RebaseShell>`).
 * For headless usage outside the admin, use `EntityForm` directly.
 *
 * @group Components
 */
export function EntityFormBinding<M extends Record<string, unknown>>({
    path,
    entityId: entityIdProp,
    collection,
    entity,
    initialStatus,
    onSaved,
    onValuesModified,
    onEntityChange,
    onStatusChange,
    openEntityMode = "full_screen",
    navigateBack: navigateBackProp,
    initialDirtyValues,
    ...restProps
}: EntityFormBindingProps<M>) {

    const { t } = useTranslation();
    const sidePanelController = useSidePanel();
    const collectionRegistryController = useCollectionRegistryController();
    const authController = useAuthController();
    const dataClient = useData();
    const snackbarController = useSnackbarController();
    const customizationController = useCustomizationController();
    const context = useAdminContext();
    const analyticsController = useAnalyticsController();

    const [status, setStatus] = useState<EntityStatus>(initialStatus);
    const [entityId, setEntityId] = useState<string | number | undefined>(() => {
        if (status === "new" || status === "copy") return undefined;
        return entityIdProp;
    });

    // --- Compute initial values with local changes ---
    const baseInitialValues = useMemo(
        () => getInitialEntityValues(authController, collection, path, status, entity, customizationController.propertyConfigs),
        [authController, collection, path, status, entity, customizationController.propertyConfigs]
    );

    const localChangesBackup = getLocalChangesBackup(collection);
    const autoApplyLocalChanges = localChangesBackup === "auto_apply";
    const manualApplyLocalChanges = localChangesBackup === "manual_apply";

    const localChangesDataRaw = useMemo(() => entityId
        ? getEntityFromCache(path + "/" + entityId)
        : getEntityFromCache(path + "#new"), [entityId, path]);

    const [localChangesCleared, setLocalChangesCleared] = useState<boolean>(false);

    // `initialDirtyValues` is deliberately *not* merged in here any more. This
    // value is the form's baseline, and an edit folded into the baseline is
    // indistinguishable from saved data — which is how an edit carried over
    // from the side panel arrived reading "Saved". {@link EntityForm} applies
    // it as an overlay on the values instead, so the difference survives.
    //
    // The auto-applied local-changes backup is still folded in, unchanged, and
    // has the same shape of problem: a restored draft opens undirty and cannot
    // be saved until a field is touched. Left as it is rather than changed
    // blind, since nothing here exercises that path.
    const computedInitialValues = useMemo(() => {
        return autoApplyLocalChanges && localChangesDataRaw
            ? mergeDeep(baseInitialValues, localChangesDataRaw as Partial<M>)
            : baseInitialValues;
    }, [autoApplyLocalChanges, localChangesDataRaw, baseInitialValues]);

    const localChangesData = useMemo(() => {
        if (!localChangesDataRaw) return undefined;
        // What the form opens showing: the baseline plus any edit handed over by
        // the layout this one replaced. See {@link getUnappliedLocalChanges} for
        // why the banner is measured against that and not against the baseline.
        const openingValues = initialDirtyValues
            ? mergeDeep(computedInitialValues, initialDirtyValues)
            : computedInitialValues;
        return getUnappliedLocalChanges(
            localChangesDataRaw as Partial<M>,
            openingValues as Partial<M>
        );
    }, [localChangesDataRaw, computedInitialValues, initialDirtyValues]);

    const hasLocalChanges = !localChangesCleared && !!localChangesData && Object.keys(localChangesData as object).length > 0;

    const localChangesCacheKey = useMemo(() => {
        return (status === "new" || status === "copy") ? path + "#new" : path + "/" + entityId;
    }, [status, path, entityId]);

    // --- Navigate back ---
    const navigateBack = useCallback(() => {
        if (navigateBackProp) {
            navigateBackProp();
            return;
        }
        if (openEntityMode === "side_panel" || openEntityMode === "dialog") {
            sidePanelController.close();
        } else {
            window.history.back();
        }
    }, [navigateBackProp, openEntityMode, sidePanelController]);

    // --- Cache operations ---
    const clearDirtyCache = useCallback(() => {
        if (status === "new" || status === "copy") {
            removeEntityFromMemoryCache(path + "#new");
            removeEntityFromCache(path + "#new");
        } else {
            removeEntityFromMemoryCache(path + "/" + entityId);
            removeEntityFromCache(path + "/" + entityId);
        }
    }, [status, path, entityId]);

    const onReset = useCallback(() => {
        clearDirtyCache();
    }, [clearDirtyCache]);

    const onValuesChangeDeferred = useCallback((values: M, controller: FormexController<M>) => {
        const key = (status === "new" || status === "copy") ? path + "#new" : path + "/" + entityId;
        if (controller.dirty) {
            const touchedValues = removeEmptyContainers(extractTouchedValues(values, controller.touched));
            if (touchedValues && Object.keys(touchedValues).length > 0) {
                saveEntityToCache(key, touchedValues);
            } else {
                removeEntityFromCache(key);
            }
        }
    }, [status, path, entityId]);

    // --- Save via data layer ---
    const onSubmit = useCallback(async (values: M, formex: FormexController<M>): Promise<Entity<M> | void> => {
        try {
            const savedEntity = await saveEntityWithCallbacks<M>({
                path,
                entityId,
                values,
                previousValues: entity?.values,
                collection,
                status,
                data: dataClient,
                context,
                afterSave: (updatedEntity: Entity<M>) => {
                    clearDirtyCache();
                    onValuesModified?.(false, updatedEntity.values);
                    onEntityChange?.(updatedEntity);
                    setStatus("existing");
                    setEntityId(updatedEntity.id);
                    onStatusChange?.("existing");

                    if (onSaved) {
                        onSaved({
                            entity: updatedEntity,
                            status,
                            path,
                            entityId: updatedEntity.id,
                            collection
                        });
                    }
                },
                afterSaveError: (e: Error) => {
                    snackbarController.open({
                        type: "error",
                        title: t("error_saving_entity"),
                        message: e?.message
                    });
                    console.error("Error saving entity", path, entityId, e);
                }
            });

            const autoSave = collection.formAutoSave;
            if (!autoSave) {
                snackbarController.open({
                    type: "success",
                    message: `${collection.singularName ?? collection.name}: ${t("saved_correctly")}`
                });
            }

            const eventName: AnalyticsEvent = status === "new"
                ? "new_entity_saved"
                : (status === "copy" ? "entity_copied" : (status === "existing" ? "entity_edited" : "unmapped_event"));
            analyticsController.onAnalyticsEvent?.(eventName, { path });

            return savedEntity;
        } catch (e: unknown) {
            console.error(e);
            throw e;
        }
    }, [path, entityId, entity, collection, status, dataClient, context, clearDirtyCache, onValuesModified, onEntityChange, onSaved, onStatusChange, snackbarController, analyticsController, t]);

    // --- Unique field validation via data layer ---
    const uniqueFieldValidator = useCallback(async ({
        name,
        value
    }: { name: string; value: unknown }) => {
        try {
            const accessor = dataClient.collection(path);
            const { data } = await accessor.find({
                where: { [name]: ["==", value] },
                limit: 2
            });
            const otherEntities = entityId ? data.filter(e => e.id !== entityId) : data;
            return otherEntities.length === 0;
        } catch (e: unknown) {
            console.error("Error checking unique field", e);
            return true;
        }
    }, [dataClient, path, entityId]);

    // --- Plugin slots ---
    const parentCollectionSlugs = collectionRegistryController.getParentCollectionSlugs(path);
    const parentEntityIds = collectionRegistryController.getParentEntityIds(path);

    // Build a minimal formContext for plugin slot props — the full one is built inside EntityForm
    const formActionProps: PluginFormActionProps = useMemo(() => ({
        entityId,
        parentCollectionSlugs,
        parentEntityIds,
        path,
        status,
        collection: collection as AdminCollection,
        context,
        formContext: undefined as unknown as FormContext<Record<string, unknown>>,
        openEntityMode,
        disabled: false
    }), [entityId, parentCollectionSlugs, parentEntityIds, path, status, collection, context, openEntityMode]);

    // `form.actions` is rendered by the entity view's identity bar, which has
    // the real formContext and does not cost a footer. Rendering it here too
    // would show Autofill twice.
    const pluginFormBefore = useSlot("form.before", formActionProps);
    const pluginFormAfter = useSlot("form.after", formActionProps);

    return (
        <EntityForm<M>
            {...restProps}
            path={path}
            entityId={entityIdProp}
            collection={collection}
            entity={entity}
            initialStatus={initialStatus}
            initialDirtyValues={initialDirtyValues}
            onSaved={onSaved}
            onValuesModified={onValuesModified}
            onEntityChange={onEntityChange}
            onStatusChange={onStatusChange}
            openEntityMode={openEntityMode}
            navigateBack={navigateBack}
            // Headless callbacks
            onSubmit={onSubmit}
            onValuesChangeDeferred={onValuesChangeDeferred}
            onReset={onReset}
            uniqueFieldValidator={uniqueFieldValidator}
            // Slots
            beforeFields={pluginFormBefore}
            afterFields={pluginFormAfter}
            pluginActions={[]}
            // Local changes
            computedInitialValues={computedInitialValues as Partial<M>}
            hasLocalChanges={hasLocalChanges}
            localChangesData={localChangesData as Partial<M>}
            manualApplyLocalChanges={manualApplyLocalChanges}
            localChangesCacheKey={localChangesCacheKey}
            onClearLocalChanges={() => setLocalChangesCleared(true)}
        />
    );
}
