
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { deepEqual as equal } from "fast-equals";

import { RebaseData, StorageSource, User } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";

/**
 * Client-side gate that decides whether a Firebase-authenticated user
 * is allowed to access the CMS UI.
 *
 * Return `true` to allow access or `false` / throw to deny.
 * @group Firebase
 */
export type FirebaseAccessGate<USER extends User = User> = (props: {

    /**
     * Logged-in user or null
     */
    user: USER | null;

    /**
     * AuthController
     */
    authController: AuthController<USER>;

    /**
     * Unified data access API
     */
    data: RebaseData;

    /**
     * Used storage implementation
     */
    storageSource: StorageSource;

}) => boolean | Promise<boolean>;

/**
 * Hook that evaluates a {@link FirebaseAccessGate} callback after
 * the user logs in and gates access to the main CMS view.
 *
 * @group Firebase
 */
export function useFirebaseAccessGate<USER extends User = User>
({
     disabled,
     authController,
     accessGate,
     storageSource,
     data
 }:
 {
     disabled?: boolean,
     authController: AuthController<USER>,
     accessGate?: boolean | FirebaseAccessGate<USER>,
     data: RebaseData;
     storageSource: StorageSource;
 }): {
    canAccessMainView: boolean,
    authLoading: boolean,
    notAllowedError: unknown,
    authVerified: boolean,
} {

    const gateEnabled = Boolean(accessGate);

    const [authLoading, setAuthLoading] = useState<boolean>(gateEnabled);
    const [notAllowedError, setNotAllowedError] = useState<unknown>(false);
    const [authVerified, setAuthVerified] = useState<boolean>(!gateEnabled || Boolean(authController.loginSkipped));

    const canAccessMainView = (authVerified) &&
        (!gateEnabled || Boolean(authController.user) || Boolean(authController.loginSkipped)) &&
        !notAllowedError;

    useEffect(() => {
        if (authController.loginSkipped)
            setAuthVerified(true);
    }, [authController.loginSkipped]);

    /**
     * We use this ref to check the authentication only if the user has
     * changed.
     */
    const checkedUserRef = useRef<User | undefined>(undefined);

    const checkAccess = useCallback(async () => {

        if (disabled) {
            return;
        }

        if (authController.initialLoading) {
            return;
        }

        if (!authController.user && !authController.loginSkipped) {
            checkedUserRef.current = undefined;
            setAuthLoading(false);
            setAuthVerified(false);
            return;
        }

        const delegateUser = authController.user;

        if (accessGate instanceof Function && delegateUser && !equal(checkedUserRef.current?.uid, delegateUser.uid)) {
            setAuthLoading(true);
            try {
                const allowed = await accessGate({
                    user: delegateUser,
                    authController,
                    data,
                    storageSource
                });
                if (!allowed) {
                    authController.signOut();
                    setNotAllowedError(true);
                }
            } catch (e) {
                setNotAllowedError(e);
                authController.signOut();
            }
            setAuthLoading(false);
            setAuthVerified(true);
            checkedUserRef.current = delegateUser;
        } else {
            setAuthLoading(false);
        }

        if (!authController.initialLoading && !delegateUser) {
            setAuthVerified(true);
        }

    }, [disabled, authController, accessGate, data, storageSource]);

    useEffect(() => {
        checkAccess();
    }, [checkAccess]);

    return useMemo(() => ({
        canAccessMainView,
        authLoading: gateEnabled && authLoading,
        notAllowedError,
        authVerified
    }), [canAccessMainView, gateEnabled, authLoading, notAllowedError, authVerified]);
}
