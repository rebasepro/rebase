import * as React from "react";

import { Entity } from "@rebasepro/types";
import { cls, LinkIcon, Skeleton, Tooltip } from "@rebasepro/ui";
import { useAnalyticsController } from "@rebasepro/app";
import { getValueInPath } from "@rebasepro/utils";
import type { AdminCollection } from "@rebasepro/admin-types";

import { getEntityTitlePropertyKeyForEntity } from "../util/previews";
import { useCollectionRegistryController } from "../hooks/navigation/contexts/CollectionRegistryContext";
import { useSidePanel } from "../hooks/useSidePanel";

export type InlineEntityPreviewProps = {
    entity: Entity<any>;
    collection?: AdminCollection;
    /** Overrides the resolved title. */
    label?: string;
    disabled?: boolean;
    /** When set, takes over the click. Otherwise the row opens the side panel. */
    onClick?: (e: React.SyntheticEvent) => void;
    /** Set to false to render text only, with no click target. */
    includeEntityLink?: boolean;
    /** Icon size in px. Defaults to a hair under the surrounding text. */
    iconSize?: number;
    className?: string;
};

const inlineMixin = "inline-flex items-center gap-1 min-w-0 max-w-full align-middle";

/**
 * An entity rendered as one line of text: a small link glyph that marks it as
 * pointing elsewhere, then the target's title in whatever typography surrounds
 * it.
 *
 * This is what a reference or relation renders as when it is *not* the subject
 * of its slot — nested inside another entity preview, or filling a title slot.
 * The card treatment (image, id, preview properties, side-panel button) only
 * makes sense at the top level; repeating it one level down produces a bordered
 * box inside a bordered box, each with its own action buttons.
 *
 * @group Preview components
 */
export function InlineEntityPreview({
    entity,
    collection: collectionProp,
    label,
    disabled,
    onClick,
    includeEntityLink = true,
    iconSize = 12,
    className
}: InlineEntityPreviewProps) {

    const collectionRegistryController = useCollectionRegistryController();
    const analyticsController = useAnalyticsController();
    const sidePanelController = useSidePanel();

    const collection = collectionProp ?? collectionRegistryController.getCollection(entity.path);

    const titlePropertyKey = collection
        ? getEntityTitlePropertyKeyForEntity(collection, entity.values, entity.id)
        : undefined;
    const titleValue = titlePropertyKey ? getValueInPath(entity.values, titlePropertyKey) : undefined;
    const resolvedLabel = label
        ?? (titleValue !== undefined && titleValue !== null && String(titleValue).trim().length > 0
            ? String(titleValue)
            : String(entity.id));

    const interactive = !disabled && (onClick !== undefined || (includeEntityLink && collection !== undefined));

    const handleClick = (event: React.SyntheticEvent) => {
        if (!interactive) return;
        // This sits inside a container with its own click handler (the parent
        // card opens the parent entity); a click here is about the target.
        event.preventDefault();
        event.stopPropagation();
        if (onClick) {
            onClick(event);
            return;
        }
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
    };

    const content = <span
        tabIndex={interactive ? 0 : undefined}
        role={interactive ? "button" : undefined}
        onClick={interactive ? handleClick : undefined}
        onKeyDown={interactive
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") handleClick(event);
            }
            : undefined}
        className={cls(
            inlineMixin,
            interactive ? "cursor-pointer hover:underline underline-offset-2" : "",
            className)}>
        <LinkIcon size={iconSize}
            className={"shrink-0 opacity-40"}/>
        <span className={"truncate"}>{resolvedLabel}</span>
    </span>;

    if (!interactive) return content;

    return <Tooltip title={`See details for ${resolvedLabel}`}
        asChild={true}>
        {content}
    </Tooltip>;
}

/**
 * Placeholder shown while the target of an inline reference is being fetched.
 */
export function InlineEntityPreviewSkeleton({ className }: { className?: string }) {
    return <span className={cls(inlineMixin, className)}>
        <LinkIcon size={12}
            className={"shrink-0 opacity-40"}/>
        <Skeleton className={"w-20 h-3"}/>
    </span>;
}

/**
 * Shown when the target of an inline reference cannot be resolved — a deleted
 * row, or a collection that is not registered. Keeps the line readable instead
 * of dropping an error box into the middle of a card.
 */
export function InlineEntityPreviewMissing({
    label,
    tooltip,
    className
}: { label: string, tooltip?: string, className?: string }) {
    const content = <span
        className={cls(inlineMixin, "text-text-secondary dark:text-text-secondary-dark", className)}>
        <LinkIcon size={12}
            className={"shrink-0 opacity-40"}/>
        <span className={"truncate italic"}>{label}</span>
    </span>;
    if (!tooltip) return content;
    return <Tooltip title={tooltip}
        asChild={true}>{content}</Tooltip>;
}
