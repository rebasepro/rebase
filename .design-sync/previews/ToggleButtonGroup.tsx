import React from "react";
import { ToggleButtonGroup, ListIcon, LayoutGridIcon, KanbanIcon } from "@rebasepro/ui";

// Contract fixed by the orchestrator (generics dropped by the .d.ts
// extractor): { value, onValueChange, options: { value, label, icon?,
// disabled? }[], className? }.
export const Basic = () => (
    <div className="p-4">
        <ToggleButtonGroup
            value="list"
            onValueChange={() => {}}
            options={[
                { value: "list", label: "List" },
                { value: "grid", label: "Grid" },
                { value: "kanban", label: "Kanban" }
            ]}
        />
    </div>
);

export const WithIcons = () => (
    <div className="p-4">
        <ToggleButtonGroup
            value="grid"
            onValueChange={() => {}}
            options={[
                { value: "list", label: "List", icon: <ListIcon size={16}/> },
                { value: "grid", label: "Grid", icon: <LayoutGridIcon size={16}/> },
                { value: "kanban", label: "Board", icon: <KanbanIcon size={16}/> }
            ]}
        />
    </div>
);

export const Disabled = () => (
    <div className="p-4">
        <ToggleButtonGroup
            value="day"
            onValueChange={() => {}}
            options={[
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month", disabled: true }
            ]}
        />
    </div>
);
