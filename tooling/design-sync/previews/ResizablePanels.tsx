import React from "react";
import { ResizablePanels, Typography, cls, defaultBorderMixin } from "@rebasepro/ui";

// Not portaled — renders inline via flex-basis, but it fills its container
// (`w-full h-full`), so it needs an explicit-height wrapper to have
// somewhere to land.

const SidebarPanel = () => (
    <div className={cls("h-full p-2 bg-surface-50 dark:bg-surface-900 border-r", defaultBorderMixin)}>
        <Typography variant="caption" className="font-semibold uppercase tracking-wider text-text-disabled dark:text-text-disabled-dark px-2">Tables</Typography>
        <div className="mt-1 flex flex-col gap-0.5">
            {["users", "orders", "products"].map(t => (
                <div key={t} className="px-2 py-1 text-xs rounded hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer">{t}</div>
            ))}
        </div>
    </div>
);

const ContentPanel = () => (
    <div className="h-full p-4 flex items-center justify-center">
        <Typography variant="body2" color="secondary">SELECT * FROM orders LIMIT 50;</Typography>
    </div>
);

// Sidebar + content split, the SQL/RLS editor layout.
export const Horizontal = () => (
    <div className={cls("h-[280px] w-full border rounded-lg overflow-hidden", defaultBorderMixin)}>
        <ResizablePanels
            orientation="horizontal"
            firstPanel={<SidebarPanel/>}
            secondPanel={<ContentPanel/>}
            panelSizePercent={28}
            onPanelSizeChange={() => {}}
        />
    </div>
);

// Query editor over results, the stacked SQLEditor layout.
export const Vertical = () => (
    <div className={cls("h-[280px] w-full border rounded-lg overflow-hidden", defaultBorderMixin)}>
        <ResizablePanels
            orientation="vertical"
            firstPanel={
                <div className="h-full p-3 bg-surface-950 text-white font-mono text-xs flex flex-col gap-1">
                    <span>SELECT id, email, created_at</span>
                    <span>FROM users</span>
                    <span>WHERE active = true;</span>
                </div>
            }
            secondPanel={<div className="h-full p-3 text-xs text-text-secondary dark:text-text-secondary-dark">3 rows returned in 12ms</div>}
            panelSizePercent={60}
            onPanelSizeChange={() => {}}
        />
    </div>
);
