import React from "react";
import { Tabs, Tab, Typography, IconButton, SettingsIcon, cls, defaultBorderMixin } from "@rebasepro/ui";

// The .d.ts only lists `variant?: "standard" | "boxy" | "pill"` — no
// "default". UIReferenceView labels its first example "variant=\"default\""
// but never actually passes that string; it just omits `variant`, which
// defaults to "standard". Sweeping standard/boxy/pill below.

export const Standard = () => (
    <div className="p-4">
        <Tabs value="schema" onValueChange={() => {}}>
            <Tab value="schema">Schema</Tab>
            <Tab value="snippets">Snippets</Tab>
            <Tab value="history">History</Tab>
        </Tabs>
    </div>
);

// Editor-sidebar pattern (SQLEditorSidebar / RLSEditor): boxy tab bar +
// section header, ported from UIReferenceView's "Tabs" section.
export const Boxy = () => (
    <div className="p-4">
        <div className={cls("border rounded-lg overflow-hidden w-[320px]", defaultBorderMixin)}>
            <Tabs value="schema" onValueChange={() => {}} variant="boxy" className={cls("border-b", defaultBorderMixin)}>
                <Tab value="schema">Schema</Tab>
                <Tab value="snippets">Snippets</Tab>
                <Tab value="history">History</Tab>
            </Tabs>
            <div className={cls("p-3 border-b flex justify-between items-center bg-surface-50 dark:bg-surface-900", defaultBorderMixin)}>
                <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark">Tables</Typography>
                <IconButton size="small" aria-label="Settings"><SettingsIcon size={14}/></IconButton>
            </div>
            <div className="p-3 h-20">
                <Typography variant="caption" color="secondary">public.users, public.orders, public.products</Typography>
            </div>
        </div>
    </div>
);

// Compact status-filter pattern.
export const Pill = () => (
    <div className="p-4">
        <Tabs value="all" onValueChange={() => {}} variant="pill">
            <Tab value="all">All</Tab>
            <Tab value="published">Published</Tab>
            <Tab value="draft">Draft</Tab>
            <Tab value="archived">Archived</Tab>
        </Tabs>
    </div>
);
