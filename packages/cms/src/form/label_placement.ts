import type { Property } from "@rebasepro/types";
import type { PropertyConfig } from "@rebasepro/cms-types";
import { isReadOnly } from "@rebasepro/app";
import { getFieldId } from "../components/field_ids";

/**
 * Where a record-form field's label goes: inside its own box, or above it.
 *
 * A one-line control carries its label inside, the way FireCMS draws a field:
 * a filled box, the label shrunk into its top edge, the value under it. Text,
 * numbers, dates, switches and single selects are all one line, so they come
 * out the same height, and two of them paired on a row line up box to box.
 *
 * Everything else keeps the label above, drawn by `FieldBlock`: a multi-select
 * (its chips wrap onto more lines, and a label sitting on the first of them
 * reads as one more chip), uploads, markdown, relations and references, and the
 * panel editors, which carry a header of their own.
 *
 * Not exported from the package. Which editor draws its label where is the
 * form's own decision, and it has to stay in step with the bindings: the ones
 * listed here render their label inside when the form does not set
 * `hideLabel`.
 */
const LABEL_INSIDE_FIELDS: ReadonlySet<string> = new Set([
    "text_field",
    "multiline",
    "url",
    "email",
    "number_input",
    "select",
    "number_select",
    "date_time",
    "switch"
]);

/**
 * Whether the form leaves this property's label to its binding, which draws it
 * inside the control.
 *
 * Decided from the declared property, as `isSelfLabellingProperty` is. Anything
 * the form cannot vouch for keeps the label above, where `FieldBlock` draws it
 * whatever the editor renders: a custom `admin.Field`, a custom property config,
 * and a built-in editor a plugin has replaced through `propertyConfigs`.
 */
export function labelsInsideControl(
    property: Property,
    propertyConfigs?: Record<string, PropertyConfig>
): boolean {
    if (property.admin?.Field) return false;
    if (isReadOnly(property)) return readOnlyLabelsInside(property);
    const fieldId = getFieldId(property);
    if (!fieldId || !LABEL_INSIDE_FIELDS.has(fieldId)) return false;
    if (propertyConfigs?.[fieldId]?.property.admin?.Field) return false;
    return true;
}

/**
 * Whether a read-only value is one line, and so drawn like the one-line fields
 * around it: a box of the same height with the label inside.
 *
 * Read-only properties are rendered by `ReadOnlyFieldBinding` whatever their
 * type, so this asks of the value what `LABEL_INSIDE_FIELDS` asks of the
 * editor. A computed subtotal paired with an editable tax amount is the case it
 * exists for — with the label above, its box sat a label's height lower than
 * the one beside it.
 */
export function readOnlyLabelsInside(property: Property): boolean {
    switch (property.type) {
        case "number":
        case "date":
            return true;
        case "string":
            return !property.admin?.markdown
                && !property.admin?.multiline
                && !property.storage;
        default:
            return false;
    }
}
