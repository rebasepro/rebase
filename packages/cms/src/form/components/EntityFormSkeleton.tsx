import type { AdminCollection, Property } from "@rebasepro/cms-types";
import type { EntityStatus } from "@rebasepro/types";
import type { ResolvedFormField, ResolvedFormSection } from "@rebasepro/app";
import React, { useMemo, useRef } from "react";
import { getFormFieldKeys, resolveFormLayout, useTranslation } from "@rebasepro/app";
import { cls, defaultBorderMixin, Skeleton, Typography } from "@rebasepro/ui";
import { PropertyKeyHint } from "../../components/PropertyKeyHint";
import { isSelfLabellingProperty, spanClass } from "./FieldBlock";
import { labelsInsideControl } from "../label_placement";
import { getFieldId } from "../../components/field_ids";
import { useRailVisible } from "./useRailVisible";

/** The columns `RecordMeta` reads its two timestamps from. */
const CREATED_KEYS = ["created_at", "createdAt", "created_on"];
const UPDATED_KEYS = ["updated_at", "updatedAt", "modified_at"];

export interface EntityFormSkeletonProps {
    collection: AdminCollection;
    /** Which record is loading: decides, as it does for the form, what the rail holds. */
    status?: EntityStatus;
    /** The surface the record opens in; a dialog pads its column tighter. */
    openEntityMode?: string;
    /** The editable form, or the read-only record (`EntityViewBinding`). */
    mode?: "edit" | "read";
}

/**
 * What a record looks like while it loads: the form it is about to become,
 * with placeholders where the values go.
 *
 * Built from the same pieces as the form, not drawn beside it — the same
 * `@container/form` root, the same column widths and padding, the same
 * sections resolved by `resolveFormLayout`, the same four-column grid and
 * spans, and the rail shown on the same measurement (`useRailVisible`). The
 * skeleton it replaces was a centred column at the widths the form had two
 * redesigns ago, with no rail: every wide record jumped sideways when it
 * loaded, and a rail appeared on the right out of nothing.
 *
 * Heights are the controls', measured against a loaded form, and the label goes
 * where `labelsInsideControl` puts it: a one-line field is a 66px box with its
 * label inside (a long text 112.5px); a labelled-above field is a 19.5px label
 * row over its control — a relation's 90px card, a file field's 172px drop
 * zone, the 202px markdown editor, the 48px user picker, a 50px box; a
 * self-labelling panel is 75.5px. The description is the
 * real text under it. What a value would make taller than that — a long body
 * of text, an expanded block — is unknown until it loads.
 */
export function EntityFormSkeleton({
    collection,
    status = "existing",
    openEntityMode,
    mode = "edit"
}: EntityFormSkeletonProps) {

    const { t } = useTranslation();
    const reading = mode === "read";
    const fieldKeys = getFormFieldKeys(collection);
    const layout = useMemo(() => resolveFormLayout({
        collection,
        fieldKeys,
        status
        // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys' contents, not the array's identity
    }), [collection, fieldKeys.join(","), status]);

    const rootRef = useRef<HTMLDivElement>(null);
    const railVisible = useRailVisible(rootRef);
    const showRail = layout.hasRail && railVisible;

    // As the form does: with no room for the rail, its fields fold back into
    // the column as a trailing section.
    const sections: ResolvedFormSection[] = showRail || !layout.sidebar.length
        ? layout.sections
        : [...layout.sections, {
            key: "__rail",
            title: t("settings_heading"),
            collapsible: false,
            collapsed: false,
            fields: layout.sidebar
        }];

    const fieldSkeleton = (field: ResolvedFormField, inRail: boolean) => {
        const property = collection.properties[field.key] as Property | undefined;

        // Rail fields render through `InspectorRow`: a compact 2-column row
        // (`88px` muted label on the left, compact ghost control or wrapping
        // dot-pills on the right, no description line underneath).
        if (inRail && !reading) {
            const isMultiPill = property?.type === "array"
                || (property?.type === "relation"
                    && property.relation !== undefined
                    && "cardinality" in property.relation
                    && property.relation.cardinality === "many");
            return (
                <div
                    key={field.key}
                    className={cls(
                        "flex gap-2.5 min-w-0 min-h-[30px]",
                        isMultiPill ? "items-start pt-0.5" : "items-center"
                    )}
                >
                    <div className={cls("w-24 shrink-0 flex items-center", isMultiPill ? "h-[30px]" : "")}>
                        <Skeleton height={10} className={"w-16"}/>
                    </div>
                    <div className={"flex-1 min-w-0 flex items-center gap-1.5 flex-wrap"}>
                        {isMultiPill ? (
                            <>
                                <Skeleton height={22} width={64} className={"rounded-full"}/>
                                <Skeleton height={22} width={56} className={"rounded-full"}/>
                            </>
                        ) : (
                            <Skeleton height={22} className={"w-3/4 rounded-md"}/>
                        )}
                    </div>
                </div>
            );
        }

        // Where FieldBlock puts the label decides the shape: inside a one-line
        // box, above anything else, or nowhere for a field whose panel header
        // is its label.
        const placement: "inside" | "above" | "own" = !property
            ? "inside"
            : isSelfLabellingProperty(property)
                ? "own"
                : labelsInsideControl(property) ? "inside" : "above";
        const labelRow = <div className={"h-[19.5px] flex items-center"}><Skeleton height={10} className={"w-28"}/></div>;
        return (
            <div key={field.key} className={cls("min-w-0 flex flex-col", !inRail && spanClass(field.span))}>
                {reading
                    // Read: the same label row, then the value as text — a 32px
                    // line, or the relation's card as the form draws it.
                    ? <>
                        {labelRow}
                        {isRelation(property)
                            ? <Skeleton height={90} className={"mt-1.5 rounded-lg"}/>
                            : <div className={"mt-1.5 h-8 flex items-center"}><Skeleton height={14} className={"w-3/4"}/></div>}
                    </>
                    : placement === "inside"
                        ? <Skeleton height={multiline(property) ? 112.5 : 66} className={"rounded-lg"}/>
                        : placement === "own"
                            // A collapsible panel whose header is the label.
                            ? <Skeleton height={75.5} className={"rounded-lg"}/>
                            : <>
                                {labelRow}
                                <Skeleton height={controlBelowLabel(property)} className={"mt-1.5 rounded-lg"}/>
                            </>}
                {/* The description is the schema's, not the record's, so it is
                    drawn for real, as FieldBlock draws it — and wraps where the
                    loaded one will, key hint included. */}
                {!reading && property?.description && placement !== "own" && (placement === "above"
                    ? <Typography variant={"caption"}
                        color={"disabled"}
                        className={"mt-1.5 ml-0.5 leading-snug"}>
                        {property.description}
                    </Typography>
                    : <div aria-hidden={true} className={"flex items-start gap-2 min-w-0 ml-3.5 mt-1.5"}>
                        <Typography variant={"caption"}
                            color={"disabled"}
                            className={"grow min-w-0 leading-snug"}>
                            {property.description}
                        </Typography>
                        <PropertyKeyHint propertyKey={field.key} className={"ml-auto shrink-0"}/>
                    </div>)}
            </div>
        );
    };

    return (
        <div ref={rootRef}
            aria-busy={true}
            className={"@container/form flex-1 flex flex-row w-full min-h-0"}>

            <div className={"flex-1 min-w-0 overflow-y-auto flex justify-center items-start"}>
                <div className={cls(
                    "@container/col w-full max-w-3xl @7xl/form:max-w-4xl 2xl:max-w-4xl flex flex-col",
                    openEntityMode === "dialog"
                        ? "pt-5 pb-8 px-6 sm:px-8"
                        : "pt-6 pb-12 px-5 sm:px-8"
                )}>
                    <div className={cls("flex flex-col", reading ? "gap-10" : "gap-8")}>
                        {sections.map(section => (
                            <section key={section.key} className={"min-w-0"}>
                                {section.title && (
                                    <div className={"flex items-center gap-2.5 w-full mb-3.5 h-4"}>
                                        <Skeleton height={10} width={Math.min(160, 12 + section.title.length * 7)}/>
                                        <span className={cls("flex-1 border-t", defaultBorderMixin)}/>
                                    </div>
                                )}
                                {!section.collapsed && (
                                    <div className={cls(
                                        "grid min-w-0",
                                        reading ? "gap-x-8 gap-y-7" : "gap-x-4 gap-y-6",
                                        "grid-cols-1 @2xl:grid-cols-4"
                                    )}>
                                        {section.fields.map(field => fieldSkeleton(field, false))}
                                    </div>
                                )}
                            </section>
                        ))}
                    </div>
                </div>
            </div>

            {showRail && (
                <aside className={cls(
                    // FormRail's own box: width, padding and surface.
                    "flex flex-col gap-5 shrink-0 w-80 @7xl/form:w-88 overflow-y-auto",
                    "px-4 py-5 bg-surface-sheet"
                )}>
                    {layout.sidebar.length > 0 && (
                        <div className={"flex flex-col gap-1.5"}>
                            {!reading && (
                                <div className={"h-4 flex items-center mb-1"}>
                                    <Skeleton height={10} width={64}/>
                                </div>
                            )}
                            {layout.sidebar.map(field => fieldSkeleton(field, true))}
                        </div>
                    )}
                    {layout.showRecordMeta && status === "existing" && (
                        // RecordMeta's rows: the caption, the id with its copy
                        // button, the two timestamps.
                        <div className={cls(
                            "flex flex-col gap-2.5",
                            layout.sidebar.length > 0 && "pt-4 border-t",
                            layout.sidebar.length > 0 && defaultBorderMixin
                        )}>
                            <div className={"h-[17.4px] flex items-center"}><Skeleton height={10} width={56}/></div>
                            <div className={"h-[28.5px] flex items-center"}><Skeleton height={12}/></div>
                            {CREATED_KEYS.some(key => key in collection.properties) &&
                                <div className={"h-4 flex items-center"}><Skeleton height={12} className={"w-2/3"}/></div>}
                            {UPDATED_KEYS.some(key => key in collection.properties) &&
                                <div className={"h-4 flex items-center"}><Skeleton height={12} className={"w-2/3"}/></div>}
                        </div>
                    )}
                </aside>
            )}
        </div>
    );
}

function isRelation(property: Property | undefined): boolean {
    return property?.type === "relation" || property?.type === "reference";
}

/**
 * The control under a label drawn above it, by the field the form picks for the
 * property (`getFieldId`): a relation's preview card, a file field's drop zone
 * (the same with or without a file in it), the markdown editor at its resting
 * height, the user picker, or a 50px box.
 */
function controlBelowLabel(property: Property | undefined): number {
    switch (property ? getFieldId(property) : undefined) {
        case "relation":
        case "reference":
            return 90;
        case "file_upload":
        case "multi_file_upload":
            return 172;
        case "markdown":
            return 202;
        case "user_select":
            return 48;
        default:
            return 50;
    }
}

/** A multi-line text box: label inside, three lines tall. */
function multiline(property: Property | undefined): boolean {
    return property !== undefined && getFieldId(property) === "multiline";
}
