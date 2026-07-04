import type { CollectionConfig } from "@rebasepro/types";
import { useAuthController } from "./useAuthController";
import { Snapshot } from "@rebasepro/types";
import { canCreateSnapshot, canEditSnapshot, canDeleteSnapshot, canReadCollection } from "@rebasepro/common";
import { useCallback, useMemo } from "react";

/**
 * Hook to evaluate roles and permissions for the current user.
 * It abstracts away the need to pass `authController` to permission evaluation functions.
 */
export function usePermissions() {
    const authController = useAuthController();

    const canCreate = useCallback(
        (collection: CollectionConfig<any>, path: string) =>
            canCreateSnapshot(collection, authController, path, null),
        [authController]
    );

    const canEdit = useCallback(
        (collection: CollectionConfig<any>, path: string, snapshot: Snapshot<any> | null) =>
            canEditSnapshot(collection, authController, path, snapshot),
        [authController]
    );

    const canDelete = useCallback(
        (collection: CollectionConfig<any>, path: string, snapshot: Snapshot<any> | null) =>
            canDeleteSnapshot(collection, authController, path, snapshot),
        [authController]
    );

    const canRead = useCallback(
        (collection: CollectionConfig<any>) =>
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
