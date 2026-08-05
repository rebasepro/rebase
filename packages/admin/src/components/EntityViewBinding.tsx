import type { Property } from "@rebasepro/types";

import type { AdditionalFieldDelegateProps, AdminCollection } from "@rebasepro/admin-types";
import type { ResolvedFormField, ResolvedFormSection } from "@rebasepro/app";
import type { FormContext } from "../types/fields";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Entity } from "@rebasepro/types";
import {
    AlignLeftIcon,
    cls,
    defaultBorderMixin,
    ErrorBoundary,
    paperMixin
} from "@rebasepro/ui";
import { getFormFieldKeys, resolveFormLayout } from "@rebasepro/app";
import { getValueInPath } from "@rebasepro/utils";

import { FieldBlock, LABEL_ICON_SIZE, spanClass } from "../form/components/FieldBlock";
import { AdditionalFieldValue } from "./AdditionalFieldValue";
import { EntityDisplayHeader, HEADER_DISPLAY_ROLES } from "./EntityDisplayHeader";
import { FormSections } from "../form/components/FormSections";
import { FormRail, RecordMeta } from "../form/components/FormRail";
import { useEntityDisplayValues } from "../hooks/useEntityDisplay";
import { useRailVisible } from "../form/components/useRailVisible";
import { PropertyPreview } from "../preview";

/** Nothing can be in error in a view that cannot be submitted. */
const NO_ERRORS: ReadonlySet<string> = new Set<string>();

/**
 * The fields the read-only view lays out, in render order.
 *
 * The same set the form uses, minus two groups. Both are dropped *before* the
 * layout resolves rather than skipped while rendering, because the resolver has
 * by then given each one a place on the grid — skipping later leaves that place
 * as a hole.
 *
 * - The `additionalFields` when there is no form context to hand them: those
 *   entries are arbitrary components, not values, and one rendered against no
 *   context is nothing at all.
 * - `headerKeys` — the properties {@link EntityDisplayHeader} has already
 *   rendered as the record's picture, subtitle, state and labels. Leaving one in
 *   prints its value twice on one screen.
 *
 * The record's **title property is not among them**, deliberately. It names the
 * page in the identity bar, but a heading and a labelled field are different
 * things: `Order #` is a column with a name and a description that someone opens
 * the record to read, and dropping it because its text also appears in the
 * breadcrumb removes a value from the record on the grounds that it is legible
 * somewhere else. See {@link HEADER_DISPLAY_ROLES}.
 */
export function readOnlyFieldKeys(
    collection: AdminCollection,
    hasFormContext: boolean,
    headerKeys?: ReadonlySet<string>
): string[] {
    const keys = getFormFieldKeys(collection);
    const additional = hasFormContext
        ? undefined
        : new Set((collection.additionalFields ?? []).map(field => field.key));

    return keys.filter(key =>
        !additional?.has(key)
        && !headerKeys?.has(key));
}

/**
 * @group Components
 */
export interface EntityViewBindingProps<M extends Record<string, unknown>> {
    entity: Entity<M>;
    collection: AdminCollection<M>;
    path: string;
    className?: string;
    /**
     * Lay the record out as a page: a centred, scrolling column with the
     * metadata rail beside it, exactly as the form does. Off for the inline
     * uses — the delete dialog renders the record inside a box it already owns.
     */
    asPage?: boolean;
    /** Padding preset, matching the form's. Only read when `asPage`. */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    /**
     * Needed only to render `additionalFields`, which are arbitrary components
     * that take a form context. Without one those entries are left out rather
     * than rendered against a fake context.
     */
    formContext?: FormContext<M>;
}

/**
 * The read-only rendering of a record's values.
 *
 * This is the same layout as {@link EntityForm}: the sections, the grid spans,
 * the labels and the rail all come from the one resolver, so the record does
 * not rearrange itself when you press Edit. Only the controls differ — each
 * field renders its {@link PropertyPreview} instead of an input.
 *
 * It used to be a flat two-column table of every value in the record: no
 * grouping, no widths, a label column sized for short names and a value column
 * that wrapped emails over two lines while the pane beside it stayed empty. A
 * boolean and a markdown body were given the same room.
 *
 * The synthetic `Id` row it used to prepend is gone with the same reasoning the
 * form applies: between that row, the collection's own id property and the
 * `path/id` chip above them, one UUID appeared three times. The id is a
 * copyable chip in the identity bar, and the rail's record block, once each.
 *
 * The labels are the form's labels, icon and all: a field is the same field
 * whether or not you are editing it. What `mode: "read"` drops is the per-field
 * *description*, which is input help rather than part of the label — and what it
 * adds is room. A control is a bordered box that separates itself from the next
 * one; a value is bare text, so the rows and sections are opened up rather than
 * inheriting spacing sized for inputs.
 */
export function EntityViewBinding<M extends Record<string, unknown>>(
    {
        entity,
        collection,
        className,
        asPage = false,
        openEntityMode = "full_screen",
        formContext
    }: EntityViewBindingProps<M>) {

    // The record's name, picture, state and labels, lifted out of the grid and
    // into a header. Resolved here rather than inside it because the fields it
    // renders have to come *out* of the layout, and the layout is resolved here.
    const display = useEntityDisplayValues<M>({
        collection,
        entity
    });

    const headerKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const role of HEADER_DISPLAY_ROLES) {
            // Set only for a role filled by a property of this collection. A
            // role filled by a resolver has no field on the grid to remove.
            const key = display[role].source?.key;
            if (key) keys.add(key);
        }
        return keys;
    }, [display]);

    // Only *whether* there is a form context changes the field list, not which
    // one it is — so the memo turns on the boolean rather than on the context
    // object, which is rebuilt on every keystroke of the form above it.
    const hasFormContext = Boolean(formContext);
    const fieldKeys = useMemo(
        () => readOnlyFieldKeys(collection as AdminCollection, hasFormContext, headerKeys),
        [collection, hasFormContext, headerKeys]
    );

    // `status: "existing"` — a record you are reading exists by definition, and
    // that is what routes a generated id and the audit timestamps out of the
    // column and into the record block.
    const layout = useMemo(() => resolveFormLayout({
        collection,
        fieldKeys,
        status: "existing"
    }), [collection, fieldKeys]);

    const containerRef = useRef<HTMLDivElement>(null);
    // Measured, not a breakpoint — see `useRailVisible`. The same reasoning as
    // the form's: the resolver *moves* fields into the rail, so when the rail
    // cannot be shown they have to fold back into the column.
    const railVisible = useRailVisible(containerRef);
    const showRail = asPage && layout.hasRail && railVisible;

    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
        () => new Set(layout.sections.filter(section => section.collapsed).map(section => section.key))
    );
    const toggleSection = useCallback((key: string) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    }, []);

    const renderField = useCallback((field: ResolvedFormField): React.ReactNode => {

        if (field.additional) {
            const additionalField = collection.additionalFields?.find(f => f.key === field.key);
            if (!additionalField || !formContext) return null;

            const AdditionalFieldBuilder = additionalField.Builder;
            const additionalFieldContext = formContext as unknown as AdditionalFieldDelegateProps["context"];
            const child = AdditionalFieldBuilder
                ? <AdditionalFieldBuilder entity={entity} context={additionalFieldContext}/>
                : <div className={"w-full"}>
                    <AdditionalFieldValue
                        field={additionalField}
                        entity={entity}
                        context={additionalFieldContext}/>
                </div>;

            return (
                // Through FieldBlock like every other cell, so a computed
                // column is labelled at the same size, with the same gap to its
                // box, as the property next to it on the grid.
                <div key={`additional_${field.key}`} className={spanClass(field.span)}>
                    <FieldBlock propertyKey={field.key}
                        showLabel={true}
                        mode={"read"}
                        label={additionalField.name}
                        icon={<AlignLeftIcon size={LABEL_ICON_SIZE}/>}>
                        <div className={cls(paperMixin, "w-full min-h-12 p-4 md:p-6 overflow-x-auto no-scrollbar")}>
                            {child}
                        </div>
                    </FieldBlock>
                </div>
            );
        }

        const property = collection.properties?.[field.key] as Property | undefined;
        if (!property) return null;

        return (
            <div key={`field_${field.key}`} className={spanClass(field.span)}>
                {/* Always labelled from here, unlike the form. The panel editors
                    that carry their own header have no header in preview — a map
                    previews as a table of its children and an array as its items,
                    so leaving the label to them would leave them unlabelled. */}
                <FieldBlock propertyKey={field.key}
                    property={property}
                    showLabel={true}
                    mode={"read"}>
                    {/* One control's height for a single-line value, so a row of
                        short fields lines up with the taller ones beside it, and
                        anything longer simply grows. Matched to the form's row
                        rather than shrunk to the text: it is what keeps a value
                        from sitting directly on the label of the row below. */}
                    <div className={"min-h-8 flex flex-col justify-center min-w-0 text-text-primary dark:text-text-primary-dark"}>
                        <PropertyPreview propertyKey={field.key}
                            value={getValueInPath(entity.values, field.key)}
                            property={property}
                            hideLabel
                            size={"medium"}/>
                    </div>
                </FieldBlock>
            </div>
        );
    }, [collection, entity, formContext]);

    /**
     * One field of a `readVariant: "summary"` section: a label/value row rather
     * than a grid cell, with the last one emphasised.
     *
     * The last row is the one a summary exists for — a run of figures is read to
     * arrive at its final line — so it is separated by a rule and set at the
     * weight the grid gave every cell equally.
     */
    const renderSummaryField = useCallback((
        field: ResolvedFormField,
        index: number,
        total: number
    ): React.ReactNode => {

        const property = collection.properties?.[field.key] as Property | undefined;
        if (!property) return null;

        const last = index === total - 1;

        return (
            <div key={`summary_${field.key}`}
                className={cls(
                    "flex items-baseline justify-between gap-4 min-w-0 py-2",
                    last && total > 1 && cls("mt-1.5 pt-3 border-t", defaultBorderMixin)
                )}>
                <span className={cls(
                    "min-w-0 truncate",
                    last
                        ? "text-sm font-semibold text-text-primary dark:text-text-primary-dark"
                        : "text-sm text-text-secondary dark:text-text-secondary-dark"
                )}>
                    {property.name ?? field.key}
                </span>
                <span className={cls(
                    "shrink-0 text-right text-text-primary dark:text-text-primary-dark",
                    last ? "text-base font-semibold" : "text-sm"
                )}>
                    <PropertyPreview propertyKey={field.key}
                        value={getValueInPath(entity.values, field.key)}
                        property={property}
                        hideLabel
                        size={"medium"}/>
                </span>
            </div>
        );
    }, [collection, entity]);

    // Same fold-back as the form: with no room for the rail its fields become a
    // trailing group rather than disappearing.
    const sections: ResolvedFormSection[] = showRail || !layout.sidebar.length
        ? layout.sections
        : [
            ...layout.sections,
            {
                key: "__rail",
                title: "Settings",
                collapsible: false,
                collapsed: false,
                fields: layout.sidebar
            }
        ];

    const content = <>
        {/* The title only when nothing above is already showing it. Every
            full-page use sits under an identity bar that carries it; the
            inline ones — the delete dialog — have no bar. */}
        <EntityDisplayHeader entity={entity}
            collection={collection}
            showTitle={!asPage}
            className={"mb-10"}/>

        <FormSections sections={sections}
            collapsed={collapsedSections}
            onToggle={toggleSection}
            errorKeys={NO_ERRORS}
            renderField={renderField}
            renderSummaryField={renderSummaryField}
            mode={"read"}/>

        {/* Folded back with the rail's fields, and for the same reason. The rail
            renders only where it has been measured to fit, so on the split pane,
            the side panel and the dialog this block was dropped outright and the
            record's id was nowhere on screen but the truncated chip in the bar.
            An id you cannot read or copy is the one piece of a record you most
            often opened it for. */}
        {!showRail && layout.showRecordMeta && (
            <div className={cls("mt-10 pt-6 border-t max-w-sm", defaultBorderMixin)}>
                <RecordMeta entity={entity as Entity<Record<string, unknown>>}/>
            </div>
        )}
    </>;

    if (!asPage) {
        // `@container/col` even here: the spans resolve against the column they
        // sit in, and inside a dialog that column is the dialog.
        return (
            <div ref={containerRef} className={cls("@container/col w-full min-w-0", className)}>
                {content}
            </div>
        );
    }

    return (
        <div ref={containerRef} className={cls("flex-1 flex flex-row w-full min-h-0", className)}>

            {/* `items-start`: without it the cross-axis default stretches the
                column to the scroller's height and its bottom padding lands at
                the bottom of the viewport instead of after the last field. */}
            <div className={"flex-1 min-w-0 overflow-y-auto flex justify-center items-start"}>
                <div className={cls(
                    "@container/col w-full max-w-3xl 2xl:max-w-4xl flex flex-col",
                    openEntityMode === "dialog"
                        ? "pt-5 pb-8 px-6 sm:px-8"
                        : "pt-6 pb-12 px-5 sm:px-8"
                )}>
                    {content}
                </div>
            </div>

            {showRail && <FormRail
                fields={layout.sidebar}
                showRecordMeta={layout.showRecordMeta}
                entity={entity as Entity<Record<string, unknown>>}
                renderField={renderField}/>}
        </div>
    );
}
