import { Entity, EntityStatus } from "@rebasepro/types";

import { EntityCustomViewParams, AdminCollection } from "@rebasepro/cms-types";
import { FormContext } from "../fields";
import { FormexController } from "./formex";
import { EntityFormActionsProps } from "./EntityFormActionsProps";

/**
 * Props for the headless EntityForm component.
 * This form can be used without admin context — all backend concerns
 * (save, caching, analytics, plugin slots) are provided via callbacks.
 */
export type EntityFormProps<M extends Record<string, unknown>> = {
    path: string;
    fullIdPath?: string;
    collection: AdminCollection<M>;
    entityId?: string | number;
    entity?: Entity<M>;
    databaseId?: string;
    onIdChange?: (id: string | number) => void;
    onValuesModified?: (modified: boolean, values: M) => void;
    onSaved?: (params: OnUpdateParams) => void;
    initialDirtyValues?: Partial<M>; // dirty cached entity in memory
    onFormContextReady?: (formContext: FormContext<M>) => void;
    className?: string;
    initialStatus: EntityStatus;
    onStatusChange?: (status: EntityStatus) => void;
    onEntityChange?: (entity: Entity<M>) => void;
    formex?: FormexController<M>;
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    /**
     * If true, the form will be disabled and no actions will be available
     */
    disabled?: boolean;
    /**
     * Include the copy and delete actions in the form
     */
    showDefaultActions?: boolean;

    EntityFormActionsComponent?: React.FC<EntityFormActionsProps>;

    navigateBack?: () => void;

    Builder?: React.ComponentType<EntityCustomViewParams<M>>;

    children?: React.ReactNode;

    // --- Headless callbacks (replace internal admin hooks) ---

    /**
     * Called on form submit with the values to save.
     * The EntityFormBinding wrapper provides this automatically.
     * When using EntityForm standalone, provide your own save logic.
     */
    onSubmit?: (values: M, formex: FormexController<M>) => Promise<Entity<M> | void> | void;

    /**
     * Called when form values change (deferred).
     * The EntityFormBinding wrapper uses this for entity caching.
     */
    onValuesChangeDeferred?: (values: M, controller: FormexController<M>) => void;

    /**
     * Called when the form is reset.
     */
    onReset?: () => void;

    /**
     * Validate that a field value is unique.
     * The EntityFormBinding wrapper provides this via the data layer.
     */
    uniqueFieldValidator?: (params: { name: string; value: unknown }) => Promise<boolean>;

    // --- Slots (replace useSlot) ---

    /** Content rendered before the form fields */
    beforeFields?: React.ReactNode;
    /** Content rendered after the form fields */
    afterFields?: React.ReactNode;
    /** Plugin-provided action elements */
    pluginActions?: React.ReactNode[];

    // --- Local changes (managed externally in binding) ---

    /**
     * Initial values for the form, after applying local changes.
     * If not provided, computed from entity + collection defaults.
     */
    computedInitialValues?: Partial<M>;
    /**
     * Whether there are unsaved local changes in the cache.
     */
    hasLocalChanges?: boolean;
    /**
     * The local changes data for the manual-apply menu.
     */
    localChangesData?: Partial<M>;
    /**
     * Whether manual-apply local changes mode is enabled.
     */
    manualApplyLocalChanges?: boolean;
    /**
     * Cache key for the local changes menu.
     */
    localChangesCacheKey?: string;
    /**
     * Callback when local changes are cleared.
     */
    onClearLocalChanges?: () => void;
};

export type OnUpdateParams = {
    entity: Entity<Record<string, unknown>>,
    status: EntityStatus,
    path: string,
    entityId?: string | number;
    selectedTab?: string;
    collection: AdminCollection<Record<string, unknown>>
};
