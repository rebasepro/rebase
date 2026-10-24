
import { useAuthController } from "./useAuthController";
import { useRlsSimulation } from "../contexts/RlsSimulationContext";
import { Entity } from "@rebasepro/types";
import { canCreateEntity, canEditEntity, canDeleteEntity, canReadCollection } from "@rebasepro/common";
import { useCallback, useMemo } from "react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Hook to evaluate roles and permissions for the current user.
 * It abstracts away the need to pass `authController` to permission evaluation functions.
 *
 * While access is simulated ("Simulate access") nothing can be created, edited
 * or deleted: the server refuses every write that carries a simulation
 * (`SIMULATION_READ_ONLY`), so the views offer none rather than failing on save.
 */
export function usePermissions() {
    const authController = useAuthController();
    const simulating = useRlsSimulation().simulation !== null;

    const canCreate = useCallback(
        (collection: AdminCollection<any>, path: string) =>
            !simulating && canCreateEntity(collection, authController, path, null),
        [authController, simulating]
    );

    const canEdit = useCallback(
        (collection: AdminCollection<any>, path: string, entity: Entity<any> | null) =>
            !simulating && canEditEntity(collection, authController, path, entity),
        [authController, simulating]
    );

    const canDelete = useCallback(
        (collection: AdminCollection<any>, path: string, entity: Entity<any> | null) =>
            !simulating && canDeleteEntity(collection, authController, path, entity),
        [authController, simulating]
    );

    const canRead = useCallback(
        (collection: AdminCollection<any>) =>
            canReadCollection(collection, authController),
        [authController]
    );

    return useMemo(() => ({
        canCreate,
        canEdit,
        canDelete,
        canRead
    }), [canCreate, canEdit, canDelete, canRead]);
}
