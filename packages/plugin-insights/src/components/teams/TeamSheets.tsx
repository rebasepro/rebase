import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LoadingButton, Paper, Table, TableBody, TableCell, TableRow, Typography } from "@rebasepro/ui";
import { Plus, Trash2 } from "lucide-react";
import React, { useState } from "react";
import { deleteSheet } from "../../api";
import { GoogleSheetsDataSource, Team } from "../../types";
import { useDataki } from "../../DatakiProvider";
import GoogleSheetsLogo from "../images/google_sheets_logo.svg";
import { AnimateHeight } from "../AnimateHeight";
import { useAuthController, useSnackbarController } from "@rebasepro/core";
import { User as FirebaseUser } from "@firebase/auth";
import { DatakiAuthController } from "../../hooks/useDatakiAuthController";
import { GoogleSheetsPicker } from "../GoogleSheetsPicker";

interface TeamSheetsProps {
    team: Team;
    onAnalyticsEvent?: (event: string, params?: any) => void;
}

export function TeamSheets({
                               team,
                               onAnalyticsEvent
                           }: TeamSheetsProps) {
    const {
        apiEndpoint,
        getDatakiAuthToken
    } = useDataki();

    const datakiConfig = useDataki();
    const authController = useAuthController<FirebaseUser, DatakiAuthController>();

    const snackbar = useSnackbarController();
    // const [sheets, setSheets] = useState<GoogleSheetsDataSource[]>([]);

    const [pickerOpen, setPickerOpen] = useState(false);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState<GoogleSheetsDataSource | null>(null);
    const [loading, setLoading] = useState(false);

    const sheets = (team.dataSources ?? []).filter(ds => ds.type === "google_sheets") as GoogleSheetsDataSource[];

    const handleAdd = () => {
        setPickerOpen(true);
        // Log analytics event
        onAnalyticsEvent?.("sheet_add_dialog_opened", {
            team_id: team.id
        });
    };

    const handleDeleteClick = (sheet: GoogleSheetsDataSource) => {
        setDeleteDialogOpen(sheet);

        // Log analytics event
        onAnalyticsEvent?.("sheet_delete_dialog_opened", {
            team_id: team.id,
            sheet_id: sheet.id
        });
    };

    const handleDelete = async (sheet:GoogleSheetsDataSource) => {
        if (!sheet) return;
        setLoading(true);
        const teamId = team.id;
        try {
            const token = await getDatakiAuthToken();
            await deleteSheet(teamId, sheet.id, token, apiEndpoint);
            snackbar.open({
                type: "success",
                message: "Sheet deleted successfully."
            });

            // Log analytics event
            onAnalyticsEvent?.("sheet_deleted", {
                team_id: teamId,
                sheet_id: sheet.id,
                sheet_name: sheet.title
            });
            setDeleteDialogOpen(null);

        } catch (error) {
            console.error("Error deleting sheet:", error);
            snackbar.open({
                type: "error",
                message: "Failed to delete sheet."
            });

            // Log analytics event for error
            onAnalyticsEvent?.("sheet_delete_error", {
                team_id: teamId,
                sheet_id: sheet.id,
                error: "Failed to delete sheet"
            });
        } finally {
            setLoading(false);
        }
    };

    const handleCloseDialog = () => {
        setPickerOpen(false);
    };

    const hasData = sheets.length > 0;

    return (
        <div className="w-full space-y-2">
            <div className="flex justify-between items-center gap-4">
                <Typography variant="subtitle2" className={"flex-1"}>Google Sheets</Typography>
                <Button variant="filled" color="neutral" size={"small"} startIcon={<Plus/>} onClick={handleAdd}>
                    Add Sheet
                </Button>
            </div>

            <AnimateHeight isOpen={hasData}>
                <Paper className="overflow-hidden">
                    <Table className={"w-full rounded-lg overflow-hidden"}>
                        <TableBody>
                            {sheets.map(sheet => (
                                <TableRow key={sheet.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-4">
                                            <div
                                                className="w-12 h-12 bg-surface-100 dark:bg-surface-800 p-2 rounded-xl flex items-center justify-center">
                                                <img src={GoogleSheetsLogo} alt="Google Sheets icon"
                                                     className="w-8 h-8"/>
                                            </div>
                                            <div>
                                                <Typography variant="body1"
                                                            className="font-semibold">{sheet.title}</Typography>
                                                <Typography variant="body2">
                                                    {sheet.spreadsheetId}
                                                </Typography>
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell align="right">
                                        <IconButton
                                            size={"smallest"}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteClick(sheet);
                                            }}>
                                            <Trash2
                                                size={"smallest"}/>
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Paper>
            </AnimateHeight>

            <AnimateHeight isOpen={!hasData}>
                <Paper className="overflow-hidden p-8 flex justify-center items-center">
                    <Typography variant="body2" color="secondary">No Google Sheets are currently linked to this
                        team.</Typography>
                </Paper>
            </AnimateHeight>

            <GoogleSheetsPicker
                open={pickerOpen}
                onClose={handleCloseDialog}
                teamId={team.id}
                onAnalyticsEvent={onAnalyticsEvent}
            />

            <Dialog open={Boolean(deleteDialogOpen)} onOpenChange={() => setDeleteDialogOpen(null)}>
                <DialogTitle>Delete Sheet</DialogTitle>
                <DialogContent>
                    <Typography>Are you sure you want to delete "{deleteDialogOpen?.title}"?</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteDialogOpen(null)} variant={"text"} color={"neutral"}>Cancel</Button>
                    <LoadingButton onClick={() => handleDelete(deleteDialogOpen!)}
                                   loading={loading}>
                        Delete
                    </LoadingButton>
                </DialogActions>
            </Dialog>

        </div>
    );
}
