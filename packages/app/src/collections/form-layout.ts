/**
 * Form layout resolution.
 *
 * Turns a collection into the shape the entity form renders: an ordered list of
 * sections holding grid-spanned fields, plus the metadata rail beside them.
 *
 * The reason this is a pure function rather than logic inside the form is that
 * the *defaults* are the interesting part. A collection that never writes an
 * `admin.form` block still has to get a two-column layout out of this — the flat
 * run of full-width fields it produced before was the single biggest cost in the
 * form, and no amount of config would have fixed it for collections nobody
 * hand-tunes. Deriving it here means it is testable in isolation, which matters
 * because "what span does a date get" is exactly the kind of rule that rots.
 */
import type {
    AdminCollection,
    FormSection,
    PropertySpan
} from "@rebasepro/admin-types";
import type { Property } from "@rebasepro/types";
import { isHidden } from "./property_presentation";

/** A field placed on the grid. */
export interface ResolvedFormField {
    key: string;
    /** Columns occupied, out of `FORM_GRID_COLUMNS`. Ignored in the rail. */
    span: PropertySpan;
    /** True for an `additionalFields` entry rather than a property. */
    additional: boolean;
}

export interface ResolvedFormSection {
    key: string;
    title?: string;
    collapsible: boolean;
    /** Initial state only; the form owns it after first interaction. */
    collapsed: boolean;
    fields: ResolvedFormField[];
}

export interface ResolvedFormLayout {
    sections: ResolvedFormSection[];
    /** Fields shown in the rail. Empty means no rail fields. */
    sidebar: ResolvedFormField[];
    /** Show the read-only id/created/updated block at the foot of the rail. */
    showRecordMeta: boolean;
    /** True when there is anything at all to put in the rail. */
    hasRail: boolean;
}

export interface ResolveFormLayoutParams<M extends Record<string, unknown>> {
    collection: AdminCollection<M>;
    /**
     * Field keys in render order, already filtered by `propertiesOrder` — i.e.
     * the output of `getFormFieldKeys`. Passed in rather than recomputed so the
     * form and the layout can never disagree about which fields exist.
     */
    fieldKeys: string[];
    /**
     * Which fields the user may edit right now. A manual id is editable while
     * creating and frozen afterwards, and that decides whether it belongs in the
     * form at all or only in the record block.
     */
    status: "new" | "existing" | "copy";
}

/* -------------------------------------------------------------------------- */
/* span derivation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A percentage lands on the nearest span rather than an arbitrary width, so a
 * collection carrying the deprecated `widthPercentage` still snaps to the grid
 * everything else is on. Boundaries are generous on the low side because the
 * common legacy values are 50 and 33.
 */
export function spanFromWidthPercentage(pct: number): PropertySpan {
    if (pct <= 30) return 1;
    if (pct <= 55) return 2;
    if (pct <= 80) return 3;
    return 4;
}

/** Does this property's editor need the full width of the column? */
function needsFullWidth(property: Property): boolean {
    switch (property.type) {
        case "map":
        case "binary":
        case "vector":
            return true;
        case "array": {
            // A tag-style array of plain short strings reads fine at half width.
            // Anything else — files, nested maps, `oneOf` blocks — does not.
            if (property.oneOf) return true;
            const of = Array.isArray(property.of) ? undefined : property.of;
            if (!of) return true;
            if (of.type !== "string" && of.type !== "number") return true;
            if (of.type === "string" && (of.storage || of.admin?.markdown || of.admin?.multiline)) return true;
            return false;
        }
        case "string":
            return Boolean(property.storage || property.admin?.markdown || property.admin?.multiline);
        default:
            return false;
    }
}

/**
 * The span a property gets when nothing is declared.
 *
 * Deliberately coarse: three buckets, chosen by how much room the *editor*
 * needs, not by how important the field is. Importance is what `admin.form`
 * sections are for.
 */
export function deriveSpan(property: Property, isTitleProperty: boolean): PropertySpan {
    if (needsFullWidth(property)) return 4;
    // The record's name carries the row on its own; it is the first thing read.
    if (isTitleProperty) return 4;
    switch (property.type) {
        case "number":
        case "boolean":
            return 1;
        case "date":
        case "geopoint":
        case "reference":
        case "relation":
            return 2;
        case "array":
            return 2; // short primitive arrays only — the rest returned 4 above
        case "string":
            return 2;
        default:
            return 2;
    }
}

/* -------------------------------------------------------------------------- */
/* id handling                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Can the user still type this id?
 *
 * A `manual` id is a real field while creating and frozen once the row exists.
 * Every generated strategy (`uuid`, `cuid`, a raw SQL default) is never typed.
 * Getting this wrong in the "frozen" direction would make manual-id collections
 * uncreatable, so it fails towards showing the field.
 */
export function isIdPropertyEditable(property: Property, status: "new" | "existing" | "copy"): boolean {
    if (!("isId" in property) || !property.isId) return true;
    if (status === "existing") return false;
    return property.isId === "manual";
}

function isIdProperty(property: Property | undefined): boolean {
    return Boolean(property && "isId" in property && property.isId);
}

/* -------------------------------------------------------------------------- */
/* resolution                                                                 */
/* -------------------------------------------------------------------------- */

function buildField<M extends Record<string, unknown>>(
    key: string,
    collection: AdminCollection<M>,
    titlePropertyKey: string | undefined
): ResolvedFormField | undefined {
    const property = collection.properties?.[key] as Property | undefined;

    if (!property) {
        // An additionalFields entry: a rendered card, not an input. Full width,
        // because we have no idea what the Builder puts inside it.
        const additional = collection.additionalFields?.some(f => f.key === key);
        return additional ? { key, span: 4, additional: true } : undefined;
    }

    if (isHidden(property)) return undefined;

    const admin = property.admin;
    const span: PropertySpan = admin?.span
        ?? (typeof admin?.widthPercentage === "number"
            ? spanFromWidthPercentage(admin.widthPercentage)
            : deriveSpan(property, key === titlePropertyKey));

    return { key, span, additional: false };
}

/**
 * Resolve the layout for a collection's generated form.
 *
 * Never drops a field: anything not named by a section lands in a trailing
 * group, so adding a column to the database cannot make it silently invisible
 * in the panel.
 */
export function resolveFormLayout<M extends Record<string, unknown>>({
    collection,
    fieldKeys,
    status
}: ResolveFormLayoutParams<M>): ResolvedFormLayout {

    const config = collection.form;
    const titlePropertyKey = collection.titleProperty as string | undefined;

    const available = new Map<string, ResolvedFormField>();
    for (const key of fieldKeys) {
        const field = buildField(key, collection, titlePropertyKey);
        if (field) available.set(key, field);
    }

    /* ---- the id ---------------------------------------------------------- */
    // Routed out of the form and into the record block unless it is still
    // typeable. This is what `hideIdFromForm` used to be for; that flag now only
    // decides whether the record block shows it at all.
    const idKeys = [...available.keys()].filter(key => {
        const property = collection.properties?.[key] as Property | undefined;
        return isIdProperty(property) && !isIdPropertyEditable(property!, status);
    });
    for (const key of idKeys) available.delete(key);

    /* ---- the rail -------------------------------------------------------- */
    const sidebar: ResolvedFormField[] = [];
    if (config?.sidebar) {
        for (const key of config.sidebar as string[]) {
            const field = available.get(key);
            if (!field) continue;      // unknown, hidden, or already the id
            sidebar.push(field);
            available.delete(key);
        }
    }

    const showRecordMeta = config?.showRecordMeta ?? !collection.hideIdFromForm;

    /* ---- sections -------------------------------------------------------- */
    const sections: ResolvedFormSection[] = [];

    if (config?.sections?.length) {
        for (const section of config.sections as FormSection<M>[]) {
            const fields: ResolvedFormField[] = [];
            for (const key of section.properties as string[]) {
                const field = available.get(key);
                if (!field) continue;
                fields.push(field);
                available.delete(key);
            }
            const titled = Boolean(section.title);
            sections.push({
                key: section.key,
                title: section.title,
                collapsible: section.collapsible ?? titled,
                collapsed: titled ? Boolean(section.collapsed) : false,
                fields
            });
        }
    }

    // Whatever no section claimed. Appended rather than dropped — a new column
    // showing up unstyled is recoverable, a new column vanishing is not.
    const leftovers = fieldKeys
        .map(key => available.get(key))
        .filter((f): f is ResolvedFormField => Boolean(f));

    if (leftovers.length) {
        // Always a trailing group, never merged into an existing section. Folding
        // them into the first untitled section put `created_at`/`updated_at`
        // between the product's images and its pricing — the reader cannot tell
        // "we grouped this here" from "nobody placed this yet", and the second is
        // what actually happened.
        sections.push({
            key: sections.length ? "__other" : "__main",
            collapsible: false,
            collapsed: false,
            fields: leftovers
        });
    }

    // A configured section that ended up empty (every key hidden, unknown, or
    // claimed by the rail) would render as a heading over nothing.
    const nonEmpty = sections.filter(s => s.fields.length > 0);

    return {
        sections: nonEmpty,
        sidebar,
        showRecordMeta,
        hasRail: sidebar.length > 0 || showRecordMeta
    };
}
