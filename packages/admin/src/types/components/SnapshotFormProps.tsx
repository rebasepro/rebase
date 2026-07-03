import { Snapshot, SnapshotStatus } from "@rebasepro/types";
import { SnapshotCollection, SnapshotCustomViewParams } from "@rebasepro/types";
import { FormContext } from "../fields";
import { FormexController } from "./formex";
import { SnapshotFormActionsProps } from "./SnapshotFormActionsProps";

/**
 * Props for the headless SnapshotForm component.
 * This form can be used without CMS context — all backend concerns
 * (save, caching, analytics, plugin slots) are provided via callbacks.
 */
export type SnapshotFormProps<M extends Record<string, unknown>> = {
    path: string;
    fullIdPath?: string;
    collection: SnapshotCollection<M>;
    snapshotId?: string | number;
    snapshot?: Snapshot<M>;
    databaseId?: string;
    onIdChange?: (id: string | number) => void;
    onValuesModified?: (modified: boolean, values: M) => void;
    onSaved?: (params: OnUpdateParams) => void;
    initialDirtyValues?: Partial<M>; // dirty cached snapshot in memory
    onFormContextReady?: (formContext: FormContext<M>) => void;
    forceActionsAtTheBottom?: boolean;
    className?: string;
    initialStatus: SnapshotStatus;
    onStatusChange?: (status: SnapshotStatus) => void;
    onSnapshotChange?: (snapshot: Snapshot<M>) => void;
    formex?: FormexController<M>;
    openSnapshotMode?: "side_panel" | "full_screen" | "split" | "dialog";
    /**
     * If true, the form will be disabled and no actions will be available
     */
    disabled?: boolean;
    /**
     * Include the copy and delete actions in the form
     */
    showDefaultActions?: boolean;

    /**
     * Display the snapshot path in the form
     */
    showSnapshotPath?: boolean;

    SnapshotFormActionsComponent?: React.FC<SnapshotFormActionsProps>;

    navigateBack?: () => void;

    Builder?: React.ComponentType<SnapshotCustomViewParams<M>>;

    children?: React.ReactNode;

    // --- Headless callbacks (replace internal CMS hooks) ---

    /**
     * Called on form submit with the values to save.
     * The SnapshotFormBinding wrapper provides this automatically.
     * When using SnapshotForm standalone, provide your own save logic.
     */
    onSubmit?: (values: M, formex: FormexController<M>) => Promise<Snapshot<M> | void> | void;

    /**
     * Called when form values change (deferred).
     * The SnapshotFormBinding wrapper uses this for snapshot caching.
     */
    onValuesChangeDeferred?: (values: M, controller: FormexController<M>) => void;

    /**
     * Called when the form is reset.
     */
    onReset?: () => void;

    /**
     * Validate that a field value is unique.
     * The SnapshotFormBinding wrapper provides this via the data layer.
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
     * If not provided, computed from snapshot + collection defaults.
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
    snapshot: Snapshot<Record<string, unknown>>,
    status: SnapshotStatus,
    path: string,
    snapshotId?: string | number;
    selectedTab?: string;
    collection: SnapshotCollection<Record<string, unknown>>
};
