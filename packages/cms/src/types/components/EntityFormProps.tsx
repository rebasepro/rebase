import { EntityStatus } from "@rebasepro/types";

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
    /**
     * The record's id. On a new record (`initialStatus: "new"`), the id it is
     * created under; omit it to let the data source assign one.
     */
    id?: string | number;
    /**
     * The saved record, as the server sends the row — dates as ISO strings, a
     * belongsTo as its foreign-key column. Absent for a new record.
     */
    row?: Record<string, unknown>;
    databaseId?: string;
    onIdChange?: (id: string | number) => void;
    onValuesModified?: (modified: boolean, values: M) => void;
    onSaved?: (params: OnSavedParams) => void;
    initialDirtyValues?: Partial<M>; // dirty cached entity in memory
    onFormContextReady?: (formContext: FormContext<M>) => void;
    className?: string;
    initialStatus: EntityStatus;
    onStatusChange?: (status: EntityStatus) => void;
    /** Called with the record as it now is, after each save: its row and its id. */
    onRowChange?: (params: { row: Record<string, unknown>; id: string }) => void;
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

    /**
     * Rendered in place of the generated fields, inside this form — so it is
     * handed this form's live {@link FormContext}, and Save, validation and the
     * unsaved-changes guard all see what it writes. A collection's
     * `formView.Builder` and an entity view declared with `includeActions` both
     * arrive here.
     */
    Builder?: React.ComponentType<EntityCustomViewParams<M>>;

    /**
     * Passed through to {@link Builder}: the path of parents above this record,
     * which every entity view receives. The form itself does not read them.
     */
    parentCollectionSlugs?: string[];
    parentEntityIds?: string[];

    /**
     * Rendered above the fields, inside the form.
     */
    children?: React.ReactNode;

    /**
     * The fields the generated form shows, in this order; any other property
     * is left out. Sections and the rail keep their grouping, each holding
     * only these fields, ordered as here. Unknown keys are ignored.
     *
     * The form validates only what it shows. Creating a record, it refuses —
     * with an error naming them — when a required field it leaves out has no
     * default value and is not filled by the server or the database.
     */
    fields?: string[];

    /**
     * Your own arrangement of the fields, rendered in place of the generated
     * ones: `<FormField name="…"/>`s in any JSX. Wins over the collection's
     * `formView.Builder`.
     *
     * The form validates only the fields its `<FormField>`s render, and
     * refuses to create a record, as {@link fields} does, when a required
     * field without a default is not among them.
     */
    layout?: React.ReactNode;

    // --- Headless callbacks (replace internal admin hooks) ---

    /**
     * Called on form submit with the values to save; resolves with the record
     * as saved — its row, as the server sends it, and its id.
     * The EntityFormBinding wrapper provides this automatically.
     * When using EntityForm standalone, provide your own save logic.
     */
    onSubmit?: (values: M, formex: FormexController<M>) => Promise<{ row: Record<string, unknown>; id: string | number } | void> | void;

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

    /**
     * Properties a new record takes from its address rather than from the
     * user: the link back to the parent of a record created under
     * `parent/{id}/{relation}`. Shown and disabled while the record is new.
     * The EntityFormBinding wrapper fills these in.
     */
    lockedPropertyKeys?: string[];

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

/**
 * What `onSaved` is called with once a record is stored.
 */
export type OnSavedParams = {
    /**
     * The saved record, as the server sends the row — dates as ISO strings, a
     * belongsTo as its foreign-key column, `id` only where the table has that column.
     */
    row: Record<string, unknown>,
    /** The saved record's id: its primary key as a string, a composite one's parts joined by `:::`. */
    id: string;
    /** What the record was before this save: `"new"` or `"copy"` for a record this save created. */
    status: EntityStatus,
    path: string,
    selectedTab?: string;
    collection: AdminCollection<Record<string, unknown>>
};
