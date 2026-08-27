
import type { Property } from "@rebasepro/types";
import * as React from "react";
import { useEffect, useMemo } from "react";

import { Entity } from "@rebasepro/types";
import type { PreviewSize } from "../types/components/PropertyPreviewProps";
import { getEntityImagePreviewPropertyKey } from "@rebasepro/app";
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
} from "@rebasepro/app";
import { useAnalyticsController } from "@rebasepro/app";
import { IconForView } from "@rebasepro/app";
import { getPropertyInPath } from "../util/property_utils";
import { resolveCollectionSlotKeys } from "./CollectionViewBinding/usePreviewSlots";
import { useEntityTitle } from "../hooks/useEntityDisplay";
import { getValueInPath } from "@rebasepro/utils";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useSidePanel } from "../hooks/useSidePanel";
import { NestedEntityPreviewBoundary } from "./EntityPreviewNesting";
import type { AdminCollection } from "@rebasepro/cms-types";

export type EntityPreviewBindingProps = {
    size?: PreviewSize,
    actions?: React.ReactNode,
    collection?: AdminCollection,
    hover?: boolean;
    previewKeys?: string[],
    disabled?: boolean,
    entity: Entity<any>,
    includeId?: boolean,
    includeTitle?: boolean,
    includeEntityLink?: boolean,
    includeImage?: boolean,
    onClick?: (e: React.SyntheticEvent) => void;
    onSidePanelClick?: (entity: Entity) => void,
};

export type EntityPreviewBindingDataProps = {
    size?: "smallest" | "small" | "medium" | "large",
    actions?: React.ReactNode,
    collection?: AdminCollection,
    previewKeys?: string[],
    entity: Entity<any>,
    onSidePanelClick?: (entity: Entity) => void,
    includeId?: boolean,
    includeTitle?: boolean,
    includeEntityLink?: boolean,
    includeImage?: boolean,
};

/**
 * This component contains the main logic and content for displaying a entity preview,
 * without any container wrapper. Used internally by EntityPreviewBinding.
 */
export function EntityPreviewBindingData({
    actions,
    collection: collectionProp,
    previewKeys,
    size = "medium",
    includeId = true,
    onSidePanelClick,
    includeTitle = true,
    includeEntityLink = true,
    includeImage = true,
    entity
}: EntityPreviewBindingDataProps) {

    const authController = useAuthController();
    const analyticsController = useAnalyticsController();
    const sidePanelController = useSidePanel();
    const customizationController = useCustomizationController();

    const collectionRegistryController = useCollectionRegistryController();

    const collection = collectionProp ?? collectionRegistryController.getCollection(entity.path);

    // Above the `!collection` return, because hooks are. `useEntityTitle`
    // tolerates a missing collection for exactly this reason.
    const title = useEntityTitle({
        collection,
        entity
    });

    // What the card says under the title.
    //
    // A stated list wins outright — `previewProperties` is the one place a
    // developer says "show these", and nothing here is allowed to second-guess
    // it. Failing that, the card fills the same slots as every other surface
    // that renders one record in a row: a supporting line and a status. It used
    // to take the first few properties in declaration order instead, which is
    // how an author card ended up rendering an entire Markdown biography.
    const statedKeys = previewKeys ?? (collection?.previewProperties as string[] | undefined);
    const listProperties = useMemo(() => {
        if (!collection) return [];
        if (statedKeys && statedKeys.length > 0) {
            return statedKeys.filter(key => getPropertyInPath(collection.properties, key));
        }
        const slotKeys = resolveCollectionSlotKeys(
            collection as AdminCollection<Record<string, unknown>>,
            authController,
            customizationController.propertyConfigs);
        return [slotKeys.subtitleKey, slotKeys.statusKey].filter(Boolean) as string[];
    }, [statedKeys, collection, authController, customizationController.propertyConfigs]);

    if (!collection) {
        return (
            <>
                <ErrorView error={`Collection not found: ${entity.path}`}/>
            </>
        );
    }

    const titleProperty = includeTitle ? title.source?.key : undefined;
    const imagePropertyKey = includeImage ? getEntityImagePreviewPropertyKey(collection) : undefined;
    const imageProperty = imagePropertyKey ? collection.properties[imagePropertyKey] : undefined;
    const ofProp = imageProperty && "of" in imageProperty ? imageProperty.of : undefined;
    const usedImageProperty = ofProp ? (Array.isArray(ofProp) ? ofProp[0] : ofProp) : imageProperty;
    const restProperties = listProperties.filter(p => p !== titleProperty && p !== imagePropertyKey);

    const imageValue = imagePropertyKey ? getValueInPath(entity.values, imagePropertyKey) : undefined;
    const usedImageValue = imageProperty !== undefined ? ("of" in imageProperty
        ? (((imageValue as unknown[]) ?? []).length > 0
            ? (imageValue as unknown[])[0] : undefined)
        : imageValue)
        : undefined;

    return (
        // Everything below renders *inside* this preview: a reference or
        // relation among the preview properties collapses to one line instead
        // of nesting another bordered card with its own id and action button.
        <NestedEntityPreviewBoundary>
            {/* `overflow-hidden`: the image slot is a fixed box, and a thumbnail
                that fails to load renders a "file not found" message sized for a
                full preview — which spilled across the title beside it. */}
            <div className={cls("flex shrink-0 overflow-hidden", {
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
                    entity
                        ? <div className={"block whitespace-nowrap overflow-hidden truncate"}>
                            <Typography variant={"caption"}
                                color={"disabled"}
                                className={"font-mono"}>
                                {entity.id}
                            </Typography>
                        </div>
                        : <Skeleton/>)}

                {/* A title that came from a property keeps that property's own
                    rendering — an enum stays its coloured chip, a relation stays
                    a link. A computed one is text, because that is all a
                    resolver returns. */}
                {includeTitle && (titleProperty || title.value) && (
                    <div
                        className={"truncate my-0.5 text-sm font-medium text-text-primary dark:text-text-primary-dark"}>
                        {!entity && titleProperty
                            ? <SkeletonPropertyComponent
                                property={getPropertyInPath(collection.properties, titleProperty) as Property}
                                size={"medium"}/>
                            : titleProperty
                                ? <PropertyPreview
                                    propertyKey={titleProperty}
                                    value={title.source?.value as never}
                                    property={getPropertyInPath(collection.properties, titleProperty) as Property}
                                    size={"medium"}/>
                                : title.value}
                    </div>
                )}

                {restProperties && restProperties.map((key) => {
                    const childProperty = getPropertyInPath(collection.properties, key);
                    if (!childProperty) return null;

                    const valueInPath = getValueInPath(entity.values, key);
                    return (
                        // `truncate` clamps a line of text; it does nothing to a
                        // preview that renders blocks. Custom `admin.Preview`
                        // components can render anything at all, so the height
                        // is capped here as well — a card that loses the tail of
                        // an unusual value beats a card the size of a document.
                        <div key={"ref_prev_" + key}
                            className={cls("truncate min-w-0 max-h-8 overflow-hidden",
                                restProperties.length > 1 ? "my-0.5" : "my-0")}>
                            {
                                entity
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

            {entity && includeEntityLink &&
                <div className="flex-shrink-0">
                    <Tooltip title={`See details for ${entity.id}`} className={"shrink-0"}>
                        <IconButton
                            color={"inherit"}
                            size={"small"}
                            className={size !== "small" ? "self-start" : ""}
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                onSidePanelClick?.(entity);
                                analyticsController.onAnalyticsEvent?.("entity_click_from_reference", {
                                    path: entity.path,
                                    entityId: entity.id
                                });
                                sidePanelController.open({
                                    entityId: entity.id,
                                    path: entity.path,
                                    collection,
                                    updateUrl: true
                                });
                            }}>
                            <ArrowRightToLineIcon/>
                        </IconButton>
                    </Tooltip>
                </div>}

            {actions && <div className="flex-shrink-0">{actions}</div>}
        </NestedEntityPreviewBoundary>
    );
}

export function EntityPreviewBindingWithId({
    entityId,
    path,
    ...props
}: Omit<EntityPreviewBindingProps, "entity"> & {
    entityId: string | number;
    path: string;
    databaseId?: string;
}) {

    const [entity, setEntity] = React.useState<Entity | undefined>();
    const [dataLoading, setDataLoading] = React.useState(false);
    const dataClient = useData();

    useEffect(() => {
        let isMounted = true;
        if (!entityId || !path) {
            setEntity(undefined);
            return;
        }
        const fetchOne = async () => {
            setDataLoading(true);
            try {
                const fetchedEntity = await dataClient.collection(path).findById(entityId);
                if (isMounted) {
                    setEntity(fetchedEntity);
                }
            } catch (error) {
                console.error("Error fetching entity:", error);
                if (isMounted) {
                    setEntity(undefined);
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
    }, [entityId, path]);

    if (dataLoading && !entity) {
        return (
            <EntityPreviewContainer
                hover={props.hover}
                size={props.size}>
                <Skeleton/>
            </EntityPreviewContainer>
        );
    }

    if (!entity) {
        return (
            <EntityPreviewContainer
                hover={props.hover}
                size={props.size}>
                <div className={"text-text-secondary dark:text-text-secondary-dark"}>
                    Entity not found
                </div>
            </EntityPreviewContainer>
        );
    }

    return <EntityPreviewBindingData
        {...props}
        entity={entity}/>;
}

/**
 * This view is used to display a preview of a entity.
 * It is used by default in reference fields and whenever a reference is displayed.
 */
export function EntityPreviewBinding({
    actions,
    disabled,
    hover,
    collection,
    previewKeys,
    onClick,
    size = "medium",
    includeId = true,
    includeTitle = true,
    includeEntityLink = true,
    includeImage = true,
    onSidePanelClick,
    entity
}: EntityPreviewBindingProps) {

    return (
        <EntityPreviewContainer
            onClick={disabled ? undefined : onClick}
            hover={disabled ? undefined : hover}
            size={size}>
            <EntityPreviewBindingData
                actions={actions}
                collection={collection}
                previewKeys={previewKeys}
                size={size}
                includeId={includeId}
                includeTitle={includeTitle}
                includeEntityLink={includeEntityLink}
                includeImage={includeImage}
                onSidePanelClick={onSidePanelClick}
                entity={entity}
            />
        </EntityPreviewContainer>
    );
}

export type EntityPreviewContainerProps = {
    children: React.ReactNode;
    hover?: boolean;
    fullwidth?: boolean;
    size?: PreviewSize;
    className?: string;
    style?: React.CSSProperties;
    onClick?: (e: React.SyntheticEvent) => void;
};

export const EntityPreviewContainer = React.forwardRef<HTMLDivElement, EntityPreviewContainerProps>(({
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
            // On the shared 28/32/40/48 control scale. `44px` was between two
            // steps of it, so a reference in a form was 4px short of the field
            // next to it and their boxes never quite agreed.
            size === "small" ? "min-h-[32px]" : "min-h-[48px]",
            fullwidth ? "w-full" : "",
            "items-center overflow-hidden",
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

EntityPreviewContainer.displayName = "EntityPreviewContainer";
