import React from "react";
import { Tabs, Tab, cls, defaultBorderMixin, Button } from "@rebasepro/ui";

// Tab only renders as a child of Tabs (reads its `variant` from Tabs'
// internal context) — full parent composition below. Tabs is not
// portaled, so this renders inline and doesn't need cardMode overrides.

// Standard variant with a disabled tab, sweeping the `disabled` prop.
export const StandardWithDisabled = () => (
    <div className="p-4">
        <Tabs value="overview" onValueChange={() => {}}>
            <Tab value="overview">Overview</Tab>
            <Tab value="policies">Policies</Tab>
            <Tab value="danger" disabled>Danger zone</Tab>
        </Tabs>
    </div>
);

// Boxy toolbar tabs with leading icons, ported from UIReferenceView's
// "Toolbar Tabs" SQL-editor pattern.
export const BoxyWithIcons = () => (
    <div className="p-4">
        <div className={cls("border rounded-lg overflow-hidden flex items-center justify-between pr-2 bg-white dark:bg-surface-950", defaultBorderMixin)}>
            <Tabs value="query1" onValueChange={() => {}} variant="boxy" className="w-[unset] flex-shrink-0">
                <Tab value="query1" className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
                    Query 1
                </Tab>
                <Tab value="query2" className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
                    Query 2
                </Tab>
            </Tabs>
            <Button variant="text" size="small">Run</Button>
        </div>
    </div>
);
