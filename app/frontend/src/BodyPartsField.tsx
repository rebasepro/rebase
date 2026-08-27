import React, { useCallback, useMemo } from "react";
import type { FieldProps } from "@rebasepro/cms";
import type { ArrayProperty } from "@rebasepro/types";
import { Typography, cls, defaultBorderMixin, fieldBackgroundMixin } from "@rebasepro/ui";

import bodyFrontImg from "./assets/body_front.png";
import bodyBackImg from "./assets/body_back.png";

/**
 * Hotspot zone: a percentage-based rectangle placed over the body image.
 * `view` controls whether the zone appears on the "front" or "back" illustration.
 */
export interface HotspotZone {
    top: number;
    left: number;
    width: number;
    height: number;
    view: "front" | "back";
}

/**
 * Clickable hotspot zones positioned over the body images.
 * Coordinates are percentages relative to each image container.
 * Keyed by the enum ID from the collection definition.
 */
export const HOTSPOT_ZONES: Record<string, HotspotZone[]> = {
    // Head: y=4-18%, x=45-55% (centered head/neck region)
    head_neck: [
        { top: 4,
left: 42,
width: 16,
height: 15,
view: "front" }
    ],
    // Shoulders: y=20-24%, the deltoid caps where arms meet torso
    // Front: body widens from ~43% to ~37% at y=20-24%
    shoulders: [
        { top: 19,
left: 36,
width: 10,
height: 6,
view: "front" },
        { top: 19,
left: 54,
width: 10,
height: 6,
view: "front" }
    ],
    // Chest: y=24-32%, torso center x=36-64%
    chest: [
        { top: 23,
left: 37,
width: 26,
height: 10,
view: "front" }
    ],
    // Biceps (front upper arm): y=26-36%, arms at x=33-38% and x=62-67%
    biceps: [
        { top: 26,
left: 33,
width: 6,
height: 10,
view: "front" },
        { top: 26,
left: 61,
width: 6,
height: 10,
view: "front" }
    ],
    // Triceps (back upper arm): y=26-36%, same arm area on back view
    triceps: [
        { top: 26,
left: 33,
width: 7,
height: 10,
view: "back" },
        { top: 26,
left: 60,
width: 7,
height: 10,
view: "back" }
    ],
    // Forearms: y=38-50%, arms at x=30-38% and x=62-70%
    forearms: [
        { top: 37,
left: 29,
width: 8,
height: 13,
view: "front" },
        { top: 37,
left: 63,
width: 8,
height: 13,
view: "front" }
    ],
    // Abs: y=32-44%, center of torso x=43-57%
    abs: [
        { top: 33,
left: 43,
width: 14,
height: 12,
view: "front" }
    ],
    // Obliques: y=32-42%, sides of torso x=36-43% and x=57-64%
    obliques: [
        { top: 33,
left: 36,
width: 8,
height: 10,
view: "front" },
        { top: 33,
left: 56,
width: 8,
height: 10,
view: "front" }
    ],
    // Upper back: y=20-34%, torso x=36-64%
    upper_back: [
        { top: 20,
left: 38,
width: 24,
height: 14,
view: "back" }
    ],
    // Lower back: y=34-44%, torso x=40-60%
    lower_back: [
        { top: 34,
left: 40,
width: 20,
height: 10,
view: "back" }
    ],
    // Hip flexors: y=44-50%, inner hip area x=42-58%
    hip_flexors: [
        { top: 44,
left: 40,
width: 20,
height: 7,
view: "front" }
    ],
    // Glutes: y=44-54%, back hip area x=42-58%
    glutes: [
        { top: 44,
left: 40,
width: 20,
height: 10,
view: "back" }
    ],
    // Quads: y=52-66%, legs at x=40-48% and x=52-60%
    quads: [
        { top: 51,
left: 39,
width: 10,
height: 16,
view: "front" },
        { top: 51,
left: 51,
width: 10,
height: 16,
view: "front" }
    ],
    // Hamstrings: y=54-64%, back of legs same x
    hamstrings: [
        { top: 54,
left: 40,
width: 10,
height: 12,
view: "back" },
        { top: 54,
left: 50,
width: 10,
height: 12,
view: "back" }
    ],
    // Calves: y=68-84%, lower legs x=41-47% and x=53-59%
    calves: [
        { top: 68,
left: 40,
width: 8,
height: 16,
view: "front" },
        { top: 68,
left: 52,
width: 8,
height: 16,
view: "front" }
    ]
};

/**
 * Custom field component for the `body_parts` property.
 * Renders two real human body illustrations (front + back) with
 * clickable hotspot overlays mapped to the collection's enum values.
 *
 * Labels and IDs are read from `property.of.enum` so the component
 * always stays in sync with the collection definition.
 */
export default function BodyPartsField({
    value,
    setValue,
    property,
    showError,
    error,
    disabled
}: FieldProps<ArrayProperty>) {

    // ── Derive available parts from the property enum ──────────
    const enumEntries = useMemo(() => {
        const ofProp = property.of;
        if (!ofProp || !("enum" in ofProp) || !Array.isArray(ofProp.enum)) return [];
        return ofProp.enum as Array<{ id: string; label: string }>;
    }, [property]);

    const labelMap = useMemo(() => {
        const m = new Map<string, string>();
        enumEntries.forEach((e) => m.set(e.id, e.label));
        return m;
    }, [enumEntries]);

    const selected: string[] = useMemo(
        () => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []),
        [value]
    );

    const [hoveredPart, setHoveredPart] = React.useState<string | null>(null);

    const toggle = useCallback(
        (partId: string) => {
            if (disabled) return;
            const next = selected.includes(partId)
                ? selected.filter((s) => s !== partId)
                : [...selected, partId];
            setValue(next);
        },
        [disabled, selected, setValue]
    );


    /** Render one body view with its hotspot overlays */
    const renderBodyView = (view: "front" | "back", imgSrc: string) => (
        <div className="relative w-full" style={{ maxWidth: 260 }}>
            <img
                src={imgSrc}
                alt={`Body ${view} view`}
                draggable={false}
                className="w-full h-auto block select-none opacity-50 dark:invert dark:brightness-125"
            />

            {/* Hotspot overlays */}
            {enumEntries.map((entry) => {
                const zones = HOTSPOT_ZONES[entry.id];
                if (!zones) return null;

                return zones
                    .filter((z) => z.view === view)
                    .map((zone, i) => {
                        const isActive = selected.includes(entry.id);
                        const isHovered = hoveredPart === entry.id;

                        return (
                            <div
                                key={`${entry.id}-${view}-${i}`}
                                onClick={() => toggle(entry.id)}
                                onMouseEnter={() => setHoveredPart(entry.id)}
                                onMouseLeave={() => setHoveredPart(null)}
                                title={entry.label}
                                className={cls(
                                    "absolute rounded-md transition-all duration-150",
                                    // Use outline instead of border to prevent layout shift
                                    isActive
                                        ? "bg-primary/30 outline outline-2 outline-primary/70"
                                        : isHovered
                                            ? "bg-primary/15 outline outline-2 outline-primary/30"
                                            : "outline outline-2 outline-transparent",
                                    disabled ? "cursor-default" : "cursor-pointer"
                                )}
                                style={{
                                    top: `${zone.top}%`,
                                    left: `${zone.left}%`,
                                    width: `${zone.width}%`,
                                    height: `${zone.height}%`,
                                    zIndex: 2
                                }}
                            />
                        );
                    });
            })}
        </div>
    );

    return (
        <div className="flex flex-col gap-3">
            <Typography variant="label" color="secondary">
                {property.name}
            </Typography>

            <div className="flex gap-4 items-start flex-wrap">
                {/* ── Body diagrams ─────────────────────────────── */}
                <div
                    className={cls(
                        "rounded-xl border p-2",
                        defaultBorderMixin,
                        "bg-surface-50 dark:bg-surface-900"
                    )}
                >
                    <div className="flex gap-2">
                        <div className="flex flex-col items-center">
                            {renderBodyView("front", bodyFrontImg)}
                            <Typography variant="caption" color="secondary" className="mt-1 uppercase tracking-wider text-[10px]">
                                Front
                            </Typography>
                        </div>
                        <div className="flex flex-col items-center">
                            {renderBodyView("back", bodyBackImg)}
                            <Typography variant="caption" color="secondary" className="mt-1 uppercase tracking-wider text-[10px]">
                                Back
                            </Typography>
                        </div>
                    </div>

                    {/* Hovered part tooltip */}
                    <div className="h-5 mt-1 flex items-center justify-center">
                        {hoveredPart && (
                            <Typography variant="caption" color="primary" className="font-semibold text-center">
                                {labelMap.get(hoveredPart) ?? hoveredPart}
                                {selected.includes(hoveredPart) ? " ✓" : ""}
                            </Typography>
                        )}
                    </div>
                </div>

                {/* ── Right panel: quick select grid ─────────────── */}
                <div className="flex-1 min-w-[220px]">
                    <div className="grid grid-cols-2 gap-1">
                        {enumEntries.map((entry) => {
                            const isActive = selected.includes(entry.id);
                            const isHovered = hoveredPart === entry.id;
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => toggle(entry.id)}
                                    onMouseEnter={() => setHoveredPart(entry.id)}
                                    onMouseLeave={() => setHoveredPart(null)}
                                    className={cls(
                                        "flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg transition-all duration-150 text-left",
                                        "outline outline-1",
                                        isActive
                                            ? "outline-primary/50 bg-primary/10 text-primary font-semibold"
                                            : isHovered
                                                ? "outline-primary/30 bg-primary/5 text-surface-600 dark:text-surface-300"
                                                : "outline-transparent text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200",
                                        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                                    )}
                                >
                                    <span
                                        className={cls(
                                            "w-2 h-2 rounded-full shrink-0 transition-colors duration-150",
                                            isActive
                                                ? "bg-primary"
                                                : "bg-surface-300 dark:bg-surface-600"
                                        )}
                                    />
                                    {entry.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Error display */}
            {showError && error && (
                <Typography variant="caption" color="error" className="mt-1">
                    {error}
                </Typography>
            )}

            {/* Description */}
            {property.description && (
                <Typography variant="caption" color="secondary">
                    {property.description}
                </Typography>
            )}
        </div>
    );
}
