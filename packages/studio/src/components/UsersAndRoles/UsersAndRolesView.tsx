import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    Alert,
    BooleanSwitchWithLabel,
    Button,
    Card,
    Chip,
    CircularProgress,
    cls,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    PencilIcon,
    IconButton,
    iconSize,
    PlusIcon,
    RefreshCwIcon,
    SearchBar,
    ShieldIcon,
    Tab,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    Tabs,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography,
    UsersIcon
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { BUILT_IN_SCOPES } from "@rebasepro/types";
import {
    asBoolean,
    asNullableString,
    asString,
    asStringArray,
    isRecord,
    useAdminFetch
} from "../../utils/adminFetch";

interface AdminUserRow {
    uid: string;
    email: string;
    displayName: string | null;
    roles: string[];
    disabled: boolean;
    emailVerified: boolean;
    createdAt: string | null;
}

interface StoredRoleRow {
    name: string;
    description: string | null;
    scopes: string[];
    isDefault: boolean;
    assignable: boolean;
    source: "built-in" | "code" | "database";
}

function parseUser(raw: unknown): AdminUserRow | null {
    if (!isRecord(raw)) return null;
    const uid = asString(raw.uid ?? raw.id);
    if (!uid) return null;
    return {
        uid,
        email: asString(raw.email),
        displayName: asNullableString(raw.displayName ?? raw.display_name),
        roles: asStringArray(raw.roles),
        disabled: asBoolean(raw.disabled, false),
        emailVerified: asBoolean(raw.emailVerified ?? raw.email_verified, false),
        createdAt: asNullableString(raw.createdAt ?? raw.created_at)
    };
}

function parseRole(raw: unknown): StoredRoleRow | null {
    if (!isRecord(raw)) return null;
    const name = asString(raw.id ?? raw.name);
    if (!name) return null;
    const source = raw.source === "built-in" || raw.builtIn === true || name === "admin"
        ? "built-in"
        : raw.source === "code"
            ? "code"
            : "database";
    return {
        name,
        description: asNullableString(raw.description),
        scopes: asStringArray(raw.scopes),
        isDefault: asBoolean(raw.isDefault, false),
        assignable: asBoolean(raw.assignable, true),
        source
    };
}

export function UsersAndRolesView() {
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

    const [tab, setTab] = useState<"users" | "roles">("users");

    // Users state
    const [users, setUsers] = useState<AdminUserRow[]>([]);
    const [usersLoading, setUsersLoading] = useState(true);
    const [usersError, setUsersError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [userDialogOpen, setUserDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<AdminUserRow | null>(null);
    const [userEmail, setUserEmail] = useState("");
    const [userPassword, setUserPassword] = useState("");
    const [userDisplayName, setUserDisplayName] = useState("");
    const [userRolesInput, setUserRolesInput] = useState("");
    const [userDisabled, setUserDisabled] = useState(false);
    const [savingUser, setSavingUser] = useState(false);

    // Roles state
    const [roles, setRoles] = useState<StoredRoleRow[]>([]);
    const [rolesLoading, setRolesLoading] = useState(true);
    const [rolesError, setRolesError] = useState<string | null>(null);
    const [roleDialogOpen, setRoleDialogOpen] = useState(false);
    const [editingRoleName, setEditingRoleName] = useState<string | null>(null);
    const [roleName, setRoleName] = useState("");
    const [roleDescription, setRoleDescription] = useState("");
    const [roleScopes, setRoleScopes] = useState<string[]>([]);
    const [customScopeInput, setCustomScopeInput] = useState("");
    const [roleIsDefault, setRoleIsDefault] = useState(false);
    const [roleAssignable, setRoleAssignable] = useState(true);
    const [savingRole, setSavingRole] = useState(false);

    const loadUsers = useCallback(async () => {
        setUsersLoading(true);
        setUsersError(null);
        try {
            const raw = await requestJson("/admin/users?limit=200");
            const arr = isRecord(raw) && Array.isArray(raw.users)
                ? raw.users
                : (Array.isArray(raw) ? raw : []);
            setUsers(arr.map(parseUser).filter((u): u is AdminUserRow => u !== null));
        } catch (err: unknown) {
            setUsersError(err instanceof Error ? err.message : t("studio_users_load_failed"));
        } finally {
            setUsersLoading(false);
        }
    }, [requestJson, t]);

    const loadRoles = useCallback(async () => {
        setRolesLoading(true);
        setRolesError(null);
        try {
            const raw = await requestJson("/admin/roles");
            const arr = isRecord(raw) && Array.isArray(raw.roles) ? raw.roles : [];
            setRoles(arr.map(parseRole).filter((r): r is StoredRoleRow => r !== null));
        } catch (err: unknown) {
            setRolesError(err instanceof Error ? err.message : t("studio_users_roles_load_failed"));
        } finally {
            setRolesLoading(false);
        }
    }, [requestJson, t]);

    useEffect(() => {
        void loadUsers();
        void loadRoles();
    }, [loadUsers, loadRoles]);

    const filteredUsers = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return users;
        return users.filter((u) =>
            u.email.toLowerCase().includes(q)
            || (u.displayName ?? "").toLowerCase().includes(q)
            || u.roles.some((r) => r.toLowerCase().includes(q))
        );
    }, [users, search]);

    const openCreateUser = () => {
        setEditingUser(null);
        setUserEmail("");
        setUserPassword("");
        setUserDisplayName("");
        setUserRolesInput("");
        setUserDisabled(false);
        setUserDialogOpen(true);
    };

    const openEditUser = (u: AdminUserRow) => {
        setEditingUser(u);
        setUserEmail(u.email);
        setUserPassword("");
        setUserDisplayName(u.displayName ?? "");
        setUserRolesInput(u.roles.join(", "));
        setUserDisabled(u.disabled);
        setUserDialogOpen(true);
    };

    const handleSaveUser = async () => {
        setSavingUser(true);
        try {
            const parsedRoles = userRolesInput.split(",").map((s) => s.trim()).filter(Boolean);
            if (editingUser) {
                await requestJson(`/admin/users/${encodeURIComponent(editingUser.uid)}`, {
                    method: "PUT",
                    body: {
                        displayName: userDisplayName.trim() || undefined,
                        roles: parsedRoles,
                        disabled: userDisabled,
                        ...(userPassword.trim() ? { password: userPassword } : {})
                    }
                });
                snackbar.open({ type: "success", message: t("studio_users_user_updated", { email: editingUser.email }) });
            } else {
                await requestJson("/admin/users", {
                    method: "POST",
                    body: {
                        email: userEmail.trim(),
                        password: userPassword,
                        displayName: userDisplayName.trim() || undefined,
                        roles: parsedRoles
                    }
                });
                snackbar.open({ type: "success", message: t("studio_users_user_created", { email: userEmail.trim() }) });
            }
            setUserDialogOpen(false);
            await loadUsers();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_users_user_save_failed") });
        } finally {
            setSavingUser(false);
        }
    };

    const handleDeleteUser = async (u: AdminUserRow) => {
        try {
            await requestJson(`/admin/users/${encodeURIComponent(u.uid)}`, { method: "DELETE" });
            snackbar.open({ type: "success", message: t("studio_users_user_deleted", { email: u.email }) });
            await loadUsers();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_users_user_delete_failed") });
        }
    };

    const openCreateRole = () => {
        setEditingRoleName(null);
        setRoleName("");
        setRoleDescription("");
        setRoleScopes([]);
        setCustomScopeInput("");
        setRoleIsDefault(false);
        setRoleAssignable(true);
        setRoleDialogOpen(true);
    };

    const openEditRole = (r: StoredRoleRow) => {
        setEditingRoleName(r.name);
        setRoleName(r.name);
        setRoleDescription(r.description ?? "");
        setRoleScopes([...r.scopes]);
        setCustomScopeInput("");
        setRoleIsDefault(r.isDefault);
        setRoleAssignable(r.assignable);
        setRoleDialogOpen(true);
    };

    const toggleScope = (scope: string) => {
        setRoleScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);
    };

    const addCustomScope = () => {
        const s = customScopeInput.trim();
        if (!s) return;
        if (!roleScopes.includes(s)) {
            setRoleScopes((prev) => [...prev, s]);
        }
        setCustomScopeInput("");
    };

    const handleSaveRole = async () => {
        const targetName = (editingRoleName ?? roleName).trim();
        if (!targetName) return;
        setSavingRole(true);
        try {
            if (editingRoleName) {
                await requestJson(`/admin/roles/${encodeURIComponent(editingRoleName)}`, {
                    method: "PUT",
                    body: {
                        description: roleDescription.trim() || null,
                        scopes: roleScopes,
                        isDefault: roleIsDefault,
                        assignable: roleAssignable
                    }
                });
                snackbar.open({ type: "success", message: t("studio_users_role_updated", { name: editingRoleName }) });
            } else {
                await requestJson("/admin/roles", {
                    method: "POST",
                    body: {
                        name: targetName,
                        description: roleDescription.trim() || null,
                        scopes: roleScopes,
                        isDefault: roleIsDefault,
                        assignable: roleAssignable
                    }
                });
                snackbar.open({ type: "success", message: t("studio_users_role_created", { name: targetName }) });
            }
            setRoleDialogOpen(false);
            await loadRoles();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_users_role_save_failed") });
        } finally {
            setSavingRole(false);
        }
    };

    const handleDeleteRole = async (name: string) => {
        try {
            await requestJson(`/admin/roles/${encodeURIComponent(name)}`, { method: "DELETE" });
            snackbar.open({ type: "success", message: t("studio_users_role_deleted", { name }) });
            await loadRoles();
        } catch (err: unknown) {
            snackbar.open({ type: "error", message: err instanceof Error ? err.message : t("studio_users_role_delete_failed") });
        }
    };

    return (
        <div className="flex flex-col h-full w-full bg-surface-sheet overflow-hidden">
            <div className={cls("px-5 py-3 border-b flex items-center justify-between gap-4", defaultBorderMixin)}>
                <div className="flex items-center gap-2.5">
                    <UsersIcon size={iconSize.medium} className={"text-text-secondary"} />
                    <div>
                        <Typography variant="h6">{t("studio_tool_users")}</Typography>
                        <Typography variant="caption" color="secondary">
                            {t("studio_users_subtitle")}
                        </Typography>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("refresh")} onClick={() => { void loadUsers(); void loadRoles(); }}>
                            <RefreshCwIcon size={iconSize.small} />
                        </IconButton>
                    </Tooltip>
                    {tab === "users" ? (
                        <Button size="small" variant="filled" onClick={openCreateUser}>
                            <PlusIcon size={iconSize.small} />
                            {t("create_user")}
                        </Button>
                    ) : (
                        <Button size="small" variant="filled" onClick={openCreateRole}>
                            <PlusIcon size={iconSize.small} />
                            {t("studio_users_new_role")}
                        </Button>
                    )}
                </div>
            </div>

            <Tabs
                value={tab}
                onValueChange={(v) => { if (v === "users" || v === "roles") setTab(v); }}
                variant="boxy"
                className="border-b border-hairline px-4"
            >
                <Tab value="users">{t("studio_users_tab_users", { count: users.length })}</Tab>
                <Tab value="roles">{t("studio_users_tab_roles", { count: roles.length })}</Tab>
            </Tabs>

            <div className="flex-1 overflow-auto p-5">
                {tab === "users" && (
                    <div className="flex flex-col gap-4">
                        <div className="max-w-sm">
                            <SearchBar
                                onTextSearch={(v) => setSearch(v ?? "")}
                                placeholder={t("studio_users_search_placeholder")}
                                innerClassName="w-full"
                            />
                        </div>

                        {usersError && <Alert color="error">{usersError}</Alert>}

                        {usersLoading ? (
                            <div className="flex justify-center py-12"><CircularProgress size="small" /></div>
                        ) : filteredUsers.length === 0 ? (
                            <Card className="p-8 text-center flex flex-col items-center gap-3">
                                <Typography variant="body2" color="secondary">
                                    {t("studio_users_empty")}
                                </Typography>
                                <Button size="small" variant="filled" onClick={openCreateUser}>
                                    <PlusIcon size={iconSize.small} />
                                    {t("create_user")}
                                </Button>
                            </Card>
                        ) : (
                            <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                                <Table className="w-full">
                                    <TableHeader>
                                            <TableCell header>{t("email")}</TableCell>
                                            <TableCell header>{t("display_name")}</TableCell>
                                            <TableCell header>{t("roles")}</TableCell>
                                            <TableCell header>{t("studio_cron_status")}</TableCell>
                                            <TableCell header className="text-right">{t("actions")}</TableCell>
                                        </TableHeader>
                                    <TableBody>
                                        {filteredUsers.map((u) => (
                                            <TableRow key={u.uid}>
                                                <TableCell className="font-mono text-sm">{u.email}</TableCell>
                                                <TableCell className="text-sm text-text-secondary">{u.displayName ?? "—"}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-1 flex-wrap">
                                                        {u.roles.length === 0 ? (
                                                            <Typography variant="caption" color="secondary">{t("studio_users_no_roles")}</Typography>
                                                        ) : u.roles.map((r) => (
                                                            <Chip key={r} size="small" colorScheme={r === "admin" ? "purpleLight" : "blueLight"}>
                                                                {r}
                                                            </Chip>
                                                        ))}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Chip size="small" colorScheme={u.disabled ? "redLight" : "greenLight"}>
                                                        {u.disabled ? t("disabled") : t("studio_users_status_active")}
                                                    </Chip>
                                                </TableCell>
                                                <TableCell className="text-right whitespace-nowrap">
                                                    <IconButton size="small" aria-label={t("studio_users_edit_user_aria", { email: u.email })} onClick={() => openEditUser(u)}>
                                                        <PencilIcon size={iconSize.small} />
                                                    </IconButton>
                                                    <IconButton size="small" aria-label={t("studio_users_delete_user_aria", { email: u.email })} onClick={() => void handleDeleteUser(u)}>
                                                        <Trash2Icon size={iconSize.small} className={"text-red-500"} />
                                                    </IconButton>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                )}

                {tab === "roles" && (
                    <div className="flex flex-col gap-4">
                        {rolesError && <Alert color="error">{rolesError}</Alert>}

                        {rolesLoading ? (
                            <div className="flex justify-center py-12"><CircularProgress size="small" /></div>
                        ) : roles.length === 0 ? (
                            <Card className="p-8 text-center flex flex-col items-center gap-3">
                                <ShieldIcon className="w-8 h-8 text-text-disabled" />
                                <Typography variant="body2" color="secondary">
                                    {t("studio_users_roles_empty")}
                                </Typography>
                                <Button size="small" variant="filled" onClick={openCreateRole}>
                                    <PlusIcon size={iconSize.small} />
                                    {t("studio_users_new_role")}
                                </Button>
                            </Card>
                        ) : (
                            <div className={cls("overflow-x-auto rounded-lg border", defaultBorderMixin)}>
                                <Table className="w-full">
                                    <TableHeader>
                                            <TableCell header>{t("role")}</TableCell>
                                            <TableCell header>{t("description")}</TableCell>
                                            <TableCell header>{t("studio_api_keys_scopes")}</TableCell>
                                            <TableCell header className="text-right">{t("actions")}</TableCell>
                                        </TableHeader>
                                    <TableBody>
                                        {roles.map((r) => (
                                            <TableRow key={r.name}>
                                                <TableCell className="font-mono text-sm font-medium whitespace-nowrap">
                                                    <div className="flex items-center gap-1.5">
                                                        <span>{r.name}</span>
                                                        {r.isDefault && <Chip size="small" colorScheme="greenLight">{t("studio_users_default_role_chip")}</Chip>}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-sm text-text-secondary">{r.description ?? "—"}</TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-1 flex-wrap">
                                                        {r.scopes.length === 0 ? (
                                                            <Typography variant="caption" color="secondary">{t("studio_users_no_scopes")}</Typography>
                                                        ) : r.scopes.map((s) => (
                                                            <Chip key={s} size="small" colorScheme="grayLight">{s}</Chip>
                                                        ))}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right whitespace-nowrap">
                                                    {r.source !== "built-in" && (
                                                        <IconButton size="small" aria-label={t("studio_users_edit_role_aria", { name: r.name })} onClick={() => openEditRole(r)}>
                                                            <PencilIcon size={iconSize.small} />
                                                        </IconButton>
                                                    )}
                                                    {r.source === "database" && r.name !== "admin" && (
                                                        <IconButton size="small" aria-label={t("studio_users_delete_role_aria", { name: r.name })} onClick={() => void handleDeleteRole(r.name)}>
                                                            <Trash2Icon size={iconSize.small} className={"text-red-500"} />
                                                        </IconButton>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* User Dialog */}
            <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen} maxWidth="md" fullWidth>
                <DialogTitle>{editingUser ? t("studio_users_edit_user_title", { email: editingUser.email }) : t("create_user")}</DialogTitle>
                <DialogContent className="flex flex-col gap-3">
                    <TextField
                        label={t("email")}
                        value={userEmail}
                        disabled={Boolean(editingUser)}
                        onChange={(e) => setUserEmail(e.target.value)}
                        placeholder="user@example.com"
                    />
                    <TextField
                        label={editingUser ? t("studio_users_new_password_label") : t("auth_password")}
                        type="password"
                        value={userPassword}
                        onChange={(e) => setUserPassword(e.target.value)}
                    />
                    <TextField
                        label={t("display_name")}
                        value={userDisplayName}
                        onChange={(e) => setUserDisplayName(e.target.value)}
                    />
                    <TextField
                        label={t("studio_roles_comma_separated")}
                        value={userRolesInput}
                        onChange={(e) => setUserRolesInput(e.target.value)}
                        placeholder="admin, support"
                    />
                    {editingUser && (
                        <BooleanSwitchWithLabel
                            label={t("studio_users_disable_account")}
                            value={userDisabled}
                            onValueChange={setUserDisabled}
                        />
                    )}
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setUserDialogOpen(false)}>{t("cancel")}</Button>
                    <Button
                        variant="filled"
                        disabled={savingUser || (!editingUser && (!userEmail.trim() || !userPassword))}
                        onClick={() => void handleSaveUser()}
                    >
                        {savingUser ? t("saving") : (editingUser ? t("studio_save_changes") : t("create_user"))}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Role Dialog */}
            <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen} maxWidth="lg" fullWidth>
                <DialogTitle>{editingRoleName ? t("studio_users_edit_role_title", { name: editingRoleName }) : t("studio_users_new_role")}</DialogTitle>
                <DialogContent className="flex flex-col gap-4">
                    <TextField
                        label={t("role_name")}
                        value={roleName}
                        disabled={Boolean(editingRoleName)}
                        onChange={(e) => setRoleName(e.target.value)}
                        placeholder="support"
                    />
                    <TextField
                        label={t("description")}
                        value={roleDescription}
                        onChange={(e) => setRoleDescription(e.target.value)}
                        placeholder={t("studio_users_role_description_placeholder")}
                    />
                    <div className="flex flex-col gap-2">
                        <Typography variant="subtitle2">{t("studio_users_builtin_scopes")}</Typography>
                        <div className="flex flex-wrap gap-1.5">
                            {BUILT_IN_SCOPES.map((scope) => {
                                const selected = roleScopes.includes(scope);
                                return (
                                    <Chip
                                        key={scope}
                                        size="small"
                                        colorScheme={selected ? "blueLight" : "grayLight"}
                                        onClick={() => toggleScope(scope)}
                                    >
                                        {scope}
                                    </Chip>
                                );
                            })}
                        </div>
                    </div>
                    <div className="flex items-end gap-2">
                        <div className="flex-1">
                            <TextField
                                label={t("studio_users_custom_scope_label")}
                                value={customScopeInput}
                                onChange={(e) => setCustomScopeInput(e.target.value)}
                                placeholder="billing:refund"
                            />
                        </div>
                        <Button variant="outlined" onClick={addCustomScope}>{t("add")}</Button>
                    </div>
                    {roleScopes.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {roleScopes.map((scope) => (
                                <Chip key={scope} size="small" colorScheme="purpleLight" onClick={() => toggleScope(scope)}>
                                    {scope} ×
                                </Chip>
                            ))}
                        </div>
                    )}
                    <BooleanSwitchWithLabel
                        label={t("studio_users_default_role_label")}
                        value={roleIsDefault}
                        onValueChange={setRoleIsDefault}
                    />
                    <BooleanSwitchWithLabel
                        label={t("studio_users_assignable_label")}
                        value={roleAssignable}
                        onValueChange={setRoleAssignable}
                    />
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setRoleDialogOpen(false)}>{t("cancel")}</Button>
                    <Button
                        variant="filled"
                        disabled={savingRole || !(editingRoleName ?? roleName).trim()}
                        onClick={() => void handleSaveRole()}
                    >
                        {savingRole ? t("saving") : t("studio_users_save_role")}
                    </Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}
