import type { AuthState, Properties, Property } from "@rebasepro/types";
import type { FieldViewer, ResolvePropertyProps } from "@rebasepro/common";
import { buildConditionContext, canReadField, canWriteField, resolveProperty } from "@rebasepro/common";
import { deepEqual as equal } from "fast-equals";
import { applyPropertyConditions, isDisabled, isHidden, isReadOnly } from "@rebasepro/app";

/**
 * A property as the record form shows it and judges it, given the values the
 * form holds now: its `dynamicProps` applied, then its `conditions`, then the
 * signed-in user's field access (see {@link applyFieldAccess}).
 *
 * One function for both, so what a field looks like and what the save checks
 * cannot drift apart. They had: the field was resolved through `dynamicProps`
 * and nothing else, and the save was judged against the raw declaration — so a
 * `dynamicProps` validation was never checked, and a `conditions` rule written
 * by the collection editor (and taught by the docs) did nothing anywhere.
 */
export function resolveFormProperty<M extends Record<string, unknown> = Record<string, unknown>>(
    props: ResolvePropertyProps<M>
): Property | null {
    const resolved = resolveProperty(props);
    if (!resolved) return resolved;
    const conditioned = resolved.conditions
        ? applyPropertyConditions(resolved, buildConditionContext({
            propertyKey: props.propertyKey,
            values: props.values,
            previousValues: props.previousValues,
            path: props.path ?? "",
            entityId: props.entityId === undefined ? undefined : String(props.entityId),
            index: props.index,
            authController: props.authController
        }))
        : resolved;
    return applyFieldAccess(conditioned, formViewer(props.authController));
}

/**
 * The signed-in user as a field rule judges them — the roles the condition
 * context reads too, so `hasRole` and `access` agree on who is asking.
 *
 * Always a viewer, never `undefined`: `undefined` is the trusted server plane,
 * which satisfies every non-empty rule. Nobody signed in is a viewer with no
 * roles.
 */
export function formViewer(authController: AuthState): FieldViewer {
    const roles: unknown[] = authController.user?.roles ?? [];
    return { roles: roles.map(r => typeof r === "string" ? r : (r as { id: string }).id) };
}

/**
 * `property.access` in the form, which is where the user meets it.
 *
 * The server enforces it either way — it strips a field the caller cannot
 * read and refuses a write naming one they cannot set. The form did not read
 * it, so a field the user could not write was an ordinary input whose edit
 * came back as a 400 on save, and a field they could not read was an empty
 * input inviting them to fill it. A field they cannot read is hidden; one they
 * can read but not write is shown read-only.
 */
export function applyFieldAccess(property: Property, viewer: FieldViewer): Property {
    if (!canReadField(property, viewer)) {
        return { ...property, conditions: { ...property.conditions, hidden: true } } as Property;
    }
    if (!canWriteField(property, viewer)) {
        return { ...property, admin: { ...property.admin, readOnly: true } } as Property;
    }
    return property;
}

/**
 * A new record's or a copy's values without the fields this user may not
 * write that still hold what the form opened with.
 *
 * The form shows such a field read-only, so its value there is a default or
 * the original record's — not an edit — and the server refuses a whole save
 * that names it. A value that did change (a callback or plugin set it) is
 * kept, and the server's refusal says why the save failed: dropping it would
 * report success for an edit that did not happen.
 */
export function withoutUnwritableDefaults<M extends Record<string, unknown>>(
    values: Partial<M>,
    openedWith: Partial<M>,
    properties: Properties,
    viewer: FieldViewer
): Partial<M> {
    let result: Partial<M> | undefined;
    for (const key of Object.keys(values)) {
        const property = (properties as Record<string, Property | undefined>)[key];
        if (!property || canWriteField(property, viewer)) continue;
        if (!equal(values[key], openedWith[key])) continue;
        result ??= { ...values };
        delete result[key];
    }
    return result ?? values;
}

/**
 * Whether the user can change this field in the form at all. A field the form
 * keeps hidden, read-only or disabled cannot be fixed from it, so it is not the
 * form's to judge: holding the save against it left "Please fix the
 * highlighted errors" over a form with nothing highlighted. The server's own
 * checks — `required`, `NOT NULL` — still hold for it.
 */
function isEditableInForm(property: Property): boolean {
    return !isHidden(property) && !isReadOnly(property) && !isDisabled(property);
}

/**
 * The properties the form validates on submit: each resolved against `values`
 * (see {@link resolveFormProperty}), inside maps too, and only those the user
 * can change.
 */
export function resolvePropertiesForValidation<M extends Record<string, unknown>>({
    properties,
    propertyKey,
    isNew,
    ...props
}: Omit<ResolvePropertyProps<M>, "property"> & {
    properties: Properties;
    /**
     * Whether the record is being created. A field marked
     * `admin.filledByServer` or `databaseDefault` is not required then: the
     * server, or the database, fills it.
     */
    isNew?: boolean;
}): Properties {
    const result: Record<string, Property> = {};
    for (const [key, raw] of Object.entries(properties as Record<string, Property>)) {
        if (!raw) continue;
        const childKey = propertyKey ? `${propertyKey}.${key}` : key;
        const formProperty = resolveFormProperty<M>({
            ...props,
            ignoreMissingFields: true,
            propertyKey: childKey,
            property: raw
        });
        if (!formProperty || !isEditableInForm(formProperty)) continue;
        const filledOnCreate = formProperty.admin?.filledByServer || formProperty.databaseDefault;
        const resolved = isNew && filledOnCreate && formProperty.validation?.required
            ? { ...formProperty, validation: { ...formProperty.validation, required: false } } as Property
            : formProperty;
        if (resolved.type === "map" && resolved.properties) {
            // `resolveProperty` walked the children for their `dynamicProps`
            // but not their conditions. Resolving them again applies both; a
            // builder is a function of the values, so applying it twice is
            // applying it once.
            result[key] = {
                ...resolved,
                properties: resolvePropertiesForValidation<M>({
                    ...props,
                    isNew,
                    propertyKey: childKey,
                    properties: resolved.properties as Properties
                })
            };
        } else {
            result[key] = resolved;
        }
    }
    return result;
}
