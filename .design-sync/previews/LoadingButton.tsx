import React from "react";
import { LoadingButton, SaveIcon } from "@rebasepro/ui";

// Ported from UIReferenceView's "LoadingButton" section.
export const States = () => (
    <div className="flex flex-wrap gap-3 p-4">
        <LoadingButton loading={true}>Saving…</LoadingButton>
        <LoadingButton loading={false}>Idle</LoadingButton>
        <LoadingButton disabled>Disabled</LoadingButton>
    </div>
);

export const Variants = () => (
    <div className="flex flex-wrap gap-3 p-4">
        <LoadingButton variant="filled" loading>Publishing…</LoadingButton>
        <LoadingButton variant="outlined" loading>Exporting…</LoadingButton>
        <LoadingButton variant="text" loading>Loading…</LoadingButton>
    </div>
);

export const Sizes = () => (
    <div className="flex flex-wrap items-end gap-3 p-4">
        {(["small", "medium", "large", "xl", "2xl"] as const).map(size => (
            <LoadingButton key={size} size={size} loading>{size}</LoadingButton>
        ))}
    </div>
);

export const WithStartIcon = () => (
    <div className="flex flex-wrap gap-3 p-4">
        <LoadingButton startIcon={<SaveIcon size={18}/>} loading={false}>Save changes</LoadingButton>
        <LoadingButton startIcon={<SaveIcon size={18}/>} loading={true}>Save changes</LoadingButton>
    </div>
);
