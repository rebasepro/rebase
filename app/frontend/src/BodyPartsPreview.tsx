import React from "react";
import type { PropertyPreviewProps } from "@rebasepro/admin";
import type { ArrayProperty, StringProperty, EnumValueConfig } from "@rebasepro/types";
import { Chip, cls, Tooltip } from "@rebasepro/ui";
import { resolveEnumValues } from "@rebasepro/common";

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
 * Renders compact colored chips for each selected body part.
 * Resolves labels from the property's enum definition to stay
 * in sync with the collection config.
 */
export default function BodyPartsPreview({
    propertyKey,
    value,
    property,
    size
}: PropertyPreviewProps<ArrayProperty>) {
    if (!value || !Array.isArray(value) || value.length === 0) return null;

    const ofProperty = property.of as StringProperty;
    const enumValues: EnumValueConfig[] = ofProperty.enum
        ? resolveEnumValues(ofProperty.enum) ?? []
        : [];

    const labelMap = new Map<string, string>();
    for (const ev of enumValues) {
        labelMap.set(String(ev.id), ev.label ?? String(ev.id));
    }

    const isSmall = size === "small";

    return (
        <div className={cls("flex flex-wrap gap-1", isSmall && "gap-0.5")}>
            {value.map((partId: string) => {
                const label = labelMap.get(partId) ?? partId;
                const color = BODY_PART_COLORS[partId] ?? "#9e9e9e";

                return (
                    <Tooltip title={label} key={partId}>
                        <span
                            className={cls(
                                "inline-flex items-center rounded-full font-medium",
                                isSmall
                                    ? "text-[10px] leading-none px-1.5 py-0.5"
                                    : "text-xs px-2 py-0.5"
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
                                    isSmall ? "w-1.5 h-1.5 mr-1" : "w-2 h-2 mr-1.5"
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
