import type { MapProperty } from "@rebasepro/cms-types";
import React from "react";

import type { PropertyPreviewProps } from "../../types/components/PropertyPreviewProps";
import { PropertyPreview } from "../PropertyPreview";
import { cls, defaultBorderMixin, Typography } from "@rebasepro/ui";
import { ErrorBoundary } from "@rebasepro/ui";
import { EmptyValue } from "../components/EmptyValue";
import { useTranslation } from "@rebasepro/app";
import { summarizeDocument, type DocumentSummary, type DocumentSummaryPart } from "../document_summary";

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
            value={value as Record<string, unknown> | unknown[] | undefined}/>;
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

/**
 * A map in one line: its top-level keys — its `previewFields` when it has
 * them — labelled, each with its value when that is short and plain, `n items`
 * for a list and `n fields` for a nested object, which is not opened. See
 * {@link summarizeDocument}.
 */
function CompactMapPreview({
    property,
    value
}: { property: MapProperty, value: Record<string, unknown> | unknown[] | undefined }) {
    const summary = summarizeDocument(value, {
        properties: property.properties,
        order: property.propertiesOrder,
        keys: property.admin?.previewProperties
    });
    return <DocumentSummaryLine summary={summary}/>;
}

/**
 * Draws a {@link DocumentSummary}: `Label value · Label 3 items`, the labels
 * in the secondary ink, on one line that truncates.
 *
 * @group Preview components
 */
export function DocumentSummaryLine({ summary }: { summary: DocumentSummary }) {
    const { t } = useTranslation();

    if (summary.kind === "empty") return <EmptyValue/>;
    if (summary.kind === "items") {
        return <Typography variant={"body2"} component={"span"} className={"block truncate"}>
            {t("preview_items_count", { count: summary.count })}
        </Typography>;
    }

    const valueOf = (entry: DocumentSummaryPart): string => {
        switch (entry.kind) {
            case "text": return entry.text;
            case "boolean": return entry.value ? t("yes") : t("no");
            case "items": return t("preview_items_count", { count: entry.count });
            case "fields": return t("preview_fields_count", { count: entry.count });
        }
    };

    return <Typography variant={"body2"} component={"span"} className={"block truncate"}>
        {summary.parts.map((entry, index) => (
            <React.Fragment key={`${entry.label}_${index}`}>
                {index > 0 && <Typography component={"span"} variant={"inherit"} color={"disabled"}>{" · "}</Typography>}
                <Typography component={"span"} variant={"inherit"} color={"secondary"}>{entry.label}</Typography>
                {" "}
                {valueOf(entry)}
            </React.Fragment>
        ))}
    </Typography>;
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
