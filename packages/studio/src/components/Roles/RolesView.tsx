import React, { useCallback, useEffect, useState } from "react";
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
    ShieldIcon,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography
} from "@rebasepro/ui";
import { useSnackbarController, useTranslation } from "@rebasepro/app";
import { ADMIN_SCOPES } from "@rebasepro/types";
import {
    asBoolean,
    asNullableString,
    asString,
    asStringArray,
    isRecord,
    useAdminFetch
} from "../../utils/adminFetch";

/**
 * The project's roles: the ones declared in code, read-only here, and the ones
 * made at runtime (`rebase.roles`), which this view creates, edits and deletes
 * through `/api/admin/roles`. A role is a name a user holds; which user holds
 * which is the users table's `roles` column, edited in its collection.
 */
interface StoredRoleRow {
    name: string;
    description: string | null;
    scopes: string[];
    isDefault: boolean;
    assignable: boolean;
    source: "built-in" | "code" | "database";
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

export function RolesView() {
    const { requestJson } = useAdminFetch();
    const snackbar = useSnackbarController();
    const { t } = useTranslation();

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
        void loadRoles();
    }, [loadRoles]);

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
                    <ShieldIcon size={iconSize.medium} className={"text-text-secondary"} />
                    <div>
                        <Typography variant="h6">{t("studio_tool_roles")}</Typography>
                        <Typography variant="caption" color="secondary">{t("studio_roles_header_description")}</Typography>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip title={t("refresh")}>
                        <IconButton size="small" aria-label={t("refresh")} onClick={() => { void loadRoles(); }}>
                            <RefreshCwIcon size={iconSize.small} />
                        </IconButton>
                    </Tooltip>
                    <Button size="small" color="primary" variant="filled" onClick={openCreateRole}>
                        <PlusIcon size={iconSize.small} />
                        {t("studio_users_new_role")}
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-auto p-5 bg-surface-card">
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
                                                        {r.source === "built-in" && <Chip size="small" colorScheme="grayLight">{t("studio_roles_source_builtin")}</Chip>}
                                                        {r.source === "code" && <Chip size="small" colorScheme="grayLight">{t("studio_roles_source_code")}</Chip>}
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
                                                    {/* A role declared in code is read-only: it changes in backend/schema. */}
                                                    {r.source === "database" && (
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
            </div>

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
                            {/* A role grants admin-plane and app scopes: every signed-in person holds the data plane already. */}
                            {ADMIN_SCOPES.map((scope) => {
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
