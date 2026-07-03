import type { SnapshotCollection, PluginFormActionProps } from "@rebasepro/types";
import type { FormContext } from "../types/fields";
import React, { useCallback, useMemo, useState } from "react";
import { AnalyticsEvent, Snapshot, SnapshotStatus, SnapshotValues } from "@rebasepro/types";
import type { SnapshotFormProps, OnUpdateParams } from "../types/components/SnapshotFormProps";
import type { SnapshotFormActionsProps } from "../types/components/SnapshotFormActionsProps";

import { getLocalChangesBackup } from "@rebasepro/common";

import {
    saveSnapshotWithCallbacks,
    useAuthController,
    useCustomizationController,
    useData,
    useSnackbarController,
    useTranslation,
    useSlot
} from "@rebasepro/core";
import { FormexController } from "@rebasepro/formex";
import { useAnalyticsController } from "@rebasepro/core";

import {
    getSnapshotFromCache,
    removeSnapshotFromCache,
    removeSnapshotFromMemoryCache,
    saveSnapshotToCache
} from "@rebasepro/core";

import { useCollectionRegistryController, useSideSnapshotController, useCMSContext } from "../index";
import { SnapshotForm } from "./SnapshotForm";
import {
    extractTouchedValues,
    removeEmptyContainers,
    getChanges,
    getInitialSnapshotValues,
} from "./form_utils";
import { mergeDeep } from "@rebasepro/utils";

/**
 * Props for the CMS-connected SnapshotFormBinding wrapper.
 * Extends SnapshotFormProps — you can pass all the same props as SnapshotForm,
 * but the binding provides CMS context (save, caching, analytics, plugin slots)
 * automatically.
 */
export type SnapshotFormBindingProps<M extends Record<string, unknown>> = Omit<SnapshotFormProps<M>,
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
 * CMS-connected wrapper around SnapshotForm.
 *
 * Provides all backend concerns that the headless SnapshotForm delegates via callbacks:
 * - Save via the data layer (`saveSnapshotWithCallbacks`)
 * - Unique field validation via the data layer
 * - Snapshot caching (local changes backup/restore)
 * - Plugin slots (form.before, form.after, form.actions)
 * - Snackbar notifications on save success/error
 * - Analytics events
 * - Navigation via side snapshot controller
 *
 * Use this component inside the CMS (`<RebaseShell>`).
 * For headless usage outside the CMS, use `SnapshotForm` directly.
 *
 * @group Components
 */
export function SnapshotFormBinding<M extends Record<string, unknown>>({
    path,
    snapshotId: snapshotIdProp,
    collection,
    snapshot,
    initialStatus,
    onSaved,
    onValuesModified,
    onSnapshotChange,
    onStatusChange,
    openSnapshotMode = "full_screen",
    navigateBack: navigateBackProp,
    initialDirtyValues,
    ...restProps
}: SnapshotFormBindingProps<M>) {

    const { t } = useTranslation();
    const sideSnapshotController = useSideSnapshotController();
    const collectionRegistryController = useCollectionRegistryController();
    const authController = useAuthController();
    const dataClient = useData();
    const snackbarController = useSnackbarController();
    const customizationController = useCustomizationController();
    const context = useCMSContext();
    const analyticsController = useAnalyticsController();

    const [status, setStatus] = useState<SnapshotStatus>(initialStatus);
    const [snapshotId, setSnapshotId] = useState<string | number | undefined>(() => {
        if (status === "new" || status === "copy") return undefined;
        return snapshotIdProp;
    });

    // --- Compute initial values with local changes ---
    const baseInitialValues = useMemo(
        () => getInitialSnapshotValues(authController, collection, path, status, snapshot, customizationController.propertyConfigs),
        [authController, collection, path, status, snapshot, customizationController.propertyConfigs]
    );

    const localChangesBackup = getLocalChangesBackup(collection);
    const autoApplyLocalChanges = localChangesBackup === "auto_apply";
    const manualApplyLocalChanges = localChangesBackup === "manual_apply";

    const localChangesDataRaw = useMemo(() => snapshotId
        ? getSnapshotFromCache(path + "/" + snapshotId)
        : getSnapshotFromCache(path + "#new"), [snapshotId, path]);

    const [localChangesCleared, setLocalChangesCleared] = useState<boolean>(false);

    const computedInitialValues = useMemo(() => {
        const withLocalChanges = autoApplyLocalChanges && localChangesDataRaw
            ? mergeDeep(baseInitialValues, localChangesDataRaw as Partial<M>)
            : baseInitialValues;
        return initialDirtyValues ? mergeDeep(withLocalChanges, initialDirtyValues) : withLocalChanges;
    }, [autoApplyLocalChanges, localChangesDataRaw, baseInitialValues, initialDirtyValues]);

    const localChangesData = useMemo(() => {
        if (!localChangesDataRaw) return undefined;
        const changes = getChanges(localChangesDataRaw, computedInitialValues);
        const cleaned = removeEmptyContainers(changes);
        if (cleaned && typeof cleaned === "object" && Object.keys(cleaned).length === 0) {
            return undefined;
        }
        return cleaned;
    }, [localChangesDataRaw, computedInitialValues]);

    const hasLocalChanges = !localChangesCleared && !!localChangesData && Object.keys(localChangesData as object).length > 0;

    const localChangesCacheKey = useMemo(() => {
        return (status === "new" || status === "copy") ? path + "#new" : path + "/" + snapshotId;
    }, [status, path, snapshotId]);

    // --- Navigate back ---
    const navigateBack = useCallback(() => {
        if (navigateBackProp) {
            navigateBackProp();
            return;
        }
        if (openSnapshotMode === "side_panel" || openSnapshotMode === "dialog") {
            sideSnapshotController.close();
        } else {
            window.history.back();
        }
    }, [navigateBackProp, openSnapshotMode, sideSnapshotController]);

    // --- Cache operations ---
    const clearDirtyCache = useCallback(() => {
        if (status === "new" || status === "copy") {
            removeSnapshotFromMemoryCache(path + "#new");
            removeSnapshotFromCache(path + "#new");
        } else {
            removeSnapshotFromMemoryCache(path + "/" + snapshotId);
            removeSnapshotFromCache(path + "/" + snapshotId);
        }
    }, [status, path, snapshotId]);

    const onReset = useCallback(() => {
        clearDirtyCache();
    }, [clearDirtyCache]);

    const onValuesChangeDeferred = useCallback((values: M, controller: FormexController<M>) => {
        const key = (status === "new" || status === "copy") ? path + "#new" : path + "/" + snapshotId;
        if (controller.dirty) {
            const touchedValues = removeEmptyContainers(extractTouchedValues(values, controller.touched));
            if (touchedValues && Object.keys(touchedValues).length > 0) {
                saveSnapshotToCache(key, touchedValues);
            } else {
                removeSnapshotFromCache(key);
            }
        }
    }, [status, path, snapshotId]);

    // --- Save via data layer ---
    const onSubmit = useCallback(async (values: M, formex: FormexController<M>): Promise<Snapshot<M> | void> => {
        try {
            const savedSnapshot = await saveSnapshotWithCallbacks<M>({
                path,
                snapshotId,
                values,
                previousValues: snapshot?.values,
                collection,
                status,
                data: dataClient,
                context,
                afterSave: (updatedSnapshot: Snapshot<M>) => {
                    clearDirtyCache();
                    onValuesModified?.(false, updatedSnapshot.values);
                    onSnapshotChange?.(updatedSnapshot);
                    setStatus("existing");
                    setSnapshotId(updatedSnapshot.id);
                    onStatusChange?.("existing");

                    if (onSaved) {
                        onSaved({
                            snapshot: updatedSnapshot,
                            status,
                            path,
                            snapshotId: updatedSnapshot.id,
                            collection
                        });
                    }
                },
                afterSaveError: (e: Error) => {
                    snackbarController.open({
                        type: "error",
                        title: t("error_saving_snapshot"),
                        message: e?.message
                    });
                    console.error("Error saving snapshot", path, snapshotId, e);
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
                ? "new_snapshot_saved"
                : (status === "copy" ? "snapshot_copied" : (status === "existing" ? "snapshot_edited" : "unmapped_event"));
            analyticsController.onAnalyticsEvent?.(eventName, { path });

            return savedSnapshot;
        } catch (e: unknown) {
            console.error(e);
            throw e;
        }
    }, [path, snapshotId, snapshot, collection, status, dataClient, context, clearDirtyCache, onValuesModified, onSnapshotChange, onSaved, onStatusChange, snackbarController, analyticsController, t]);

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
            const otherSnapshots = snapshotId ? data.filter(e => e.id !== snapshotId) : data;
            return otherSnapshots.length === 0;
        } catch (e: unknown) {
            console.error("Error checking unique field", e);
            return true;
        }
    }, [dataClient, path, snapshotId]);

    // --- Plugin slots ---
    const parentCollectionSlugs = collectionRegistryController.getParentCollectionSlugs(path);
    const parentSnapshotIds = collectionRegistryController.getParentSnapshotIds(path);

    // Build a minimal formContext for plugin slot props — the full one is built inside SnapshotForm
    const formActionProps: PluginFormActionProps = useMemo(() => ({
        snapshotId,
        parentCollectionSlugs,
        parentSnapshotIds,
        path,
        status,
        collection: collection as SnapshotCollection,
        context,
        formContext: undefined as unknown as FormContext<Record<string, unknown>>,
        openSnapshotMode,
        disabled: false
    }), [snapshotId, parentCollectionSlugs, parentSnapshotIds, path, status, collection, context, openSnapshotMode]);

    const pluginFormActions = useSlot("form.actions", formActionProps);
    const pluginFormBefore = useSlot("form.before", formActionProps);
    const pluginFormAfter = useSlot("form.after", formActionProps);

    return (
        <SnapshotForm<M>
            {...restProps}
            path={path}
            snapshotId={snapshotIdProp}
            collection={collection}
            snapshot={snapshot}
            initialStatus={initialStatus}
            initialDirtyValues={initialDirtyValues}
            onSaved={onSaved}
            onValuesModified={onValuesModified}
            onSnapshotChange={onSnapshotChange}
            onStatusChange={onStatusChange}
            openSnapshotMode={openSnapshotMode}
            navigateBack={navigateBack}
            // Headless callbacks
            onSubmit={onSubmit}
            onValuesChangeDeferred={onValuesChangeDeferred}
            onReset={onReset}
            uniqueFieldValidator={uniqueFieldValidator}
            // Slots
            beforeFields={pluginFormBefore}
            afterFields={pluginFormAfter}
            pluginActions={pluginFormActions ?? []}
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
