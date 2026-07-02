"use client";
import type { RebaseProps } from "./RebaseProps";
import type { CustomizationController, RebasePlugin, SlotContribution } from "@rebasepro/types";
import type { ComponentOverrideMap } from "@rebasepro/types";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CenteredView, Typography } from "@rebasepro/ui";
import { RebaseContext, User, CollectionRegistryController, DataDriver, DataSourceDefinition, RebaseData, DEFAULT_DATA_SOURCE_KEY, StorageSource, StorageSourceDefinition, DEFAULT_STORAGE_SOURCE_KEY } from "@rebasepro/types";
import { PluginProviderStack } from "./PluginProviderStack";
import { PluginLifecycleManager } from "./PluginLifecycleManager";
import { AuthControllerContext } from "../contexts";
import { useCustomizationController, useRebaseContext, useAuthSubscription } from "../hooks";
import { ApiConfigProvider, useApiConfig } from "../hooks/ApiConfigContext";
import { ErrorView } from "../components";
import { StorageSourceContext } from "../contexts/StorageSourceContext";
import { UserConfigurationPersistenceContext } from "../contexts/UserConfigurationPersistenceContext";
import { RebaseDataContext } from "../contexts/RebaseDataContext";
import { DataSourcesContext, DataSourcesContextValue } from "../contexts/DataSourcesContext";
import { StorageSourcesContext, StorageSourcesContextValue } from "../contexts/StorageSourcesContext";
import { DatabaseAdminContext } from "../contexts/DatabaseAdminContext";
import { ModeControllerProvider, AdminModeControllerProvider, SnackbarProvider } from "../contexts";
import { RebaseI18nProvider } from "../i18n/RebaseI18nProvider";
import { RebaseRegistryProvider } from "../hooks/useRebaseRegistry";
import { SchemaDriftProvider } from "../components/SchemaDriftBanner";
import { GlobalComponentOverrideProvider } from "../contexts/ComponentOverrideContext";
import { useBuildModeController } from "../hooks/useBuildModeController";
import { useBuildAdminModeController } from "../hooks/useBuildAdminModeController";
import { RebaseClientInstanceContext } from "../contexts/RebaseClientInstanceContext";
import { DialogsProvider } from "../contexts/DialogsProvider";
import { buildRebaseData, CollectionRegistry } from "@rebasepro/common";
import { CustomizationControllerContext } from "../contexts/CustomizationControllerContext";
import { AnalyticsContext } from "../contexts/AnalyticsContext";

import { EffectiveRoleControllerContext } from "../contexts/EffectiveRoleController";
import { useBuildEffectiveRoleController } from "../hooks/useBuildEffectiveRoleController";

/**
 * If you are using independent components of the CMS
 * you need to wrap them with this main component, so the internal hooks work.
 *
 * This is the main component of Rebase. It acts as the provider of all the
 * internal contexts and hooks.
 *
 * You only need to use this component if you are building a custom app.
 *
 * @group Core
 */
export function Rebase<USER extends User>(props: RebaseProps<USER>) {

    const {
        children,
        entityLinkBuilder,
        userConfigPersistence,
        dateTimeFormat,
        locale,
        client,
        authController: authControllerProp,
        storageSource: storageSourceProp,
        driver: driverProp,
        dataSources: dataSourcesProp,
        storageSources: storageSourcesProp,

        data: dataProp,
        databaseAdmin,
        plugins: pluginsProp,
        slots: directSlots = [],
        onAnalyticsEvent,
        propertyConfigs,
        entityViews,
        entityActions,

        effectiveRoleController,
        apiUrl,
        translations,
        components: componentsProp
    } = props;

    const plugins = pluginsProp;

    // ── Dev-mode prop conflict warnings (fire once per mount) ────────
    const warnedRef = useRef(false);
    if (!warnedRef.current) {
        if (dataProp && driverProp) {
            console.warn(
                "[Rebase] Both `data` and `driver` props are set. " +
                "The `driver` prop is ignored because `data` takes precedence."
            );
        }
        warnedRef.current = true;
    }

    // Validate plugin key uniqueness
    if (plugins) {
        const keys = plugins.map((p) => p.key);
        if (new Set(keys).size !== keys.length) {
            console.error("Duplicate plugin keys detected:", keys.filter((k, i) => keys.indexOf(k) !== i));
        }
    }

    // Merge direct slots with plugin slots
    const resolvedSlots: SlotContribution[] = useMemo(() => [
        ...directSlots,
        ...((plugins ?? []).flatMap((p) => p.slots ?? []))
    ], [directSlots, plugins]);


    // Auth fallback logic
    const clientAuthController = useAuthSubscription(authControllerProp ? undefined : client?.auth);
    const authController = authControllerProp ?? clientAuthController;

    const normalizedDataSources = useMemo(() => {
        return dataSourcesProp ?? [];
    }, [dataSourcesProp]);

    // Build the data-source context: the declared registry plus a RebaseData
    // per direct/custom source (those carrying a client-side driver). Server-
    // mediated sources have no entry — they ride the default client.
    //
    // Shallow-compared against the previous build (keys + driver instances) so
    // inline `dataSources` literals don't rebuild RebaseData instances every
    // render and thrash data-fetch effects that key off the data identity.
    const dataSourcesRef = useRef<{
        sig: { key: string; driver?: DataDriver }[];
        value: DataSourcesContextValue;
    } | null>(null);
    const dataSourcesValue = useMemo<DataSourcesContextValue>(() => {
        const sig = normalizedDataSources.map((d) => ({ key: d.key, driver: d.driver }));
        const prev = dataSourcesRef.current;
        if (prev
            && prev.sig.length === sig.length
            && sig.every((s, i) => prev.sig[i].key === s.key && prev.sig[i].driver === s.driver)) {
            return prev.value;
        }
        const registry: Record<string, DataSourceDefinition> = {};
        const sources: Record<string, RebaseData> = {};
        for (const ds of normalizedDataSources) {
            const { driver, ...definition } = ds;
            registry[ds.key] = definition;
            if (driver) sources[ds.key] = buildRebaseData(driver);
        }
        const value: DataSourcesContextValue = { registry, sources };
        dataSourcesRef.current = { sig, value };
        return value;
    }, [normalizedDataSources]);

    // Data fallback logic. The resolved value is the *default* data source,
    // serving every collection not routed to a registered direct/custom source.
    const resolvedData = useMemo(() => {
        if (dataProp) return dataProp;
        if (driverProp) return buildRebaseData(driverProp);
        if (client?.data) return client.data;
        // No explicit default — fall back to a registered default-keyed source
        // (e.g. a single direct driver registered as "(default)").
        const defaultSource = dataSourcesValue.sources[DEFAULT_DATA_SOURCE_KEY]
            ?? Object.values(dataSourcesValue.sources)[0];
        if (defaultSource) return defaultSource;
        throw new Error("Rebase requires either `client`, `data`, `driver`, or `dataSources` to be provided");
    }, [dataProp, driverProp, client, dataSourcesValue]);

    // Storage fallback logic
    const resolvedStorage = storageSourceProp ?? client?.storage;

    // ── Storage sources (mirrors the dataSources pattern) ────────────
    // Storage-source definitions discovered from the backend via
    // `GET /api/storage/sources`. The backend is the single source of truth;
    // server-transport sources are auto-wired on the client, `direct` sources
    // are completed by the `storageSources` prop (which holds live instances).
    const [remoteStorageSources, setRemoteStorageSources] = useState<StorageSourceDefinition[]>([]);
    const authUser = authController.user;
    const loginSkipped = authController.loginSkipped;
    useEffect(() => {
        if (!client?.fetchStorageSources) return;
        let cancelled = false;
        client.fetchStorageSources()
            .then((defs) => { if (!cancelled) setRemoteStorageSources(defs); })
            .catch((e) => {
                // A 401 before auth is expected; the effect re-runs once the
                // user logs in (authUser/loginSkipped change) and retries.
                console.debug("[Rebase] Could not load storage sources", e);
            });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, authUser, loginSkipped]);

    // Normalize the prop + discovered definitions into a registry + sources map.
    const storageSourcesRef = useRef<{
        propList: { key: string; source?: StorageSource; transport?: string }[];
        remote: StorageSourceDefinition[];
        resolvedStorage?: StorageSource;
        client?: typeof client;
        value: StorageSourcesContextValue;
    } | null>(null);
    const storageSourcesValue = useMemo<StorageSourcesContextValue>(() => {
        const list = storageSourcesProp ?? [];
        const prev = storageSourcesRef.current;
        // Stable identity unless an input actually changed (the prop may be a
        // fresh array literal on every render; sources are compared by identity).
        if (prev
            && prev.remote === remoteStorageSources
            && prev.resolvedStorage === resolvedStorage
            && prev.client === client
            && prev.propList.length === list.length
            && list.every((s, i) => prev.propList[i].key === s.key
                && prev.propList[i].source === s.source
                && prev.propList[i].transport === s.transport)) {
            return prev.value;
        }
        const registry: Record<string, StorageSourceDefinition> = {};
        const sources: Record<string, StorageSource> = {};

        // 1. Definitions discovered from the backend (labels, engine, transport).
        for (const def of remoteStorageSources) {
            registry[def.key] = def;
        }

        // 2. Server-backed named sources wired on the client registry: the
        //    default, `createRebaseClient({ storageSources })`, and any
        //    server-transport sources auto-registered by `fetchStorageSources`.
        if (client?.storageRegistry) {
            for (const key of client.storageRegistry.list()) {
                const source = client.storageRegistry.get(key);
                if (source) sources[key] = source;
            }
        }

        // 3. App-provided definitions: `direct` live sources and overrides.
        for (const ss of list) {
            const { source, ...definition } = ss;
            registry[ss.key] = definition;
            if (source) {
                // `direct` transport: app-provided live source (e.g. Firebase).
                sources[ss.key] = source;
            } else if (!sources[ss.key]
                && ss.transport === "server"
                && ss.key !== DEFAULT_STORAGE_SOURCE_KEY
                && client?.createStorageSource) {
                // `server` transport declared only on the prop: build a
                // backend-routed source so requests carry `?storageId=key`.
                sources[ss.key] = client.createStorageSource(ss.key);
            }
        }
        // 4. Default/server storage from the client.
        if (resolvedStorage && !sources[DEFAULT_STORAGE_SOURCE_KEY]) {
            sources[DEFAULT_STORAGE_SOURCE_KEY] = resolvedStorage;
        }
        const value: StorageSourcesContextValue = { registry, sources };
        storageSourcesRef.current = {
            propList: list.map((s) => ({ key: s.key, source: s.source, transport: s.transport })),
            remote: remoteStorageSources,
            resolvedStorage,
            client,
            value
        };
        return value;
    }, [storageSourcesProp, remoteStorageSources, resolvedStorage, client]);

    // Database admin — use explicit prop, or derive from client.ws / driver when available.
    const resolvedDatabaseAdmin = useMemo(() => {
        if (databaseAdmin) return databaseAdmin;

        // 1. DataDriver exposes `.admin` capability object
        if (driverProp?.admin) {
            return driverProp.admin;
        }

        // 2. Auto-derive from the client's WebSocket connection (Rebase backend)
        const ws = client?.ws;
        if (ws && typeof (ws as unknown as Record<string, unknown>).executeSql === "function") {
            const wsAdmin = ws as unknown as import("@rebasepro/types").DatabaseAdmin;
            return {
                executeSql: wsAdmin.executeSql!.bind(wsAdmin),
                fetchAvailableDatabases: wsAdmin.fetchAvailableDatabases?.bind(wsAdmin),
                fetchAvailableRoles: wsAdmin.fetchAvailableRoles?.bind(wsAdmin),
                fetchCurrentDatabase: wsAdmin.fetchCurrentDatabase?.bind(wsAdmin),
                fetchUnmappedTables: wsAdmin.fetchUnmappedTables?.bind(wsAdmin),
                fetchTableMetadata: wsAdmin.fetchTableMetadata?.bind(wsAdmin),
                // Branch admin capabilities
                ...(typeof wsAdmin.createBranch === "function" ? {
                    createBranch: wsAdmin.createBranch.bind(wsAdmin),
                    deleteBranch: wsAdmin.deleteBranch!.bind(wsAdmin),
                    listBranches: wsAdmin.listBranches!.bind(wsAdmin)
                } : {})
            };
        }

        return undefined;
    }, [databaseAdmin, client, driverProp]);

    if (!resolvedStorage && typeof console !== "undefined") {
        console.warn(
            "[Rebase] No storageSource provided. File upload features will not work. " +
            "Provide storageSource via props or through a RebaseClient."
        );
    }

    const pluginsLoading = plugins?.some((p) => p.loading) ?? false;

    const loading = authController.initialLoading || pluginsLoading;

    const customizationController: CustomizationController = useMemo(() => ({
        dateTimeFormat,
        locale,
        entityLinkBuilder,
        plugins,
        resolvedSlots,
        entityViews: entityViews ?? [],
        entityActions: entityActions ?? [],
        propertyConfigs: propertyConfigs ?? {},
        components: componentsProp
    }), [dateTimeFormat, locale, entityLinkBuilder, plugins, resolvedSlots, entityViews, entityActions, propertyConfigs, componentsProp]);

    const analyticsController = useMemo(() => ({
        onAnalyticsEvent
    }), []);

    const fallbackEffectiveRoleController = useBuildEffectiveRoleController();
    const activeEffectiveRoleController = effectiveRoleController ?? fallbackEffectiveRoleController;

    const modeController = useBuildModeController();
    const adminModeController = useBuildAdminModeController();

    if (authController.authError) {
        return (
            <CenteredView maxWidth={"md"}>
                <ErrorView
                    title={"Error loading auth"}
                    error={authController.authError as Error | string}/>
            </CenteredView>
        );
    }

    const content = (
        <RebaseI18nProvider locale={locale} translations={translations}>
        <GlobalComponentOverrideProvider overrides={componentsProp}>
        <SnackbarProvider>
        <ModeControllerProvider value={modeController}>
        <AdminModeControllerProvider value={adminModeController}>
        <RebaseClientInstanceContext.Provider value={client}>
        <AnalyticsContext.Provider value={analyticsController}>
            <CustomizationControllerContext.Provider value={customizationController}>
                <UserConfigurationPersistenceContext.Provider
                    value={userConfigPersistence}>
                    <StorageSourcesContext.Provider
                        value={storageSourcesValue}>
                    <StorageSourceContext.Provider
                        value={resolvedStorage!}>
                        <DataSourcesContext.Provider
                            value={dataSourcesValue}>
                        <RebaseDataContext.Provider
                            value={resolvedData}>
                            <DatabaseAdminContext.Provider
                                value={resolvedDatabaseAdmin}>
                                <AuthControllerContext.Provider
                                    value={authController}>
                                        <EffectiveRoleControllerContext.Provider value={activeEffectiveRoleController}>
                                            <DialogsProvider>
                                                <SchemaDriftProvider>
                                                <RebaseRegistryProvider>
                                                    <RebaseInternal
                                                        loading={loading}>
                                                        {children}
                                                    </RebaseInternal>
                                                </RebaseRegistryProvider>
                                                </SchemaDriftProvider>
                                            </DialogsProvider>
                                        </EffectiveRoleControllerContext.Provider>
                                </AuthControllerContext.Provider>
                            </DatabaseAdminContext.Provider>
                        </RebaseDataContext.Provider>
                        </DataSourcesContext.Provider>
                    </StorageSourceContext.Provider>
                    </StorageSourcesContext.Provider>
                </UserConfigurationPersistenceContext.Provider>
            </CustomizationControllerContext.Provider>
        </AnalyticsContext.Provider>
        </RebaseClientInstanceContext.Provider>
        </AdminModeControllerProvider>
        </ModeControllerProvider>
        </SnackbarProvider>
        </GlobalComponentOverrideProvider>
        </RebaseI18nProvider>
    );

    const resolvedApiUrl = apiUrl || client?.baseUrl || (typeof window !== "undefined" ? window.location.origin : "");

    if (resolvedApiUrl) {
        return (
            <ApiConfigProvider apiUrl={resolvedApiUrl} getAuthToken={authController.getAuthToken}>
                {content}
            </ApiConfigProvider>
        );
    }

    return content;

}

function RebaseInternal({
    loading,
    children
}: {
    loading: boolean;
    children: React.ReactNode | ((props: { context: RebaseContext; loading: boolean; }) => React.ReactNode);
}) {

    const context = useRebaseContext();
    const customizationController = useCustomizationController();

    const childrenResult = typeof children === "function" ? children({
        context,
        loading
    }) : children;

    const plugins = customizationController.plugins;
    const authController = context.authController;
    const authReady = !loading
        && !authController.authLoading
        && (Boolean(authController.user) || authController.loginSkipped);

    if (plugins && plugins.length > 0) {
        return (
            <PluginProviderStack
                plugins={plugins}
                scope="root"
                scopeProps={{ context }}>
                {authReady && <PluginLifecycleManager plugins={plugins} context={context}/>}
                {childrenResult}
            </PluginProviderStack>
        );
    }

    return childrenResult;
}

