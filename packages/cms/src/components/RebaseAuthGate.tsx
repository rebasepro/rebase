import React from "react";
import {
    useRebaseRegistry,
    useAuthController
} from "@rebasepro/app";
import { CircularProgressCenter } from "@rebasepro/ui";
import { LoginView, readEmailLinkAction } from "@rebasepro/app";
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

    // A verification link opened while signed in is verified by the session
    // itself — which keeps everything on the account — on the screen that
    // knows the link. Left to the app's router it was a page that does not
    // exist, so the link mailed at registration went unconfirmed.
    const openedVerificationLink = typeof window !== "undefined"
        && readEmailLinkAction(window.location)?.kind === "verify-email";

    if (!authController?.user || openedVerificationLink) {
        const ActiveLoginView = registry.authConfig?.loginView ?? (
            <LoginView authController={authController as AuthControllerExtended}/>
        );
        return <>{ActiveLoginView}</>;
    }

    return <>{children}</>;
}
