import React from "react";
import { ImageIcon } from "lucide-react";
import { cls } from "../../util";
import { Typography } from "../../components/Typography";
import { Chip } from "../../components/Chip";
import { BooleanSwitch } from "../../components/BooleanSwitch";
import { Markdown } from "../../components/Markdown";
import { Tooltip } from "../../components/Tooltip";
import { iconSize } from "../../icons";
import type { CellRendererProps, CollectionPropertyConfig, CollectionEnumValueConfig } from "./CollectionViewTypes";

// ——— Helpers ———

/**
 * Resolve an enum key to its display label and optional color.
 */
function resolveEnumLabel(
    enumValues: CollectionPropertyConfig["enum"],
    value: unknown
): { label: string; color?: string } | undefined {
    if (!enumValues) return undefined;
    const key = String(value);
    if (enumValues instanceof Map) {
        const config: CollectionEnumValueConfig | undefined = enumValues.get(value as string | number);
        if (!config) return undefined;
        if (typeof config === "string") return { label: config };
        return { label: config.label, color: config.color };
    }
    const config: CollectionEnumValueConfig | undefined = enumValues[key];
    if (!config) return undefined;
    if (typeof config === "string") return { label: config };
    return { label: config.label, color: config.color };
}

/**
 * Format a date value using Intl.DateTimeFormat.
 */
function formatDate(value: unknown, includeTime: boolean): string {
    if (value == null) return "—";
    const date = value instanceof Date ? value : new Date(String(value));
    if (isNaN(date.getTime())) return String(value);

    const options: Intl.DateTimeFormatOptions = includeTime
        ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
        : { year: "numeric", month: "short", day: "numeric" };

    return new Intl.DateTimeFormat(undefined, options).format(date);
}

/**
 * Type guard for geopoint-like objects.
 */
function isGeoPoint(value: unknown): value is { lat: number; lng: number } {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.lat === "number" && typeof obj.lng === "number";
}

// ——— Component ———

/**
 * Default cell renderer for the headless CollectionView.
 * Handles all built-in property types without depending on any Rebase core types.
 *
 * @group Preview components
 */
export function DefaultCellRenderer({
    row,
    propertyKey,
    property,
    value,
    size,
    width,
    height
}: CellRendererProps) {

    // 1. Null / undefined → em-dash
    if (value === null || value === undefined) {
        return (
            <Typography variant="body2"
                        color="secondary"
                        className="px-1">
                —
            </Typography>
        );
    }

    // 2. Custom Preview component override
    if (property.Preview) {
        const PreviewComponent = property.Preview;
        return (
            <PreviewComponent
                row={row}
                propertyKey={propertyKey}
                property={property}
                value={value}
                size={size}
                width={width}
                height={height}
            />
        );
    }

    // ——— Type-specific renderers ———

    switch (property.type) {
        case "string":
            return renderString(property, value);

        case "number":
            return renderNumber(property, value);

        case "boolean":
            return renderBoolean(value);

        case "date":
            return renderDate(property, value);

        case "array":
            return renderArray(property, value);

        case "map":
            return renderMap(value);

        case "reference":
        case "relation":
            return renderReference(value);

        case "geopoint":
            return renderGeopoint(value);

        default:
            return (
                <Typography variant="body2"
                            color="secondary"
                            noWrap
                            className="px-1">
                    {JSON.stringify(value)}
                </Typography>
            );
    }
}

// ——— Per-type render functions ———

function renderString(property: CollectionPropertyConfig, value: unknown): React.ReactElement {
    const strValue = String(value);

    // Enum → Chip
    if (property.enum) {
        const resolved = resolveEnumLabel(property.enum, value);
        return (
            <Chip size="small"
                  colorScheme={resolved?.color ? { color: resolved.color, text: "#fff" } : undefined}>
                {resolved?.label ?? strValue}
            </Chip>
        );
    }

    // Preview as tag → Chip
    if (property.previewAsTag) {
        return (
            <Chip size="small">
                {strValue}
            </Chip>
        );
    }

    // URL → clickable link
    if (property.url) {
        const href = typeof property.url === "string" ? property.url : strValue;
        return (
            <Typography variant="body2"
                        noWrap
                        component="a"
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cls(
                            "px-1 text-primary hover:underline cursor-pointer"
                        )}>
                {strValue}
            </Typography>
        );
    }

    // Email → mailto link
    if (property.email) {
        return (
            <Typography variant="body2"
                        noWrap
                        component="a"
                        href={`mailto:${strValue}`}
                        className={cls(
                            "px-1 text-primary hover:underline cursor-pointer"
                        )}>
                {strValue}
            </Typography>
        );
    }

    // Markdown → rendered markdown
    if (property.markdown) {
        return (
            <div className="px-1 max-h-[100px] overflow-hidden">
                <Markdown source={strValue} size="small" />
            </div>
        );
    }

    // Storage → image preview with fallback
    if (property.storage) {
        return (
            <div className={cls(
                "px-1 flex items-center justify-center",
                "w-[40px] h-[40px] rounded overflow-hidden"
            )}>
                {strValue ? (
                    <img
                        src={strValue}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            const target = e.currentTarget;
                            target.style.display = "none";
                            const fallback = target.nextElementSibling;
                            if (fallback instanceof HTMLElement) {
                                fallback.style.display = "flex";
                            }
                        }}
                    />
                ) : null}
                <div className={cls(
                    "w-full h-full items-center justify-center rounded",
                    "bg-surface-100 dark:bg-surface-800 text-text-secondary dark:text-text-secondary-dark",
                    strValue ? "hidden" : "flex"
                )}>
                    <ImageIcon size={iconSize.small} />
                </div>
            </div>
        );
    }

    // Default string → truncated text
    return (
        <Tooltip title={strValue.length > 50 ? strValue : undefined}
                 side="bottom">
            <Typography variant="body2"
                        noWrap
                        className="px-1">
                {strValue}
            </Typography>
        </Tooltip>
    );
}

function renderNumber(property: CollectionPropertyConfig, value: unknown): React.ReactElement {
    const numStr = String(value);

    // Enum → Chip
    if (property.enum) {
        const resolved = resolveEnumLabel(property.enum, value);
        return (
            <Chip size="small"
                  colorScheme={resolved?.color ? { color: resolved.color, text: "#fff" } : undefined}>
                {resolved?.label ?? numStr}
            </Chip>
        );
    }

    // Default → right-aligned
    return (
        <Typography variant="body2"
                    noWrap
                    align="right"
                    className="px-1 tabular-nums">
            {numStr}
        </Typography>
    );
}

function renderBoolean(value: unknown): React.ReactElement {
    return (
        <div className="px-1 flex items-center">
            <BooleanSwitch value={!!value}
                           size="small"
                           disabled />
        </div>
    );
}

function renderDate(property: CollectionPropertyConfig, value: unknown): React.ReactElement {
    const includeTime = property.mode === "date_time";
    const formatted = formatDate(value, includeTime);

    return (
        <Typography variant="body2"
                    noWrap
                    className="px-1 tabular-nums">
            {formatted}
        </Typography>
    );
}

function renderArray(property: CollectionPropertyConfig, value: unknown): React.ReactElement {
    if (!Array.isArray(value)) {
        return (
            <Typography variant="body2"
                        color="secondary"
                        className="px-1">
                —
            </Typography>
        );
    }

    // Array of enum values → row of chips
    if (property.of?.enum && value.length > 0) {
        return (
            <div className="px-1 flex flex-wrap gap-1 overflow-hidden">
                {value.map((item, i) => {
                    const resolved = resolveEnumLabel(property.of!.enum, item);
                    return (
                        <Chip key={i}
                              size="smallest"
                              colorScheme={resolved?.color ? { color: resolved.color, text: "#fff" } : undefined}>
                            {resolved?.label ?? String(item)}
                        </Chip>
                    );
                })}
            </div>
        );
    }

    // Array of strings → comma-separated
    if (value.length > 0 && value.every((item) => typeof item === "string")) {
        return (
            <Typography variant="body2"
                        noWrap
                        className="px-1">
                {(value as string[]).join(", ")}
            </Typography>
        );
    }

    // Generic array → item count
    return (
        <Typography variant="body2"
                    color="secondary"
                    className="px-1">
            {value.length} {value.length === 1 ? "item" : "items"}
        </Typography>
    );
}

function renderMap(value: unknown): React.ReactElement {
    if (typeof value !== "object" || value === null) {
        return (
            <Typography variant="body2"
                        color="secondary"
                        className="px-1">
                —
            </Typography>
        );
    }

    const fieldCount = Object.keys(value as Record<string, unknown>).length;
    return (
        <Typography variant="body2"
                    color="secondary"
                    className="px-1">
            {fieldCount} {fieldCount === 1 ? "field" : "fields"}
        </Typography>
    );
}

function renderReference(value: unknown): React.ReactElement {
    return (
        <Typography variant="body2"
                    noWrap
                    className="px-1">
            {String(value)}
        </Typography>
    );
}

function renderGeopoint(value: unknown): React.ReactElement {
    if (isGeoPoint(value)) {
        return (
            <Typography variant="body2"
                        noWrap
                        className="px-1 tabular-nums">
                {value.lat.toFixed(6)}, {value.lng.toFixed(6)}
            </Typography>
        );
    }

    return (
        <Typography variant="body2"
                    color="secondary"
                    className="px-1">
            {String(value)}
        </Typography>
    );
}
