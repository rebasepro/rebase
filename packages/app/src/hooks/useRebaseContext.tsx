import { User } from "@rebasepro/types";
import { AuthController, RebaseContext } from "@rebasepro/cms-types";
import { wrapAsSdkData } from "@rebasepro/common";
import { useAuthController } from "./useAuthController";
import { useRebaseClient } from "./useRebaseClient";
import { useData } from "./data/useData";
import { useStorageSource } from "./useStorageSource";
import { useSnackbarController } from "./useSnackbarController";
import { useUserConfigurationPersistence } from "./useUserConfigurationPersistence";
import { useDialogsController } from "./useDialogsController";
import { useCustomizationController } from "./useCustomizationController";
import { useAnalyticsController } from "./useAnalyticsController";
import { useEffectiveRoleController } from "./useEffectiveRoleController";
import React, { useEffect, useContext } from "react";


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
    // `context.data` is the flat SDK view — identical in shape to the backend
    // `context.data` and the frontend SDK client, so callbacks behave the same
    // everywhere. The admin reads Entities via `useData()` directly.
    const entityData = useData();
    const data = React.useMemo(() => wrapAsSdkData(entityData), [entityData]);
    const storageSource = useStorageSource();
    const snackbarController = useSnackbarController();
    const userConfigPersistence = useUserConfigurationPersistence();
    const dialogsController = useDialogsController();
    const customizationController = useCustomizationController();
    const analyticsController = useAnalyticsController();
    const effectiveRoleController = useEffectiveRoleController();


    // Will get `databaseAdmin` from context
    const databaseAdmin = useContext(DatabaseAdminContext);

    const rebaseContextRef = React.useRef<RebaseContext<USER, AuthControllerType>>({
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
    });

    React.useEffect(() => {
        rebaseContextRef.current = {
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
            client: client!
        };
    }, [authController, data, storageSource, snackbarController, userConfigPersistence,
        dialogsController, customizationController, analyticsController,
        effectiveRoleController, databaseAdmin, client]);

    return rebaseContextRef.current;
}
