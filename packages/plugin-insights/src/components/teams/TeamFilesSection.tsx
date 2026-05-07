import { Button, CircularProgress, cls, IconButton, Paper, Table, TableBody, TableCell, TableRow, Typography } from "@rebasepro/ui";
import { Database as StorageIcon, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { useDataki } from "../../DatakiProvider";
import { ApiError, deleteTeamFile, listTeamFiles, TeamFileRecord } from "../../api";
import FileUploadButton from "../files/FileUploadButton";
import { AnimateHeight } from "../AnimateHeight";
import { getDataSourceIcon } from "../DataSourceLabel";

interface TeamFilesSectionProps {
    teamId: string;
    className?: string;
    onAnalyticsEvent?: (event: string, params?: any) => void;
    onUploadSuccess?: (createdFiles: TeamFileRecord[]) => void;
}

export const TeamFilesSection: React.FC<TeamFilesSectionProps> = ({
    teamId,
    className,
    onAnalyticsEvent,
    onUploadSuccess
}) => {
    const dataki = useDataki();
    const apiEndpoint = dataki.apiEndpoint;

    const [files, setFiles] = useState<TeamFileRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadFiles = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const token = await dataki.getDatakiAuthToken();
            const list = await listTeamFiles(token, apiEndpoint, teamId);
            setFiles(list);
        } catch (e: any) {
            console.error("Error listing team files", e);
            setError(e instanceof ApiError ? e.message : "Failed to load files");
            setFiles([]);
        } finally {
            setLoading(false);
        }
    }, [apiEndpoint, dataki, teamId]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    const handleDelete = async (file: TeamFileRecord) => {
        setDeletingId(file.id);
        setError(null);
        onAnalyticsEvent?.("team_files_delete_initiated", {
            team_id: teamId,
            file_id: file.id
        });
        try {
            const token = await dataki.getDatakiAuthToken();
            await deleteTeamFile(token, apiEndpoint, teamId, file.id);
            setFiles(prev => prev.filter(f => f.id !== file.id));
            onAnalyticsEvent?.("team_files_delete_success", {
                team_id: teamId,
                file_id: file.id
            });
        } catch (e: any) {
            console.error("Error deleting file", e);
            setError(e instanceof ApiError ? e.message : "Failed to delete file");
            onAnalyticsEvent?.("team_files_delete_error", {
                team_id: teamId,
                file_id: file.id,
                error: e?.message
            });
        } finally {
            setDeletingId(null);
        }
    };

    const hasData = files.length > 0;

    return (
        <div className={cls("w-full space-y-2", className)}>
            <div className="flex justify-between items-center gap-4">
                <Typography variant="subtitle2" className="flex-1">Files</Typography>
                <div className="flex items-center gap-2">
                    {uploading && <span className="text-xs text-gray-500 flex items-center gap-1"><CircularProgress
                        size="smallest" /> Uploading...</span>}
                    <Button size="small" variant="text" disabled={loading || uploading}
                        onClick={loadFiles}>Refresh</Button>
                </div>
            </div>

            {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}

            {!loading && hasData && <Paper className="overflow-hidden">
                <Table className="w-full rounded-lg overflow-hidden">
                    <TableBody>
                        {files.map(file => {
                            const sizeKB = (file.size / 1024).toFixed(1) + " KB";
                            // Create a FileDataSource-like object to get the icon
                            const fileDataSource = {
                                type: "file" as const,
                                id: file.id,
                                name: file.name,
                                originalName: file.originalName,
                                size: file.size,
                                mimeType: file.mimeType,
                                uploadedAt: file.uploadedAt,
                                uploaderId: file.uploaderId
                            };
                            const icon = getDataSourceIcon(fileDataSource);

                            return (
                                <TableRow key={file.id} className="hover:bg-surface-50 dark:hover:bg-gray-800">
                                    <TableCell className="flex gap-6 items-center w-full">
                                        <div
                                            className="w-12 h-12 bg-surface-100 dark:bg-surface-800 p-3 rounded-xl flex items-center justify-center">
                                            {icon ? (
                                                <img
                                                    src={icon}
                                                    alt="File icon"
                                                    className="w-6 h-6"
                                                />
                                            ) : (
                                                <StorageIcon size="small" />
                                            )}
                                        </div>
                                        <div className="flex flex-col flex-1 min-w-0">
                                            <Typography variant="body1" className="font-medium truncate"
                                                title={file.name}>{file.name}</Typography>
                                            <Typography variant="caption" color="secondary" className="truncate"
                                                title={file.originalName}>{file.originalName}</Typography>
                                        </div>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Typography variant="caption">{sizeKB}</Typography>
                                        <Typography variant="caption"
                                            color="secondary">{new Date(file.uploadedAt).toLocaleString()}</Typography>
                                    </TableCell>
                                    <TableCell align="right" style={{ width: 64 }}>
                                        <IconButton
                                            size="smallest"
                                            color="error"
                                            onClick={() => handleDelete(file)}
                                            disabled={deletingId === file.id}
                                            title="Delete File"
                                        >
                                            {deletingId === file.id ? <CircularProgress size="small" /> :
                                                <Trash2 size="smallest" />}
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </Paper>}

            {((!loading && !hasData) || (loading && hasData)) && (
                <Paper className="overflow-hidden p-8 flex justify-center items-center">
                    {loading && !hasData && <CircularProgress />}
                    {!loading && !hasData && <Typography variant="body2" color="secondary">No files found</Typography>}
                </Paper>
            )}

            <div className="flex gap-2">
                <FileUploadButton
                    teamId={teamId}
                    onUploadingChange={setUploading}
                    onUploaded={(created) => {
                        setFiles(prev => [...created, ...prev]);
                        onUploadSuccess?.(created);
                    }}
                />
            </div>
        </div>
    );
};

export default TeamFilesSection;
