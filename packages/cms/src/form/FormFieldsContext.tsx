import React, { useCallback, useContext } from "react";
import { deepEqual as equal } from "fast-equals";
import type { Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { AuthState, Property } from "@rebasepro/types";
import type { ResolvedFormField } from "@rebasepro/app";
import { isHidden, useAuthController, useCustomizationController, useRebaseContext } from "@rebasepro/app";
import type { ResolvePropertyProps } from "@rebasepro/common";
import { effectiveAccess } from "@rebasepro/common";
import { AlignLeftIcon, cls, paperMixin } from "@rebasepro/ui";
import { FormexController, useFormexSelector } from "@rebasepro/forms";

import type { FormContext, PropertyFieldBindingProps } from "../types/fields";
import { AdditionalFieldValue } from "../components/AdditionalFieldValue";
import { FieldBlock, isSelfLabellingProperty, LABEL_ICON_SIZE, spanClass } from "./components/FieldBlock";
import { labelsInsideControl } from "./label_placement";
import { PropertyFieldBinding } from "./PropertyFieldBinding";
import { resolveFormProperty } from "./resolve_form_properties";

type Values = Record<string, unknown>;
type CollectionProperty = NonNullable<AdminCollection["properties"][string]>;

/**
 * What a record form gives every field it renders: the rules that place,
 * label, disable and hide one, and the context it binds to.
 *
 * `EntityForm` provides it, and every field of the form is drawn through
 * {@link FormFieldsContextValue.renderField} — the generated sections, the
 * rail and `<FormField>` alike — so a field has one set of rules wherever it
 * sits.
 *
 * Its identity changes only with what a field draws from it, never with a
 * keystroke: a field reads the values it depends on through the form's
 * selector, so typing in one field does not re-render another.
 */
export interface FormFieldsContextValue {
    collection: AdminCollection<Values>;
    path: string;
    entityId?: string | number;
    entity?: Entity<Values>;
    status: "new" | "existing" | "copy";
    /** The memoised context the bindings take; see `EntityForm`. */
    fieldContext: FormContext<Values>;
    /** What the form opened with, which `conditions` read as the previous values. */
    previousValues: Partial<Values>;
    /** Values the record changed to underneath an edit, by top-level key. */
    underlyingChanges: Record<string, unknown>;
    autoSave: boolean;
    /** The field that takes focus when a new record opens. */
    autoFocusKey?: string;
    /** Every rule that disables a field, except a save in progress. */
    isFieldDisabled: (key: string, property: CollectionProperty) => boolean;
    /** One field, with every rule of the form. */
    renderField: (field: ResolvedFormField) => React.ReactNode;
    /** The field for a key — placed as the form's layout places it, when it does — or nothing for a key the collection lacks. */
    fieldFor: (key: string) => ResolvedFormField | undefined;
    /** Marks a field as shown, for validation; returns the call that unmarks it. */
    register: (key: string) => () => void;
}

export const FormFieldsContext = React.createContext<FormFieldsContextValue | undefined>(undefined);

export function useFormFieldsContext(): FormFieldsContextValue | undefined {
    return useContext(FormFieldsContext);
}

/**
 * Whether a record shows a field, for these values, to this user: no
 * `conditions.hidden` rule hides it and the user's field access lets them read
 * it. The form's cells and the read-only view both ask here, so a field a rule
 * hides while editing is not on the page that reads the record either.
 */
export function isFieldShown<M extends Record<string, unknown>>(props: {
    propertyKey: string;
    property: Property;
    values: Partial<M>;
    previousValues?: Partial<M>;
    path: string;
    entityId?: string | number;
    propertyConfigs?: ResolvePropertyProps<M>["propertyConfigs"];
    authController: AuthState;
}): boolean {
    const { property } = props;
    // Most fields carry neither rule, and resolving one runs its dynamicProps.
    if (!property.conditions?.hidden && !effectiveAccess(property)) return true;
    const shown = resolveFormProperty<M>({
        ...props,
        ignoreMissingFields: true
    });
    return shown !== null && !isHidden(shown);
}

/** What {@link FormFieldsContextValue.renderField} renders: one cell, keyed for a list. */
export function renderFormField(field: ResolvedFormField): React.ReactNode {
    return <FormFieldCell key={`${field.additional ? "additional" : "field"}_${field.key}`} field={field}/>;
}

/**
 * One field of the form. Memoised on its placement: it re-renders when the
 * form's rules change, or when one of the few things it reads from the values
 * changes — whether a rule hides it, whether the record changed under it,
 * whether a save is running.
 */
const FormFieldCell = React.memo(function FieldCell({ field }: { field: ResolvedFormField }) {

    const fields = useContext(FormFieldsContext);
    if (!fields) throw new Error("INTERNAL: a form field rendered outside its form");

    const authController = useAuthController();
    const customizationController = useCustomizationController();
    const rebaseContext = useRebaseContext();

    const {
        collection,
        path,
        entityId,
        entity,
        previousValues,
        underlyingChanges,
        autoSave,
        autoFocusKey,
        isFieldDisabled,
        fieldContext
    } = fields;

    const property = field.additional ? undefined : collection.properties?.[field.key];

    // A field a rule hides for these values, or that this user may not read,
    // takes its label with it: the binding renders nothing, and a heading over
    // nothing is worse. Selected as a yes or no, so the cell re-renders when
    // that answer flips and not on every value its rule reads.
    const selectShown = useCallback((formex: FormexController<Values>): boolean => {
        if (!property) return true;
        return isFieldShown({
            propertyKey: field.key,
            property,
            values: formex.values,
            previousValues,
            path,
            entityId,
            propertyConfigs: customizationController.propertyConfigs,
            authController
        });
    }, [property, field.key, previousValues, path, entityId, customizationController.propertyConfigs, authController]);
    const shown = useFormexSelector(selectShown);

    const selectUnderlyingChanged = useCallback((formex: FormexController<Values>): boolean =>
        field.key in underlyingChanges && !equal(formex.values[field.key], underlyingChanges[field.key]),
    [field.key, underlyingChanges]);
    const underlyingValueHasChanged = useFormexSelector(selectUnderlyingChanged);

    const selectSubmitting = useCallback((formex: FormexController<Values>): boolean =>
        !autoSave && formex.isSubmitting, [autoSave]);
    const submitting = useFormexSelector(selectSubmitting);

    if (field.additional) {
        const additionalField = collection.additionalFields?.find(f => f.key === field.key);
        if (!additionalField || !entity) return null;

        const AdditionalFieldBuilder = additionalField.Builder;
        if (!AdditionalFieldBuilder && !additionalField.value) {
            throw new Error("When using additional fields you need to provide a Builder or a value");
        }
        const child = AdditionalFieldBuilder
            ? <AdditionalFieldBuilder entity={entity} context={rebaseContext}/>
            : <div className={"w-full"}>
                <AdditionalFieldValue
                    field={additionalField}
                    entity={entity}
                    context={rebaseContext}/>
            </div>;

        return (
            // Through FieldBlock like every other cell, so a computed column
            // is labelled at the same size, with the same gap to its box, as
            // the property next to it on the grid.
            <div className={spanClass(field.span)}>
                <FieldBlock propertyKey={field.key}
                    showLabel={true}
                    label={additionalField.name}
                    icon={<AlignLeftIcon size={LABEL_ICON_SIZE}/>}>
                    <div className={cls(paperMixin, "w-full min-h-12 p-4 md:p-6 overflow-x-auto no-scrollbar")}>
                        {child}
                    </div>
                </FieldBlock>
            </div>
        );
    }

    if (!property) {
        console.warn(`Property ${field.key} not found in collection ${collection.name} in properties or additional fields. Skipping.`);
        return null;
    }
    if (!shown) return null;

    const disabled = submitting || isFieldDisabled(field.key, property);
    // Three places a label can be. The panel-style editors carry their own
    // header. The one-line controls draw it inside their box, FireCMS-style,
    // so they all stand the same height. Everything else — multi-selects,
    // uploads, markdown, relations — is labelled above by FieldBlock.
    const selfLabelling = isSelfLabellingProperty(property);
    const labelInside = !selfLabelling
        && labelsInsideControl(property, customizationController.propertyConfigs);

    const bindingProps: PropertyFieldBindingProps<Values> = {
        propertyKey: field.key,
        disabled,
        property,
        // FieldBlock owns the description, so the binding must not repeat it —
        // it still renders validation errors, which belong against the control
        // rather than under the label.
        includeDescription: false,
        hideLabel: !selfLabelling && !labelInside,
        underlyingValueHasChanged: underlyingValueHasChanged && !autoSave,
        context: fieldContext,
        partOfArray: false,
        minimalistView: false,
        // One height for every control in the form. Left to their own
        // defaults, a text field came out 48px, a select 44 and a switch 64.
        // `large`: the record-form density — a 64px box with the label inside
        // and a 16px value, or a 48px box under a label. See DESIGN.md "Form
        // density".
        size: "large",
        autoFocus: autoFocusKey === field.key
    };

    return (
        <div className={spanClass(field.span)}>
            <FieldBlock propertyKey={field.key}
                property={property}
                showLabel={!selfLabelling && !labelInside}
                labelInside={labelInside}>
                <PropertyFieldBinding {...bindingProps}/>
            </FieldBlock>
        </div>
    );
});
