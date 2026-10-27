/**
 * Form layout resolution.
 *
 * Turns a collection into the shape the entity form renders: an ordered list of
 * sections holding grid-spanned fields, plus the metadata rail beside them.
 *
 * A field takes the full row unless its property sets `admin.span`, with one
 * exception: two neighbouring fields whose editors are both small and of the
 * same kind — two numbers, two switches, two dates, two short selects — share a
 * row. Nothing wider is ever guessed. Pairing by type alone put Namespace beside
 * Custom Domain and Git Branch beside Git Repository URL, values that sat
 * together only because both were strings; a string's editor says nothing about
 * how long its value is, so a free-text field is never paired. Nothing here
 * looks at which property is the record's title either.
 */
import type {
    AdminCollection,
    FormSection,
    PropertySpan
} from "@rebasepro/cms-types";
import type { EnumValues, Property } from "@rebasepro/types";
import { effectiveAccess } from "@rebasepro/common";
import { isHidden } from "./property_presentation";

/**
 * Columns in the form grid.
 *
 * A local literal rather than an import of `FORM_GRID_COLUMNS`: everything else
 * this module takes from `@rebasepro/cms-types` is a *type*, erased at build
 * time, and a runtime value would make this pure function depend on that
 * package's built output — which is exactly what broke the dev server, since
 * `@rebasepro/app` resolves that package to its dist. `satisfies PropertySpan`
 * keeps the two honest: a full-width field and the column count are the same
 * number by definition.
 */
const GRID_COLUMNS = 4 satisfies PropertySpan;

/** A field placed on the grid. */
export interface ResolvedFormField {
    key: string;
    /** Columns occupied, out of `GRID_COLUMNS`. Ignored in the rail. */
    span: PropertySpan;
    /** True for an `additionalFields` entry rather than a property. */
    additional: boolean;
    /** The span was written on the property. Pairing leaves these alone. */
    spanExplicit?: boolean;
}

export interface ResolvedFormSection {
    key: string;
    title?: string;
    collapsible: boolean;
    /** Initial state only; the form owns it after first interaction. */
    collapsed: boolean;
    fields: ResolvedFormField[];
    /**
     * Declared arrangement for the read-only view. Carried through untouched —
     * the resolver decides *which* fields a section holds, not how the surface
     * that renders it stacks them, and only the read view honours this.
     */
    readVariant?: "grid" | "summary";
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

/**
 * An audit timestamp the database maintains — `created_at`, `updated_at`.
 *
 * Not a guess from the name: `autoValue` says the column is written by the
 * system on create or update, so the field is never typed. Rendering it as an
 * input in the middle of the form promised an edit that cannot happen, and the
 * record block already shows both values — the same two dates twice on one
 * screen.
 */
export function isAuditTimestamp(property: Property | undefined): boolean {
    return Boolean(
        property
        && property.type === "date"
        && property.autoValue
    );
}

/* -------------------------------------------------------------------------- */
/* pairing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Longest label, help text and option label a field can carry and still take
 * half a row. Past these a half-width field truncates its label, or wraps its
 * help text into a block that leaves its neighbour floating above a hole — the
 * App Capacity field, whose paragraph of help sat beside a one-line App Region.
 */
const PAIR_MAX_LABEL = 32;
const PAIR_MAX_DESCRIPTION = 60;
const PAIR_MAX_OPTION_LABEL = 32;

/** What a field's editor is, for the purpose of sitting beside another one. */
type PairKind = "number" | "switch" | "date" | "date_time" | "select";

function enumLabels(values: EnumValues | Map<unknown, unknown>): string[] {
    const entries: unknown[] = values instanceof Map
        ? [...values.values()]
        : Array.isArray(values) ? values : Object.values(values);
    return entries.map(entry =>
        typeof entry === "string" ? entry : String((entry as { label?: unknown })?.label ?? ""));
}

/**
 * The kind of compact editor this property renders, or `undefined` when its
 * editor needs the row — or when nothing about it says how long its value is.
 *
 * Deliberately narrow. A plain string is never compact: "Namespace" and "Git
 * Branch" are both strings and nothing in the schema tells a 6-character branch
 * from a 60-character URL. Neither is a relation, whose preview is the related
 * record's own text. Only editors whose width is bounded by what they are —
 * a number, a switch, a date picker, a select over short options — qualify.
 */
export function pairKind(property: Property): PairKind | undefined {
    // A custom editor's size is unknown, and a partner that hides itself on a
    // condition strands the other half of its row.
    if (property.admin?.Field) return undefined;
    if (property.conditions) return undefined;
    // Nor does one the form may not render for its user: a field-level read
    // rule (or `excludeFromApi`) hides it, as `EntityForm` does.
    if (effectiveAccess(property)) return undefined;
    if ((property.name?.length ?? 0) > PAIR_MAX_LABEL) return undefined;
    if ((property.description?.length ?? 0) > PAIR_MAX_DESCRIPTION) return undefined;

    switch (property.type) {
        case "boolean":
            return "switch";
        case "date":
            return property.mode === "date_time" ? "date_time" : "date";
        case "number":
        case "string": {
            if (property.enum) {
                const labels = enumLabels(property.enum as EnumValues);
                return labels.every(label => label.length <= PAIR_MAX_OPTION_LABEL) ? "select" : undefined;
            }
            return property.type === "number" ? "number" : undefined;
        }
        default:
            return undefined;
    }
}

/**
 * Put neighbouring fields of the same compact kind two to a row.
 *
 * Greedy and in declaration order: a run of three numbers is a pair and a full
 * row, never a pair with the third pulled out of order. A pair only starts at
 * the beginning of a row — the grid flows, so a pair placed after an author's
 * `span: 2` would split across two rows. Fields with a span the author wrote are
 * left as written, and nothing is widened to close a gap they leave.
 */
export function pairCompactFields(
    fields: ResolvedFormField[],
    propertyOf: (key: string) => Property | undefined
): ResolvedFormField[] {
    const kindOf = (field: ResolvedFormField | undefined): PairKind | undefined => {
        if (!field || field.additional || field.spanExplicit) return undefined;
        const property = propertyOf(field.key);
        return property ? pairKind(property) : undefined;
    };

    const out = [...fields];
    let used = 0; // columns taken in the current row
    for (let i = 0; i < out.length; i++) {
        const kind = kindOf(out[i]);
        if (used === 0 && kind && kindOf(out[i + 1]) === kind) {
            out[i] = {
                ...out[i],
                span: 2
            };
            out[i + 1] = {
                ...out[i + 1],
                span: 2
            };
            i++;
            continue;
        }
        const span = out[i].span;
        if (used + span > GRID_COLUMNS) used = 0;
        used = (used + span) % GRID_COLUMNS;
    }
    return out;
}

/* -------------------------------------------------------------------------- */
/* resolution                                                                 */
/* -------------------------------------------------------------------------- */

function buildField<M extends Record<string, unknown>>(
    key: string,
    collection: AdminCollection<M>
): ResolvedFormField | undefined {
    const property = collection.properties?.[key] as Property | undefined;

    if (!property) {
        // An additionalFields entry: a rendered card, not an input. Full width,
        // because we have no idea what the Builder puts inside it.
        const additional = collection.additionalFields?.some(f => f.key === key);
        return additional ? { key, span: GRID_COLUMNS, additional: true } : undefined;
    }

    if (isHidden(property)) return undefined;

    return {
        key,
        span: property.admin?.span ?? GRID_COLUMNS,
        additional: false,
        spanExplicit: property.admin?.span !== undefined
    };
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

    const available = new Map<string, ResolvedFormField>();
    for (const key of fieldKeys) {
        const field = buildField(key, collection);
        if (field) available.set(key, field);
    }

    /* ---- the id ---------------------------------------------------------- */
    // A single surrogate key is routed out of the form and into the record
    // block, unless it is still typeable. This is what `hideIdFromForm` used to
    // be for; that flag now only decides whether the record block shows it.
    //
    // A COMPOSITE key is not. Postgres has no `id` — a row is addressed by one
    // or more real columns, and `entity.id` is a token we synthesise on top
    // (`a:::b`, see `buildCompositeId`). When the key spans several columns
    // those columns are data: on a junction row, `order_id` and `product_id`
    // are *which order* and *which product*. Hiding them behind an address
    // nobody can read would remove the only meaningful thing on the form.
    const idKeys = [...available.keys()].filter(key =>
        isIdProperty(collection.properties?.[key] as Property | undefined));

    if (idKeys.length === 1) {
        const property = collection.properties?.[idKeys[0]] as Property;
        if (!isIdPropertyEditable(property, status)) {
            available.delete(idKeys[0]);
        }
    }

    /* ---- audit timestamps ------------------------------------------------ */
    // Same treatment as the id, and for the same reason: the record block shows
    // them, so leaving them in the column renders each date twice — once as a
    // disabled input the user cannot change, once as metadata.
    const showRecordMetaResolved = config?.showRecordMeta ?? !collection.hideIdFromForm;
    if (showRecordMetaResolved) {
        for (const key of [...available.keys()]) {
            const property = collection.properties?.[key] as Property | undefined;
            // An explicit `sidebar` entry wins — the author asked for it there.
            if (config?.sidebar?.includes(key as never)) continue;
            if (isAuditTimestamp(property)) available.delete(key);
        }
    }

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

    const showRecordMeta = showRecordMetaResolved;

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
                fields,
                readVariant: section.readVariant
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
    const propertyOf = (key: string) => collection.properties?.[key] as Property | undefined;
    return {
        sections: sections
            .filter(s => s.fields.length > 0)
            .map(s => ({
                ...s,
                fields: pairCompactFields(s.fields, propertyOf)
            })),
        sidebar,
        showRecordMeta,
        hasRail: sidebar.length > 0 || showRecordMeta
    };
}
