import type { AdminCollection } from "@rebasepro/admin-types";
import type { Entity, Property } from "@rebasepro/types";
import React from "react";
import { Chip, cls, Typography } from "@rebasepro/ui";

import { useEntityDisplayValues } from "../hooks/useEntityDisplay";
import { PropertyPreview } from "../preview";

/**
 * The roles whose property the read-only view takes out of its grid.
 *
 * A role rendered here and left in the grid prints the value twice, so the
 * header's own rendering and this list have to agree — but the list is *not*
 * simply "every role the header draws". Two are deliberately absent:
 *
 * `title`, because the heading above a record and a labelled field are not the
 * same thing. `Order #` is a column with a name, a description and a format that
 * someone reads the record to find; `ORD-2026-0043` sitting in the identity bar
 * beside the breadcrumb is a label for the page. Removing the field because the
 * page is named after it takes a value out of the record on the grounds that its
 * text appears elsewhere, which is not a reason — a value in the database is
 * shown.
 *
 * `date`, because the rail's record block already carries the timestamps, and a
 * collection whose `date` role points at a business date — an order date, a due
 * date — wants that field where it declared it.
 */
export const HEADER_DISPLAY_ROLES = ["subtitle", "image", "status", "tags"] as const;

export interface EntityDisplayHeaderProps<M extends Record<string, unknown>> {
    entity: Entity<M>;
    collection: AdminCollection<M>;
    /**
     * Render the title. Off when an identity bar above already shows it — which
     * is every full-page use — and on inside a dialog that has no bar.
     */
    showTitle?: boolean;
    className?: string;
}

/**
 * What the record *is*, above the fields that say what it holds.
 *
 * A record's picture, name, state and labels are the things you opened the page
 * to see; on the plain grid they were fields like any other, so an order's
 * status sat in the second cell of the first row at the same size and weight as
 * its shipping cost, and its tags were a wrapped list of grey text.
 *
 * Every role here comes from `admin.display` and nothing is derived except the
 * title, which was already derived for the identity bar. A collection that
 * declares no display block therefore gets no header at all rather than a
 * heuristic guess at which of its enums is a "status" — the panel does not know
 * what these records are, and a wrong guess here is louder than no guess.
 *
 * A role filled by a *property* renders through {@link PropertyPreview}, so a
 * status keeps its enum's colour and an image stays a storage thumbnail. A role
 * filled by a resolver has no property behind it and renders as what it
 * returned.
 */
export function EntityDisplayHeader<M extends Record<string, unknown>>({
    entity,
    collection,
    showTitle = false,
    className
}: EntityDisplayHeaderProps<M>) {

    const display = useEntityDisplayValues<M>({
        collection,
        entity
    });

    const title = showTitle ? asText(display.title.value) : undefined;
    const subtitle = asText(display.subtitle.value);
    const tags = asTags(display.tags.value);

    const hasStatus = display.status.value !== undefined;
    const hasImage = display.image.value !== undefined;

    if (!title && !subtitle && !hasStatus && !hasImage && !tags.length) return null;

    return (
        <div className={cls("flex items-start gap-4 min-w-0", className)}>

            {hasImage && (
                <div className={"shrink-0 w-16 h-16 rounded-lg overflow-hidden flex items-center justify-center bg-surface-100 dark:bg-surface-800"}>
                    <RoleValue role={display.image} propertyFallback={
                        // A resolver's image is documented as a URL; a storage
                        // path only resolves when a property is behind it, which
                        // is what carries the storage source.
                        typeof display.image.value === "string"
                            ? <img src={display.image.value}
                                alt={""}
                                className={"w-full h-full object-cover"}/>
                            : null
                    }/>
                </div>
            )}

            <div className={"flex flex-col gap-1.5 min-w-0 flex-1"}>

                {title && (
                    <Typography variant={"h5"} className={"min-w-0 truncate m-0"}>
                        {title}
                    </Typography>
                )}

                {subtitle && (
                    <Typography variant={"body2"}
                        color={"secondary"}
                        className={"min-w-0 m-0"}>
                        {subtitle}
                    </Typography>
                )}

                {(hasStatus || tags.length > 0) && (
                    <div className={"flex flex-wrap items-center gap-1.5"}>
                        {hasStatus && (
                            <RoleValue role={display.status} propertyFallback={
                                <Chip size={"small"}>{asText(display.status.value)}</Chip>
                            }/>
                        )}
                        {tags.map(tag => (
                            <Chip key={tag} size={"small"} outlined>{tag}</Chip>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * One resolved role, rendered richly when a property is behind it.
 *
 * `source` is set only when the value came from a property of this collection
 * (see `useEntityDisplay`), and it carries what a rich rendering needs. Its
 * absence is exactly the "this was computed" signal, and a computed value is a
 * bare string with no property to describe it — hence the fallback.
 */
function RoleValue({
    role,
    propertyFallback
}: {
    role: { value: unknown, source?: { key: string, property: Property | undefined, value: unknown } };
    propertyFallback: React.ReactNode;
}) {
    const source = role.source;
    if (!source?.property) return <>{propertyFallback}</>;
    return <PropertyPreview propertyKey={source.key}
        value={source.value}
        property={source.property}
        hideLabel
        size={"medium"}/>;
}

/** A role's value as a line of text, or nothing when it holds nothing to read. */
function asText(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text.length ? text : undefined;
}

/** The `tags` role, which takes a single string as shorthand for one tag. */
function asTags(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    const list = Array.isArray(value) ? value : [value];
    return list
        .map(entry => asText(entry))
        .filter((entry): entry is string => Boolean(entry));
}
