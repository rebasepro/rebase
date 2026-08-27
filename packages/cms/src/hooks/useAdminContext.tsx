import { useMemo } from "react";
import { useRebaseContext } from "@rebasepro/app";
import type {
    User
} from "@rebasepro/types";
import type {
    AuthController,
    RebaseContext,
    SideDialogsController,
    SidePanelController
} from "@rebasepro/cms-types";
import type {
    CollectionRegistryController
} from "@rebasepro/types";
import type {
    NavigationStateController,
    UrlController
} from "@rebasepro/cms-types";
import { useSidePanel } from "./useSidePanel";
import { useSideDialogsController } from "./useSideDialogsController";
import {
    useUrlController,
    useNavigationStateController,
    useCollectionRegistryController
} from "./navigation/contexts";

/**
 * The admin context extends the core RebaseContext with admin-specific
 * controllers that are only available inside the admin routing tree.
 *
 * Use {@link useAdminContext} to obtain an instance.
 * @group Hooks and utilities
 */
export type AdminContext<
    DB = Record<string, unknown>,
    USER extends User = User,
    AuthControllerType extends AuthController<USER> = AuthController<USER>
> = RebaseContext<USER, AuthControllerType> & {
    sidePanelController: SidePanelController;
    sideDialogsController: SideDialogsController;
    urlController: UrlController;
    navigationStateController: NavigationStateController;
    collectionRegistryController: CollectionRegistryController<DB>;
};

/**
 * Hook that builds a fully-populated admin context by combining the
 * core {@link RebaseContext} with admin-specific controllers.
 *
 * Use this instead of `useRebaseContext()` in admin components that
 * need to pass context to entity action callbacks, plugin slots,
 * or any consumer that expects admin controllers on the context object.
 *
 * @group Hooks and utilities
 */
export function useAdminContext<
    DB = Record<string, unknown>,
    USER extends User = User,
    AuthControllerType extends AuthController<USER> = AuthController<USER>
>(): AdminContext<DB, USER, AuthControllerType> {
    const baseContext = useRebaseContext<USER, AuthControllerType>();
    const sidePanelController = useSidePanel();
    const sideDialogsController = useSideDialogsController();
    const urlController = useUrlController();
    const navigationStateController = useNavigationStateController();
    const collectionRegistryController = useCollectionRegistryController<DB>();

    return useMemo(() => ({
        ...baseContext,
        sidePanelController,
        sideDialogsController,
        urlController,
        navigationStateController,
        collectionRegistryController
    }), [
        baseContext,
        sidePanelController,
        sideDialogsController,
        urlController,
        navigationStateController,
        collectionRegistryController
    ]);
}
