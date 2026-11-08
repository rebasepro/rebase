import React, { useEffect } from "react";
import { useFormFieldsContext } from "./FormFieldsContext";

/**
 * Props for {@link FormField}.
 *
 * @group Form custom fields
 */
export interface FormFieldProps {
    /** The key of the property, or of the `additionalFields` entry, to render. */
    name: string;
}

/**
 * One field of the record form it is rendered in, bound to the collection's
 * property of that name: the same label, density, disabled and hidden rules,
 * validation and autosave as the generated form gives it.
 *
 * Place it anywhere inside a record form — among `RecordForm`'s children,
 * or in a collection's `formView.Builder` — to arrange the fields yourself.
 * A field drawn this way counts as shown: where the form is laid out with
 * `<FormField>`s, it validates the fields they render and no others.
 *
 * Typing in one field does not re-render another.
 *
 * @example
 * ```tsx
 * <RecordForm collection="orders" id={id}>
 *     <div className="grid grid-cols-2 gap-4">
 *         <FormField name="customer"/>
 *         <FormField name="status"/>
 *     </div>
 *     <FormField name="notes"/>
 * </RecordForm>
 * ```
 *
 * @group Form custom fields
 */
export function FormField({ name }: FormFieldProps): React.ReactNode {
    const fields = useFormFieldsContext();
    const field = fields?.fieldFor(name);
    const register = field ? fields?.register : undefined;
    useEffect(() => register?.(name), [register, name]);
    if (!fields) {
        throw new Error(`<FormField name="${name}"/> is rendered outside a record form. Render it inside RecordForm, as its children, in a collection's \`formView.Builder\`, or another child of EntityForm.`);
    }
    if (!field) {
        throw new Error(`<FormField name="${name}"/>: the collection "${fields.collection.slug}" has no property or additional field named "${name}".`);
    }
    return fields.renderField(field);
}
