import React from "react";
import { Button, cls, iconSize, KeyRoundIcon, Typography } from "@rebasepro/ui";
import { UserSelectPopover, SelectableUser } from "@rebasepro/core";

export interface AuthSimulationSelectorProps {
    authMode: "jwt" | "none";
    setAuthMode: (mode: "jwt" | "none") => void;
    selectedUser: SelectableUser | null;
    setSelectedUser: (user: SelectableUser | null) => void;
    users: SelectableUser[];
    loading?: boolean;
    currentUser: SelectableUser | null;
}

export function AuthSimulationSelector({
    authMode,
    setAuthMode,
    selectedUser,
    setSelectedUser,
    users,
    loading,
    currentUser
}: AuthSimulationSelectorProps) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <KeyRoundIcon size={iconSize.small} className="text-text-secondary dark:text-text-secondary-dark" />
            <Typography
                variant="caption"
                className="text-text-secondary dark:text-text-secondary-dark text-xs font-medium"
            >
                Auth:
            </Typography>
            <Button
                size="small"
                variant={authMode === "jwt" ? "outlined" : "outlined"}
                color={authMode === "jwt" ? "primary" : "neutral"}
                onClick={() => setAuthMode("jwt")}
                className="rounded-full !px-3 !py-1 !text-xs"
            >
                JWT Token
            </Button>
            <Button
                size="small"
                variant={authMode === "none" ? "outlined" : "outlined"}
                color={authMode === "none" ? "error" : "neutral"}
                onClick={() => setAuthMode("none")}
                className="rounded-full !px-3 !py-1 !text-xs"
            >
                No Auth
            </Button>

            {authMode === "jwt" && (
                <>
                    <div className="w-px h-4 bg-surface-300 dark:bg-surface-600 mx-1" />
                    <Typography
                        variant="caption"
                        className="text-text-secondary dark:text-text-secondary-dark text-xs font-medium"
                    >
                        Run as:
                    </Typography>
                    <UserSelectPopover
                        selectedUser={selectedUser}
                        onUserSelected={setSelectedUser}
                        users={users}
                        loading={loading}
                        currentUser={currentUser}
                    />
                </>
            )}
        </div>
    );
}
