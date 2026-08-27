import { InferPropertyType } from "@rebasepro/types";
import { Entity } from "@rebasepro/types";
import { FormexController } from "./components/formex";

import { Property } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";

export type DefaultFieldConfig =
    | "text_field"
    | "multiline"
    | "markdown"
    | "url"
    | "email"
    | "switch"
    | "select"
    | "multi_select"
    | "user_select"
    | "number_input"
    | "number_select"
    | "multi_number_select"
    | "file_upload"
    | "multi_file_upload"
    | "reference"
    | "multi_references"
    | "relation"
    | "date_time"
    | "group"
    | "key_value"
    | "repeat"
    | "custom_array"
    | "block"
    | "vector_input"
    | "geopoint"
    | "binary";

/**
 * When building a custom field you need to create a React component that takes
 * this interface as props.
 *
 * @group Form custom fields
 */
export interface FieldProps<
    P extends Property | Property = Property,
    CustomProps = unknown,
    M extends Record<string, unknown> = Record<string, unknown>> {

    /**
     * Key of the property
     * E.g. "user.name" for a property with path "user.name"
     */
    propertyKey: string;

    /**
     * Current value of this field, inferred from the property type P
     */
    value: InferPropertyType<P> | any;
    setValue: (value: InferPropertyType<P> | null | any, shouldValidate?: boolean) => void;

    /**
     * Set value of a different field directly
     * @param propertyKey
     * @param value
     * @param shouldValidate
     */
    setFieldValue: (propertyKey: string, value: unknown, shouldValidate?: boolean) => void;

    /**
     * Is the form currently submitting
     */
    isSubmitting?: boolean;

    /**
     * Should this field show the error indicator.
     * Note that there might be an error (like an empty field that should be
     * filled) but we don't want to show the error until the user has tried
     * saving.
     */
    showError?: boolean;

    /**
     * Is there an error in this field. The error field has the same shape as
     * the field, replacing values with a string containing the error.
     * It takes the value `null` if there is no error
     */
    error?: string;

    /**
     * Has this field been touched
     */
    touched?: boolean;

    /**
     * Property related to this field, now strongly typed to P
     */
    property: P;

    /**
     * Should this field include a description
     */
    includeDescription?: boolean;

    /**
     * The container is rendering the label and the description itself, so this
     * field should render only its control.
     *
     * This is what the generated form sets. Field types used to disagree about
     * where a label goes — text and number put it inside the input, select,
     * array, storage and read-only put it above — which read as two design
     * systems in one column. The label now belongs to the form, and the binding
     * to the control.
     *
     * A custom field that ignores this still renders its own label, so it
     * degrades to the old look rather than losing its label.
     */
    hideLabel?: boolean;

    /**
     * Flag to indicate that the underlying value has been updated in the
     * driver
     */
    underlyingValueHasChanged?: boolean;

    /**
     * Is this field part of an array
     */
    partOfArray?: boolean;

    /**
     * Is this field part of a block
     */
    partOfBlock?: boolean;

    /**
     * Display the child properties directly, without being wrapped in an
     * extendable panel. Note that this will also hide the title of this property.
     */
    minimalistView?: boolean;

    /**
     * Should this field autofocus on mount
     */
    autoFocus?: boolean;

    /**
     * Additional properties set by the developer
     */
    customProps?: CustomProps;

    /**
     * Additional values related to the state of the form or the entity
     */
    context: FormContext<M>;

    /**
     * Flag to indicate if this field should be disabled
     */
    disabled?: boolean;

    /**
     * Size of the field
     */
    size?: "small" | "medium" | "large";

    /**
     * Some properties might change internal state (like expanding a panel).
     * This function should be called when the internal state changes.
     * This is used to preserve state in array containers.
     *
     * @param property
     */
    onPropertyChange?: (property: Partial<Property>) => void;

}

/**
 * Context passed to custom fields
 * @group Form custom fields
 */
export interface FormContext<M extends Record<string, unknown> = Record<string, unknown>> {

    /**
     * Current values of the entity
     */
    values: M;

    /**
     * Update the value of a field
     * @param key
     * @param value
     * @param shouldValidate
     */
    setFieldValue: (key: string, value: unknown, shouldValidate?: boolean) => void;

    /**
     * Quietly persist the entity to the database without any UI feedback
     * (no validation, no snackbar, no form reset).
     * Use this for programmatic/background saves from custom views.
     */
    save: (values: M) => void;

    /**
     * Submit the form — validates, saves, resets the form, and shows
     * a success snackbar. This is what the Save button calls.
     * Use this from custom views when you want the full "user saved" experience.
     */
    submit: () => void;

    /**
     * Collection of the entity being modified
     */
    collection?: AdminCollection<M>;

    /**
     * Entity id, it can be undefined if it's a new entity
     */
    entityId?: string | number;

    /**
     * Path this entity is located at
     */
    path?: string;

    status: "new" | "existing" | "copy";

    entity?: Entity<M>;

    savingError?: Error;

    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /**
     * This is the underlying formex controller that powers the form.
     * If you are in a red only mode, the formex controller is there, but you can't
     * operate with it
     */
    formex: FormexController<M>;

    disabled: boolean;

    /**
     * A save is in flight, including the autosave debounce, which `formex`
     * cannot report because it never goes through `handleSubmit`.
     */
    isSaving?: boolean;

    /**
     * Whether the form context is in read-only detail view mode.
     * Custom entity views can use this to adjust their rendering.
     */
    readOnly?: boolean;
}

/**
 * In case you need to render a field bound to a Property inside your
 * custom field you can use {@link PropertyFieldBinding} with these props.
 * @group Form custom fields
 */
export interface PropertyFieldBindingProps<M extends Record<string, unknown> = Record<string, unknown>> {

    /**
     * The key/path of the property, such as `age`. You can use nested and array
     * indexed such as `address.street` or `people[3]`
     */
    propertyKey: string;

    /**
     * The admin property you are binding this field to
     */
    property: Property;

    /**
     * The context where this field is being rendered. You get a context as a
     * prop when creating a custom field.
     */
    context: FormContext<M>;

    /**
     * Should the description be included in this field
     */
    includeDescription?: boolean;

    /**
     * The container renders the label and description; render only the control.
     * See the note on {@link FieldProps.hideLabel}.
     */
    hideLabel?: boolean;

    /**
     * Has the value of this property been updated in the database while this
     * field is being edited
     */
    underlyingValueHasChanged?: boolean;

    /**
     * Is this field part of an array
     */
    partOfArray?: boolean;

    /**
     * Is this field part of a block
     */
    partOfBlock?: boolean;

    /**
     * Display the child properties directly, without being wrapped in an
     * extendable panel. Note that this will also hide the title of this property.
     */
    minimalistView?: boolean;

    /**
     * Should the field take focus when rendered. When opening the popup view
     * in table mode, it makes sense to put the focus on the only field rendered.
     */
    autoFocus?: boolean;

    /**
     * Should this field be disabled
     */
    disabled?: boolean;

    /**
     * Index of the field in the array.
     * Only used when the field is part of an array.
     */
    index?: number;

    /**
     * The size of the field
     */
    size?: "small" | "medium" | "large",

    /**
     * Some properties might change internal state (like expanding a panel).
     * This function should be called when the internal state changes.
     * This is used to preserve state in array containers.
     *
     * @param property
     */
    onPropertyChange?: (property: Partial<Property>) => void;
}
