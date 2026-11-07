import React, { useContext, useId } from "react";

/**
 * The DOM ids a record form gives its fields and sections, unique per form.
 *
 * Two forms on one page — a record and the record it links to, a form in a
 * dialog over another — each drew `form_field_title`, and an id that is not
 * unique sends a label, an `aria-controls` or a scroll-to-error to the wrong
 * form. Each form takes a scope of its own and every id under it carries it.
 *
 * Ids are for the page's own wiring. To find a field from outside — a test, an
 * e2e script — select by the attributes, which stay the same in every form:
 * `[data-form-field="<key>"]` inside `[data-form-path="<path>"]`.
 */
export const FormDomScopeContext = React.createContext<string | undefined>(undefined);

/**
 * The scope of the form this renders in, or one of the caller's own outside
 * any form (the read-only view of a record draws the same blocks).
 */
export function useFormDomScope(): string {
    const scope = useContext(FormDomScopeContext);
    const own = useId();
    return scope ?? domScopeFromId(own);
}

/** A `useId` value as an id fragment: no characters a CSS selector would need escaped. */
export function domScopeFromId(id: string): string {
    return "form" + id.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function fieldDomId(scope: string, propertyKey: string): string {
    return `${scope}_field_${propertyKey}`;
}

export function sectionDomId(scope: string, sectionKey: string): string {
    return `${scope}_section_${sectionKey}`;
}

/** The selector for one field's block, by its key, in any form. */
export function fieldSelector(propertyKey: string): string {
    return `[data-form-field="${propertyKey.replace(/["\\]/g, "\\$&")}"]`;
}
