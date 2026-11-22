import React from "react";
import { Button, Chip, iconSize, KeyRoundIcon, Typography } from "@rebasepro/ui";
import { UserSelectPopover, SelectableUser } from "@rebasepro/app";

export interface AuthSimulationSelectorProps {
    authMode: "jwt" | "none";
    setAuthMode: (mode: "jwt" | "none") => void;
    selectedUser: SelectableUser | null;
    setSelectedUser: (user: SelectableUser | null) => void;
    users: SelectableUser[];
    loading?: boolean;
    /** For a caller that searches `users` on the server — see `UserSelectPopover`. */
    onUserSearchTextChange?: (searchText: string) => void;
    /** How many users that search matched, when `users` is only its first page — see `UserSelectPopover`. */
    userTotalCount?: number;
    currentUser: SelectableUser | null;
    /**
     * What every request runs as, when the host fixes it (a service key, in
     * the hosted console). Set, the selector shows this instead of the auth
     * modes and the "Run as" picker: neither choice exists there.
     */
    fixedIdentityLabel?: string;
    /** Why the identity is fixed, shown on hover over {@link fixedIdentityLabel}. */
    fixedIdentityHint?: string;
}

export function AuthSimulationSelector({
    authMode,
    setAuthMode,
    selectedUser,
    setSelectedUser,
    users,
    loading,
    onUserSearchTextChange,
    userTotalCount,
    currentUser,
    fixedIdentityLabel,
    fixedIdentityHint
}: AuthSimulationSelectorProps) {
    if (fixedIdentityLabel !== undefined) {
        return (
            <div className="flex flex-wrap items-center gap-3" title={fixedIdentityHint}>
                <KeyRoundIcon size={iconSize.small} className="text-text-secondary dark:text-text-secondary-dark" />
                <Typography
                    variant="caption"
                    className="text-text-secondary dark:text-text-secondary-dark text-xs font-medium"
                >
                    Auth:
                </Typography>
                <Chip size="smallest">{fixedIdentityLabel}</Chip>
            </div>
        );
    }
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
                    <div className="w-px h-4 bg-hairline-strong mx-1" />
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
                        onSearchTextChange={onUserSearchTextChange}
                        totalCount={userTotalCount}
                        currentUser={currentUser}
                    />
                </>
            )}
        </div>
    );
}
