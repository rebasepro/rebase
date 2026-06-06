import React, { useState } from "react";
import { useInternalUserManagementController } from "../hooks/useInternalUserManagementController";
import { useAuthController } from "../hooks/useAuthController";
import { useTranslation } from "../hooks/useTranslation";
import { useSnackbarController } from "../hooks/useSnackbarController";
import { Button, CircularProgress, Typography } from "@rebasepro/ui";

export interface BootstrapAdminBannerProps {
    className?: string;
}

export function BootstrapAdminBanner({
    className
}: BootstrapAdminBannerProps) {
    const userManagement = useInternalUserManagementController();
    const { user: loggedInUser } = useAuthController();
    const { t } = useTranslation();
    const snackbarController = useSnackbarController();
    const [bootstrapping, setBootstrapping] = useState(false);

    // If we're not running locally, don't render anything
    if (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        return null;
    }

    if (!userManagement || !loggedInUser) {
        return null;
    }

    // Non-admin users don't load the users list (admin API is skipped to
    // avoid 403s), so `users` would be empty and falsely trigger this banner.
    // Only admin users (or users with no roles yet, during initial bootstrap)
    // should ever see this prompt.
    const loggedInUserRoles = loggedInUser.roles ?? [];
    const isLoggedInUserAdmin = loggedInUserRoles.length === 0 || loggedInUserRoles.some(r => r === "admin");
    if (!isLoggedInUserAdmin) {
        return null;
    }

    const { hasAdminUsers, loading: delegateLoading, bootstrapAdmin, usersError } = userManagement;

    if (delegateLoading || hasAdminUsers || usersError || !bootstrapAdmin) {
        return null;
    }

    const handleBootstrap = async () => {
        if (!bootstrapAdmin) return;
        setBootstrapping(true);
        try {
            await bootstrapAdmin();
            snackbarController.open({ type: "success", message: t("bootstrap_admin_success") || "Admin successfully created" });
            window.location.reload();
        } catch (error: unknown) {
            snackbarController.open({ type: "error", message: error instanceof Error ? error.message : t("failed_to_bootstrap_admin") || "Failed to bootstrap admin" });
        } finally {
            setBootstrapping(false);
        }
    };

    return (
        <div className={`bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-700 rounded p-4 flex items-center justify-between ${className || ""}`}>
            <div>
                <Typography variant="label" className="text-yellow-800 dark:text-yellow-200">
                    {t("no_users_or_roles_defined") || "No admins found. Click to add your user as admin."}
                </Typography>
            </div>
            <Button
                onClick={handleBootstrap}
                disabled={bootstrapping}
            >
                {bootstrapping ? <CircularProgress size="small"/> : (t("add_logged_user_as_admin") || "Add logged user as admin")}
            </Button>
        </div>
    );
}
