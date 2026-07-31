import React from "react";
import { FileUpload, Typography, Chip, UploadCloudIcon, FileTextIcon, XIcon, IconButton, cls, defaultBorderMixin } from "@rebasepro/ui";

// FileUpload's .d.ts has no `children` prop (the source's PropsWithChildren
// wrapper didn't survive extraction) — stick to `title`/`uploadDescription`,
// the documented content slots, rather than porting a `children` usage.
// It previously rendered blank on the floor card; the fix is giving it
// real `uploadDescription`/`title` content and a non-zero footprint.

export const Idle = () => (
    <div className="p-4 w-full max-w-md">
        <FileUpload
            size="large"
            accept={{ "text/csv": [".csv"], "application/json": [".json"] }}
            maxFiles={1}
            title="Import data"
            uploadDescription={<><UploadCloudIcon size={18}/> Drag and drop a CSV or JSON file, or click to browse</>}
            onFilesAdded={() => {}}
        />
    </div>
);

// Compact size for tight forms (e.g. an inline logo/avatar uploader).
export const Compact = () => (
    <div className="p-4 w-full max-w-sm">
        <FileUpload
            size="small"
            accept={{ "image/*": [".png", ".jpg", ".svg"] }}
            maxFiles={1}
            uploadDescription={<><UploadCloudIcon size={16}/> Upload logo</>}
            onFilesAdded={() => {}}
        />
    </div>
);

// Dropzone plus the surrounding file-list chrome a real import screen
// composes around it — FileUpload itself has no file-list UI, this is the
// caller-side pattern (mirrors ImportFileUpload in the admin package).
export const WithSelectedFiles = () => (
    <div className="p-4 w-full max-w-md flex flex-col gap-3">
        <FileUpload
            size="medium"
            accept={{ "text/csv": [".csv"] }}
            maxFiles={1}
            uploadDescription={<><UploadCloudIcon size={16}/> Drag and drop a file here or click to upload</>}
            onFilesAdded={() => {}}
        />
        <div className={cls("rounded-lg border divide-y", defaultBorderMixin)}>
            <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                    <FileTextIcon size={16} className="text-text-disabled dark:text-text-disabled-dark shrink-0"/>
                    <Typography variant="body2" className="truncate">orders_export.csv</Typography>
                    <Chip size="smallest" colorScheme="green">Ready</Chip>
                </div>
                <IconButton size="small" aria-label="Remove file"><XIcon size={14}/></IconButton>
            </div>
        </div>
    </div>
);
