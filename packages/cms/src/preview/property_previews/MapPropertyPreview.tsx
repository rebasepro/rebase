import type { MapProperty } from "@rebasepro/types";
import React from "react";

import type { PropertyPreviewProps } from "../../types/components/PropertyPreviewProps";
import { PropertyPreview } from "../PropertyPreview";
import { cls, defaultBorderMixin, Typography } from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { EmptyValue } from "../components/EmptyValue";

/**
 * @group Preview components
 */
export function MapPropertyPreview({
    propertyKey,
    value,
    property,
    size,
    compact
}: PropertyPreviewProps<MapProperty>) {

    if (property.type !== "map") {
        throw Error("Picked wrong preview component MapPropertyPreview");
    }

    const mapProperty = property as MapProperty;

    // A map is a table — a row per sub-property — and a card line has room for
    // neither the rows nor the borders between them.
    if (compact) {
        return <CompactMapPreview property={mapProperty}
            value={value as Record<string, unknown> | undefined}/>;
    }

    if (!mapProperty.properties || Object.keys(mapProperty.properties ?? {}).length === 0) {
        return (
            <KeyValuePreview value={value}/>
        );
    }

    if (!value) return null;
    const mapValue = value as Record<string, unknown>;

    const mapPropertyKeys: string[] = Object.keys(mapProperty.properties)

    if (size === "small")
        return (
            <div className="w-full flex flex-col space-y-1 md:space-y-2">
                {mapPropertyKeys.map((key, index) => (
                    <div key={`map_${key}`}>
                        <ErrorBoundary
                            key={"map_preview_" + mapProperty.name + key + index}>
                            <PropertyPreview propertyKey={key}
                                value={mapValue[key]}
                                property={mapProperty.properties![key]}
                                // entity={entity}
                                size={size}/>
                        </ErrorBoundary>
                    </div>
                ))}
            </div>
        );

    return (
        <div
            className="flex flex-col gap-1 w-full">
            {mapPropertyKeys &&
                mapPropertyKeys.map((key, index) => {
                    const childProperty = mapProperty.properties![key];
                    const isArrayOrMap = childProperty.type === "map" || childProperty.type === "array";
                    return (
                        <div
                            key={`map_preview_table_${key}}`}
                            className={cls(defaultBorderMixin, "last:border-b-0 border-b")}>
                            <div
                                className={"flex flex-row pt-0.5 pb-0.5 gap-2"}>
                                <div
                                    className="min-w-[140px] w-[25%] py-1">
                                    <Typography variant={"caption"}
                                        className={"break-words font-semibold"}
                                        color={"secondary"}>
                                        {childProperty.name}
                                    </Typography>
                                </div>
                                <div
                                    className="grow max-w-[75%]">
                                    <ErrorBoundary>
                                        {!isArrayOrMap &&
                                            <PropertyPreview
                                                propertyKey={key}
                                                value={mapValue[key]}
                                                property={childProperty}
                                                // entity={entity}
                                                size={size}/>}
                                    </ErrorBoundary>
                                </div>
                            </div>

                            {isArrayOrMap &&
                                <div className={cls(defaultBorderMixin, "border-l pl-4 ml-2 my-2")}>
                                    <PropertyPreview
                                        propertyKey={key}
                                        value={mapValue[key]}
                                        property={childProperty}
                                        // entity={entity}
                                        size={size}/>
                                </div>
                            }
                        </div>
                    );
                })}
        </div>
    );

}

/** How many leaf values a one-line map summary shows before it gives up. */
const COMPACT_MAP_ENTRIES = 3;

/**
 * A map in one line: its first few leaf values, labelled, joined by dots.
 *
 * Nested maps and arrays are skipped rather than flattened — a line that says
 * `[object Object]` is worse than a line that says nothing about that field —
 * and a map with no leaves at all falls back to stating its size, which is at
 * least true.
 */
function CompactMapPreview({
    property,
    value
}: { property: MapProperty, value: Record<string, unknown> | undefined }) {

    if (!value || typeof value !== "object") return <EmptyValue/>;

    const declared = property.properties;
    const keys = declared ? Object.keys(declared) : Object.keys(value);

    const parts: string[] = [];
    for (const key of keys) {
        if (parts.length >= COMPACT_MAP_ENTRIES) break;
        const childValue = value[key];
        if (childValue === undefined || childValue === null || childValue === "") continue;
        if (typeof childValue === "object") continue;
        const label = declared?.[key]?.name ?? key;
        parts.push(`${label}: ${String(childValue)}`);
    }

    if (parts.length === 0) {
        const count = Object.keys(value).length;
        return <Typography variant={"caption"}
            color={"secondary"}
            className={"truncate"}>
            {count === 1 ? "1 field" : `${count} fields`}
        </Typography>;
    }

    return <span className={"truncate text-sm"}>{parts.join(" · ")}</span>;
}

export function KeyValuePreview({ value }: { value: any }) {
    if (typeof value !== "object") return null;
    if (!value) return <EmptyValue/>;
    return <div
        className="flex flex-col gap-1 w-full">
        {
            Object.entries(value).map(([key, childValue]: [string, any]) => (
                <div
                    key={`map_preview_table_${key}}`}
                    className={cls(defaultBorderMixin, "last:border-b-0 border-b")}>
                    <div
                        className={"flex flex-row pt-0.5 pb-0.5 gap-2"}>
                        <div
                            key={`table-cell-title-${key}-${key}`}
                            className="min-w-[140px] w-[25%] py-1">
                            <Typography variant={"caption"}
                                className={"font-semibold break-words"}
                                color={"secondary"}>
                                {key}
                            </Typography>
                        </div>
                        <div
                            className="grow max-w-[75%]">
                            {childValue && typeof childValue !== "object" && <Typography>
                                <ErrorBoundary>
                                    {childValue.toString()}
                                </ErrorBoundary>
                            </Typography>}
                        </div>
                    </div>
                    {typeof childValue === "object" &&
                        <div className={cls(defaultBorderMixin, "border-l pl-4")}>
                            <KeyValuePreview value={childValue}/>
                        </div>
                    }
                </div>
            ))
        }
    </div>;
}
