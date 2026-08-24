import React from "react";
import { DefaultCellRenderer, Typography } from "@rebasepro/ui";
import type { CollectionPropertyConfig } from "@rebasepro/ui";

const row = { id: "proj-1" };

const cases: { label: string; property: CollectionPropertyConfig; value: unknown }[] = [
    { label: "string", property: { type: "string", name: "Name" }, value: "Website Redesign" },
    { label: "string / enum", property: { type: "string", name: "Status", enum: { in_progress: { label: "In Progress", color: "blue" } } }, value: "in_progress" },
    { label: "string / url", property: { type: "string", name: "Site", url: true }, value: "https://rebase.pro" },
    { label: "string / email", property: { type: "string", name: "Contact", email: true }, value: "alice@example.com" },
    { label: "string / previewAsTag", property: { type: "string", name: "Tag", previewAsTag: true }, value: "frontend" },
    { label: "string / storage", property: { type: "string", name: "Cover", storage: true }, value: "" },
    { label: "number", property: { type: "number", name: "Progress" }, value: 65 },
    { label: "number / enum", property: { type: "number", name: "Priority", enum: { 3: { label: "High", color: "orange" } } }, value: 3 },
    { label: "boolean", property: { type: "boolean", name: "Active" }, value: true },
    { label: "date", property: { type: "date", name: "Created" }, value: "2026-07-15" },
    { label: "date / date_time", property: { type: "date", name: "Updated", mode: "date_time" }, value: "2026-07-30T14:32:00Z" },
    { label: "array / strings", property: { type: "array", name: "Tags", of: { type: "string", name: "Tag" } }, value: ["frontend", "design"] },
    { label: "array / enum", property: { type: "array", name: "Labels", of: { type: "string", name: "Label", enum: { p1: { label: "P1", color: "red" }, p2: { label: "P2", color: "yellow" } } } }, value: ["p1", "p2"] },
    { label: "map", property: { type: "map", name: "Metadata", properties: {} }, value: { source: "web", campaign: "q3" } },
    { label: "reference", property: { type: "reference", name: "Owner" }, value: "users/alice-johnson" },
    { label: "geopoint", property: { type: "geopoint", name: "Location" }, value: { lat: 40.7128, lng: -74.006 } },
    { label: "null value", property: { type: "string", name: "Notes" }, value: null }
];

export function TypeGallery() {
    return (
        <div className="grid grid-cols-3 gap-4 w-full">
            {cases.map(({ label, property, value }) => (
                <div key={label} className="rounded-lg border border-surface-200 dark:border-surface-800 p-3">
                    <Typography variant="caption" color="secondary" className="font-mono">{label}</Typography>
                    <div className="mt-2 flex items-center" style={{ minHeight: 32 }}>
                        <DefaultCellRenderer
                            row={row}
                            propertyKey={label}
                            property={property}
                            value={value}
                            size="medium"
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}
