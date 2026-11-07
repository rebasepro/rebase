/**
 * What an app the model wrote imports as `@rebasepro/mcp-apps`: the
 * project's data, as the person, and the admin panel's own views of it.
 *
 * Every call here is a tool call through the host (`tool-driver.ts`), so an
 * app can read and change exactly what its user could with the tools, under
 * the same RLS, and each change it makes is confirmed by them first. What it
 * changes refreshes every hook and view of that collection.
 *
 * Rows are the read tools' rows (dates as ISO text, a belongsTo as its
 * foreign key), the shape the model already reads with query_collection.
 * The API is written in show_app's description (`SHOW_APP_CODE_GUIDE` in the
 * server's `mcp-tools.ts`); the two change together.
 */
import React, { createContext, useContext, useEffect, useMemo, useReducer, useState } from "react";
import type { AdminCollection, SidePanelController } from "@rebasepro/cms-types";
import type { CollectionRegistryController, Entity } from "@rebasepro/types";
import { CollectionPanel } from "../components/CollectionPanel";
import { EntityFormPanel } from "../components/EntityFormPanel";
import { useSidePanel } from "../hooks/useSidePanel";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import type { ToolData } from "./tool_driver";
import { filterOf, orderOf, type ViewMode } from "./payload";

type Row = Record<string, unknown>;

interface AppSdk {
    data: ToolData;
    /** The names the app was opened with, for the message when it reaches for another. */
    allowed: readonly string[];
}

const AppSdkContext = createContext<AppSdk | undefined>(undefined);

/** The SDK's own state for an app: given by the view around the app's component. */
export function AppSdkProvider({ value, children }: { value: AppSdk; children: React.ReactNode }) {
    return (
        <AppSdkContext.Provider value={value}>
            <SidePanelHolder/>
            {children}
        </AppSdkContext.Provider>
    );
}

function useSdk(): AppSdk {
    const sdk = useContext(AppSdkContext);
    if (!sdk) throw new Error("The app's hooks and views work only inside the app the view opened.");
    return sdk;
}

/**
 * The config of a collection the app may draw — the project's own, as its
 * admin registers it, custom views and fields included — or the error that
 * says which it may.
 */
function useCollection(name: string): AdminCollection {
    const { allowed } = useSdk();
    const registry = useCollectionRegistryController();
    const collection = registry.getCollection(name);
    if (!collection) {
        throw new Error(`"${name}" is not one of this app's collections (${allowed.join(", ")}). `
            + "List it in show_app's `collections`.");
    }
    return collection;
}

/** A counter bumped on every change to `collection`, wherever it was made. */
function useChanges(data: ToolData, collection: string): number {
    const [version, bump] = useReducer((current: number) => current + 1, 0);
    useEffect(() => data.watch(collection, bump), [data, collection]);
    return version;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface QueryOptions {
    where?: Record<string, unknown>;
    orderBy?: unknown;
    limit?: number;
    offset?: number;
    searchString?: string;
}

/** A page of rows, read again whenever the arguments change or the collection does. */
export function useQuery(collection: string, options: QueryOptions = {}) {
    const { data } = useSdk();
    const version = useChanges(data, collection);
    const [refreshed, refresh] = useReducer((current: number) => current + 1, 0);
    const key = JSON.stringify(options);
    const [state, setState] = useState<{ data: Row[]; total?: number; hasMore: boolean; loading: boolean; error?: string }>(
        { data: [], hasMore: false, loading: true });

    useEffect(() => {
        let live = true;
        setState(current => ({ ...current, loading: true }));
        const args: QueryOptions = JSON.parse(key);
        data.find(collection, { ...args })
            .then(page => live && setState({ ...page, loading: false }))
            .catch(error => live && setState(current => ({ ...current, loading: false, error: messageOf(error) })));
        return () => {
            live = false;
        };
    }, [data, collection, key, version, refreshed]);

    return { ...state, refresh };
}

/** One row, read again when its collection changes. `data` is undefined for a row that is not there, or not visible. */
export function useRecord(collection: string, id: string | number | undefined) {
    const { data } = useSdk();
    const version = useChanges(data, collection);
    const [refreshed, refresh] = useReducer((current: number) => current + 1, 0);
    const [state, setState] = useState<{ data?: Row; loading: boolean; error?: string }>({ loading: id !== undefined });

    useEffect(() => {
        if (id === undefined || id === "") {
            setState({ loading: false });
            return;
        }
        let live = true;
        setState(current => ({ ...current, loading: true }));
        data.get(collection, id)
            .then(row => live && setState({ data: row, loading: false }))
            .catch(error => live && setState({ loading: false, error: messageOf(error) }));
        return () => {
            live = false;
        };
    }, [data, collection, id, version, refreshed]);

    return { ...state, refresh };
}

/** How many rows match, counted again when the collection changes. */
export function useCount(collection: string, where?: Record<string, unknown>) {
    const { data } = useSdk();
    const version = useChanges(data, collection);
    const key = JSON.stringify(where ?? null);
    const [state, setState] = useState<{ count?: number; loading: boolean; error?: string }>({ loading: true });

    useEffect(() => {
        let live = true;
        setState(current => ({ ...current, loading: true }));
        const filter: Record<string, unknown> | null = JSON.parse(key);
        data.count(collection, filter ?? undefined)
            .then(count => live && setState({ count, loading: false }))
            .catch(error => live && setState({ loading: false, error: messageOf(error) }));
        return () => {
            live = false;
        };
    }, [data, collection, key, version]);

    return state;
}

/**
 * Create, change and delete rows. Each asks the person first, and rejects
 * when they decline (`error` then says so).
 */
export function useMutate() {
    const { data } = useSdk();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    return useMemo(() => {
        const run = async <T,>(change: () => Promise<T>): Promise<T> => {
            setSaving(true);
            setError(undefined);
            try {
                return await change();
            } catch (failure) {
                setError(messageOf(failure));
                throw failure;
            } finally {
                setSaving(false);
            }
        };
        return {
            create: (collection: string, values: Row, id?: string | number) => run(() => data.create(collection, values, id)),
            update: (collection: string, id: string | number, values: Row) => run(() => data.update(collection, id, values)),
            remove: (collection: string, id: string | number) => run(() => data.remove(collection, id)),
            saving,
            error
        };
    }, [data, saving, error]);
}

export interface CollectionViewProps {
    collection: string;
    /** Which rows: a filter the person cannot clear. */
    where?: Record<string, unknown>;
    orderBy?: unknown;
    view?: ViewMode;
    /** In pixels; the view scrolls inside it. */
    height?: number;
    /** A row was opened: given the row, instead of opening its form. */
    onRowClick?: (row: Row) => void;
    /** The row drawn as selected (by its id), where the app keeps one; null for none. */
    highlightedEntityId?: string | number | null;
}

/** The admin panel's collection view: search, filters, sorting, paging, its forms. */
export function CollectionView({ collection, where, orderBy, view, height = 420, onRowClick, highlightedEntityId }: CollectionViewProps) {
    const config = useCollection(collection);
    const { data } = useSdk();
    // The app is handed the row as the read tools serve it. The page the view
    // drew filled the driver's row cache, so this asks the server nothing.
    const onEntityClick = useMemo(() => onRowClick
        ? (entity: Entity) => void data.get(config.slug, entity.id).then(row => row && onRowClick(row))
        : undefined, [onRowClick, data, config.slug]);
    const filterKey = JSON.stringify(where ?? null);
    const overrides = useMemo<Partial<AdminCollection>>(() => {
        const filter = filterOf(JSON.parse(filterKey) ?? undefined);
        return filter ? { fixedFilter: filter } : {};
    }, [filterKey]);
    const sort = orderOf(orderBy);

    return (
        <div className="min-h-0 min-w-0 rounded-xl overflow-hidden" style={{ height }}>
            <CollectionPanel
                key={filterKey}
                path={config.slug}
                title={false}
                className="h-full flex flex-col"
                {...(view && { viewMode: view })}
                {...(sort && { sort })}
                {...(highlightedEntityId !== undefined && { highlightedEntityId })}
                {...(onEntityClick && { onEntityClick })}
                collectionOverrides={overrides}
            />
        </div>
    );
}

export interface RecordFormProps {
    collection: string;
    /** The row. Without it, the form creates one, and becomes its form once saved. */
    id?: string | number;
    /** A new row's starting values. */
    values?: Row;
    onSaved?: (id: string | number) => void;
}

/** The admin panel's record form: its sections, validation and relation pickers. */
export function RecordForm({ collection, id, values, onSaved }: RecordFormProps) {
    const config = useCollection(collection);
    const [created, setCreated] = useState<string | number>();
    const shown = id ?? created;
    return (
        <EntityFormPanel
            key={String(shown ?? "new")}
            collection={config}
            entityId={shown}
            {...(shown === undefined && values && { defaultValues: values })}
            onSaved={params => {
                if (params.entityId === undefined) return;
                if (shown === undefined) setCreated(params.entityId);
                onSaved?.(params.entityId);
            }}
        />
    );
}

/**
 * The side panel the admin panel opens forms in, for `openRecord` — a plain
 * function an app calls from a button, where no hook reaches.
 */
let current: { panel: SidePanelController; sdk: AppSdk; registry: CollectionRegistryController } | undefined;

function SidePanelHolder() {
    const panel = useSidePanel();
    const sdk = useSdk();
    const registry = useCollectionRegistryController();
    useEffect(() => {
        current = { panel, sdk, registry };
        return () => {
            if (current?.panel === panel) current = undefined;
        };
    }, [panel, sdk, registry]);
    return null;
}

function openForm(collection: string, entityId: string | number | undefined, values?: Row): void {
    if (!current) throw new Error("openRecord works only inside the app the view opened.");
    const config = current.registry.getCollection(collection);
    if (!config) {
        throw new Error(`"${collection}" is not one of this app's collections (${current.sdk.allowed.join(", ")}).`);
    }
    current.panel.open({
        path: config.slug,
        collection: config,
        ...(entityId !== undefined && { entityId }),
        ...(values && { defaultValues: values })
    });
}

/** Open a row's form over the app. */
export function openRecord(collection: string, id: string | number): void {
    openForm(collection, id);
}

/** Open a new row's form over the app, starting from `values`. */
export function openNewRecord(collection: string, values?: Row): void {
    openForm(collection, undefined, values);
}

/** The module an app imports as `@rebasepro/mcp-apps`. */
export const SDK_MODULE = {
    useQuery,
    useRecord,
    useCount,
    useMutate,
    CollectionView,
    RecordForm,
    openRecord,
    openNewRecord
};
