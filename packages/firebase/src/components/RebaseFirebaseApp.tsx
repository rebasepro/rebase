import React from "react";
import { GoogleAuthProvider } from "firebase/auth";

import {
    Rebase,
    ModeControllerProvider,
    SnackbarProvider,
    useBrowserTitleAndIcon,
    useBuildLocalConfigurationPersistence,
    useBuildModeController,
    useBuildAdminModeController,
    AdminModeControllerProvider,
    RebaseRoutes
} from "@rebasepro/app";
import {
    AppBar,
    Drawer,
    Scaffold,
    SideDialogs,
    useBuildCollectionRegistryController,
    useBuildUrlController,
    useBuildNavigationStateController,
    CollectionRegistryContext,
    UrlContext,
    NavigationStateContext,
    SidePanelProvider,
    RebaseRoute
} from "@rebasepro/cms";
import { DEFAULT_DATA_SOURCE_KEY, Entity } from "@rebasepro/types";
import { PropertyConfig, RebaseContext } from "@rebasepro/cms-types";
import { CenteredView, CircularProgressCenter } from "@rebasepro/ui";
import { buildRebaseData } from "@rebasepro/common";
import { Route, Outlet, Navigate } from "react-router";

import { RebaseFirebaseAppProps } from "./RebaseFirebaseAppProps";
import { FirebaseLoginView } from "./FirebaseLoginView";
import {
    useAppCheck,
    useFirebaseAuthController,
    useFirebaseStorageSource,
    useFirestoreDriver,
    useInitialiseFirebase,
    useBuildUserManagement,
    useFirebaseAccessGate
} from "../hooks";

import { FirebaseAuthController } from "../types";

const DEFAULT_SIGN_IN_OPTIONS = [
    GoogleAuthProvider.PROVIDER_ID
];

/**
 * This is the default implementation of a Rebase app using the Firebase services
 * as a backend.
 * You can use this component as a full app, by specifying collections and
 * entity collections.
 *
 * This component is in charge of initialising Firebase, with the given
 * configuration object.
 *
 * If you are building a larger app and need finer control, you can use
 * {@link Rebase}, {@link Scaffold}, {@link SideDialogs}
 * and {@link NavigationRoutes} instead.
 *
 * @param props

 * @category Firebase
 */
export function RebaseFirebaseApp({
    name,
    logo,
    logoDark,
    accessGate,
    collections,
    views,
    adminViews,
    textSearchControllerBuilder,
    allowSkipLogin,
    signInOptions = DEFAULT_SIGN_IN_OPTIONS,
    firebaseConfig,
    onFirebaseInit,
    appCheckOptions,
    dateTimeFormat,
    locale,
    basePath,
    baseCollectionPath,
    onAnalyticsEvent,
    propertyConfigs: propertyConfigsProp,
    plugins,
    autoOpenDrawer,
    firestoreIndexesBuilder,
    components,
    localTextSearchEnabled = false
}: RebaseFirebaseAppProps) {

    /**
     * Update the browser title and icon
     */
    useBrowserTitleAndIcon(name, logo);

    const propertyConfigs: Record<string, PropertyConfig> = (propertyConfigsProp ?? [])
        .map(pc => ({
            [pc.key]: pc
        }))
        .reduce((a, b) => ({ ...a,
...b }), {});

    const {
        firebaseApp,
        firebaseConfigLoading,
        configError
    } = useInitialiseFirebase({
        onFirebaseInit,
        firebaseConfig
    });

    /**
     * Controller used to manage the dark or light color mode
     */
    const modeController = useBuildModeController();
    const adminModeController = useBuildAdminModeController();

    const {
        loading,
        appCheckVerified,
        error
    } = useAppCheck({
        firebaseApp,
        options: appCheckOptions
    });

    /**
     * Controller for managing authentication
     */
    const authController: FirebaseAuthController = useFirebaseAuthController({
        firebaseApp,
        signInOptions
    });

    /**
     * Controller for saving some user preferences locally.
     */
    const userConfigPersistence = useBuildLocalConfigurationPersistence();

    const firestoreDelegate = useFirestoreDriver({
        firebaseApp,
        textSearchControllerBuilder: textSearchControllerBuilder,
        firestoreIndexesBuilder: firestoreIndexesBuilder,
        localTextSearchEnabled
    })

    /**
     * Controller used for saving and fetching files in storage
     */
    const storageSource = useFirebaseStorageSource({
        firebaseApp
    });

    /**
     * Validate access gate
     */
    const {
        authLoading,
        canAccessMainView,
        notAllowedError
    } = useFirebaseAccessGate({
        authController,
        accessGate,
        data: buildRebaseData(firestoreDelegate),
        storageSource
    });

    const collectionRegistryController = useBuildCollectionRegistryController({
        userConfigPersistence
    });

    const urlController = useBuildUrlController({
        basePath: basePath ?? "/",
        baseCollectionPath: baseCollectionPath ?? "/c",
        collectionRegistryController
    });

    const defaultUserManagement = useBuildUserManagement({
        authController,
        dataSourceDelegate: firestoreDelegate
    });


    const navigationStateController = useBuildNavigationStateController({
        collections,
        views,
        adminViews,
        authController,
        data: buildRebaseData(firestoreDelegate),
        plugins,
        collectionRegistryController,
        urlController,
        adminMode: adminModeController.mode
    });

    if (firebaseConfigLoading || !firebaseApp || loading) {
        return <>
            <CircularProgressCenter/>
        </>;
    }

    if (configError) {
        return <CenteredView>{configError}</CenteredView>;
    }

    return (
        <SnackbarProvider>
            <ModeControllerProvider value={modeController}>
                <AdminModeControllerProvider value={adminModeController}>

                    <CollectionRegistryContext.Provider value={collectionRegistryController}>
                        <UrlContext.Provider value={urlController}>
                            <NavigationStateContext.Provider value={navigationStateController}>
                                <Rebase
                                    authController={authController}
                                    userConfigPersistence={userConfigPersistence}
                        dateTimeFormat={dateTimeFormat}
                        dataSources={[{
                            key: DEFAULT_DATA_SOURCE_KEY,
                            engine: "firestore",
                            transport: "direct",
                            driver: firestoreDelegate
                        }]}
                        storageSource={storageSource}
                        entityLinkBuilder={({ entity }: { entity: Entity<any> }) => `https://console.firebase.google.com/project/${firebaseApp.options.projectId}/firestore/data/${entity.path}/${entity.id}`}
                        locale={locale}
                        onAnalyticsEvent={onAnalyticsEvent}
                        plugins={plugins}
                        propertyConfigs={propertyConfigs}>
                        {({
                            context,
                            loading
                        }: { context: RebaseContext, loading: boolean }) => {

                            let component;
                            if (loading || authLoading) {
                                component = <CircularProgressCenter size={"large"}/>;
                            } else {
                                const usedLogo = modeController.mode === "dark" && logoDark ? logoDark : logo;
                                if (!canAccessMainView) {
                                    const LoginViewUsed = components?.LoginView ?? FirebaseLoginView;
                                    component = (
                                        <LoginViewUsed
                                            logo={usedLogo}
                                            allowSkipLogin={allowSkipLogin}
                                            signInOptions={signInOptions ?? DEFAULT_SIGN_IN_OPTIONS}
                                            firebaseApp={firebaseApp}
                                            authController={authController}
                                            notAllowedError={notAllowedError instanceof Error ? notAllowedError : typeof notAllowedError === "string" ? notAllowedError : undefined}/>
                                    );
                                } else {
                                    const firstCollectionEntry = navigationStateController.topLevelNavigation?.navigationEntries.find(e => e.type === "collection");
                                    const fallbackRoute = firstCollectionEntry ? <Navigate to={urlController.buildUrlCollectionPath(firstCollectionEntry.id)} replace /> : <CenteredView>No home page or collections provided.</CenteredView>;

                                    component = (
                                        <SidePanelProvider>
                                            <RebaseRoutes>
                                                <Route element={
                                                    <Scaffold
                                                        logo={usedLogo}
                                                        autoOpenDrawer={autoOpenDrawer}>
                                                        <AppBar title={name} logo={usedLogo}/>
                                                        <Drawer/>
                                                        <Outlet/>
                                                        <SideDialogs/>
                                                    </Scaffold>
                                                }>
                                                    <Route path="/" element={components?.HomePage ? <components.HomePage/> : fallbackRoute}/>
                                                    <Route path="/c/*" element={<RebaseRoute/>}/>
                                                </Route>
                                            </RebaseRoutes>
                                        </SidePanelProvider>
                                    );
                                }
                            }

                            return component;
                        }}
                                </Rebase>
                            </NavigationStateContext.Provider>
                        </UrlContext.Provider>
                    </CollectionRegistryContext.Provider>
                </AdminModeControllerProvider>
            </ModeControllerProvider>
        </SnackbarProvider>
    );
}
