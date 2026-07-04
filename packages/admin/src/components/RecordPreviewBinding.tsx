import type { CollectionConfig } from "@rebasepro/types";
import type { Property } from "@rebasepro/types";
import * as React from "react";
import { useEffect, useMemo } from "react";

import { Snapshot } from "@rebasepro/types";
import type { PreviewSize } from "../types/components/PropertyPreviewProps";
import { getSnapshotImagePreviewPropertyKey } from "@rebasepro/common";
import {
    ArrowRightToLineIcon,
    cls,
    defaultBorderMixin,
    IconButton,
    Skeleton,
    Tooltip,
    Typography
} from "@rebasepro/ui";
import { PropertyPreview, SkeletonPropertyComponent } from "../preview";
import {
    useAuthController,
    useCustomizationController,
    useData,
    ErrorView
} from "@rebasepro/core";
import { useAnalyticsController } from "@rebasepro/core";
import { IconForView } from "@rebasepro/core";
import { getPropertyInPath } from "../util/property_utils";
import { getSnapshotPreviewKeys, getSnapshotTitlePropertyKey } from "../util/previews";
import { getValueInPath } from "@rebasepro/utils";
import { useCollectionRegistryController, useSidePanel } from "../index";

export type RecordPreviewBindingProps = {
    size?: PreviewSize,
    actions?: React.ReactNode,
    collection?: CollectionConfig,
    hover?: boolean;
    previewKeys?: string[],
    disabled?: boolean,
    snapshot: Snapshot<any>,
    includeId?: boolean,
    includeTitle?: boolean,
    includeSnapshotLink?: boolean,
    includeImage?: boolean,
    onClick?: (e: React.SyntheticEvent) => void;
    onSidePanelClick?: (snapshot: Snapshot) => void,
};

export type RecordPreviewBindingDataProps = {
    size?: "smallest" | "small" | "medium" | "large",
    actions?: React.ReactNode,
    collection?: CollectionConfig,
    previewKeys?: string[],
    snapshot: Snapshot<any>,
    onSidePanelClick?: (snapshot: Snapshot) => void,
    includeId?: boolean,
    includeTitle?: boolean,
    includeSnapshotLink?: boolean,
    includeImage?: boolean,
};

/**
 * This component contains the main logic and content for displaying a snapshot preview,
 * without any container wrapper. Used internally by RecordPreviewBinding.
 */
export function RecordPreviewBindingData({
    actions,
    collection: collectionProp,
    previewKeys,
    size = "medium",
    includeId = true,
    onSidePanelClick,
    includeTitle = true,
    includeSnapshotLink = true,
    includeImage = true,
    snapshot
}: RecordPreviewBindingDataProps) {

    const authController = useAuthController();
    const analyticsController = useAnalyticsController();
    const sidePanelController = useSidePanel();
    const customizationController = useCustomizationController();

    const collectionRegistryController = useCollectionRegistryController();

    const collection = collectionProp ?? collectionRegistryController.getCollection(snapshot.path);

    const listProperties = useMemo(() => {
        if (!collection) return [];
        return previewKeys ?? getSnapshotPreviewKeys(authController, collection, customizationController.propertyConfigs, previewKeys, size === "medium" || size === "large" ? 3 : 2);
    }, [previewKeys, collection, size, authController, customizationController.propertyConfigs]);

    if (!collection) {
        return (
            <>
                <ErrorView error={`Collection not found: ${snapshot.path}`}/>
            </>
        );
    }

    const titleProperty = includeTitle ? getSnapshotTitlePropertyKey(collection, customizationController.propertyConfigs) : undefined;
    const imagePropertyKey = includeImage ? getSnapshotImagePreviewPropertyKey(collection) : undefined;
    const imageProperty = imagePropertyKey ? collection.properties[imagePropertyKey] : undefined;
    const ofProp = imageProperty && "of" in imageProperty ? imageProperty.of : undefined;
    const usedImageProperty = ofProp ? (Array.isArray(ofProp) ? ofProp[0] : ofProp) : imageProperty;
    const restProperties = listProperties.filter(p => p !== titleProperty && p !== imagePropertyKey);

    const imageValue = imagePropertyKey ? getValueInPath(snapshot.values, imagePropertyKey) : undefined;
    const usedImageValue = imageProperty !== undefined ? ("of" in imageProperty
        ? (((imageValue as unknown[]) ?? []).length > 0
            ? (imageValue as unknown[])[0] : undefined)
        : imageValue)
        : undefined;

    return (
        <>
            <div className={cls("flex  shrink-0", {
                "w-6 h-6 mx-1 my-0.5": size === "small" || size === "smallest",
                "w-8 h-8 ml-1 mr-2 m-2 self-start": size === "medium",
                "w-10 h-10 ml-2 mr-2 m-2 self-start": size === "large"
            })}>
                {usedImageProperty && usedImageValue ? <PropertyPreview property={usedImageProperty}
                    propertyKey={imagePropertyKey as string}
                    size={"small"}
                    value={usedImageValue as never}/> : null}
                {(!usedImageProperty || !usedImageValue) ? <IconForView collectionOrView={collection}
                    color={"primary"}
                    size={size}
                    className={"m-auto"}/> : null}
            </div>

            <div
                className={"flex flex-col grow w-full m-1 shrink min-w-0 text-text-primary dark:text-text-primary-dark flex-1 mr-2"}>

                {includeId && (
                    snapshot
                        ? <div className={"block whitespace-nowrap overflow-hidden truncate"}>
                            <Typography variant={"caption"}
                                color={"disabled"}
                                className={"font-mono"}>
                                {snapshot.id}
                            </Typography>
                        </div>
                        : <Skeleton/>)}

                {titleProperty && (
                    <div
                        className={"truncate my-0.5 text-sm font-medium text-text-primary dark:text-text-primary-dark"}>
                        {
                            snapshot
                                ? <PropertyPreview
                                    propertyKey={titleProperty as string}
                                    value={getValueInPath(snapshot.values, titleProperty) as never}
                                    property={collection.properties[titleProperty as string] as Property}
                                    size={"medium"}/>
                                : <SkeletonPropertyComponent
                                    property={collection.properties[titleProperty as string] as Property}
                                    size={"medium"}/>
                        }
                    </div>
                )}

                {restProperties && restProperties.map((key) => {
                    const childProperty = getPropertyInPath(collection.properties, key);
                    if (!childProperty) return null;

                    const valueInPath = getValueInPath(snapshot.values, key);
                    return (
                        <div key={"ref_prev_" + key}
                            className={cls("truncate", restProperties.length > 1 ? "my-0.5" : "my-0")}>
                            {
                                snapshot
                                    ? <PropertyPreview
                                        propertyKey={key as string}
                                        value={valueInPath as never}
                                        property={childProperty as Property}
                                        size={"small"}/>
                                    : <SkeletonPropertyComponent
                                        property={childProperty as Property}
                                        size={"small"}/>
                            }
                        </div>
                    );
                })}

            </div>

            {snapshot && includeSnapshotLink &&
                <div className="flex-shrink-0">
                    <Tooltip title={`See details for ${snapshot.id}`} className={"shrink-0"}>
                        <IconButton
                            color={"inherit"}
                            size={"small"}
                            className={size !== "small" ? "self-start" : ""}
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                onSidePanelClick?.(snapshot);
                                analyticsController.onAnalyticsEvent?.("snapshot_click_from_reference", {
                                    path: snapshot.path,
                                    snapshotId: snapshot.id
                                });
                                sidePanelController.open({
                                    snapshotId: snapshot.id,
                                    path: snapshot.path,
                                    collection,
                                    updateUrl: true
                                });
                            }}>
                            <ArrowRightToLineIcon/>
                        </IconButton>
                    </Tooltip>
                </div>}

            {actions && <div className="flex-shrink-0">{actions}</div>}
        </>
    );
}

export function RecordPreviewBindingWithId({
    snapshotId,
    path,
    ...props
}: Omit<RecordPreviewBindingProps, "snapshot"> & {
    snapshotId: string | number;
    path: string;
    databaseId?: string;
}) {

    const [snapshot, setSnapshot] = React.useState<Snapshot | undefined>();
    const [dataLoading, setDataLoading] = React.useState(false);
    const dataClient = useData();

    useEffect(() => {
        let isMounted = true;
        if (!snapshotId || !path) {
            setSnapshot(undefined);
            return;
        }
        const fetchOne = async () => {
            setDataLoading(true);
            try {
                const fetchedSnapshot = await dataClient.collection(path).findById(snapshotId);
                if (isMounted) {
                    setSnapshot(fetchedSnapshot);
                }
            } catch (error) {
                console.error("Error fetching snapshot:", error);
                if (isMounted) {
                    setSnapshot(undefined);
                }
            } finally {
                if (isMounted) {
                    setDataLoading(false);
                }
            }
        }

        fetchOne();

        return () => {
            isMounted = false;
        }
    }, [snapshotId, path]);

    if (dataLoading && !snapshot) {
        return (
            <SnapshotPreviewContainer
                hover={props.hover}
                size={props.size}>
                <Skeleton/>
            </SnapshotPreviewContainer>
        );
    }

    if (!snapshot) {
        return (
            <SnapshotPreviewContainer
                hover={props.hover}
                size={props.size}>
                <div className={"text-text-secondary dark:text-text-secondary-dark"}>
                    Snapshot not found
                </div>
            </SnapshotPreviewContainer>
        );
    }

    return <RecordPreviewBindingData
        {...props}
        snapshot={snapshot}/>;
}

/**
 * This view is used to display a preview of a snapshot.
 * It is used by default in reference fields and whenever a reference is displayed.
 */
export function RecordPreviewBinding({
    actions,
    disabled,
    hover,
    collection,
    previewKeys,
    onClick,
    size = "medium",
    includeId = true,
    includeTitle = true,
    includeSnapshotLink = true,
    includeImage = true,
    onSidePanelClick,
    snapshot
}: RecordPreviewBindingProps) {

    return (
        <SnapshotPreviewContainer
            onClick={disabled ? undefined : onClick}
            hover={disabled ? undefined : hover}
            size={size}>
            <RecordPreviewBindingData
                actions={actions}
                collection={collection}
                previewKeys={previewKeys}
                size={size}
                includeId={includeId}
                includeTitle={includeTitle}
                includeSnapshotLink={includeSnapshotLink}
                includeImage={includeImage}
                onSidePanelClick={onSidePanelClick}
                snapshot={snapshot}
            />
        </SnapshotPreviewContainer>
    );
}

export type SnapshotPreviewContainerProps = {
    children: React.ReactNode;
    hover?: boolean;
    fullwidth?: boolean;
    size?: PreviewSize;
    className?: string;
    style?: React.CSSProperties;
    onClick?: (e: React.SyntheticEvent) => void;
};

export const SnapshotPreviewContainer = React.forwardRef<HTMLDivElement, SnapshotPreviewContainerProps>(({
    children,
    hover,
    onClick,
    size = "medium",
    style,
    className,
    fullwidth = true,
    ...props
}, ref) => {
    return <div
        ref={ref}
        tabIndex={0}
        style={style}
        className={cls(
            "bg-white dark:bg-surface-900",
            size === "small" ? "min-h-[32px]" : "min-h-[44px]",
            fullwidth ? "w-full" : "",
            "items-center",
            hover ? "hover:bg-surface-accent-50 dark:hover:bg-surface-800 group-hover:bg-surface-accent-50 dark:group-hover:bg-surface-800" : "",
            size === "small" ? "p-1" : "px-2 py-1",
            "flex border rounded-lg",
            onClick ? "cursor-pointer" : "",
            defaultBorderMixin,
            className)}
        role={onClick ? "button" : undefined}
        onClick={(event) => {
            if (onClick) {
                event.preventDefault();
                onClick(event);
            }
        }}
        onKeyDown={(event) => {
            if (onClick && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onClick(event);
            }
        }}
        {...props}>
        {children}
    </div>;
});

SnapshotPreviewContainer.displayName = "SnapshotPreviewContainer";
