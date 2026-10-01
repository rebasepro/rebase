
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
    ArrowLeftIcon,
    Button,
    Checkbox,
    CheckIcon,
    Chip,
    CircularProgress,
    cls,
    CopyIcon,
    defaultBorderMixin,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    DownloadIcon,
    FileIcon,
    FileTextIcon,
    FileUpload,
    FolderIcon,
    FolderPlusIcon,
    HomeIcon,
    IconButton,
    iconSize,
    ImageIcon,
    LayoutGridIcon,
    ListIcon,
    LoadingButton,
    Music2Icon,
    PlusIcon,
    RefreshCwIcon,
    ResizablePanels,
    Select,
    SelectItem,
    TextField,
    Tooltip,
    Trash2Icon,
    Typography,
    UploadCloudIcon,
    VideoIcon,
    XIcon
} from "@rebasepro/ui";
import { useStorageSource, useStorageSources, useSnackbarController, ErrorView, useApiBase, useApiConfig, useTranslation } from "@rebasepro/app";
import { DEFAULT_STORAGE_SOURCE_KEY, type StorageListResult } from "@rebasepro/types";
import { classifyLoadFailure, type LoadFailure } from "../load-failure";
import { useSearchParams } from "react-router";
import { useDropzone } from "react-dropzone";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface StorageFile {
    name: string;
    fullPath: string;
    isFolder: boolean;
    /** Only populated when metadata is fetched */
    size?: number;
    contentType?: string;
    downloadUrl?: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * The query parameter holding the folder being browsed.
 *
 * Namespaced because Studio does not always own the URL it renders under: the
 * SaaS console embeds this view in a page that keeps its own state in `?tab=`
 * and `?sub=`, and a bare `path` is a name any host app might already be using.
 */
const STORAGE_PATH_PARAM = "storagePath";

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileIcon(contentType?: string) {
    if (!contentType) return FileTextIcon;
    if (contentType.startsWith("image/")) return ImageIcon;
    if (contentType.startsWith("video/")) return VideoIcon;
    if (contentType.startsWith("audio/")) return Music2Icon;
    return FileTextIcon;
}

function getExtension(name: string): string {
    const parts = name.split(".");
    return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
}

function breadcrumbSegments(path: string, rootLabel: string): { label: string; path: string }[] {
    if (!path || path === "/") return [{ label: rootLabel,
path: "" }];
    const parts = path.split("/").filter(Boolean);
    const segments = [{ label: rootLabel,
path: "" }];
    let accumulated = "";
    for (const part of parts) {
        accumulated = accumulated ? `${accumulated}/${part}` : part;
        segments.push({ label: part,
path: accumulated });
    }
    return segments;
}

// ──────────────────────────────────────────────
// Upload Dialog
// ──────────────────────────────────────────────

function UploadDialog({
    open,
    currentPath,
    onClose,
    onUpload
}: {
    open: boolean;
    currentPath: string;
    onClose: () => void;
    onUpload: (files: File[]) => Promise<void>;
}) {
    const { t } = useTranslation();
    const [uploading, setUploading] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [error, setError] = useState<string | null>(null);

    const handleFilesAdded = useCallback((files: File[]) => {
        setSelectedFiles(prev => [...prev, ...files]);
    }, []);

    const handleRemoveFile = useCallback((index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    }, []);

    const handleUpload = useCallback(async () => {
        if (selectedFiles.length === 0) return;
        setUploading(true);
        setError(null);
        try {
            await onUpload(selectedFiles);
            setSelectedFiles([]);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : t("studio_storage_upload_failed"));
        } finally {
            setUploading(false);
        }
    }, [selectedFiles, onUpload, onClose, t]);

    const handleClose = useCallback(() => {
        if (!uploading) {
            setSelectedFiles([]);
            setError(null);
            onClose();
        }
    }, [uploading, onClose]);

    return (
        <Dialog open={open} onOpenChange={(o) => !o && handleClose()} maxWidth="md">
            <DialogTitle>
                {t("studio_storage_upload_dialog_title")}
                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark mt-0.5 block">
                    {t("studio_storage_upload_to")} <span className="font-mono text-primary">/{currentPath || t("studio_storage_root_folder")}</span>
                </Typography>
            </DialogTitle>
            <DialogContent className="space-y-4">
                <FileUpload
                    onFilesAdded={handleFilesAdded}
                    size="large"
                    uploadDescription={
                        <div className="flex flex-col items-center justify-center pointer-events-none">
                            <UploadCloudIcon className="text-surface-accent-400 mb-2 w-8 h-8"/>
                            <Typography variant="label">
                                {t("studio_storage_drop_or_browse")}
                            </Typography>
                            <Typography variant="caption" color="secondary">
                                {t("studio_storage_any_file_type")}
                            </Typography>
                        </div>
                    }
                />

                {error && (
                    <Typography variant="caption" className="text-red-500 block whitespace-pre-line">
                        {error}
                    </Typography>
                )}

                {selectedFiles.length > 0 && (
                    <div className="space-y-2">
                        <Typography variant="caption" color="secondary">
                            {t("studio_storage_selected_files", { count: selectedFiles.length })}
                        </Typography>
                        <div className="max-h-40 overflow-auto space-y-1">
                            {selectedFiles.map((file, index) => (
                                <div
                                    key={`${file.name}-${index}`}
                                    className="flex items-center justify-between p-2 rounded bg-surface-raised"
                                >
                                    <div className="flex-1 min-w-0 mr-2">
                                        <Typography variant="body2" className="truncate">
                                            {file.name}
                                        </Typography>
                                        <Typography variant="caption" color="secondary">
                                            {formatFileSize(file.size)}
                                        </Typography>
                                    </div>
                                    <IconButton
                                        size="small"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveFile(index);
                                        }}
                                        disabled={uploading}
                                    >
                                        <XIcon size={14}/>
                                    </IconButton>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </DialogContent>

            <DialogActions>
                <Button variant="text" onClick={handleClose} disabled={uploading}>
                    {t("studio_storage_cancel")}
                </Button>
                <Button
                    variant="filled"
                    onClick={handleUpload}
                    disabled={selectedFiles.length === 0 || uploading}
                    startIcon={uploading ? <CircularProgress size="smallest"/> : <UploadCloudIcon size={14}/>}
                >
                    {uploading
                        ? t("studio_storage_uploading")
                        : selectedFiles.length > 0
                            ? t("studio_storage_upload_count", { count: selectedFiles.length })
                            : t("studio_storage_upload")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

// ──────────────────────────────────────────────
// FileIcon preview panel
// ──────────────────────────────────────────────

function FilePreviewPanel({
    file,
    onClose,
    onDelete,
    downloadUrl
}: {
    file: StorageFile;
    onClose: () => void;
    onDelete: () => void;
    downloadUrl: string | null;
}) {
    const { t } = useTranslation();
    const isImage = file.contentType?.startsWith("image/");
    const isVideo = file.contentType?.startsWith("video/");
    const isAudio = file.contentType?.startsWith("audio/");
    const FileIconComponent = getFileIcon(file.contentType);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [urlCopied, setUrlCopied] = useState(false);

    return (
        <>
            <div className={cls(
                "flex flex-col h-full border-l",
                defaultBorderMixin,
                "bg-surface-card"
            )}>
                {/* Header */}
                <div className={cls("flex items-center justify-between p-3 border-b shrink-0", defaultBorderMixin)}>
                    <Typography variant="body2" className="font-medium truncate flex-1 mr-2">
                        {file.name}
                    </Typography>
                    <div className="flex items-center gap-0.5">
                        {downloadUrl && (
                            <Tooltip title={t("studio_storage_download")}>
                                <IconButton
                                    size="small"
                                    onClick={() => window.open(downloadUrl, "_blank")}
                                >
                                    <DownloadIcon size={iconSize.smallest}/>
                                </IconButton>
                            </Tooltip>
                        )}
                        <Tooltip title={t("studio_storage_delete")}>
                            <IconButton
                                size="small"
                                onClick={() => setDeleteDialogOpen(true)}
                                className="text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            >
                                <Trash2Icon size={iconSize.smallest}/>
                            </IconButton>
                        </Tooltip>
                        <IconButton size="small" onClick={onClose}>
                            <XIcon size={iconSize.smallest}/>
                        </IconButton>
                    </div>
                </div>

                {/* Preview */}
                <div className="flex-1 overflow-auto">
                    <div className={cls("flex flex-col items-center justify-center min-h-[200px] p-4 bg-surface-sheet border-b", defaultBorderMixin)}>
                        {(() => {
                            const ext = getExtension(file.name)?.toLowerCase() || "";
                            const isImage = file.contentType?.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext);
                            const isVideo = file.contentType?.startsWith("video/") || ["mp4", "webm", "ogg", "mov"].includes(ext);
                            const isAudio = file.contentType?.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a"].includes(ext);
                            const downloadUrl = file.downloadUrl;

                            if (isImage && downloadUrl) {
                                return (
                                    <img
                                        src={downloadUrl}
                                        alt={file.name}
                                        className="max-w-full max-h-[400px] object-contain rounded-md shadow-sm"
                                    />
                                );
                            } else if (isVideo && downloadUrl) {
                                return (
                                    <video
                                        src={downloadUrl}
                                        className="max-w-full max-h-[400px] rounded-md"
                                        controls
                                    />
                                );
                            } else if (isAudio && downloadUrl) {
                                return (
                                    <div className="flex flex-col items-center gap-4">
                                        <Music2Icon className="text-surface-accent-400 w-10 h-10"/>
                                        <audio src={downloadUrl} controls className="w-full max-w-xs"/>
                                    </div>
                                );
                            } else {
                                return (
                                    <div className="flex flex-col items-center gap-3 text-surface-accent-400">
                                        <FileIconComponent className="w-10 h-10"/>
                                        <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark">
                                            {t("studio_storage_no_preview")}
                                        </Typography>
                                    </div>
                                );
                            }
                        })()}
                    </div>
                </div>

                    {/* Metadata */}
                    <div className="p-4 space-y-3">
                        <div>
                            <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark text-[10px] uppercase tracking-wider font-semibold mb-1 block">
                                {t("studio_storage_file_info")}
                            </Typography>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                    {t("studio_storage_name")}
                                </Typography>
                                <Typography variant="body2" className="text-[13px] break-all">
                                    {file.name}
                                </Typography>
                            </div>
                            <div>
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                    {t("studio_storage_type")}
                                </Typography>
                                <Typography variant="body2" className="text-[13px]">
                                    {file.contentType || t("studio_storage_type_unknown")}
                                </Typography>
                            </div>
                            {file.size !== undefined && (
                                <div>
                                    <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                        {t("studio_storage_size")}
                                    </Typography>
                                    <Typography variant="body2" className="text-[13px]">
                                        {formatFileSize(file.size)}
                                    </Typography>
                                </div>
                            )}
                            <div>
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                    {t("studio_storage_extension")}
                                </Typography>
                                <Typography variant="body2" className="text-[13px] font-mono">
                                    {getExtension(file.name) || "—"}
                                </Typography>
                            </div>
                            <div className="col-span-2">
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                    {t("studio_storage_path")}
                                </Typography>
                                <Typography variant="body2" className="text-[13px] font-mono break-all">
                                    {file.fullPath}
                                </Typography>
                            </div>
                        </div>

                        {downloadUrl && (
                            <div className="pt-2">
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px] block mb-1">
                                    {t("studio_storage_url")}
                                </Typography>
                                <div
                                    className={cls(
                                        "flex items-center gap-2 p-2 rounded cursor-pointer transition-colors",
                                        "bg-surface-raised hover:bg-surface-raised-hover"
                                    )}
                                    onClick={() => {
                                        const fullUrl = downloadUrl.startsWith("http")
                                            ? downloadUrl
                                            : `${window.location.origin}${downloadUrl.startsWith("/") ? "" : "/"}${downloadUrl}`;
                                        navigator.clipboard.writeText(fullUrl).then(() => {
                                            setUrlCopied(true);
                                            setTimeout(() => setUrlCopied(false), 2000);
                                        });
                                    }}
                                >
                                    <Typography variant="caption" className="font-mono text-[11px] truncate flex-1 min-w-0 text-primary">
                                        {(() => {
                                            const fullUrl = downloadUrl.startsWith("http")
                                                ? downloadUrl
                                                : `${window.location.origin}${downloadUrl.startsWith("/") ? "" : "/"}${downloadUrl}`;
                                            return fullUrl;
                                        })()}
                                    </Typography>
                                    <Tooltip title={urlCopied ? t("studio_storage_url_copied") : t("studio_storage_copy_url")}>
                                        <div className="shrink-0">
                                            {urlCopied
                                                ? <CheckIcon size={14} className="text-green-500"/>
                                                : <CopyIcon size={14} className="text-surface-accent-400"/>
                                            }
                                        </div>
                                    </Tooltip>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            {/* Delete Confirmation */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogTitle hidden>{t("studio_storage_delete_file_title")}</DialogTitle>
                <DialogContent>
                    <Typography variant="subtitle1" className="mb-2">
                        {t("studio_storage_delete_file_question")}
                    </Typography>
                    <Typography className="text-surface-accent-600 dark:text-surface-accent-400">
                        {t("studio_storage_delete_file_body", { name: file.name })}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDeleteDialogOpen(false)}>
                        {t("studio_storage_cancel")}
                    </Button>
                    <Button
                        variant="filled"
                        color="error"
                        onClick={() => {
                            setDeleteDialogOpen(false);
                            onDelete();
                        }}
                    >
                        {t("studio_storage_delete")}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}

// ──────────────────────────────────────────────
// Main StorageView Export
// ──────────────────────────────────────────────

export const StorageView = () => {
    const { t } = useTranslation();
    const defaultStorageSource = useStorageSource();
    const storageSources = useStorageSources();
    const snackbarController = useSnackbarController();

    // Available backends to browse. Always includes the default; named
    // sources come from `<Rebase storageSources={...}>`.
    const sourceKeys = useMemo(() => {
        const keys = Object.keys(storageSources.sources);
        if (!keys.includes(DEFAULT_STORAGE_SOURCE_KEY)) keys.unshift(DEFAULT_STORAGE_SOURCE_KEY);
        return keys;
    }, [storageSources.sources]);

    const [selectedSourceKey, setSelectedSourceKey] = useState<string>(DEFAULT_STORAGE_SOURCE_KEY);

    const storageSource = storageSources.sources[selectedSourceKey] ?? defaultStorageSource;

    // Navigation
    const [searchParams, setSearchParams] = useSearchParams();
    // Accepts the historical unqualified `path` so links already shared keep
    // working; only the namespaced one is ever written.
    const currentPath = searchParams.get(STORAGE_PATH_PARAM) ?? searchParams.get("path") ?? "";
    const [loading, setLoading] = useState(true);
    /** Why the listing failed, classified — see `load-failure.ts`. */
    const [failure, setFailure] = useState<LoadFailure | null>(null);

    // Contents
    const [folders, setFolders] = useState<StorageFile[]>([]);
    const [files, setFiles] = useState<StorageFile[]>([]);

    // Selection and preview
    const [selectedFile, setSelectedFile] = useState<StorageFile | null>(null);
    const [selectedDownloadUrl, setSelectedDownloadUrl] = useState<string | null>(null);

    // Upload
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

    // View mode
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

    // Multi-selection
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const lastClickedRef = useRef<string | null>(null);

    // Bulk / folder delete
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteDialogTarget, setDeleteDialogTarget] = useState<"selection" | StorageFile | null>(null);
    const [deleting, setDeleting] = useState(false);

    // New folder
    const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [creatingFolder, setCreatingFolder] = useState(false);
    const apiConfig = useApiConfig();
    const apiBase = useApiBase();

    const storageSourceRef = React.useRef(storageSource);
    useEffect(() => {
        storageSourceRef.current = storageSource;
    }, [storageSource]);

    // ── Fetch directory contents ──
    const fetchContents = useCallback(async (path: string) => {
        setLoading(true);
        setFailure(null);
        try {
            const result: StorageListResult = await storageSourceRef.current.listObjects(path);

            const folderItems: StorageFile[] = (result.prefixes ?? []).map(ref => ({
                name: ref.name,
                fullPath: ref.fullPath,
                isFolder: true
            }));

            // Build file items and fetch metadata for each
            const fileItems: StorageFile[] = await Promise.all(
                (result.items ?? []).map(async (ref) => {
                    try {
                        const downloadConfig = await storageSourceRef.current.getSignedUrl(ref.fullPath);
                        return {
                            name: ref.name,
                            fullPath: ref.fullPath,
                            isFolder: false,
                            size: downloadConfig.metadata?.size,
                            contentType: downloadConfig.metadata?.contentType,
                            downloadUrl: downloadConfig.url ?? undefined
                        };
                    } catch {
                        return {
                            name: ref.name,
                            fullPath: ref.fullPath,
                            isFolder: false
                        };
                    }
                })
            );

            setFolders(folderItems);
            setFiles(fileItems);
        } catch (e) {
            console.error("Storage list error:", e);
            // A refusal from the project's own `storageAuthorize` hook is not a
            // fault — see `load-failure.ts`. Rendering both the same way told
            // a customer with a working project that their storage was broken.
            setFailure(classifyLoadFailure(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // `selectedSourceKey` is a dep so switching backend re-lists; the
        // ref-sync effect above runs first, so `storageSourceRef` is current.
        fetchContents(currentPath);
    }, [currentPath, fetchContents, selectedSourceKey]);

    // What was previewed and selected belongs to the listing it was picked in.
    const clearSelection = useCallback(() => {
        setSelectedFile(null);
        setSelectedDownloadUrl(null);
        setSelectedPaths(new Set());
        lastClickedRef.current = null;
    }, []);

    // Navigate to path
    //
    // Updates only this view's own parameter and leaves the rest of the query
    // string alone. It used to assign the whole thing (`setSearchParams({})`),
    // which is fine when Studio owns the URL but destructive when it is
    // embedded: the SaaS console keeps the open tab in `?tab=`, so opening a
    // folder erased it and bounced the user out of Storage entirely. The key is
    // namespaced for the same reason — a bare `path` is a name a host app can
    // easily be using for something else.
    const handleNavigate = useCallback((path: string) => {
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            if (path) next.set(STORAGE_PATH_PARAM, path);
            else next.delete(STORAGE_PATH_PARAM);
            return next;
        }, { replace: true });
        clearSelection();
    }, [setSearchParams, clearSelection]);

    // Switching source keeps the folder path, not the files picked in it: the
    // preview's and the selection's actions run through the selected source,
    // so a file opened in one would be deleted, by its path, from the other.
    const handleSourceChange = useCallback((key: string) => {
        setSelectedSourceKey(key);
        clearSelection();
    }, [clearSelection]);

    // Navigate up one level
    const handleNavigateUp = useCallback(() => {
        const parts = currentPath.split("/").filter(Boolean);
        parts.pop();
        handleNavigate(parts.join("/"));
    }, [currentPath, handleNavigate]);

    // All items (folders + files) in display order, for shift-range select
    const allItems = useMemo(() => [...folders, ...files], [folders, files]);

    // ── Multi-select click handler ──
    const handleItemClick = useCallback((item: StorageFile, e: React.MouseEvent) => {
        const path = item.fullPath;
        if (e.metaKey || e.ctrlKey) {
            // Toggle individual item
            setSelectedPaths(prev => {
                const next = new Set(prev);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
            });
            lastClickedRef.current = path;
        } else if (e.shiftKey && lastClickedRef.current) {
            // Range select
            const allPaths = allItems.map(i => i.fullPath);
            const anchorIdx = allPaths.indexOf(lastClickedRef.current);
            const currentIdx = allPaths.indexOf(path);
            if (anchorIdx >= 0 && currentIdx >= 0) {
                const [start, end] = anchorIdx < currentIdx ? [anchorIdx, currentIdx] : [currentIdx, anchorIdx];
                setSelectedPaths(prev => {
                    const next = new Set(prev);
                    for (let i = start; i <= end; i++) next.add(allPaths[i]);
                    return next;
                });
            }
        } else {
            // Exclusive select
            setSelectedPaths(new Set([path]));
            lastClickedRef.current = path;
            // Also open preview if it's a file
            if (!item.isFolder) {
                setSelectedFile(item);
                if (item.downloadUrl) {
                    setSelectedDownloadUrl(item.downloadUrl);
                } else {
                    storageSourceRef.current.getSignedUrl(item.fullPath)
                        .then(config => setSelectedDownloadUrl(config.url))
                        .catch(() => setSelectedDownloadUrl(null));
                }
            } else {
                setSelectedFile(null);
                setSelectedDownloadUrl(null);
            }
        }
    }, [allItems]);

    // Double-click: open folder or preview file
    const handleItemDoubleClick = useCallback((item: StorageFile) => {
        if (item.isFolder) {
            handleNavigate(item.fullPath);
        } else {
            setSelectedFile(item);
            if (item.downloadUrl) {
                setSelectedDownloadUrl(item.downloadUrl);
            } else {
                storageSourceRef.current.getSignedUrl(item.fullPath)
                    .then(config => setSelectedDownloadUrl(config.url))
                    .catch(() => setSelectedDownloadUrl(null));
            }
        }
    }, [handleNavigate]);

    // Upload files
    const handleUpload = useCallback(async (uploadFiles: File[]) => {
        for (const file of uploadFiles) {
            const key = currentPath ? `${currentPath}/${file.name}` : file.name;
            await storageSourceRef.current.putObject({
                file,
                key
            });
        }
        snackbarController.open({
            type: "success",
            message: t("studio_storage_files_uploaded", { count: uploadFiles.length })
        });
        await fetchContents(currentPath);
    }, [currentPath, snackbarController, fetchContents, t]);

    // Create new folder
    const handleCreateFolder = useCallback(async () => {
        if (!newFolderName.trim() || !apiConfig?.apiUrl) return;

        // Validate folder name
        const name = newFolderName.trim();
        if (name.includes("/") || name.includes("\\")) {
            snackbarController.open({ type: "error",
message: t("studio_storage_folder_name_has_slash") });
            return;
        }

        // Check if folder already exists
        const existingFolder = folders.find(f => f.name === name);
        if (existingFolder) {
            snackbarController.open({ type: "error",
message: t("studio_storage_folder_exists", { name }) });
            return;
        }

        setCreatingFolder(true);
        try {
            const folderPath = currentPath ? `default/${currentPath}/${name}` : `default/${name}`;
            const token = apiConfig.getAuthToken ? await apiConfig.getAuthToken() : null;
            const response = await fetch(`${apiBase}/storage/folder`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { "Authorization": `Bearer ${token}` } : {})
                },
                // The selected source, as every other action here routes by
                // it: without `storageId` the folder went to the default
                // backend whichever one was being browsed.
                body: JSON.stringify({
                    path: folderPath,
                    ...(selectedSourceKey !== DEFAULT_STORAGE_SOURCE_KEY ? { storageId: selectedSourceKey } : {})
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: t("studio_storage_create_folder_failed") }));
                throw new Error(err.error || t("studio_storage_create_folder_failed"));
            }

            snackbarController.open({ type: "success",
message: t("studio_storage_folder_created", { name }) });
            setNewFolderDialogOpen(false);
            setNewFolderName("");
            await fetchContents(currentPath);
        } catch (e) {
            snackbarController.open({ type: "error",
message: e instanceof Error ? e.message : String(e) });
        } finally {
            setCreatingFolder(false);
        }
    }, [newFolderName, currentPath, apiConfig, apiBase, snackbarController, fetchContents, folders, selectedSourceKey, t]);

    // Drag-and-drop on main view
    const handleDropFiles = useCallback(async (droppedFiles: File[]) => {
        if (droppedFiles.length === 0) return;
        try {
            for (const file of droppedFiles) {
                const key = currentPath ? `${currentPath}/${file.name}` : file.name;
                await storageSourceRef.current.putObject({ file,
key });
            }
            snackbarController.open({
                type: "success",
                message: t("studio_storage_files_uploaded", { count: droppedFiles.length })
            });
            await fetchContents(currentPath);
        } catch (e) {
            snackbarController.open({
                type: "error",
                message: e instanceof Error ? e.message : String(e)
            });
        }
    }, [currentPath, snackbarController, fetchContents, t]);

    const {
        getRootProps: getDropRootProps,
        getInputProps: getDropInputProps,
        isDragActive
    } = useDropzone({
        onDrop: handleDropFiles,
        noClick: true,
        noKeyboard: true,
        noDragEventsBubbling: true
    });

    // ── Recursive folder delete helper ──
    const deleteFolderRecursive = useCallback(async (prefix: string) => {
        const result = await storageSourceRef.current.listObjects(prefix);
        // Delete all files in this level
        for (const item of result.items ?? []) {
            await storageSourceRef.current.deleteObject(item.fullPath);
        }
        // Recurse into sub-folders
        for (const sub of result.prefixes ?? []) {
            await deleteFolderRecursive(sub.fullPath);
        }
        // Delete the folder entry itself (needed for local filesystem)
        try {
            await storageSourceRef.current.deleteObject(prefix);
        } catch {
            // Ignore — S3 folders are virtual and may not exist as objects
        }
    }, []);

    // Delete a single file
    const handleDeleteFile = useCallback(async (file: StorageFile) => {
        try {
            if (file.isFolder) {
                await deleteFolderRecursive(file.fullPath);
            } else {
                await storageSourceRef.current.deleteObject(file.fullPath);
            }
            snackbarController.open({ type: "success",
message: t("studio_storage_file_deleted", { name: file.name }) });
            setSelectedFile(null);
            setSelectedDownloadUrl(null);
            setSelectedPaths(prev => {
                const next = new Set(prev);
                next.delete(file.fullPath);
                return next;
            });
            fetchContents(currentPath);
        } catch (e) {
            snackbarController.open({ type: "error",
message: e instanceof Error ? e.message : String(e) });
        }
    }, [currentPath, snackbarController, fetchContents, deleteFolderRecursive, t]);

    // Bulk delete (selected items)
    const handleBulkDelete = useCallback(async () => {
        setDeleting(true);
        try {
            const items = allItems.filter(i => selectedPaths.has(i.fullPath));
            for (const item of items) {
                if (item.isFolder) {
                    await deleteFolderRecursive(item.fullPath);
                } else {
                    await storageSourceRef.current.deleteObject(item.fullPath);
                }
            }
            snackbarController.open({ type: "success",
message: t("studio_storage_items_deleted", { count: items.length }) });
            setSelectedPaths(new Set());
            setSelectedFile(null);
            setSelectedDownloadUrl(null);
            await fetchContents(currentPath);
        } catch (e) {
            snackbarController.open({ type: "error",
message: e instanceof Error ? e.message : String(e) });
        } finally {
            setDeleting(false);
            setDeleteDialogOpen(false);
            setDeleteDialogTarget(null);
        }
    }, [allItems, selectedPaths, currentPath, snackbarController, fetchContents, deleteFolderRecursive, t]);

    // Confirm delete for a single file or folder
    const handleConfirmDeleteItem = useCallback(async () => {
        if (!deleteDialogTarget || deleteDialogTarget === "selection") return;
        setDeleting(true);
        try {
            if (deleteDialogTarget.isFolder) {
                await deleteFolderRecursive(deleteDialogTarget.fullPath);
            } else {
                await storageSourceRef.current.deleteObject(deleteDialogTarget.fullPath);
            }
            snackbarController.open({ type: "success",
message: deleteDialogTarget.isFolder
    ? t("studio_storage_folder_deleted", { name: deleteDialogTarget.name })
    : t("studio_storage_file_deleted", { name: deleteDialogTarget.name }) });
            if (!deleteDialogTarget.isFolder && selectedFile?.fullPath === deleteDialogTarget.fullPath) {
                setSelectedFile(null);
                setSelectedDownloadUrl(null);
            }
            setSelectedPaths(prev => {
                const next = new Set(prev);
                next.delete(deleteDialogTarget.fullPath);
                return next;
            });
            await fetchContents(currentPath);
        } catch (e) {
            snackbarController.open({ type: "error",
message: e instanceof Error ? e.message : String(e) });
        } finally {
            setDeleting(false);
            setDeleteDialogOpen(false);
            setDeleteDialogTarget(null);
        }
    }, [deleteDialogTarget, selectedFile, currentPath, snackbarController, fetchContents, deleteFolderRecursive, t]);

    // Select all / deselect
    const handleSelectAll = useCallback(() => {
        if (selectedPaths.size === allItems.length) {
            setSelectedPaths(new Set());
        } else {
            setSelectedPaths(new Set(allItems.map(i => i.fullPath)));
        }
    }, [allItems, selectedPaths]);

    // ── Keyboard shortcuts ──
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            // Don't handle shortcuts when a dialog is open
            if (deleteDialogOpen || uploadDialogOpen || newFolderDialogOpen) return;
            // Cmd/Ctrl+A: select all
            if ((e.metaKey || e.ctrlKey) && e.key === "a") {
                e.preventDefault();
                handleSelectAll();
            }
            // Escape: deselect
            if (e.key === "Escape") {
                setSelectedPaths(new Set());
                setSelectedFile(null);
                setSelectedDownloadUrl(null);
            }
            // Delete / Backspace: delete selected
            if ((e.key === "Delete" || e.key === "Backspace") && selectedPaths.size > 0 && !e.metaKey && !e.ctrlKey) {
                // Don't trigger if user is typing in an input
                if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
                e.preventDefault();
                setDeleteDialogTarget("selection");
                setDeleteDialogOpen(true);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [handleSelectAll, selectedPaths, deleteDialogOpen, uploadDialogOpen, newFolderDialogOpen]);

    // Handle refresh
    const handleRefresh = useCallback(() => {
        fetchContents(currentPath);
    }, [currentPath, fetchContents]);

    const segments = breadcrumbSegments(currentPath, t("studio_storage_root"));


    // ── Render file grid/list ──
    const renderContents = () => {
        if (loading) {
            return (
                <div className="flex-grow flex items-center justify-center">
                    <div className="text-center">
                        <CircularProgress size="medium"/>
                        <Typography variant="body2" className="mt-4 text-text-secondary dark:text-text-secondary-dark font-mono tracking-tight animate-pulse">
                            {t("studio_storage_loading")}
                        </Typography>
                    </div>
                </div>
            );
        }

        if (failure?.kind === "denied") {
            return (
                <div className="flex-grow flex items-center justify-center p-6 overflow-auto">
                    <div className="max-w-md text-center">
                        <Typography variant="subtitle2" className="block">
                            {t("studio_storage_denied_title")}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary dark:text-text-secondary-dark block mt-2">
                            {t("studio_storage_denied_hint")}
                        </Typography>
                        <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark block mt-3 font-mono break-all">
                            {failure.detail}
                        </Typography>
                    </div>
                </div>
            );
        }

        if (failure) {
            return (
                <div className="flex-grow flex items-center justify-center p-6 overflow-auto">
                    <ErrorView
                        title={t("studio_storage_read_failed")}
                        error={failure.detail}
                        onRetry={failure.retryable ? handleRefresh : undefined}
                    />
                </div>
            );
        }


        if (allItems.length === 0) {
            return (
                <div className="flex-grow flex items-center justify-center text-text-disabled dark:text-text-disabled-dark">
                    <div className="text-center">
                        <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
                        </svg>
                        <Typography variant="body2">
                            {t("studio_storage_empty")}
                        </Typography>
                        <div className="flex items-center gap-2 mt-3">
                            <Button variant="text" onClick={() => {
                                setNewFolderName("");
                                setNewFolderDialogOpen(true);
                            }}>
                                <FolderPlusIcon size={iconSize.smallest}/>
                                {t("studio_storage_new_folder")}
                            </Button>
                            <Button onClick={() => setUploadDialogOpen(true)}>
                                <PlusIcon size={iconSize.smallest}/>
                                {t("studio_storage_upload_files")}
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        if (viewMode === "list") {
            return (
                <div className="flex-grow overflow-auto">
                    <table className="w-full">
                        <thead>
                            <tr className={cls("border-b text-left text-[10px] uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark", defaultBorderMixin)}>
                                <th className="pl-3 pr-0 py-2 w-8">
                                    <Checkbox
                                        size="small"
                                        checked={allItems.length > 0 && selectedPaths.size === allItems.length}
                                        indeterminate={selectedPaths.size > 0 && selectedPaths.size < allItems.length}
                                        onCheckedChange={handleSelectAll}
                                    />
                                </th>
                                <th className="px-2 py-2 font-semibold">{t("studio_storage_name")}</th>
                                <th className="px-4 py-2 font-semibold w-24">{t("studio_storage_type")}</th>
                                <th className="px-4 py-2 font-semibold w-24 text-right">{t("studio_storage_size")}</th>
                                <th className="px-2 py-2 w-10"/>
                            </tr>
                        </thead>
                        <tbody>
                            {folders.map(folder => {
                                const isChecked = selectedPaths.has(folder.fullPath);
                                return (
                                    <tr
                                        key={folder.fullPath}
                                        data-storage-item
                                        className={cls(
                                            "cursor-pointer transition-colors border-b group",
                                            defaultBorderMixin,
                                            isChecked
                                                ? "bg-primary/5 dark:bg-primary/10"
                                                : "hover:bg-surface-hover"
                                        )}
                                        onClick={(e) => handleItemClick(folder, e)}
                                        onDoubleClick={() => handleItemDoubleClick(folder)}
                                    >
                                        <td className="pl-3 pr-0 py-2.5" onClick={(e) => e.stopPropagation()}>
                                            <Checkbox
                                                size="small"
                                                checked={isChecked}
                                                onCheckedChange={() => {
                                                    setSelectedPaths(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(folder.fullPath)) next.delete(folder.fullPath);
                                                        else next.add(folder.fullPath);
                                                        return next;
                                                    });
                                                }}
                                            />
                                        </td>
                                        <td className="px-2 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <FolderIcon size={iconSize.smallest} className="text-amber-500 dark:text-amber-400 shrink-0"/>
                                                <Typography variant="body2" className="text-[13px] font-medium truncate">
                                                    {folder.name}
                                                </Typography>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark">
                                                {t("studio_storage_folder")}
                                            </Typography>
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                            <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark">
                                                —
                                            </Typography>
                                        </td>
                                        <td className="px-2 py-2.5"/>
                                    </tr>
                                );
                            })}
                            {files.map(file => {
                                const FileIconComp = getFileIcon(file.contentType);
                                const isChecked = selectedPaths.has(file.fullPath);
                                return (
                                    <tr
                                        key={file.fullPath}
                                        data-storage-item
                                        className={cls(
                                            "cursor-pointer transition-colors border-b group",
                                            defaultBorderMixin,
                                            isChecked
                                                ? "bg-primary/5 dark:bg-primary/10"
                                                : "hover:bg-surface-hover"
                                        )}
                                        onClick={(e) => handleItemClick(file, e)}
                                        onDoubleClick={() => handleItemDoubleClick(file)}
                                    >
                                        <td className="pl-3 pr-0 py-2.5" onClick={(e) => e.stopPropagation()}>
                                            <Checkbox
                                                size="small"
                                                checked={isChecked}
                                                onCheckedChange={() => {
                                                    setSelectedPaths(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(file.fullPath)) next.delete(file.fullPath);
                                                        else next.add(file.fullPath);
                                                        return next;
                                                    });
                                                }}
                                            />
                                        </td>
                                        <td className="px-2 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <FileIconComp size={iconSize.smallest} className="text-surface-accent-400 shrink-0"/>
                                                <Typography variant="body2" className="text-[13px] truncate">
                                                    {file.name}
                                                </Typography>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark">
                                                {getExtension(file.name) || file.contentType?.split("/")[1]?.toUpperCase() || "—"}
                                            </Typography>
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                            <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark font-mono text-[11px]">
                                                {file.size !== undefined ? formatFileSize(file.size) : "—"}
                                            </Typography>
                                        </td>
                                        <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                                            <IconButton
                                                size="smallest"
                                                className="opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={() => {
                                                    setDeleteDialogTarget(file);
                                                    setDeleteDialogOpen(true);
                                                }}
                                            >
                                                <Trash2Icon size={14}/>
                                            </IconButton>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            );
        }

        // Grid view
        return (
            <div className="flex-grow overflow-auto p-4">
                {/* Folder cards */}
                {folders.length > 0 && (
                    <div className="mb-4">
                        <Typography variant="caption" className="text-[10px] uppercase tracking-wider font-semibold text-text-disabled dark:text-text-disabled-dark mb-2 block">
                            {t("studio_storage_folders")}
                        </Typography>
                        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
                            {folders.map(folder => {
                                const isChecked = selectedPaths.has(folder.fullPath);
                                return (
                                    <div
                                        key={folder.fullPath}
                                        data-storage-item
                                        className={cls(
                                            "rounded-lg p-3 cursor-pointer border",
                                            "transition-colors duration-150",
                                            defaultBorderMixin,
                                            "hover:bg-surface-hover hover:shadow-sm",
                                            "flex items-center gap-2",
                                            isChecked && "ring-2 ring-primary bg-primary/5 dark:bg-primary/10"
                                        )}
                                        onClick={(e) => handleItemClick(folder, e)}
                                        onDoubleClick={() => handleItemDoubleClick(folder)}
                                    >
                                        <FolderIcon size={iconSize.smallest} className="text-amber-500 dark:text-amber-400 shrink-0"/>
                                        <Typography variant="body2" className="text-[13px] font-medium truncate">
                                            {folder.name}
                                        </Typography>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* FileIcon cards */}
                {files.length > 0 && (
                    <div>
                        <Typography variant="caption" className="text-[10px] uppercase tracking-wider font-semibold text-text-disabled dark:text-text-disabled-dark mb-2 block">
                            {t("studio_storage_files_heading", { count: files.length })}
                        </Typography>
                        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
                            {files.map(file => {
                                const FileIconComp = getFileIcon(file.contentType);
                                const ext = getExtension(file.name)?.toLowerCase() || "";
                                const isImage = file.contentType?.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext);
                                const isChecked = selectedPaths.has(file.fullPath);

                                return (
                                    <div
                                        key={file.fullPath}
                                        data-storage-item
                                        className={cls(
                                            "rounded-lg overflow-hidden cursor-pointer border",
                                            "transition-shadow duration-150",
                                            defaultBorderMixin,
                                            "hover:shadow-md",
                                            isChecked && "ring-2 ring-primary"
                                        )}
                                        onClick={(e) => handleItemClick(file, e)}
                                        onDoubleClick={() => handleItemDoubleClick(file)}
                                    >
                                        {/* Thumbnail or icon */}
                                        <div className="aspect-square relative overflow-hidden bg-surface-raised flex items-center justify-center">
                                            {isImage && file.downloadUrl ? (
                                                <img
                                                    src={file.downloadUrl}
                                                    alt={file.name}
                                                    className="w-full h-full object-cover"
                                                    loading="lazy"
                                                />
                                            ) : (
                                                <FileIconComp className="text-surface-accent-400 dark:text-surface-accent-500 w-8 h-8"/>
                                            )}

                                            {/* Extension badge */}
                                            {getExtension(file.name) && (
                                                <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-black/50 text-white backdrop-blur-sm">
                                                    {getExtension(file.name)}
                                                </div>
                                            )}
                                        </div>

                                        {/* Name & size */}
                                        <div className="p-2.5">
                                            <Typography variant="body2" className="text-[12px] font-medium truncate text-surface-900 dark:text-white">
                                                {file.name}
                                            </Typography>
                                            <Typography variant="caption" color="secondary" className="truncate block mt-0.5 text-[11px]">
                                                {file.size !== undefined ? formatFileSize(file.size) : "—"}
                                            </Typography>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="flex h-full w-full bg-surface-card overflow-hidden text-text-primary dark:text-text-primary-dark">
            <div className="flex h-full w-full">
                {/* Main content */}
                <div className="flex-grow flex flex-col min-w-0 h-full">
                            {/* Toolbar */}
                            <div className={cls("flex items-center justify-between pr-2 border-b bg-surface-card shrink-0 h-10", defaultBorderMixin)}>
                                <div className="flex items-center gap-1.5 flex-grow overflow-hidden px-3 py-2">
                                    {/* Breadcrumbs — always visible */}
                                    {currentPath && (
                                        <Tooltip title={t("studio_storage_go_up")}>
                                            <IconButton size="small" onClick={handleNavigateUp}>
                                                <ArrowLeftIcon size={iconSize.smallest}/>
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
                                        {segments.map((seg, i) => (
                                            <React.Fragment key={seg.path}>
                                                {i > 0 && (
                                                    <Typography variant="caption" className="text-text-disabled dark:text-text-disabled-dark mx-0.5">/</Typography>
                                                )}
                                                <Button
                                                    variant="text"
                                                    size="small"
                                                    className={cls(
                                                        "px-1.5 py-0.5 min-h-0 min-w-0 h-6 text-xs whitespace-nowrap normal-case font-normal",
                                                        i === segments.length - 1
                                                            ? "text-text-primary dark:text-text-primary-dark font-medium"
                                                            : "text-text-secondary dark:text-text-secondary-dark"
                                                    )}
                                                    onClick={() => handleNavigate(seg.path)}
                                                >
                                                    {seg.label}
                                                </Button>
                                            </React.Fragment>
                                        ))}
                                    </div>

                                    <div className="flex-1"/>

                                    {/* Selection actions or file count */}
                                    {selectedPaths.size > 0 ? (
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            <Typography variant="body2" className="text-[13px] font-medium whitespace-nowrap">
                                                {t("studio_storage_selected_count", { count: selectedPaths.size })}
                                            </Typography>
                                            <Button
                                                size="small"
                                                variant="text"
                                                onClick={() => {
                                                    setDeleteDialogTarget("selection");
                                                    setDeleteDialogOpen(true);
                                                }}
                                            >
                                                <Trash2Icon size={14} className="mr-1"/>
                                                {t("studio_storage_delete")}
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="text"
                                                onClick={() => {
                                                    setSelectedPaths(new Set());
                                                    setSelectedFile(null);
                                                    setSelectedDownloadUrl(null);
                                                }}
                                            >
                                                <XIcon size={14} className="mr-1"/>
                                                {t("studio_storage_deselect")}
                                            </Button>
                                        </div>
                                    ) : !loading ? (
                                        <Chip size="small" className="shrink-0 text-[10px]">
                                            {t("studio_storage_file_count", { count: files.length })}
                                            {folders.length > 0 ? `, ${t("studio_storage_folder_count", { count: folders.length })}` : ""}
                                        </Chip>
                                    ) : null}
                                </div>

                                <div className="flex shrink-0 items-center justify-end gap-1.5 pr-1">

                                    {/* Backend picker — only shown when more than one storage source is available */}
                                    {sourceKeys.length > 1 && (
                                        <Select
                                            size="small"
                                            position="item-aligned"
                                            value={selectedSourceKey}
                                            onValueChange={(value) => {
                                                if (value && value !== selectedSourceKey) handleSourceChange(value);
                                            }}
                                            renderValue={(key) => {
                                                const label = storageSources.registry[key]?.label;
                                                return label ?? (key === DEFAULT_STORAGE_SOURCE_KEY ? t("studio_storage_default_source") : key);
                                            }}>
                                            {sourceKeys.map((key) => (
                                                <SelectItem key={key} value={key}>
                                                    {storageSources.registry[key]?.label
                                                        ?? (key === DEFAULT_STORAGE_SOURCE_KEY ? t("studio_storage_default_source") : key)}
                                                </SelectItem>
                                            ))}
                                        </Select>
                                    )}

                                    <Tooltip title={t("studio_storage_grid_view")}>
                                        <IconButton
                                            size="small"
                                            onClick={() => setViewMode("grid")}
                                            className={cls(viewMode === "grid" && "bg-surface-raised")}
                                        >
                                            <LayoutGridIcon size={iconSize.smallest}/>
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title={t("studio_storage_list_view")}>
                                        <IconButton
                                            size="small"
                                            onClick={() => setViewMode("list")}
                                            className={cls(viewMode === "list" && "bg-surface-raised")}
                                        >
                                            <ListIcon size={iconSize.smallest}/>
                                        </IconButton>
                                    </Tooltip>

                                    <div className={cls("h-4 w-px mx-0.5", defaultBorderMixin, "bg-surface-raised")}/>

                                    <Tooltip title={t("studio_storage_refresh")}>
                                        <IconButton size="small" onClick={handleRefresh} disabled={loading}>
                                            <RefreshCwIcon size={iconSize.smallest}/>
                                        </IconButton>
                                    </Tooltip>

                                    <Tooltip title={t("studio_storage_new_folder")}>
                                        <IconButton
                                            size="small"
                                            onClick={() => {
                                                setNewFolderName("");
                                                setNewFolderDialogOpen(true);
                                            }}
                                        >
                                            <FolderPlusIcon size={iconSize.smallest}/>
                                        </IconButton>
                                    </Tooltip>
                                    <Button
                                        size="small"
                                        color="primary"
                                        onClick={() => setUploadDialogOpen(true)}
                                    >
                                        <UploadCloudIcon size={iconSize.smallest} className="mr-1"/>
                                        {t("studio_storage_upload")}
                                    </Button>
                                </div>
                            </div>

                            {/* File grid / list — drop zone */}
                            <div {...getDropRootProps()}
                                 className="flex-grow flex flex-col overflow-hidden min-h-0 relative"
                                 onClick={(e) => {
                                     const target = e.target as HTMLElement;
                                     if (!target.closest("[data-storage-item]") && selectedPaths.size > 0) {
                                         setSelectedPaths(new Set());
                                         setSelectedFile(null);
                                         setSelectedDownloadUrl(null);
                                     }
                                 }}
                            >
                                <input {...getDropInputProps()} />
                                {renderContents()}
                                {/* Drag overlay */}
                                {isDragActive && (
                                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 dark:bg-primary/10 backdrop-blur-[2px]">
                                        <div className="flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-primary bg-surface-scrim">
                                            <UploadCloudIcon className="w-10 h-10 text-primary"/>
                                            <Typography variant="subtitle2" className="text-primary font-semibold">
                                                {t("studio_storage_drop_to_upload")}
                                            </Typography>
                                            <Typography variant="caption" color="secondary">
                                                {t("studio_storage_upload_to")} /{currentPath || t("studio_storage_root_folder")}
                                            </Typography>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Status bar */}
                            <div className={cls("px-4 py-1.5 border-t bg-surface-sheet flex items-center justify-between shrink-0", defaultBorderMixin)}>
                                <div className="flex items-center gap-4 text-[11px]">
                                    <span className="text-text-disabled dark:text-text-disabled-dark font-semibold uppercase tracking-tighter">
                                        {t("studio_storage_path")}
                                    </span>
                                    <span className="font-mono text-text-secondary dark:text-text-secondary-dark">
                                        /{currentPath || ""}
                                    </span>
                                </div>
                                {selectedPaths.size > 0 ? (
                                    <div className="text-[11px] text-text-secondary dark:text-text-secondary-dark">
                                        {t("studio_storage_items_selected", { count: selectedPaths.size })}
                                    </div>
                                ) : selectedFile ? (
                                    <div className="text-[11px] text-text-secondary dark:text-text-secondary-dark">
                                        {t("studio_storage_selected_label")} <span className="font-mono">{selectedFile.name}</span>
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        {/* Preview panel */}
                        {selectedFile && (
                            <div className="w-80 lg:w-96 shrink-0">
                                <FilePreviewPanel
                                    file={selectedFile}
                                    downloadUrl={selectedDownloadUrl}
                                    onClose={() => {
                                        setSelectedFile(null);
                                        setSelectedDownloadUrl(null);
                                    }}
                                    onDelete={() => handleDeleteFile(selectedFile)}
                                />
                            </div>
                        )}
            </div>

            {/* Upload Dialog */}
            <UploadDialog
                open={uploadDialogOpen}
                currentPath={currentPath}
                onClose={() => setUploadDialogOpen(false)}
                onUpload={handleUpload}
            />

            {/* Delete confirmation dialog */}
            <Dialog
                open={deleteDialogOpen}
                onOpenChange={(open) => {
                    if (!open && !deleting) {
                        setDeleteDialogOpen(false);
                        setDeleteDialogTarget(null);
                    }
                }}
            >
                <DialogTitle hidden>{t("studio_storage_delete_confirmation_title")}</DialogTitle>
                <DialogContent>
                    <Typography variant="subtitle1" className="font-semibold mb-2">
                        {deleteDialogTarget === "selection"
                            ? t("studio_storage_delete_items_question", { count: selectedPaths.size })
                            : deleteDialogTarget?.isFolder
                                ? t("studio_storage_delete_folder_question", { name: deleteDialogTarget.name })
                                : deleteDialogTarget
                                    ? t("studio_storage_delete_file_question")
                                    : t("studio_storage_delete_question")}
                    </Typography>
                    <Typography variant="body2" color="secondary">
                        {deleteDialogTarget === "selection"
                            ? t("studio_storage_delete_selection_body")
                            : deleteDialogTarget && !deleteDialogTarget.isFolder
                                ? t("studio_storage_delete_file_body", { name: deleteDialogTarget.name })
                                : t("studio_storage_delete_folder_body")}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button
                        variant="text"
                        onClick={() => {
                            setDeleteDialogOpen(false);
                            setDeleteDialogTarget(null);
                        }}
                        disabled={deleting}
                    >
                        {t("studio_storage_cancel")}
                    </Button>
                    <LoadingButton
                        color="error"
                        loading={deleting}
                        onClick={deleteDialogTarget === "selection" ? handleBulkDelete : handleConfirmDeleteItem}
                    >
                        <Trash2Icon size={14} className="mr-1"/>
                        {t("studio_storage_delete")}
                    </LoadingButton>
                </DialogActions>
            </Dialog>

            {/* New Folder Dialog */}
            <Dialog
                open={newFolderDialogOpen}
                onOpenChange={(open) => {
                    if (!open && !creatingFolder) {
                        setNewFolderDialogOpen(false);
                        setNewFolderName("");
                    }
                }}
            >
                <DialogTitle hidden>{t("studio_storage_new_folder_title")}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        size="small"
                        label={t("studio_storage_folder_name")}
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && newFolderName.trim()) {
                                e.preventDefault();
                                handleCreateFolder();
                            }
                        }}
                        disabled={creatingFolder}
                        placeholder={t("studio_storage_folder_name_placeholder")}
                    />
                    {currentPath && (
                        <Typography variant="caption" color="secondary" className="mt-2">
                            {t("studio_storage_created_in")} <span className="font-mono">/{currentPath}/</span>
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        variant="text"
                        onClick={() => {
                            setNewFolderDialogOpen(false);
                            setNewFolderName("");
                        }}
                        disabled={creatingFolder}
                    >
                        {t("studio_storage_cancel")}
                    </Button>
                    <LoadingButton
                        color="primary"
                        loading={creatingFolder}
                        disabled={!newFolderName.trim()}
                        onClick={handleCreateFolder}
                    >
                        <FolderPlusIcon size={14} className="mr-1"/>
                        {t("studio_storage_create")}
                    </LoadingButton>
                </DialogActions>
            </Dialog>
        </div>
    );
};
