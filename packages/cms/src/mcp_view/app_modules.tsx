/**
 * What an app the model wrote imports (show_app): the modules of
 * `MCP_APP_MODULES`, each the package's own exports — `@rebasepro/cms`'s
 * blocks, `@rebasepro/app`'s row hooks, the UI kit, React — so the code reads
 * as Rebase code does anywhere, and the parts are the ones the admin panel is
 * made of.
 *
 * One thing differs from the packages: an app was opened with a list of
 * tables (show_app's `tables`), and every export that names one
 * holds the app to it, with an error that says which it may use. The rows an
 * app reads and writes go through the tool driver, as the person, under their
 * RLS and their connection's scopes: that is what bounds an app, which can do
 * nothing the model could not with the same tools. `useRowWrites` asks them
 * before each write (`confirmingDriver` in `tool_driver.ts`), a courtesy
 * against an app writing without a click; the admin's own controls in it — a
 * form's Save, a delete — behave as on a show_table screen. A form whose
 * overrides make it save itself is not handed to an app: it would write on
 * mount, unasked.
 */
import React, { createContext, useCallback, useContext, useMemo } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as UI from "@rebasepro/ui";
import { useAggregate, useRow, useRowCount, useRows, useRowWrites, type UseRowWritesResult } from "@rebasepro/app";
import type { SidePanelBindingProps, SidePanelController } from "@rebasepro/cms-types";
import {
    getCollectionDataPath,
    type McpAppModule,
    type McpAppModuleExport
} from "@rebasepro/types";
import { CollectionPanel, type CollectionPanelProps } from "../components/CollectionPanel";
import { RecordForm, type RecordFormProps } from "../components/RecordForm";
import { RecordDetail, type RecordDetailProps } from "../components/RecordDetail";
import { FieldValue, type FieldValueProps } from "../components/FieldValue";
import {
    CollectionFiltersButton,
    CollectionSearchBar,
    CollectionToolbar,
    CollectionViewModeToggle
} from "../components/CollectionViewBinding/CollectionToolbar";
import { CollectionAddButton } from "../components/CollectionViewBinding/CollectionAddButton";
import { FormField } from "../form/FormField";
import { useSidePanel } from "../hooks/useSidePanel";
import { collectionPropOf } from "../components/collection_prop";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";

/** The collections the app was opened with, by the names the model gave. */
const AppCollectionsContext = createContext<readonly string[] | undefined>(undefined);

/** Around an app's component: the collections its imports may name. */
export function AppCollections({ names, children }: { names: readonly string[]; children: React.ReactNode }) {
    return <AppCollectionsContext.Provider value={names}>{children}</AppCollectionsContext.Provider>;
}

/**
 * Throws, for a collection the app was not opened with. A name counts by
 * what the model listed, or by the collection it names — its slug or the
 * name the tools take — so `orders` and the table it lives in are one.
 */
function useCollectionCheck(): (name: string | undefined) => void {
    const allowed = useContext(AppCollectionsContext);
    const registry = useCollectionRegistryController();
    return useCallback((name: string | undefined) => {
        if (allowed === undefined || name === undefined || allowed.includes(name)) return;
        const collection = registry.getCollection(name);
        if (collection && (allowed.includes(collection.slug)
            || allowed.includes(getCollectionDataPath(collection)))) return;
        throw new Error(`"${name}" is not one of this app's tables (${allowed.join(", ")}). `
            + "List it in show_app's `tables`.");
    }, [allowed, registry]);
}

function AppCollectionPanel(props: CollectionPanelProps) {
    useCollectionCheck()(collectionPropOf(props.collection, props.path).path);
    return <CollectionPanel {...props}/>;
}

function AppRecordForm({ collectionOverrides, ...props }: RecordFormProps) {
    useCollectionCheck()(collectionPropOf(props.collection, props.path).path);
    // A form that saves itself writes the values it was seeded with on mount,
    // with nobody's click: off, whether the override or the collection asked
    // for it. The overrides merge over the collection the form opens.
    return <RecordForm {...props} collectionOverrides={{ ...collectionOverrides, formAutoSave: false }}/>;
}

function AppRecordDetail(props: RecordDetailProps) {
    useCollectionCheck()(collectionPropOf(props.collection, props.path).path);
    return <RecordDetail {...props}/>;
}

function AppFieldValue(props: FieldValueProps) {
    useCollectionCheck()(props.collection);
    return <FieldValue {...props}/>;
}

function useAppSidePanel(): SidePanelController {
    const check = useCollectionCheck();
    const panel = useSidePanel();
    return useMemo(() => {
        const checked = <M extends Record<string, unknown>>(props: SidePanelBindingProps<M>) => {
            check(props.path);
            return props;
        };
        return {
            close: () => panel.close(),
            open: props => panel.open(checked(props)),
            replace: props => panel.replace(checked(props))
        };
    }, [panel, check]);
}

/** The row hooks, each held to the app's collections. */
const useAppRows: typeof useRows = (collection, options) => {
    useCollectionCheck()(collection);
    return useRows(collection, options);
};

const useAppRow: typeof useRow = (collection, id) => {
    useCollectionCheck()(collection);
    return useRow(collection, id);
};

const useAppRowCount: typeof useRowCount = (collection, where) => {
    useCollectionCheck()(collection);
    return useRowCount(collection, where);
};

const useAppAggregate: typeof useAggregate = (collection, params) => {
    useCollectionCheck()(collection);
    return useAggregate(collection, params);
};

/** Writes are checked when they are made: a refused one rejects, as a failed write does. */
function useAppRowWrites(): UseRowWritesResult {
    const check = useCollectionCheck();
    const writes = useRowWrites();
    return useMemo(() => {
        const checked = <T, >(collection: string, write: () => Promise<T>): Promise<T> => {
            try {
                check(collection);
            } catch (error) {
                return Promise.reject(error);
            }
            return write();
        };
        return {
            ...writes,
            create: (collection, values, id) => checked(collection, () => writes.create(collection, values, id)),
            update: (collection, id, values) => checked(collection, () => writes.update(collection, id, values)),
            remove: (collection, id) => checked(collection, () => writes.remove(collection, id))
        };
    }, [writes, check]);
}

/** A module's served exports: exactly its names in `MCP_APP_MODULES`, no more, no fewer. */
type Served<M extends McpAppModule> = Record<McpAppModuleExport<M>, unknown>;

const APP_MODULE: Served<"@rebasepro/app"> = {
    useRows: useAppRows,
    useRow: useAppRow,
    useRowCount: useAppRowCount,
    useAggregate: useAppAggregate,
    useRowWrites: useAppRowWrites
};

const CMS_MODULE: Served<"@rebasepro/cms"> = {
    CollectionPanel: AppCollectionPanel,
    CollectionToolbar,
    CollectionSearchBar,
    CollectionFiltersButton,
    CollectionViewModeToggle,
    CollectionAddButton,
    RecordForm: AppRecordForm,
    RecordDetail: AppRecordDetail,
    FormField,
    FieldValue: AppFieldValue,
    useSidePanel: useAppSidePanel
};

/** Every module an app may import, by name. */
export const APP_MODULE_EXPORTS: Record<McpAppModule, object> = {
    "react": React,
    "react/jsx-runtime": jsxRuntime,
    "@rebasepro/ui": UI,
    "@rebasepro/app": APP_MODULE,
    "@rebasepro/cms": CMS_MODULE
};
