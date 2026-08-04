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

/**
 * Columns in the form grid.
 *
 * A local literal rather than an import of `FORM_GRID_COLUMNS`: everything else
 * this module takes from `@rebasepro/admin-types` is a *type*, erased at build
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
    /**
     * The span was written on the property rather than derived from its type.
     * Row filling leaves these alone: an author who wrote a width meant it.
     */
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
/* span derivation                                                            */
/* -------------------------------------------------------------------------- */

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

/**
 * Close the trailing gap in each row.
 *
 * Without this a section of half-width fields with an odd count leaves a hole —
 * `name | sku` then `brand | ␣␣` — a field stranded beside half a row of
 * nothing, which reads as a mistake rather than a layout. The remainder is
 * spread across the row's derived fields rather than dumped on the last one, so
 * a lone half-width field becomes full width and a pair grows evenly. Fields
 * with an explicit span are never resized.
 */
export function fillRows(fields: ResolvedFormField[]): ResolvedFormField[] {
    const rows: ResolvedFormField[][] = [];
    let row: ResolvedFormField[] = [];
    let used = 0;

    for (const field of fields) {
        if (used + field.span > GRID_COLUMNS && row.length) {
            rows.push(row);
            row = [];
            used = 0;
        }
        row.push(field);
        used += field.span;
    }
    if (row.length) rows.push(row);

    return rows.flatMap(entries => {
        const total = entries.reduce((sum, f) => sum + f.span, 0);
        let gap = GRID_COLUMNS - total;
        if (gap <= 0) return entries;

        // Spread the remainder across the row's derived fields rather than
        // dumping it all on the last one: two half-width fields beside a gap
        // become two three-quarter fields, not one full-width and one half.
        // Fields with an explicit span keep it — the author picked that width.
        const growable = entries
            .map((f, i) => [f, i] as const)
            .filter(([f]) => !f.spanExplicit);

        if (!growable.length) return entries;

        const next = [...entries];
        let cursor = 0;
        while (gap > 0) {
            const [, index] = growable[cursor % growable.length];
            next[index] = { ...next[index], span: (next[index].span + 1) as PropertySpan };
            gap -= 1;
            cursor += 1;
        }
        return next;
    });
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
    const explicit = admin?.span !== undefined;
    const span: PropertySpan = admin?.span ?? deriveSpan(property, key === titlePropertyKey);

    return { key, span, additional: false, spanExplicit: explicit };
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
    const nonEmpty = sections
        .filter(s => s.fields.length > 0)
        .map(s => ({ ...s, fields: fillRows(s.fields) }));

    return {
        sections: nonEmpty,
        sidebar,
        showRecordMeta,
        hasRail: sidebar.length > 0 || showRecordMeta
    };
}
