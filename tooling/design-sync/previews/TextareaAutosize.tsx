import React from "react";
import { TextareaAutosize } from "@rebasepro/ui";

// A headless autosizing primitive with no built-in field chrome (see
// packages/ui/src/components/VirtualTable/fields/VirtualTableInput.tsx — the
// real consumer supplies all styling via className/style). Wrap it in the
// same field-box treatment TextField/DateTimeField use so the preview isn't
// browser-default text.
export const Basic = () => (
    <div className="rounded-lg bg-surface-accent-200/50 dark:bg-white/[0.055] p-3 w-[320px] m-4">
        <TextareaAutosize
            className="w-full bg-transparent outline-none text-base resize-none"
            minRows={2}
            value={"Policies are evaluated per row, for every read and write."}
            onChange={() => {}}
        />
    </div>
);

export const WithMinMaxRows = () => (
    <div className="rounded-lg bg-surface-accent-200/50 dark:bg-white/[0.055] p-3 w-[320px] m-4">
        <TextareaAutosize
            className="w-full bg-transparent outline-none text-base resize-none"
            minRows={3}
            maxRows={6}
            value={"Grows with content until it reaches maxRows, then scrolls.\nLine two.\nLine three.\nLine four.\nLine five.\nLine six.\nLine seven — this one scrolls."}
            onChange={() => {}}
        />
    </div>
);
