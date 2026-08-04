import type { Property } from "@rebasepro/types";

import type { AdditionalFieldDelegateProps, AdminCollection, CustomizationController } from "@rebasepro/admin-types";
import type { ResolvedFormField, ResolvedFormSection } from "@rebasepro/app";
import type { FormContext } from "../types/fields";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Entity } from "@rebasepro/types";
import {
    AlignLeftIcon,
    cls,
    ErrorBoundary,
    ExternalLinkIcon,
    IconButton,
    iconSize,
    paperMixin,
    Tooltip
} from "@rebasepro/ui";
import { getFormFieldKeys, resolveFormLayout, useCustomizationController } from "@rebasepro/app";
import { getValueInPath } from "@rebasepro/utils";

import { FieldBlock, spanClass } from "../form/components/FieldBlock";
import { AdditionalFieldValue } from "./AdditionalFieldValue";
import { FormSections } from "../form/components/FormSections";
import { FormRail } from "../form/components/FormRail";
import { useRailVisible } from "../form/components/useRailVisible";
import { LabelWithIconAndTooltip } from "../form/components/LabelWithIconAndTooltip";
import { PropertyPreview } from "../preview";

/** Nothing can be in error in a view that cannot be submitted. */
const NO_ERRORS: ReadonlySet<string> = new Set<string>();

/**
 * The fields the read-only view lays out, in render order.
 *
 * The same set the form uses, minus the `additionalFields` when there is no
 * form context to hand them: those entries are arbitrary components, not
 * values, and one rendered against no context is nothing at all. They are
 * dropped *before* the layout resolves rather than skipped while rendering,
 * because the resolver has by then given each of them a full row — skipping
 * later leaves that row as a hole in the grid.
 */
export function readOnlyFieldKeys(collection: AdminCollection, hasFormContext: boolean): string[] {
    const keys = getFormFieldKeys(collection);
    if (hasFormContext) return keys;
    const additional = new Set((collection.additionalFields ?? []).map(field => field.key));
    return keys.filter(key => !additional.has(key));
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

    const customizationController: CustomizationController = useCustomizationController();
    const externalLink = customizationController?.entityLinkBuilder?.({ entity });

    // Only *whether* there is a form context changes the field list, not which
    // one it is — so the memo turns on the boolean rather than on the context
    // object, which is rebuilt on every keystroke of the form above it.
    const hasFormContext = Boolean(formContext);
    const fieldKeys = useMemo(
        () => readOnlyFieldKeys(collection as AdminCollection, hasFormContext),
        [collection, hasFormContext]
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
                <div key={`additional_${field.key}`} className={spanClass(field.span)}>
                    <LabelWithIconAndTooltip
                        propertyKey={field.key}
                        icon={<AlignLeftIcon size={iconSize.small}/>}
                        title={additionalField.name}
                        className={"text-text-secondary dark:text-text-secondary-dark"}/>
                    <div className={cls(paperMixin, "w-full min-h-14 p-4 md:p-6 overflow-x-auto no-scrollbar")}>
                        <ErrorBoundary>
                            {child}
                        </ErrorBoundary>
                    </div>
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
                    showLabel={true}>
                    {/* One row's height for a single-line value, so a row of
                        short fields lines up with the taller ones beside it, and
                        anything longer simply grows. */}
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
        {externalLink && (
            <div className={"flex justify-end mb-2"}>
                <Tooltip title={"Open in the live site"}>
                    <a href={externalLink} rel={"noopener noreferrer"} target={"_blank"}>
                        <IconButton size={"small"}>
                            <ExternalLinkIcon/>
                        </IconButton>
                    </a>
                </Tooltip>
            </div>
        )}

        <FormSections sections={sections}
            collapsed={collapsedSections}
            onToggle={toggleSection}
            errorKeys={NO_ERRORS}
            renderField={renderField}/>
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
