import React, { useRef, useState } from "react";
import UploadFilesButton from "../UploadFilesButton";
import { useDataki } from "../../DatakiProvider";
import { ApiError, TeamFileRecord, uploadTeamFiles } from "../../api";
import { DataSource } from "../../types";
import { useSnackbarController } from "@rebasepro/core";

// Accept CSV and Excel files (extensions + common MIME types)
const ACCEPTED_FILE_TYPES = ".csv, .xls, .xlsx, text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel";

interface FileUploadButtonProps {
  teamId: string;
  className?: string;
  autoCloseMenu?: () => void; // optional callback to close parent menu
  onUploaded?: (created: TeamFileRecord[], dataSources?: DataSource[]) => Promise<void> | void;
  onUploadingChange?: (uploading: boolean) => void;
  onPickerOpen?: () => void;
  onPickerClose?: () => void;
  selectOnly?: boolean; // if true, just emit selected files without uploading (not used now but future safe)
}

/**
 * Unified component encapsulating the hidden file input + trigger button + upload flow.
 * Avoids duplicating logic across DataSourcesSelection and TeamFilesSection.
 */
export const FileUploadButton: React.FC<FileUploadButtonProps> = ({
  teamId,
  className,
  autoCloseMenu,
  onUploaded,
  onUploadingChange,
  onPickerOpen,
  onPickerClose,
  selectOnly
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dataki = useDataki();
  const snackbar = useSnackbarController();
  const [uploading, setUploading] = useState(false);

  const trigger = () => {
    // Notify parent that the OS picker will be opened so it can avoid auto-closing.
    onPickerOpen?.();
    // Add a one-time focus listener to detect when the OS file dialog is closed (including cancel).
    const onWindowFocus = () => {
      // Give a tiny delay to allow change event to fire first when files were selected.
      setTimeout(() => onPickerClose?.(), 50);
    };
    window.addEventListener("focus", onWindowFocus, { once: true });
    inputRef.current?.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || !fileList.length) {
      // If the user canceled the picker, ensure parent gets notified that the picker closed.
      onPickerClose?.();
      return;
    }
    const files = Array.from(fileList);
    if (selectOnly) {
      // Future extension point
      if (inputRef.current) inputRef.current.value = "";
      onPickerClose?.();
      return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    const total = files.length;
    snackbar.open({ type: "info", message: `Uploading ${total} file${total > 1 ? "s" : ""}...` });
    try {
      const token = await dataki.getDatakiAuthToken();
      const names = files.map(f => f.name.replace(/\.[^.]+$/, ""));
      const created = await uploadTeamFiles(token, dataki.apiEndpoint, teamId, files, names);
      snackbar.open({ type: "success", message: `Uploaded ${total} file${total > 1 ? "s" : ""}` });
      await onUploaded?.(created.files, created.dataSources);
      // Close parent menu only after a successful upload so the input stays mounted while the OS
      // file picker is open and during the upload flow.
      autoCloseMenu?.();
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : (e?.message || "Upload failed");
      console.error("File upload error", e);
      snackbar.open({ type: "error", message: msg });
    } finally {
      if (inputRef.current) inputRef.current.value = "";
      setUploading(false);
      onUploadingChange?.(false);
      // Notify parent the picker/upload flow finished so it can re-enable menu closing.
      onPickerClose?.();
    }
  };

  return (
    <>
      <UploadFilesButton
        className={className}
        onClick={trigger}
        selected={uploading}
      />
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={handleChange}
      />
    </>
  );
};

export default FileUploadButton;
