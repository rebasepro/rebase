
import { useAuthController } from "./useAuthController";
import { Entity } from "@rebasepro/types";
import { canCreateEntity, canEditEntity, canDeleteEntity, canReadCollection } from "@rebasepro/common";
import { useCallback, useMemo } from "react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * Hook to evaluate roles and permissions for the current user.
 * It abstracts away the need to pass `authController` to permission evaluation functions.
 */
export function usePermissions() {
    const authController = useAuthController();

    const canCreate = useCallback(
        (collection: AdminCollection<any>, path: string) =>
            canCreateEntity(collection, authController, path, null),
        [authController]
    );

    const canEdit = useCallback(
        (collection: AdminCollection<any>, path: string, entity: Entity<any> | null) =>
            canEditEntity(collection, authController, path, entity),
        [authController]
    );

    const canDelete = useCallback(
        (collection: AdminCollection<any>, path: string, entity: Entity<any> | null) =>
            canDeleteEntity(collection, authController, path, entity),
        [authController]
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
