import React from "react";
import { Typography } from "@rebasepro/ui";

// The full type scale. Ported from UIReferenceView's "Typography" section —
// the pangram is what makes the Instrument Sans / Inter split legible.
export const Scale = () => (
    <div className="flex flex-col gap-3 p-4">
        {(["h1", "h2", "h3", "h4", "h5", "h6", "subtitle1", "subtitle2", "body1", "body2", "caption", "label", "button"] as const).map(v => (
            <div key={v} className="flex items-baseline gap-4 border-b border-surface-200 dark:border-surface-700 pb-3 last:border-0">
                <span className="w-20 shrink-0 text-xs text-surface-400 font-mono">{v}</span>
                <Typography variant={v}>The quick brown fox jumps over the lazy dog</Typography>
            </div>
        ))}
    </div>
);

export const Colors = () => (
    <div className="flex flex-col gap-2 p-4">
        {(["primary", "secondary", "disabled", "error"] as const).map(c => (
            <Typography key={c} color={c}>color=&quot;{c}&quot; — the quick brown fox</Typography>
        ))}
    </div>
);

// Headings pair with body copy in real screens; this is the combination the
// two-face split (Instrument Sans headings, Inter body) is designed around.
export const InContext = () => (
    <div className="max-w-[520px] p-4">
        <Typography variant="h3" gutterBottom>Row level security</Typography>
        <Typography variant="subtitle2" color="secondary" gutterBottom>
            Policies are evaluated per row, for every read and write.
        </Typography>
        <Typography variant="body1" gutterBottom>
            A policy binds a Postgres expression to an operation. When a request
            arrives, the server sets the request&apos;s role and lets Postgres decide
            which rows are visible — the API never filters in application code.
        </Typography>
        <Typography variant="caption" color="secondary">
            Last updated 12 minutes ago
        </Typography>
    </div>
);

export const Alignment = () => (
    <div className="flex flex-col gap-2 w-[380px] p-4">
        {(["left", "center", "right", "justify"] as const).map(a => (
            <Typography key={a} align={a} className="border-b border-surface-200 dark:border-surface-700 pb-2">
                align=&quot;{a}&quot; — the quick brown fox jumps over the lazy dog
            </Typography>
        ))}
    </div>
);
