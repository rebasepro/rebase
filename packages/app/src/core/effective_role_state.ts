import type { EffectiveRoleController } from "@rebasepro/types";
import { useCallback, useState, useMemo } from "react";
import { readStoredString, removeStoredString, writeStoredString } from "../util/local_storage";

/**
 * The effective role controller `<Rebase>` falls back to when the host passes
 * none. Kept apart from the deprecated public hook
 * (`useBuildEffectiveRoleController`) so building it does not report a
 * deprecation the app never used, and out of the hooks barrel so it is not a
 * public export.
 */
export function useEffectiveRoleState(): EffectiveRoleController {

    const savedRole = readStoredString("rebase-effective-role");
    const [effectiveRole, setEffectiveRole] = useState<string | null>(savedRole ?? null);

    const setRoleInternal = useCallback((newRole: string | null) => {
        if (newRole) {
            writeStoredString("rebase-effective-role", newRole);
        } else {
            removeStoredString("rebase-effective-role");
        }
        setEffectiveRole(newRole);
    }, []);

    return useMemo(() => ({
        effectiveRole,
        setEffectiveRole: setRoleInternal
    }), [effectiveRole, setRoleInternal]);
}
