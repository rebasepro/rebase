import type { Properties } from "@rebasepro/types";
import type { ArrayProperty, MapProperty, Property, StringProperty } from "@rebasepro/types";
import { PreviewSize } from "../../types/components/PropertyPreviewProps";
import React from "react";
import { Skeleton, Table, TableBody, TableRow, TableCell, Typography } from "@rebasepro/ui";
import { getThumbnailMeasure } from "../util";

export interface SkeletonPropertyComponentProps {
    property: Property,
    size: PreviewSize
}

/**
 * @group Preview components
 */
export function SkeletonPropertyComponent({
    property,
    size
}: SkeletonPropertyComponentProps
) {

    if (!property) {
        console.error("No property assigned for skeleton component", property, size);
    }

    let content: React.ReactNode | any;
    if (property.type === "string") {
        const stringProperty = property as StringProperty;
        if (stringProperty.admin?.urlPreview) {
            content = renderUrlComponent(stringProperty, size);
        } else if (stringProperty.storage) {
            content = renderSkeletonImageThumbnail(size);
        } else {
            content = renderSkeletonText();
        }
    } else if (property.type === "array") {
        const arrayProperty = property as ArrayProperty;

        if (arrayProperty.of) {
            if (Array.isArray(arrayProperty.of)) {
                content = <>{arrayProperty.of.map((p, i) => renderGenericArrayCell(p, i))} </>;
            } else {
                if (arrayProperty.of.type === "map" && arrayProperty.of.properties) {
                    content = renderArrayOfMaps(arrayProperty.of.properties, size, arrayProperty.of.admin?.previewProperties);
                } else if (arrayProperty.of.type === "string") {
                    if (arrayProperty.of.enum) {
                        content = renderArrayEnumTableCell();
                    } else if (arrayProperty.of.storage) {
                        content = renderGenericArrayCell(arrayProperty.of);
                    } else {
                        content = renderArrayOfStrings();
                    }
                } else {
                    content = renderGenericArrayCell(arrayProperty.of);
                }
            }
        }

    } else if (property.type === "map") {
        content = renderMap(property as MapProperty, size);
    } else if (property.type === "date") {
        content = renderSkeletonText();
    } else if (property.type === "reference") {
        content = renderReference();
    } else if (property.type === "boolean") {
        content = renderSkeletonText();
    } else {
        content = renderSkeletonText();
    }
    return (content || null);
}

function renderMap<T extends Record<string, any>>(property: MapProperty, size: PreviewSize) {

    if (!property.properties)
        return <></>;

    let mapPropertyKeys: string[];
    if (size === "large") {
        mapPropertyKeys = Object.keys(property.properties);
    } else {
        mapPropertyKeys = (property.admin?.previewProperties || Object.keys(property.properties)) as string[];
        if (size === "medium")
            mapPropertyKeys = mapPropertyKeys.slice(0, 3);
        else if (size === "small")
            mapPropertyKeys = mapPropertyKeys.slice(0, 1);
    }

    if (size !== "large")
        return (
            <div
                className="w-full flex flex-col space-y-4"
            >
                {mapPropertyKeys.map((key, index) => (
                    <div key={`map_${key}`}>
                        {property.properties && property.properties[key] &&
                            <SkeletonPropertyComponent
                                property={property.properties[key]}
                                size={"medium"}/>}
                    </div>
                ))}
            </div>
        );

    return (
        <Table className="table-auto">
            <TableBody>
                {mapPropertyKeys &&
                    mapPropertyKeys.map((key, index) => {
                        return (
                            <TableRow
                                key={`map_preview_table__${index}`}>
                                <TableCell key={`table-cell-title--${key}`}
                                    className="align-top"
                                    style={{ width: "30%" }}>
                                    <Typography variant="caption" color="secondary">
                                        {property.properties![key].name}
                                    </Typography>
                                </TableCell>
                                <TableCell key={`table-cell-${key}`}
                                    style={{ width: "70%" }}>
                                    {property.properties && property.properties[key] &&
                                        <SkeletonPropertyComponent
                                            property={property.properties[key]}
                                            size={"medium"}/>}
                                </TableCell>
                            </TableRow>
                        );
                    })}
            </TableBody>
        </Table>
    );
}

function renderArrayOfMaps(properties: Properties, size: PreviewSize, previewProperties?: string[]) {
    let tableProperties = previewProperties;
    if (!tableProperties || !tableProperties.length) {
        tableProperties = Object.keys(properties) as string[];
        if (size)
            tableProperties = tableProperties.slice(0, 3);
    }

    return (
        <Table className="table-auto">
            <TableBody>
                {
                    [0, 1, 2].map((value, index) => {
                        return (
                            <TableRow key={`table_${value}_${index}`}>
                                {tableProperties && tableProperties.map(
                                    (key) => (
                                        <TableCell
                                            key={`table-cell-${key}`}
                                        >
                                            <SkeletonPropertyComponent
                                                property={(properties)[key]}
                                                size={"medium"}/>
                                        </TableCell>
                                    )
                                )}
                            </TableRow>
                        );
                    })}
            </TableBody>
        </Table>
    );
}

function renderArrayOfStrings() {
    return (
        <div className={"flex flex-col gap-2"}>
            {
                [0, 1].map((value, index) => (
                    renderSkeletonText(index)
                ))}
        </div>
    );
}

function renderArrayEnumTableCell() {
    return (
        <div className={"flex flex-col gap-2"}>
            {
                [0, 1].map((value, index) =>
                    <>
                        {renderSkeletonText(index)}
                    </>
                )}
        </div>
    );
}

function renderGenericArrayCell(
    property: Property,
    index = 0
) {
    return (

        <div key={"array_index_" + index}
            className={"flex flex-col gap-2"}>

            {
                [0, 1].map((value, index) =>
                    <>
                        <SkeletonPropertyComponent key={`i_${index}`}
                            property={property}
                            size={"medium"}/>
                    </>
                )}
        </div>
    );
}

function renderUrlAudioComponent() {
    return (
        <Skeleton width={300}
            height={100}/>
    );
}

export function renderSkeletonImageThumbnail(size: PreviewSize) {
    const imageSize = size === "small" ? 40 : size === "medium" ? 100 : 200;
    return (
        <Skeleton width={imageSize}
            height={imageSize}/>
    );
}

function renderUrlVideo(size: PreviewSize) {

    return (
        <Skeleton width={size !== "large" ? 300 : 500}
            height={size !== "large" ? 200 : 250}/>
    );
}

function renderReference() {
    return <Skeleton width={200} height={100}/>;
}

function renderUrlComponent(property: StringProperty, size: PreviewSize = "large") {

    if (typeof property.admin?.urlPreview === "boolean") {
        return <div style={{
            display: "flex"
        }}>
            {renderSkeletonIcon()}
            {renderSkeletonText()}
        </div>;
    }

    return renderUrlFile(size);
}

function renderUrlFile(size: PreviewSize) {

    return (
        <div
            className={`w-${getThumbnailMeasure(size)} h-${getThumbnailMeasure(size)}`}>
            {renderSkeletonIcon()}
        </div>
    );
}

export function renderSkeletonText(index?: number, width = 120) {
    return <Skeleton width={width} key={`skeleton_${index}`}/>;
}

export function renderSkeletonCaptionText(index?: number) {
    return <Skeleton
        height={20}/>;
}

export function renderSkeletonIcon() {
    return <Skeleton width={24} height={24}/>;
}
