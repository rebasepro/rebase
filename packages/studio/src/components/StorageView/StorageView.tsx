
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
import { useStorageSource, useStorageSources, useSnackbarController, ErrorView, useApiBase, useApiConfig } from "@rebasepro/app";
import { DEFAULT_STORAGE_SOURCE_KEY, type StorageListResult } from "@rebasepro/types";
import { classifyStorageFailure, type StorageFailure } from "./storage-failure";
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

function breadcrumbSegments(path: string): { label: string; path: string }[] {
    if (!path || path === "/") return [{ label: "Root",
path: "" }];
    const parts = path.split("/").filter(Boolean);
    const segments = [{ label: "Root",
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
            setError(err instanceof Error ? err.message : "Upload failed");
        } finally {
            setUploading(false);
        }
    }, [selectedFiles, onUpload, onClose]);

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
                Upload Files
                <Typography variant="caption" className="text-text-secondary dark:text-text-secondary-dark mt-0.5 block">
                    to <span className="font-mono text-primary">/{currentPath || "root"}</span>
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
                                Drop files here or click to browse
                            </Typography>
                            <Typography variant="caption" color="secondary">
                                Any file type supported
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
                            Selected files ({selectedFiles.length})
                        </Typography>
                        <div className="max-h-40 overflow-auto space-y-1">
                            {selectedFiles.map((file, index) => (
                                <div
                                    key={`${file.name}-${index}`}
                                    className="flex items-center justify-between p-2 rounded bg-surface-100 dark:bg-surface-800"
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
                    Cancel
                </Button>
                <Button
                    variant="filled"
                    onClick={handleUpload}
                    disabled={selectedFiles.length === 0 || uploading}
                    startIcon={uploading ? <CircularProgress size="smallest"/> : <UploadCloudIcon size={14}/>}
                >
                    {uploading ? "Uploading..." : `Upload${selectedFiles.length > 0 ? ` (${selectedFiles.length})` : ""}`}
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
                "bg-white dark:bg-surface-800"
            )}>
                {/* Header */}
                <div className={cls("flex items-center justify-between p-3 border-b shrink-0", defaultBorderMixin)}>
                    <Typography variant="body2" className="font-medium truncate flex-1 mr-2">
                        {file.name}
                    </Typography>
                    <div className="flex items-center gap-0.5">
                        {downloadUrl && (
                            <Tooltip title="Download">
                                <IconButton
                                    size="small"
                                    onClick={() => window.open(downloadUrl, "_blank")}
                                >
                                    <DownloadIcon size={iconSize.smallest}/>
                                </IconButton>
                            </Tooltip>
                        )}
                        <Tooltip title="Delete">
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
                    <div className={cls("flex flex-col items-center justify-center min-h-[200px] p-4 bg-surface-50 dark:bg-surface-800 border-b", defaultBorderMixin)}>
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
                                            No preview available
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
                                File Info
                            </Typography>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                    Name
                                </Typography>
                                <Typography variant="body2" className="text-[13px] break-all">
                                    {file.name}
                                </Typography>
                            </div>
                            <div>
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                    Type
                                </Typography>
                                <Typography variant="body2" className="text-[13px]">
                                    {file.contentType || "Unknown"}
                                </Typography>
                            </div>
                            {file.size !== undefined && (
                                <div>
                                    <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                        Size
                                    </Typography>
                                    <Typography variant="body2" className="text-[13px]">
                                        {formatFileSize(file.size)}
                                    </Typography>
                                </div>
                            )}
                            <div>
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                    Extension
                                </Typography>
                                <Typography variant="body2" className="text-[13px] font-mono">
                                    {getExtension(file.name) || "—"}
                                </Typography>
                            </div>
                            <div className="col-span-2">
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px]">
                                    Path
                                </Typography>
                                <Typography variant="body2" className="text-[13px] font-mono break-all">
                                    {file.fullPath}
                                </Typography>
                            </div>
                        </div>

                        {downloadUrl && (
                            <div className="pt-2">
                                <Typography variant="caption" className="text-surface-accent-500 text-[11px] block mb-1">
                                    URL
                                </Typography>
                                <div
                                    className={cls(
                                        "flex items-center gap-2 p-2 rounded cursor-pointer transition-colors",
                                        "bg-surface-100 dark:bg-surface-800 hover:bg-surface-200 dark:hover:bg-surface-700"
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
                                    <Tooltip title={urlCopied ? "Copied!" : "Copy URL"}>
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
                <DialogTitle hidden>Delete File</DialogTitle>
                <DialogContent>
                    <Typography variant="subtitle1" className="mb-2">
                        Delete File?
                    </Typography>
                    <Typography className="text-surface-accent-600 dark:text-surface-accent-400">
                        Are you sure you want to delete &quot;{file.name}&quot;?
                        This action cannot be undone.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button variant="text" onClick={() => setDeleteDialogOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="filled"
                        color="error"
                        onClick={() => {
                            setDeleteDialogOpen(false);
                            onDelete();
                        }}
                    >
                        Delete
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
    const currentPath = searchParams.get(STORAGE_PATH_PARAM) || searchParams.get("path") || "";
    const [loading, setLoading] = useState(true);
    /** Why the listing failed, classified — see `storage-failure.ts`. */
    const [failure, setFailure] = useState<StorageFailure | null>(null);
    const [error, setError] = useState<string | null>(null);

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
        setError(null);
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
            // fault — see `storage-failure.ts`. Rendering both the same way told
            // a customer with a working project that their storage was broken.
            setFailure(classifyStorageFailure(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // `selectedSourceKey` is a dep so switching backend re-lists; the
        // ref-sync effect above runs first, so `storageSourceRef` is current.
        fetchContents(currentPath);
    }, [currentPath, fetchContents, selectedSourceKey]);

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
        setSelectedFile(null);
        setSelectedDownloadUrl(null);
        setSelectedPaths(new Set());
        lastClickedRef.current = null;
    }, [setSearchParams]);

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
            message: `${uploadFiles.length} file${uploadFiles.length > 1 ? "s" : ""} uploaded successfully`
        });
        await fetchContents(currentPath);
    }, [currentPath, snackbarController, fetchContents]);

    // Create new folder
    const handleCreateFolder = useCallback(async () => {
        if (!newFolderName.trim() || !apiConfig?.apiUrl) return;

        // Validate folder name
        const name = newFolderName.trim();
        if (name.includes("/") || name.includes("\\")) {
            snackbarController.open({ type: "error",
message: "Folder name cannot contain slashes" });
            return;
        }

        // Check if folder already exists
        const existingFolder = folders.find(f => f.name === name);
        if (existingFolder) {
            snackbarController.open({ type: "error",
message: `Folder "${name}" already exists` });
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
                body: JSON.stringify({ path: folderPath })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: "Failed to create folder" }));
                throw new Error(err.error || "Failed to create folder");
            }

            snackbarController.open({ type: "success",
message: `Folder "${name}" created` });
            setNewFolderDialogOpen(false);
            setNewFolderName("");
            await fetchContents(currentPath);
        } catch (e) {
            snackbarController.open({ type: "error",
message: e instanceof Error ? e.message : String(e) });
        } finally {
            setCreatingFolder(false);
        }
    }, [newFolderName, currentPath, apiConfig, apiBase, snackbarController, fetchContents, folders]);

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
                message: `${droppedFiles.length} file${droppedFiles.length > 1 ? "s" : ""} uploaded successfully`
            });
            await fetchContents(currentPath);
        } catch (e) {
            snackbarController.open({
                type: "error",
                message: e instanceof Error ? e.message : String(e)
            });
        }
    }, [currentPath, snackbarController, fetchContents]);

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
message: `"${file.name}" deleted` });
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
    }, [currentPath, snackbarController, fetchContents, deleteFolderRecursive]);

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
message: `${items.length} item${items.length !== 1 ? "s" : ""} deleted` });
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
    }, [allItems, selectedPaths, currentPath, snackbarController, fetchContents, deleteFolderRecursive]);

    // Confirm delete for a single folder
    const handleConfirmDeleteFolder = useCallback(async () => {
        if (!deleteDialogTarget || deleteDialogTarget === "selection") return;
        setDeleting(true);
        try {
            await deleteFolderRecursive(deleteDialogTarget.fullPath);
            snackbarController.open({ type: "success",
message: `Folder "${deleteDialogTarget.name}" deleted` });
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
    }, [deleteDialogTarget, currentPath, snackbarController, fetchContents, deleteFolderRecursive]);

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

    const segments = breadcrumbSegments(currentPath);


    // ── Render file grid/list ──
    const renderContents = () => {
        if (loading) {
            return (
                <div className="flex-grow flex items-center justify-center">
                    <div className="text-center">
                        <CircularProgress size="medium"/>
                        <Typography variant="body2" className="mt-4 text-text-secondary dark:text-text-secondary-dark font-mono tracking-tight animate-pulse">
                            Loading...
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
                            This project&apos;s storage rules refused this listing
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary dark:text-text-secondary-dark block mt-2">
                            Nothing is wrong with the project. Its <code>storageAuthorize</code> hook
                            decides who may read which keys, and it declined this path for the
                            signed-in account — commonly because a listing must name a prefix the
                            rule recognises rather than the bucket root.
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
                        title="Could not read this project's storage"
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
                            This folder is empty
                        </Typography>
                        <div className="flex items-center gap-2 mt-3">
                            <Button variant="text" onClick={() => {
                                setNewFolderName("");
                                setNewFolderDialogOpen(true);
                            }}>
                                <FolderPlusIcon size={iconSize.smallest}/>
                                New folder
                            </Button>
                            <Button onClick={() => setUploadDialogOpen(true)}>
                                <PlusIcon size={iconSize.smallest}/>
                                Upload files
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
                                <th className="px-2 py-2 font-semibold">Name</th>
                                <th className="px-4 py-2 font-semibold w-24">Type</th>
                                <th className="px-4 py-2 font-semibold w-24 text-right">Size</th>
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
                                                : "hover:bg-surface-100 dark:hover:bg-surface-800"
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
                                                Folder
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
                                                : "hover:bg-surface-100 dark:hover:bg-surface-800"
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
                                                onClick={() => handleDeleteFile(file)}
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
                            Folders
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
                                            "hover:bg-surface-100 dark:hover:bg-surface-800 hover:shadow-sm",
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
                            Files ({files.length})
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
                                        <div className="aspect-square relative overflow-hidden bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
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
        <div className="flex h-full w-full bg-white dark:bg-surface-800 overflow-hidden text-text-primary dark:text-text-primary-dark">
            <div className="flex h-full w-full">
                {/* Main content */}
                <div className="flex-grow flex flex-col min-w-0 h-full">
                            {/* Toolbar */}
                            <div className={cls("flex items-center justify-between pr-2 border-b bg-white dark:bg-surface-800 shrink-0 h-10", defaultBorderMixin)}>
                                <div className="flex items-center gap-1.5 flex-grow overflow-hidden px-3 py-2">
                                    {/* Breadcrumbs — always visible */}
                                    {currentPath && (
                                        <Tooltip title="Go up">
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
                                                {selectedPaths.size} selected
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
                                                Delete
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
                                                Deselect
                                            </Button>
                                        </div>
                                    ) : !loading ? (
                                        <Chip size="small" className="shrink-0 text-[10px]">
                                            {files.length} file{files.length !== 1 ? "s" : ""}
                                            {folders.length > 0 ? `, ${folders.length} folder${folders.length !== 1 ? "s" : ""}` : ""}
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
                                                if (value) setSelectedSourceKey(value);
                                            }}
                                            renderValue={(key) => {
                                                const label = storageSources.registry[key]?.label;
                                                return label ?? (key === DEFAULT_STORAGE_SOURCE_KEY ? "Default" : key);
                                            }}>
                                            {sourceKeys.map((key) => (
                                                <SelectItem key={key} value={key}>
                                                    {storageSources.registry[key]?.label
                                                        ?? (key === DEFAULT_STORAGE_SOURCE_KEY ? "Default" : key)}
                                                </SelectItem>
                                            ))}
                                        </Select>
                                    )}

                                    <Tooltip title="Grid view">
                                        <IconButton
                                            size="small"
                                            onClick={() => setViewMode("grid")}
                                            className={cls(viewMode === "grid" && "bg-surface-100 dark:bg-surface-800")}
                                        >
                                            <LayoutGridIcon size={iconSize.smallest}/>
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="List view">
                                        <IconButton
                                            size="small"
                                            onClick={() => setViewMode("list")}
                                            className={cls(viewMode === "list" && "bg-surface-100 dark:bg-surface-800")}
                                        >
                                            <ListIcon size={iconSize.smallest}/>
                                        </IconButton>
                                    </Tooltip>

                                    <div className={cls("h-4 w-px mx-0.5", defaultBorderMixin, "bg-surface-200 dark:bg-surface-700")}/>

                                    <Tooltip title="Refresh">
                                        <IconButton size="small" onClick={handleRefresh} disabled={loading}>
                                            <RefreshCwIcon size={iconSize.smallest}/>
                                        </IconButton>
                                    </Tooltip>

                                    <Tooltip title="New folder">
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
                                        Upload
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
                                        <div className="flex flex-col items-center gap-2 p-6 rounded-xl border-2 border-dashed border-primary bg-white/80 dark:bg-surface-900/80">
                                            <UploadCloudIcon className="w-10 h-10 text-primary"/>
                                            <Typography variant="subtitle2" className="text-primary font-semibold">
                                                Drop files to upload
                                            </Typography>
                                            <Typography variant="caption" color="secondary">
                                                to /{currentPath || "root"}
                                            </Typography>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Status bar */}
                            <div className={cls("px-4 py-1.5 border-t bg-surface-50 dark:bg-surface-800 flex items-center justify-between shrink-0", defaultBorderMixin)}>
                                <div className="flex items-center gap-4 text-[11px]">
                                    <span className="text-text-disabled dark:text-text-disabled-dark font-semibold uppercase tracking-tighter">
                                        Path
                                    </span>
                                    <span className="font-mono text-text-secondary dark:text-text-secondary-dark">
                                        /{currentPath || ""}
                                    </span>
                                </div>
                                {selectedPaths.size > 0 ? (
                                    <div className="text-[11px] text-text-secondary dark:text-text-secondary-dark">
                                        {selectedPaths.size} item{selectedPaths.size !== 1 ? "s" : ""} selected
                                    </div>
                                ) : selectedFile ? (
                                    <div className="text-[11px] text-text-secondary dark:text-text-secondary-dark">
                                        Selected: <span className="font-mono">{selectedFile.name}</span>
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
                <DialogTitle hidden>Delete Confirmation</DialogTitle>
                <DialogContent>
                    <Typography variant="subtitle1" className="font-semibold mb-2">
                        {deleteDialogTarget === "selection"
                            ? `Delete ${selectedPaths.size} item${selectedPaths.size !== 1 ? "s" : ""}?`
                            : deleteDialogTarget
                                ? `Delete folder "${deleteDialogTarget.name}"?`
                                : "Delete?"}
                    </Typography>
                    <Typography variant="body2" color="secondary">
                        {deleteDialogTarget === "selection"
                            ? "This will permanently delete all selected files and folders, including their contents. This action cannot be undone."
                            : "This will permanently delete the folder and all of its contents. This action cannot be undone."}
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
                        Cancel
                    </Button>
                    <LoadingButton
                        color="error"
                        loading={deleting}
                        onClick={deleteDialogTarget === "selection" ? handleBulkDelete : handleConfirmDeleteFolder}
                    >
                        <Trash2Icon size={14} className="mr-1"/>
                        Delete
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
                <DialogTitle hidden>New Folder</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        size="small"
                        label="Folder name"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && newFolderName.trim()) {
                                e.preventDefault();
                                handleCreateFolder();
                            }
                        }}
                        disabled={creatingFolder}
                        placeholder="Enter folder name"
                    />
                    {currentPath && (
                        <Typography variant="caption" color="secondary" className="mt-2">
                            Will be created in <span className="font-mono">/{currentPath}/</span>
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
                        Cancel
                    </Button>
                    <LoadingButton
                        color="primary"
                        loading={creatingFolder}
                        disabled={!newFolderName.trim()}
                        onClick={handleCreateFolder}
                    >
                        <FolderPlusIcon size={14} className="mr-1"/>
                        Create
                    </LoadingButton>
                </DialogActions>
            </Dialog>
        </div>
    );
};
