import type { Properties, Property } from "@rebasepro/types";
import type { ResolvePropertyProps } from "@rebasepro/common";
import { buildConditionContext, resolveProperty } from "@rebasepro/common";
import { applyPropertyConditions, isDisabled, isHidden, isReadOnly } from "@rebasepro/app";

/**
 * A property as the record form shows it and judges it, given the values the
 * form holds now: its `dynamicProps` applied, then its `conditions`.
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
    if (!resolved?.conditions) return resolved;
    return applyPropertyConditions(resolved, buildConditionContext({
        propertyKey: props.propertyKey,
        values: props.values,
        previousValues: props.previousValues,
        path: props.path ?? "",
        entityId: props.entityId === undefined ? undefined : String(props.entityId),
        index: props.index,
        authController: props.authController
    }));
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
     * `admin.filledByServer` is not required then: the server fills it.
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
        const resolved = isNew && formProperty.admin?.filledByServer && formProperty.validation?.required
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
