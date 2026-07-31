import React, { useState } from "react";
import { CollectionViewToolbar, IconButton, PlusIcon, FilterIcon } from "@rebasepro/ui";
import type { CollectionViewMode, CollectionViewSize } from "@rebasepro/ui";

export function Default() {
    const [viewMode, setViewMode] = useState<CollectionViewMode>("table");
    const [size, setSize] = useState<CollectionViewSize>("m");
    const [search, setSearch] = useState<string | undefined>(undefined);

    return (
        <div className="w-full rounded-lg border border-surface-200 dark:border-surface-800 overflow-hidden">
            <CollectionViewToolbar
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                enabledViews={["list", "table", "cards", "kanban"]}
                size={size}
                onSizeChange={setSize}
                searchString={search}
                onSearchChange={setSearch}
                actionsStart={
                    <IconButton size="small">
                        <FilterIcon size={16} />
                    </IconButton>
                }
                actionsEnd={
                    <IconButton size="small">
                        <PlusIcon size={16} />
                    </IconButton>
                }
            />
        </div>
    );
}

export function KanbanGrouping() {
    const [viewMode, setViewMode] = useState<CollectionViewMode>("kanban");
    const [selectedKanbanProperty, setSelectedKanbanProperty] = useState("status");

    return (
        <div className="w-full rounded-lg border border-surface-200 dark:border-surface-800 overflow-hidden">
            <CollectionViewToolbar
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                enabledViews={["list", "table", "cards", "kanban"]}
                searchString={undefined}
                onSearchChange={() => {}}
                loading={false}
                kanbanPropertyOptions={[
                    { key: "status", label: "Status" },
                    { key: "priority", label: "Priority" }
                ]}
                selectedKanbanProperty={selectedKanbanProperty}
                onKanbanPropertyChange={setSelectedKanbanProperty}
            />
        </div>
    );
}
