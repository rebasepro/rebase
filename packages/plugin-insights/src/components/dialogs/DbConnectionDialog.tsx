import React, { FormEvent } from "react";
import { DatabaseConnectionConfig } from "../../types";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, LoadingButton, TextField, Typography } from "@rebasepro/ui";
import { Database, AlertTriangle } from "lucide-react";
import { useDataki } from "../../DatakiProvider";
import { testDatabaseConnection } from "../../api";
import { useSnackbarController } from "@rebasepro/core";
import { ConnectPostgresButton } from "../databases/ConnectPostgresButton";
import { ConnectMySQLButton } from "../databases/ConnectMySQLButton";

export interface DbConnectionDialogProps {
    dialogOpen: boolean;
    setDialogOpen: (open: boolean) => void;
    editing: DatabaseConnectionConfig | null;
    form: Partial<DatabaseConnectionConfig>;
    setForm: (form: Partial<DatabaseConnectionConfig>) => void;
    saving: boolean;
    onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function DbConnectionDialog({
                                       dialogOpen,
                                       setDialogOpen,
                                       editing,
                                       form,
                                       setForm,
                                       saving,
                                       onSubmit
                                   }: DbConnectionDialogProps) {

    const datakiConfig = useDataki();
    const snackbarController = useSnackbarController();

    const [testInProgress, setTestInProgress] = React.useState(false);

    // Validation function to check if all required fields are filled
    const isFormValid = () => {
        const requiredFields = ['name', 'type', 'host', 'port', 'databaseName', 'user'];

        // Check if all required fields have values
        const allRequiredFieldsFilled = requiredFields.every(field => {
            const value = form[field as keyof DatabaseConnectionConfig];
            return value !== undefined && value !== null && value !== '';
        });

        // When creating a new connection, password is also required
        if (!editing) {
            return allRequiredFieldsFilled && form.password && form.password.trim() !== '';
        }

        // When editing, password can be empty (keeps current password)
        return allRequiredFieldsFilled;
    };

    const doDbTest = async () => {
        const accessToken = await datakiConfig.getDatakiAuthToken();
        setTestInProgress(true);
        testDatabaseConnection(accessToken, datakiConfig.apiEndpoint, form as DatabaseConnectionConfig)
            .then(() => {
                snackbarController.open({
                    type: "success",
                    message: "Database connection successful"
                })
            })
            .catch((error) => {
                snackbarController.open({
                    type: "error",
                    message: `Database connection failed: ${error.message}`
                });
            })
            .finally(() => setTestInProgress(false));
    }

    return (
        <Dialog
            maxWidth={"2xl"}
            open={dialogOpen}
            onOpenChange={(open: boolean) => {
                if (!saving) setDialogOpen(open);
            }}
        >
            <form onSubmit={onSubmit}>
                <DialogTitle className={"flex items-center gap-4"}>
                    <Database size={20}/>
                    {editing ? "Edit" : "New"} Database Connection
                </DialogTitle>
                <DialogContent className="space-y-4">

                    <div className="flex gap-2">

                        <ConnectPostgresButton selected={form.type === "postgresql"} onClick={() => setForm({
                            ...form,
                            type: "postgresql"
                        })}/>
                        <ConnectMySQLButton selected={form.type === "mysql"} onClick={() => setForm({
                            ...form,
                            type: "mysql"
                        })}/>

                    </div>

                    <Alert
                        color="base"
                        className={"text-sm flex items-center gap-1"} size={"medium"}><AlertTriangle size={16} className={"mr-4"}/>You might need to whitelist the IP <b>34.89.253.13</b></Alert>
                    <TextField
                        label="Connection Name"
                        required
                        autoFocus
                        value={form.name || ""}
                        onChange={(e) => setForm({
                            ...form,
                            name: e.target.value
                        })}
                    />
                    <TextField
                        label="Host"
                        required
                        size={"medium"}
                        value={form.host || ""}
                        onChange={(e) => setForm({
                            ...form,
                            host: e.target.value
                        })}
                    />
                    <TextField
                        label="Port"
                        type="number"
                        required
                        size={"medium"}
                        value={form.port?.toString() || ""}
                        onChange={(e) => setForm({
                            ...form,
                            port: parseInt(e.target.value, 10) || undefined
                        })}
                    />
                    <TextField
                        label="Database Name"
                        required
                        value={form.databaseName || ""}
                        size={"medium"}
                        onChange={(e) => setForm({
                            ...form,
                            databaseName: e.target.value
                        })}
                    />
                    <TextField
                        label="Username"
                        required
                        size={"medium"}
                        value={form.user || ""}
                        onChange={(e) => setForm({
                            ...form,
                            user: e.target.value
                        })}
                    />
                    <div>
                        <TextField
                            label="Password"
                            type="password"
                            required={!editing}
                            size={"medium"}
                            value={form.password || ""}
                            placeholder={editing ? "Leave blank to keep current password" : ""}
                            onChange={(e) => setForm({
                                ...form,
                                password: e.target.value
                            })}
                        />
                        {editing && <Typography variant="caption" color="secondary" className={"ml-3.5 mt-1"}>
                            Leave blank to keep current password
                        </Typography>}
                        <Typography variant="caption" color="secondary" className={"ml-3.5 mt-1"}>
                            Your password will be encrypted both in transit and at rest.
                        </Typography>
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button type="button" variant="text" onClick={() => setDialogOpen(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <LoadingButton loading={testInProgress}
                                   type="button" variant="text" onClick={doDbTest} disabled={saving || !isFormValid()}>
                        Test connection
                    </LoadingButton>
                    <LoadingButton type="submit" loading={saving} disabled={saving || !isFormValid()} variant="filled">
                        Save Connection
                    </LoadingButton>
                </DialogActions>
            </form>
        </Dialog>
    );
}
