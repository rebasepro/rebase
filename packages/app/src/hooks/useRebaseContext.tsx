import { User } from "@rebasepro/types";
import { AuthController, RebaseContext } from "@rebasepro/cms-types";
import { useAuthController } from "./useAuthController";
import { useRebaseClient } from "./useRebaseClient";
import { SdkDataLayerContext } from "./data/sdkData";
import { buildContextData, missingContextData } from "./data/rowWrites";
import { useStorageSource } from "./useStorageSource";
import { useSnackbarController } from "./useSnackbarController";
import { useUserConfigurationPersistence } from "./useUserConfigurationPersistence";
import { useDialogsController } from "./useDialogsController";
import { useCustomizationController } from "./useCustomizationController";
import { useAnalyticsController } from "./useAnalyticsController";
import { useEffectiveRoleController } from "./useEffectiveRoleController";
import React, { useContext } from "react";


// DatabaseAdmin is provided by <Rebase> via DatabaseAdminContext.
import { DatabaseAdminContext } from "../contexts/DatabaseAdminContext";

/**
 * Hook to retrieve the {@link RebaseContext}.
 *
 * Consider that in order to use this hook you need to have a parent
 * `Rebase` component.
 *
 * @see RebaseContext
 * @group Hooks and utilities
 */
export const useRebaseContext = <USER extends User = User, AuthControllerType extends AuthController<USER> = AuthController<USER>>(): RebaseContext<USER, AuthControllerType> => {

    const client = useRebaseClient<any>();

    const authController = useAuthController<USER, AuthControllerType>();
    // `context.data` is the flat layer the row hooks read — rows as the
    // backend's `context.data` and the client's `data` serve them, so code
    // given a context behaves the same everywhere. Its writes run the
    // collection's browser callbacks, which are handed this same context.
    const layer = useContext(SdkDataLayerContext);
    const contextRef = React.useRef<RebaseContext<USER, AuthControllerType> | undefined>(undefined);
    const data = React.useMemo(
        () => layer
            ? buildContextData(layer, () => {
                if (!contextRef.current) throw new Error("context.data was written to before its context existed.");
                return contextRef.current;
            })
            : missingContextData(),
        [layer]);
    const storageSource = useStorageSource();
    const snackbarController = useSnackbarController();
    const userConfigPersistence = useUserConfigurationPersistence();
    const dialogsController = useDialogsController();
    const customizationController = useCustomizationController();
    const analyticsController = useAnalyticsController();
    const effectiveRoleController = useEffectiveRoleController();


    // Will get `databaseAdmin` from context
    const databaseAdmin = useContext(DatabaseAdminContext);

    // Built during render, so it is the context of *this* render. It used to be
    // kept in a ref and refreshed from an effect, which put every reader one
    // render behind: a sign-in or sign-out that caused no further render was
    // never seen by anything that read `context.authController`.
    const context = React.useMemo<RebaseContext<USER, AuthControllerType>>(() => ({
        authController,
        data,
        storageSource,
        snackbarController,
        userConfigPersistence,
        dialogsController,
        customizationController,
        analyticsController,
        effectiveRoleController,
        databaseAdmin,
        client: client! // Client should be provided
    }), [authController, data, storageSource, snackbarController, userConfigPersistence,
        dialogsController, customizationController, analyticsController,
        effectiveRoleController, databaseAdmin, client]);
    contextRef.current = context;
    return context;
}
