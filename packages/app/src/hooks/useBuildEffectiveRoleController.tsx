import type { EffectiveRoleController } from "@rebasepro/types";
import { useCallback, useState, useMemo } from "react";
import { readStoredString, removeStoredString, writeStoredString } from "../util/local_storage";
;

/**
 * Use this hook to build an effective role controller that determines
 * what role is simulated in Editor mode when Dev mode is active.
 *
 * It uses localStorage to persist the simulated role across reloads.
 */
export function useBuildEffectiveRoleController(): EffectiveRoleController {

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
