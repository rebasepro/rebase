import React, { useLayoutEffect, useRef } from "react";
import { useRebaseRegistryDispatch } from "../hooks";
import type { RebaseAuthViewConfig } from "@rebasepro/cms-types";

/**
 * Declarative component to configure authentication in Rebase.
 * Renders nothing — purely registers config into the RebaseRegistry.
 *
 * This is a framework-level component that lives in core since
 * authentication is cross-cutting (admin, Studio, any app area).
 * @group Core
 */
export function RebaseAuth({ loginView }: RebaseAuthViewConfig) {
    const dispatch = useRebaseRegistryDispatch();
    const registeredRef = useRef(false);

    useLayoutEffect(() => {
        dispatch.registerAuth({ loginView });
        registeredRef.current = true;
        return () => {
            registeredRef.current = false;
            dispatch.unregisterAuth();
        };
    }, [dispatch, loginView]);

    return null;
}
