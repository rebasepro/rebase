import React from "react";
import { Typography, cls, iconSize } from "@rebasepro/ui";
import { KeyRoundIcon } from "lucide-react";
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
            <button
                onClick={() => setAuthMode("jwt")}
                className={cls(
                    "px-3 py-1 text-xs rounded-full border transition-all",
                    authMode === "jwt"
                        ? "bg-primary/15 text-primary dark:text-primary-dark border-primary/30 font-medium"
                        : "border-surface-300 dark:border-surface-600 text-text-secondary dark:text-text-secondary-dark hover:border-primary/30"
                )}
            >
                JWT Token
            </button>
            <button
                onClick={() => setAuthMode("none")}
                className={cls(
                    "px-3 py-1 text-xs rounded-full border transition-all",
                    authMode === "none"
                        ? "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 font-medium"
                        : "border-surface-300 dark:border-surface-600 text-text-secondary dark:text-text-secondary-dark hover:border-red-500/30"
                )}
            >
                No Auth
            </button>

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
