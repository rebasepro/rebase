/**
 * Complete, typed stand-ins for the controllers and sources the admin takes.
 *
 * A test usually cares about one or two fields of an `AuthController` or a
 * `StorageSource`; these return the whole object, with inert defaults for the
 * rest, so a test states only what it is about and the fixture still has the
 * shape the code receives.
 */
import { jest } from "@jest/globals";
import { createCallContext } from "@rebasepro/common";
import { wrapAsEntityData } from "@rebasepro/cms-types";
import type {
    RebaseSdkData,
    StorageSource,
    User
} from "@rebasepro/types";
import type {
    AdminCollection,
    AdminPostgresCollection,
    AuthController,
    CustomizationController,
    DialogsController,
    EntitySelectionController,
    EntityTableController,
    SelectionController,
    SidePanelBindingProps,
    SidePanelController,
    TableController,
    UserConfigurationPersistence,
    FormContext,
    FormexController,
    NavigationStateController,
    RebaseContext,
    UrlController,
    CollectionRegistryController,
    CollectionConfig,
    Property,
    ResolvedBelongsTo,
    ResolvedManyToMany,
    Entity,
    RebaseData
} from "@rebasepro/cms-types";
// The field bindings' own props (with `hideLabel` and the other form-only
// flags), which `@rebasepro/cms-types`' plugin-facing `FieldProps` leaves out.
import type { FieldProps } from "../../src/types/fields";
import type { CollectionsConfigController } from "../../src/collection_editor/types/config_controller";

/** A resolved Postgres collection, named after its slug, with no properties unless given. */
export function fakeCollection(slug: string, rest: Partial<AdminPostgresCollection> = {}): AdminPostgresCollection {
    return { slug, name: slug, properties: {}, ...rest };
}

/** A `belongsTo` as the normalizer resolves it: `<name>_id` on this table, pointing at `target`. */
export function resolvedBelongsTo(relationName: string, target: CollectionConfig): ResolvedBelongsTo {
    return {
        kind: "belongsTo",
        relationName,
        target: () => target,
        targetSlug: target.slug,
        cardinality: "one",
        writable: true,
        shared: false,
        localKey: `${relationName}_id`,
        index: true
    };
}

/** A `manyToMany` as the normalizer resolves it, through `<source>_<target>`. */
export function resolvedManyToMany(relationName: string, source: string, target: CollectionConfig): ResolvedManyToMany {
    return {
        kind: "manyToMany",
        relationName,
        target: () => target,
        targetSlug: target.slug,
        cardinality: "many",
        writable: true,
        shared: true,
        through: { table: `${source}_${target.slug}`, sourceColumn: `${source}_id`, targetColumn: `${target.slug}_id`, properties: {} }
    };
}

/** A signed-in user; `uid` is all most tests need. */
export function fakeUser(uid = "user-1", rest: Partial<User> = {}): User {
    return {
        uid,
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "test",
        isAnonymous: false,
        ...rest
    };
}

/** An auth controller that has finished loading, with `user` signed in (or `null`). */
export function fakeAuthController(rest: Partial<AuthController> = {}): AuthController {
    return {
        user: fakeUser(),
        authLoading: false,
        initialLoading: false,
        loginSkipped: false,
        extra: undefined,
        setExtra: () => undefined,
        signOut: async () => undefined,
        getAuthToken: async () => "test-token",
        ...rest
    };
}

/** A storage source that stores nothing; override the methods a test exercises. */
export function fakeStorageSource(rest: Partial<StorageSource> = {}): StorageSource {
    return {
        putObject: jest.fn<StorageSource["putObject"]>(async ({ key, bucket }) => {
            const stored = bucket ?? "default";
            return { key, bucket: stored, storageUrl: `s3://${stored}/${key}` };
        }),
        getSignedUrl: jest.fn<StorageSource["getSignedUrl"]>(async () => ({ url: null })),
        getObject: jest.fn<StorageSource["getObject"]>(async () => null),
        deleteObject: jest.fn<StorageSource["deleteObject"]>(async () => undefined),
        listObjects: jest.fn<StorageSource["listObjects"]>(async () => ({ prefixes: [], items: [] })),
        ...rest
    };
}

/** No plugins, no custom property configs, no extra actions or views. */
export function fakeCustomization(rest: Partial<CustomizationController> = {}): CustomizationController {
    return {
        plugins: [],
        propertyConfigs: {},
        entityActions: [],
        entityViews: [],
        resolvedSlots: [],
        ...rest
    };
}

/** A pristine form controller over `values`. */
export function fakeFormex<T>(values: T, rest: Partial<FormexController<T>> = {}): FormexController<T> {
    return {
        values,
        initialValues: values,
        setValues: () => undefined,
        setFieldValue: () => undefined,
        touched: {},
        setFieldTouched: () => undefined,
        setTouched: () => undefined,
        dirty: false,
        setDirty: () => undefined,
        setSubmitCount: () => undefined,
        errors: {},
        setFieldError: () => undefined,
        handleChange: () => undefined,
        handleBlur: () => undefined,
        handleSubmit: () => undefined,
        validate: () => undefined,
        resetForm: () => undefined,
        submitCount: 0,
        isSubmitting: false,
        setSubmitting: () => undefined,
        isValidating: false,
        version: 0,
        undo: () => undefined,
        redo: () => undefined,
        canUndo: false,
        canRedo: false,
        ...rest
    };
}

/** A registry over `collections`, found by slug; paths resolve to themselves. */
export function fakeCollectionRegistry<EC extends CollectionConfig = AdminCollection>(
    collections: EC[] = [],
    rest: Partial<CollectionRegistryController<Record<string, unknown>, EC>> = {}
): CollectionRegistryController<Record<string, unknown>, EC> {
    const bySlug = (slug: string) => collections.find((c) => c.slug === slug);
    return {
        collections,
        initialised: true,
        getCollection: (slugOrPath: string) => bySlug(slugOrPath),
        getRawCollection: bySlug,
        resolveDataPath: (path) => path,
        resolveCollectionPath: (path) => path,
        getParentReferencesFromPath: () => [],
        getParentCollectionSlugs: () => [],
        getParentEntityIds: () => [],
        convertIdsToPaths: (ids) => ids,
        ...rest
    };
}

/** URLs under `/` with collections at `/c/<path>`; `navigate` does nothing. */
export function fakeUrlController(rest: Partial<UrlController> = {}): UrlController {
    return {
        basePath: "/",
        baseCollectionPath: "/c",
        urlPathToDataPath: () => "",
        homeUrl: "/",
        isUrlCollectionPath: () => true,
        buildUrlCollectionPath: (path) => `/c/${path}`,
        buildAppUrlPath: (path) => path,
        resolveDatabasePathsFrom: (path) => path,
        navigate: () => undefined,
        ...rest
    };
}

/**
 * The admin's full context. `client`, `data` and `storageSource` are
 * `createCallContext`'s stand-ins, which throw a clear error when used, so a
 * test supplies only what the code under test should reach.
 */
export function fakeRebaseContext(rest: Partial<RebaseContext> = {}): RebaseContext {
    const call = createCallContext();
    return {
        ...call,
        client: { ...call.client, data: call.data },
        authController: fakeAuthController(),
        ...rest
    };
}

/** A form context over `values`, as a field rendered inside a record's form receives it. */
export function fakeFormContext<M extends Record<string, unknown>>(
    values: M,
    rest: Partial<FormContext<M>> = {}
): FormContext<M> {
    return {
        values,
        setFieldValue: () => undefined,
        save: () => undefined,
        submit: () => undefined,
        status: "existing",
        formex: fakeFormex(values),
        disabled: false,
        ...rest
    };
}

/** The props a field binding is rendered with, for `property` under the key `"field"`. */
export function fakeFieldProps<P extends Property, C = unknown>(
    property: P,
    rest: Partial<FieldProps<P, C>> = {}
): FieldProps<P, C> {
    return {
        propertyKey: "field",
        value: null,
        setValue: () => undefined,
        setFieldValue: () => undefined,
        property,
        context: fakeFormContext({}),
        ...rest
    };
}

/** A selection controller over a fixed list of selected rows; its setters do nothing. */
export function fakeSelectionController<M extends Record<string, unknown> = Record<string, unknown>>(
    entities: Entity<M>[] = [],
    rest: Partial<EntitySelectionController<M>> = {}
): EntitySelectionController<M> {
    return {
        selection: { type: "entities", entities },
        setSelection: () => undefined,
        selectedCount: entities.length,
        hasSelection: entities.length > 0,
        setSelectedEntities: () => undefined,
        selectAllMatching: () => undefined,
        clearSelection: () => undefined,
        isEntitySelected: (entity) => entities.some((e) => e.id === entity.id),
        toggleEntitySelection: () => undefined,
        ...rest
    };
}

/** A table controller that has loaded `data`, all of it. */
export function fakeTableController<M extends Record<string, unknown> = Record<string, unknown>>(
    data: Entity<M>[] = [],
    rest: Partial<EntityTableController<M>> = {}
): EntityTableController<M> {
    return { data, dataLoading: false, noMoreToLoad: true, ...rest };
}

/** A row selection controller with `rows` ticked (by their `id`); its setters do nothing. */
export function fakeRowSelectionController<M extends Record<string, unknown> = Record<string, unknown>>(
    rows: Record<string, unknown>[] = [],
    rest: Partial<SelectionController<M>> = {}
): SelectionController<M> {
    const ids = rows.map((row) => String(row.id));
    return {
        selection: { type: "rows", ids, rows },
        selectedCount: rows.length,
        hasSelection: rows.length > 0,
        isSelected: (id) => ids.includes(String(id)),
        toggleSelection: () => undefined,
        setSelectedRows: () => undefined,
        selectAllMatching: () => undefined,
        clearSelection: () => undefined,
        ...rest
    };
}

/** A row table controller that has loaded `rows`, all of them, keyed by their `id`. */
export function fakeRowTableController<M extends Record<string, unknown> = Record<string, unknown>>(
    rows: Record<string, unknown>[] = [],
    rest: Partial<TableController<M>> = {}
): TableController<M> {
    return { rows, ids: rows.map((row) => String(row.id)), loading: false, noMoreToLoad: true, ...rest };
}

/** A collection editor's config controller over `collections`, loaded; every write resolves and does nothing. */
export function fakeCollectionsConfigController(
    collections: AdminCollection[] = [],
    rest: Partial<CollectionsConfigController> = {}
): CollectionsConfigController {
    return {
        loading: false,
        collections,
        getCollection: (id) => {
            const found = collections.find((c) => c.slug === id);
            if (!found) throw new Error(`No collection "${id}" in this fake`);
            return found;
        },
        saveCollection: async () => undefined,
        updateCollection: async () => undefined,
        saveProperty: async () => undefined,
        deleteProperty: async () => undefined,
        deleteCollection: async () => undefined,
        updatePropertiesOrder: async () => undefined,
        updateKanbanColumnsOrder: async () => undefined,
        navigationEntries: [],
        saveNavigationEntries: async () => undefined,
        ...rest
    };
}

/** Per-user collection overrides, kept nowhere: nothing recently visited, nothing favourite. */
export function fakeUserConfigPersistence(rest: Partial<UserConfigurationPersistence> = {}): UserConfigurationPersistence {
    return {
        saveTablePreferences: () => undefined,
        getTablePreferences: () => ({}),
        recentlyVisitedPaths: [],
        setRecentlyVisitedPaths: () => undefined,
        favouritePaths: [],
        setFavouritePaths: () => undefined,
        collapsedGroups: [],
        setCollapsedGroups: () => undefined,
        ...rest
    };
}

/** Navigation that has finished loading, with nothing in it unless given. */
export function fakeNavigationState(rest: Partial<NavigationStateController> = {}): NavigationStateController {
    return { loading: false, refreshNavigation: () => undefined, ...rest };
}

/** A side panel controller whose `open` records the panels opened. */
export function fakeSidePanelController() {
    const open = jest.fn<(props: SidePanelBindingProps) => void>();
    const panels: SidePanelController = {
        open: (props) => open(props),
        replace: (props) => open(props),
        close: () => undefined
    };
    return { panels, open };
}

/** A data plane whose every read and write throws: for code that is handed one but must not use it. */
export function fakeSdkData(): RebaseSdkData {
    return createCallContext().data;
}

/** The entity-shaped data client, over the same refusing data plane: for code that is handed one but must not use it. */
export function fakeRebaseData(): RebaseData {
    return wrapAsEntityData(fakeSdkData());
}

/** A dialogs controller whose `open` is a mock that returns a closable handle. */
export function fakeDialogsController() {
    // `open` is generic over the dialog's props, which a mock cannot be; this
    // one records the entry each call opened.
    const open = jest.fn<(entry: { key: string }) => { closeDialog: () => void }>(() => ({ closeDialog: () => undefined }));
    const dialogs: DialogsController = { open: (entry) => open(entry), close: () => undefined };
    return { dialogs, open };
}
