import { User } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";
import { useContext } from "react";
import { AuthControllerContext } from "../contexts/AuthControllerContext";

/**
 * Hook to retrieve the AuthContext.
 *
 * Consider that in order to use this hook you need to have a parent
 * `Rebase`
 *
 * @see AuthController
 * @group Hooks and utilities
 */
export const useAuthController = <USER extends User = User, AuthControllerType extends AuthController<USER> = AuthController<USER>>(): AuthControllerType => {
    const authController = useContext(AuthControllerContext);
    if (!authController) throw new Error("useAuthController must be used inside <Rebase>");
    return authController as AuthControllerType;
};
