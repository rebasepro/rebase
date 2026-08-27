import React from "react";
import type { PropertyPreviewProps } from "@rebasepro/cms";
import type { ArrayProperty, EnumValueConfig, StringProperty } from "@rebasepro/types";
import { cls, Tooltip } from "@rebasepro/ui";
import { resolveEnumValues } from "@rebasepro/common";

import { HOTSPOT_ZONES } from "./BodyPartsField";
import bodyFrontImg from "./assets/body_front.png";
import bodyBackImg from "./assets/body_back.png";

/**
 * Color mapping for body regions — groups related body parts under a
 * shared color to give the preview visual structure at a glance.
 */
const BODY_PART_COLORS: Record<string, string> = {
    // Upper body - push
    chest: "#e57373",
    shoulders: "#ef5350",
    triceps: "#f06292",
    // Upper body - pull
    upper_back: "#64b5f6",
    biceps: "#42a5f5",
    forearms: "#29b6f6",
    // Core
    abs: "#ffb74d",
    obliques: "#ffa726",
    lower_back: "#ff8a65",
    // Lower body
    quads: "#66bb6a",
    glutes: "#4caf50",
    hamstrings: "#43a047",
    calves: "#81c784",
    hip_flexors: "#a5d6a7",
    // Head
    head_neck: "#b39ddb"
};

/**
 * Custom preview component for the `body_parts` array property.
 *
 * Renders compact colored chips for each selected body part when small.
 * Renders interactive visual body diagrams (front + back) with highlighted
 * regions when medium or large.
 */
export default function BodyPartsPreview({
                                             propertyKey,
                                             value,
                                             property,
                                             size
                                         }: PropertyPreviewProps<ArrayProperty>) {

    const ofProperty = property.of as StringProperty;
    const enumValues: EnumValueConfig[] = ofProperty.enum
        ? resolveEnumValues(ofProperty.enum) ?? []
        : [];

    const labelMap = new Map<string, string>();
    for (const ev of enumValues) {
        labelMap.set(String(ev.id), ev.label ?? String(ev.id));
    }

    const [hoveredPart, setHoveredPart] = React.useState<string | null>(null);

    const isSmall = size === "small";

    if (!value || !Array.isArray(value) || value.length === 0) return null;

    if (isSmall) {
        return (
            <div className={cls("flex flex-wrap gap-1", "gap-0.5")}>
                {value.map((partId: string) => {
                    const label = labelMap.get(partId) ?? partId;
                    const color = BODY_PART_COLORS[partId] ?? "#9e9e9e";

                    return (
                        <Tooltip title={label} key={partId}>
                            <span
                                className={cls(
                                    "inline-flex items-center rounded-full font-medium",
                                    "text-[10px] leading-none px-1.5 py-0.5"
                                )}
                                style={{
                                    backgroundColor: `${color}22`,
                                    color: color,
                                    border: `1px solid ${color}44`
                                }}
                            >
                                <span
                                    className={cls(
                                        "rounded-full shrink-0",
                                        "w-1.5 h-1.5 mr-1"
                                    )}
                                    style={{ backgroundColor: color }}
                                />
                                {label}
                            </span>
                        </Tooltip>
                    );
                })}
            </div>
        );
    }

    const isCompact = size === "medium";

    const renderBodyView = (view: "front" | "back", imgSrc: string) => (
        <div
            className={cls("relative", isCompact ? "h-24 w-fit" : "w-full")}
            style={isCompact ? undefined : { maxWidth: 240 }}
        >
            <img
                src={imgSrc}
                alt={`Body ${view} view`}
                draggable={false}
                className={cls(
                    "block select-none opacity-40 dark:invert dark:brightness-125",
                    isCompact ? "h-full w-auto" : "w-full h-auto"
                )}
            />

            {/* Hotspot overlays */}
            {enumValues.map((entry) => {
                const partId = String(entry.id);
                const zones = HOTSPOT_ZONES[partId];
                if (!zones) return null;

                const isSelected = value.includes(partId);
                if (!isSelected) return null;

                const color = BODY_PART_COLORS[partId] ?? "#9e9e9e";

                return zones
                    .filter((z) => z.view === view)
                    .map((zone, i) => {
                        const isHovered = hoveredPart === partId;
                        return (
                            <div
                                key={`${partId}-${view}-${i}`}
                                onMouseEnter={() => setHoveredPart(partId)}
                                onMouseLeave={() => setHoveredPart(null)}
                                title={entry.label ?? partId}
                                className="absolute rounded transition-all duration-150 z-10"
                                style={{
                                    top: `${zone.top}%`,
                                    left: `${zone.left}%`,
                                    width: `${zone.width}%`,
                                    height: `${zone.height}%`,
                                    backgroundColor: isHovered ? `${color}88` : `${color}55`,
                                    border: isHovered ? `2px solid ${color}` : `1.5px solid ${color}`,
                                    boxShadow: isHovered ? `0 0 8px ${color}` : "none",
                                    zIndex: 2
                                }}
                            />
                        );
                    });
            })}
        </div>
    );

    return (
        <div
            className={cls(
                "flex rounded-xl border bg-surface-50 dark:bg-surface-900 border-surface-200 dark:border-surface-800 w-fit",
                isCompact ? "gap-2 p-1" : "gap-6 p-3"
            )}
        >
            {renderBodyView("front", bodyFrontImg)}
            {renderBodyView("back", bodyBackImg)}
        </div>
    );
}
