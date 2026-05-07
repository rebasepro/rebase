import { FormEvent, ReactNode, useState } from "react";
import { useDataki } from "../DatakiProvider";
import { createDbConnection, deleteDbConnection, updateDbConnection } from "../api";
import { DatabaseConnectionConfig } from "../types";
import { useSnackbarController } from "@rebasepro/core";
import { DbConnectionDialog } from "../components/dialogs/DbConnectionDialog";
import { DeleteDbConnectionDialog } from "../components/dialogs/DeleteDbConnectionDialog";

export interface UseDbConnectionDialogOptions {
    teamId: string;
    onConnectionsChange?: () => Promise<void>;
    onAnalyticsEvent?: (event: string, params?: any) => void;
}

export interface UseDbConnectionDialogResult {
    dialogOpen: boolean;
    setDialogOpen: (open: boolean) => void;
    editing: DatabaseConnectionConfig | null;
    form: Partial<DatabaseConnectionConfig>;
    setForm: (form: Partial<DatabaseConnectionConfig>) => void;
    saving: boolean;
    deletingId: string | null;
    showDeleteConfirm: DatabaseConnectionConfig | null;
    setShowDeleteConfirm: (connection: DatabaseConnectionConfig | null) => void;
    openDialog: (conn?: Partial<DatabaseConnectionConfig>) => void;
    handleFormSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
    handleDeleteConfirm: () => Promise<void>;
    DbConnectionDialogComponent: ReactNode;
    DeleteDbConnectionDialogComponent: ReactNode;
}

export function useDbConnectionDialog({
                                          teamId,
                                          onConnectionsChange,
                                          onAnalyticsEvent
                                      }: UseDbConnectionDialogOptions): UseDbConnectionDialogResult {
    const {
        getDatakiAuthToken,
        apiEndpoint
    } = useDataki();
    const snackbarController = useSnackbarController();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<DatabaseConnectionConfig | null>(null);
    const [form, setForm] = useState<Partial<DatabaseConnectionConfig>>({});
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<DatabaseConnectionConfig | null>(null);

    function openDialog(conn?: Partial<DatabaseConnectionConfig>) {
        onAnalyticsEvent?.("database_connection_form_opened", {
            team_id: teamId,
            is_edit: !!(conn?.id),
            connection_type: conn?.type || "postgresql"
        });

        if (conn && Object.keys(conn).length) {
            // Editing an existing connection or using a preset
            const connectionType = conn.type || "postgresql";

            setEditing(conn.id ? conn as DatabaseConnectionConfig : null);
            setForm({
                ...conn,
                type: connectionType,
                port: conn.port || (connectionType === "postgresql" ? 5432 : 3306),
                databaseName: conn.databaseName || (connectionType === "postgresql" ? "postgres" : "mysql"),
                user: conn.user || (connectionType === "postgresql" ? "postgres" : "root"),
                teamId: conn.teamId || teamId,
                password: "" // Clear password for editing, will be handled by placeholder/helper text
            });
        } else {
            // Creating a completely new connection with defaults
            setEditing(null);
            setForm({
                type: "postgresql",
                port: 5432,
                databaseName: "postgres",
                user: "postgres",
                teamId,
                password: "",
            });
        }
        setDialogOpen(true);
    }

    async function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (saving) return;
        setSaving(true);
        const token = await getDatakiAuthToken();

        const isEdit = editing && editing.id;

        onAnalyticsEvent?.(isEdit ? "database_connection_update_initiated" : "database_connection_create_initiated", {
            team_id: teamId,
            connection_type: form.type,
            connection_id: editing?.id
        });

        try {
            const payload = { ...form };
            if (isEdit) {
                await updateDbConnection(teamId, editing.id, payload as Partial<DatabaseConnectionConfig>, token, apiEndpoint);

                onAnalyticsEvent?.("database_connection_updated", {
                    team_id: teamId,
                    connection_type: form.type,
                    connection_id: editing.id
                });

                snackbarController.open({
                    type: "success",
                    message: "Connection updated."
                });
            } else {
                const newConnection = await createDbConnection(teamId, payload as DatabaseConnectionConfig, token, apiEndpoint);

                onAnalyticsEvent?.("database_connection_created", {
                    team_id: teamId,
                    connection_type: form.type,
                    connection_id: newConnection?.id
                });

                snackbarController.open({
                    type: "success",
                    message: "Connection created."
                });
            }
            if (onConnectionsChange) {
                await onConnectionsChange();
            }
            setDialogOpen(false);
        } catch (error: any) {
            onAnalyticsEvent?.(isEdit ? "database_connection_update_error" : "database_connection_create_error", {
                team_id: teamId,
                connection_type: form.type,
                error: error.message || "Failed to save connection"
            });

            console.error("Error saving connection:", error);
            snackbarController.open({
                type: "error",
                message: error.message || "Error saving connection."
            });
        } finally {
            setSaving(false);
        }
    }

    async function handleDeleteConfirm() {
        if (!showDeleteConfirm?.id) return;
        setDeletingId(showDeleteConfirm.id);

        onAnalyticsEvent?.("database_connection_delete_initiated", {
            team_id: teamId,
            connection_type: showDeleteConfirm.type,
            connection_id: showDeleteConfirm.id
        });

        try {
            const token = await getDatakiAuthToken();
            await deleteDbConnection(teamId, showDeleteConfirm.id, token, apiEndpoint);

            onAnalyticsEvent?.("database_connection_deleted", {
                team_id: teamId,
                connection_type: showDeleteConfirm.type,
                connection_id: showDeleteConfirm.id
            });

            snackbarController.open({
                type: "success",
                message: "Connection deleted."
            });

            if (onConnectionsChange) {
                await onConnectionsChange();
            }
            setShowDeleteConfirm(null);
        } catch (error: any) {
            onAnalyticsEvent?.("database_connection_delete_error", {
                team_id: teamId,
                connection_id: showDeleteConfirm.id,
                error: error.message || "Failed to delete connection"
            });

            console.error("Error deleting connection:", error);
            snackbarController.open({
                type: "error",
                message: error.message || "Error deleting connection."
            });
        } finally {
            setDeletingId(null);
        }
    }

    // Create the dialog component instances with all needed props
    const DbConnectionDialogComponent = (
        <DbConnectionDialog
            dialogOpen={dialogOpen}
            setDialogOpen={setDialogOpen}
            editing={editing}
            form={form}
            setForm={setForm}
            saving={saving}
            onSubmit={handleFormSubmit}
        />
    );

    const DeleteDbConnectionDialogComponent = (
        <DeleteDbConnectionDialog
            showDeleteConfirm={showDeleteConfirm}
            setShowDeleteConfirm={setShowDeleteConfirm}
            deletingId={deletingId}
            onDeleteConfirm={handleDeleteConfirm}
        />
    );

    return {
        dialogOpen,
        setDialogOpen,
        editing,
        form,
        setForm,
        saving,
        deletingId,
        showDeleteConfirm,
        setShowDeleteConfirm,
        openDialog,
        handleFormSubmit,
        handleDeleteConfirm,
        DbConnectionDialogComponent,
        DeleteDbConnectionDialogComponent
    };
}
