import React from "react";
import {
    useRebaseRegistry,
    useAuthController
} from "@rebasepro/app";
import { CircularProgressCenter } from "@rebasepro/ui";
import { LoginView } from "@rebasepro/app";
import type { AuthControllerExtended } from "@rebasepro/cms-types";

/**
 * Auth gate component that handles the authentication flow.
 *
 * - Shows a loading spinner while `authController.initialLoading` is true.
 * - Shows the login view when no user is authenticated.
 * - Renders `children` when a user is authenticated.
 *
 * **Independently usable**: Use this alone when you want auth gating
 * without the full admin layout or navigation.
 *
 * @example
 * ```tsx
 * <RebaseAuthGate>
 *   <MyCustomApp />
 * </RebaseAuthGate>
 * ```
 */
export function RebaseAuthGate({ children }: { children: React.ReactNode }) {
    const registry = useRebaseRegistry();
    const authController = useAuthController();


    if (authController?.initialLoading) {
        return <CircularProgressCenter size={"large"}/>;
    }

    if (!authController?.user) {
        const ActiveLoginView = registry.authConfig?.loginView ?? (
            <LoginView authController={authController as AuthControllerExtended}/>
        );
        return <>{ActiveLoginView}</>;
    }

    return <>{children}</>;
}
