import { Autocomplete, AutocompleteItem, BooleanSwitchWithLabel, Chip, Dialog, DialogContent, DialogTitle, IconButton, LoadingButton, Select, SelectItem, Tooltip, useAutoComplete, Typography } from "@rebasepro/ui";
import { Code, Copy, Share, Type, X } from "lucide-react";
import React, { useEffect } from "react"
import { Dashboard, DatakiUser, Team } from "../types";
import { useDataki } from "../DatakiProvider";
import { deletePermissionFromDashboard, inviteUserToDashboard } from "../api";
import { useAuthController, useSnackbarController } from "@rebasepro/core";
import { UserAvatar } from "./UserAvatar";
import { TextFieldWithTags } from "./TextFieldWithTags";
import { CopyButton } from "./CopyButton";

interface ShareDialogProps {
    dashboard: Dashboard;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({
    dashboard,
    open,
    onOpenChange
}) => {

    const dataki = useDataki();
    const authController = useAuthController();
    const snackbarController = useSnackbarController();

    const [dashboardUsers, setDashboardUsers] = React.useState<(DatakiUser & { type: "read" | "write" })[]>([]);
    const [dashboardTeams, setDashboardTeams] = React.useState<(Team & { type: "read" | "write" })[]>([]);
    const [isPublic, setIsPublic] = React.useState<boolean>(dashboard.public || false);
    const [updatingPublicStatus, setUpdatingPublicStatus] = React.useState<boolean>(false);

    const [editionPermission, setEditingPermission] = React.useState(false);

    const handlePublicToggle = async (value: boolean) => {
        if (!canUserEditPermissions) return;

        setUpdatingPublicStatus(true);
        try {
            await dataki.updateDashboard(dashboard.id, {
                public: value
            }, "public_update");
            setIsPublic(value);
            snackbarController.open({
                message: value ? "Dashboard is now public" : "Dashboard is now private",
                type: "success"
            });
        } catch (error) {
            console.error("Error updating dashboard public status:", error);
            snackbarController.open({
                message: "Failed to update dashboard sharing settings",
                type: "error"
            });
            // Reset to previous value on error
            setIsPublic(!value);
        } finally {
            setUpdatingPublicStatus(false);
        }
    };

    const removeUser = async ({
                                  email,
                                  teamId
                              }: { email?: string, teamId?: string }) => {
        console.log("Removing user", email, teamId);
        setEditingPermission(true);
        const firebaseToken = await dataki.getDatakiAuthToken();
        deletePermissionFromDashboard({
            teamId,
            email,
            dashboardId: dashboard.id,
            firebaseAccessToken: firebaseToken,
            apiEndpoint: dataki.apiEndpoint
        })
            .then(() => {
                setDashboardUsers(dashboardUsers.filter(u => u.email !== email));
                snackbarController.open({
                    message: "User removed successfully",
                    type: "success"
                });
            })
            .catch((e) => {
                console.error("Error removing user", e);
                snackbarController.open({
                    message: e.message ?? "Error removing user",
                    type: "error"
                });
            })
            .finally(() => setEditingPermission(false));
    }

    const loggedUserInProject = authController.user?.uid
        ? dashboardUsers?.find(u => u.id === authController.user?.uid)
        : undefined;
    const canUserEditPermissions = authController.user?.uid === dashboard.owner || loggedUserInProject?.type === "write";

    useEffect(() => {

        if (!dashboard.permissions) {
            setDashboardUsers([]);
            return;
        }
        Promise.all(
            dashboard.permissions
                .filter(p => p.uid)
                .map(async ({
                                uid,
                                type
                            }) => {
                    console.log("Fetching user for permission", uid, type);
                    try {
                        const user = await dataki.getUser(uid as string);
                        return {
                            ...user,
                            type
                        };
                    } catch (e) {
                        console.error("Error fetching user for permission", uid, e);
                        return null;
                    }
                })
        )
            .then((res) => setDashboardUsers(res.filter(Boolean) as (DatakiUser & { type: "read" | "write" })[]))
            .catch((e) => console.error("Error fetching dashboard users", e));

        Promise.all(
            dashboard.permissions
                .filter(p => p.team_id)
                .map(async ({
                                team_id,
                                type
                            }) => {
                    const team = await dataki.getTeam(team_id as string);
                    return {
                        ...team,
                        type
                    };
                })
        )
            .then(setDashboardTeams)
            .catch((e) => console.error("Error fetching dashboard teams", e));

    }, [dashboard.permissions]);

    const shareUrl = `${window.location.origin}/dashboards/${dashboard.id}`;

    return (
        <Dialog open={open}
                onOpenChange={onOpenChange}
                maxWidth={"xl"}
                className="overflow-visible">

            <DialogTitle>
                Share this dashboard
                <div className="absolute top-4 right-4">
                    <IconButton variant="ghost"
                                onClick={() => onOpenChange(false)}>
                        <X/>
                    </IconButton>
                </div>
            </DialogTitle>

            <DialogContent className="relative flex flex-col gap-4">

                <InviteForm dashboard={dashboard}/>

                <div className="space-y-2 mt-4">
                    <div className="text-sm text-text-secondary dark:text-text-secondary-dark">Who has access</div>
                    <div>
                        {dashboardUsers.map((user) => {
                            const userIsOwner = user.id === dashboard.owner;
                            const userPermissionsComponent = userIsOwner || !canUserEditPermissions
                                ? <div
                                    className="text-sm text-text-disabled dark:text-text-disabled-dark">
                                    {userIsOwner
                                        ? "owner"
                                        : (user.type === "read" ? "can view" : "can edit")}
                                </div>
                                : <Select
                                    size={"smallest"}
                                    invisible={true}
                                    value={user.type}
                                    disabled={editionPermission}
                                    className="-mr-2"
                                    inputClassName={"px-0 pl-2"}
                                    onValueChange={(type: any) => {
                                        if (type === "remove") {
                                            return removeUser({ email: user.email ?? undefined });
                                        } else if (type === "write" || type === "read") {
                                            setEditingPermission(true);
                                            const currentType = user.type;
                                            setDashboardUsers(dashboardUsers.map(u => {
                                                if (u.id === user.id) {
                                                    return {
                                                        ...u,
                                                        type: type as "read" | "write"
                                                    };
                                                }
                                                return u;
                                            }));
                                            return dataki.updateDashboardPermissions({
                                                dashboardId: dashboard.id,
                                                uid: user.id,
                                                permissions: type as "read" | "write"
                                            }).catch(() => {
                                                setDashboardUsers(dashboardUsers.map(u => {
                                                    if (u.id === user.id) {
                                                        return {
                                                            ...u,
                                                            type: currentType
                                                        };
                                                    }
                                                    return u;
                                                }));
                                            }).finally(() => setEditingPermission(false));
                                        }
                                    }}>
                                    <SelectItem value={"write"}>Can edit</SelectItem>
                                    <SelectItem value={"read"}>Can view</SelectItem>
                                    <SelectItem value={"remove"}>Remove</SelectItem>
                                </Select>;
                            return (
                                <div key={user.id} className="flex items-center gap-2">
                                    <UserAvatar user={user}/>
                                    <div className="flex-1 block">
                                        {user.displayName && <div className="text-sm">{user.displayName}</div>}
                                        {user.email && <div
                                            className="text-xs text-text-secondary dark:text-text-secondary-dark">{user.email ?? user.id}</div>}
                                    </div>
                                    {userPermissionsComponent}
                                </div>
                            );
                        })}
                        {dashboardTeams.map((team) => {
                                const teamPermissionsComponent = !canUserEditPermissions
                                    ? <div
                                        className="text-sm text-text-disabled dark:text-text-disabled-dark">
                                        {team.type === "read" ? "can view" : "can edit"}
                                    </div>
                                    : <Select
                                        size={"smallest"}
                                        invisible={true}
                                        value={team.type}
                                        disabled={editionPermission}
                                        className="-mr-2"
                                        inputClassName={"px-0 pl-2"}
                                        onValueChange={(type: any) => {
                                            if (type === "remove") {
                                                return removeUser({ teamId: team.id });
                                            } else if (type === "write" || type === "read") {
                                                setEditingPermission(true);
                                                const currentType = team.type;
                                                setDashboardTeams(dashboardTeams.map(t => {
                                                    if (t.id === team.id) {
                                                        return {
                                                            ...t,
                                                            type: type as "read" | "write"
                                                        };
                                                    }
                                                    return t;
                                                }));
                                                return dataki.updateDashboardPermissions({
                                                    dashboardId: dashboard.id,
                                                    teamId: team.id,
                                                    permissions: type as "read" | "write"
                                                }).catch(() => {
                                                    setDashboardTeams(dashboardTeams.map(t => {
                                                        if (t.id === team.id) {
                                                            return {
                                                                ...t,
                                                                type: currentType
                                                            };
                                                        }
                                                        return t;
                                                    }));
                                                }).finally(() => setEditingPermission(false));
                                            }
                                        }}>
                                        <SelectItem value={"write"}>Can edit</SelectItem>
                                        <SelectItem value={"read"}>Can view</SelectItem>
                                        <SelectItem value={"remove"}>Remove</SelectItem>
                                    </Select>;
                                return (
                                    <div key={team.id} className="flex items-center gap-2">
                                        <Chip size={"small"} colorScheme={"orangeLight"} className={"text-xs my-2"}>Team</Chip>
                                        <div className="flex-1">
                                            <div className="text-sm">{team.name}</div>
                                        </div>
                                        {teamPermissionsComponent}
                                    </div>
                                );
                            }
                        )}

                        {/* Public sharing toggle */}
                        <div className="pt-4 mt-2">
                            <Tooltip title={"Anyone with the link can view this dashboard"}>
                                <BooleanSwitchWithLabel
                                    className={"text-text-secondary dark:text-text-secondary-dark"}
                                    label="Public dashboard"
                                    disabled={!canUserEditPermissions || updatingPublicStatus}
                                    value={isPublic}
                                    invisible={true}
                                    position={"start"}
                                    size={"smallest"}
                                    onValueChange={handlePublicToggle}
                                />
                            </Tooltip>
                        </div>

                        {isPublic && (
                            <div className="pt-4">
                                <Typography variant="label" className="font-medium flex gap-2">
                                    <Code size="small"/>
                                    Share link
                                </Typography>
                                <div className="relative mt-2">
                                    <pre className="docs-code p-3 bg-surface-accent-100 dark:bg-surface-accent-900 rounded-lg overflow-x-auto">
                                        <code>
                                            <span className="tok-str">{shareUrl}</span>
                                        </code>
                                    </pre>
                                    <div className="absolute top-2 right-2">
                                        <CopyButton
                                            textToCopy={shareUrl}
                                            tooltip="Copy link"
                                            disabled={!isPublic}
                                        />
                                    </div>
                                </div>
                                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark mt-2">
                                    Anyone with this link can view the dashboard.
                                </Typography>
                            </div>
                        )}

                    </div>
                </div>

                {/*<div className="space-y-2 pt-4">*/}
                {/*    <Button*/}
                {/*        variant="text"*/}
                {/*        color={"text"}*/}
                {/*        className="w-full justify-start gap-2">*/}
                {/*        <Code/>*/}
                {/*        Copy Dev Mode link*/}
                {/*    </Button>*/}
                {/*</div>*/}
            </DialogContent>
        </Dialog>
    )
}

function InviteForm({
                        dashboard,
                    }: {
    dashboard: Dashboard,
}) {

    const {
        apiEndpoint,
        getDatakiAuthToken,
        relatedUsers,
        teams
    } = useDataki();

    const snackbarController = useSnackbarController();
    const [inviteLoading, setInviteLoading] = React.useState(false);
    const [permissions, setPermissions] = React.useState<"read" | "write">("write");

    const [inputText, setInputText] = React.useState("");
    const [selectedTeamIds, setSelectedTeamIds] = React.useState<string[]>([]);
    const [selectedUserIds, setSelectedUserIds] = React.useState<string[]>([]);

    const doInvite = async () => {
        setInviteLoading(true);
        const firebaseToken = await getDatakiAuthToken();
        inviteUserToDashboard(inputText,
            selectedUserIds ?? [],
            selectedTeamIds ?? [],
            permissions,
            dashboard.id,
            firebaseToken,
            apiEndpoint)
            .then(() => {
                snackbarController.open({
                    message: "User invited successfully",
                    type: "success"
                });
            })
            .catch((e) => {
                console.error(e);
                snackbarController.open({
                    message: e.message ?? "Error inviting user",
                    type: "error"
                });
            })
            .finally(() => setInviteLoading(false));
    }

    const inputRef = React.useRef<HTMLInputElement>(null);
    const {
        inputFocused,
        autoCompleteOpen,
        setAutoCompleteOpen
    } = useAutoComplete({
        ref: inputRef
    });

    const existingUserIds = dashboard.permissions?.filter(p => p.uid).map(p => p.uid) ?? [];

    const tags = [...selectedTeamIds, ...selectedUserIds];
    return <form className="relative flex gap-2"
                 onSubmit={(e) => {
                     e.preventDefault();
                     e.stopPropagation();
                     doInvite();
                     return false;
                 }}>
        <TextFieldWithTags
            inputRef={inputRef}
            size={"small"}
            value={inputText}
            onChange={(e: any) => setInputText(e.target.value)}
            placeholder="Invite others by email"
            className="flex-grow"
            autoComplete={"off"}
            tags={tags}
            renderTag={(tag: any) => {
                const team = teams.find((team: any) => team.id === tag);
                if (team) {
                    return team?.name;
                }
                const user = relatedUsers?.find((user: any) => user.id === tag);
                if (user) {
                    return user.displayName ?? user.email;
                }
                return tag;
            }}
            onTagsChange={(tags: any[]) => {
                setSelectedTeamIds(tags.filter((tag: any) => teams.some((team: any) => team.id === tag)));
                setSelectedUserIds(tags.filter((tag: any) => relatedUsers?.some((user: any) => user.id === tag)));
            }}
            endAdornment={<Select
                size={"small"}
                value={permissions}
                onValueChange={(value: any) => {
                    if (value === "write" || value === "read")
                        setPermissions(value);
                }}>
                <SelectItem value={"write"}>Can edit</SelectItem>
                <SelectItem value={"read"}>Can view</SelectItem>
            </Select>}
        />
        <Autocomplete
            open={autoCompleteOpen}
            className={"overflow-y-auto max-h-[50vh]"}
            setOpen={setAutoCompleteOpen}>

            {teams.map((team: any, index: number) => {
                if (selectedTeamIds.includes(team.id)) {
                    return null;
                }
                return <AutocompleteItem
                    key={index + "_" + team.id}
                    className={"text-sm gap-4 px-2"}
                    onClick={() => {
                        setSelectedTeamIds([...selectedTeamIds, team.id]);
                    }}
                >
                    <Chip size={"small"} colorScheme={"orangeLight"}>Team</Chip>
                    <div className={"flex-grow gap-2 flex items-center"}>
                        {team.name}
                        <span className={"text-xs text-text-secondary dark:text-text-secondary-dark"}>
                            {team.users?.length} members
                        </span>
                    </div>
                </AutocompleteItem>;
            })}
            {relatedUsers?.map((user: any, index: number) => {
                    if ((inputText && inputText.toLowerCase().includes(user.email?.toLowerCase()))
                        || selectedUserIds.includes(user.id)
                        || existingUserIds.includes(user.id)) {
                        return null;
                    }

                    return <AutocompleteItem
                        key={index + "_" + user.email}
                        className={"text-sm gap-4 px-2"}
                        onClick={() => {
                            setSelectedUserIds([...selectedUserIds, user.id]);
                            // setAutoCompleteOpen(false);
                            // if (inputText.length > 0) {
                            //     setInputText(inputText + ", " + user.email);
                            // } else {
                            //     setInputText(user.email ?? null);
                            // }
                        }}
                    >
                        <UserAvatar user={user}/>
                        {user.displayName ?? user.email}
                    </AutocompleteItem>;
                }
            )}
        </Autocomplete>
        <LoadingButton color="neutral"
                       loading={inviteLoading}
                       disabled={!inputText && !selectedTeamIds.length && !selectedUserIds.length}
                       type="submit">
            Invite
        </LoadingButton>
    </form>;
}
