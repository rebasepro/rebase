import type { FieldProps } from "../../types/fields";
import type { NumberProperty, StringProperty } from "@rebasepro/types";
import React, { useCallback } from "react";

import {
    cls,
    Collapse,
    fieldBackgroundHoverMixin,
    fieldBackgroundMixin,
    IconButton,
    TextareaAutosize,
    TextField,
    XIcon
} from "@rebasepro/ui";
import { PreviewType } from "@rebasepro/admin-types";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { PropertyPreview } from "../../preview";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";
import { getIconForProperty } from "../../util/property_utils";

/**
 * Generic text field.
 * This is one of the internal components that get mapped natively inside forms
 * and tables to the specified properties.
 * @group Form fields
 */
export function TextFieldBinding<T extends string | number>({
                                                                propertyKey,
                                                                value,
                                                                setValue,
                                                                error,
                                                                showError,
                                                                disabled,
                                                                autoFocus,
                                                                property,
                                                                includeDescription,
                                                                hideLabel,
                                                                size = "large"
                                                            }: FieldProps<StringProperty | NumberProperty>) {

    let multiline: boolean | undefined;
    let url: boolean | PreviewType | undefined;
    if (property.type === "string") {
        multiline = property.admin?.multiline;
        url = property.admin?.urlPreview;
    }

    useClearRestoreValue({
        property,
        value,
        setValue
    });

    const displayValue = (value !== undefined && value !== null) ? String(value) : "";

    const handleClearClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setValue(null);
    }, [setValue]);

    const onChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (inputType === "number") {
            const numberValue = event.target.value ? parseFloat(event.target.value) : undefined;
            if (numberValue && isNaN(numberValue)) {
                setValue(null);
            } else if (numberValue !== undefined && numberValue !== null) {
                setValue(numberValue as T);
            } else {
                setValue(null);
            }
        } else {
            setValue(event.target.value as T);
        }
    };

    const isMultiline = Boolean(multiline);

    let inputType: "number" | "email" | "url" | undefined = undefined;
    if (property.type === "number") {
        inputType = "number";
    } else if (property.type === "string") {
        if (property.email) inputType = "email";
        else if (property.admin?.urlPreview) inputType = "url";
    }

    // `undefined` rather than an empty element: TextField and the multiline box
    // both reserve a label row whenever `label` is truthy, so a null-rendering
    // element would leave the gap behind without the text.
    const label = hideLabel
        ? undefined
        : (
            <LabelWithIcon
                icon={getIconForProperty(property, "small")}
                required={property.validation?.required || property.isId === true}
                title={property.name ?? propertyKey}/>
        );

    // The control needs a name of its own in two cases, and between them they
    // cover every text field in an entity form:
    //
    //  - `hideLabel`, which the form sets for anything FieldBlock labels for it
    //    (`hideLabel: !selfLabelling`). FieldBlock draws the name in a <span>
    //    inside a <div> — not a <label>, and pointing at nothing — so suppressing
    //    the field's own label left the input with no accessible name at all and
    //    a screen reader fell back to reading its value back to you.
    //  - the multiline branch below, which never associated anything: its label
    //    is a decorative absolutely-positioned <div>, so it is unnamed whether or
    //    not the form also drew one.
    //
    // The single-line TextField is already handled by the kit when a label is
    // present — it wires `aria-labelledby` — so it only needs this as a fallback.
    const accessibleName = property.name ?? propertyKey;
    return (<>
            <PropertyIdCopyTooltip propertyKey={propertyKey}>
                {isMultiline ? (
                    <div className={cls(
                        "rounded-md relative max-w-full min-h-[64px]",
                        fieldBackgroundMixin,
                        fieldBackgroundHoverMixin,
                        showError && error ? "border border-red-500 dark:border-red-600" : ""
                    )}>
                        {label && <div
                            className="pointer-events-none absolute top-1 text-xs font-medium px-3 text-text-secondary dark:text-text-secondary-dark">
                            {label}
                        </div>}
                        <TextareaAutosize
                            value={displayValue}
                            onChange={onChange}
                            autoFocus={autoFocus}
                            disabled={disabled}
                            aria-label={accessibleName}
                            className={cls(
                                "rounded-md resize-none w-full outline-none text-base bg-transparent min-h-[64px] px-3",
                                label ? "pt-8 pb-2" : "py-2",
                                disabled && "outline-none opacity-50 text-surface-accent-600 dark:text-surface-accent-500",
                                showError && error ? "text-red-500 dark:text-red-600" : ""
                            )}
                        />
                        {property.admin?.clearable && (
                            <div
                                className="flex flex-row justify-center items-center absolute h-full right-0 top-0 mr-4">
                                <IconButton onClick={handleClearClick}>
                                    <XIcon/>
                                </IconButton>
                            </div>
                        )}
                    </div>
                ) : (
                    <TextField
                        size={size}
                        value={displayValue}
                        onChange={onChange}
                        autoFocus={autoFocus}
                        label={label}
                        aria-label={label ? undefined : accessibleName}
                        type={inputType}
                        disabled={disabled}
                        endAdornment={
                            property.admin?.clearable && <IconButton
                                onClick={handleClearClick}>
                                <XIcon/>
                            </IconButton>
                        }
                        error={showError ? !!error : undefined}
                        inputClassName={error ? "text-red-500 dark:text-red-600" : ""}/>
                )}
            </PropertyIdCopyTooltip>
            <FieldHelperText includeDescription={includeDescription}
                             showError={showError}
                             error={error}
                             disabled={disabled}
                             property={property}/>

            {url && <Collapse
                className="mt-1 ml-1"
                in={Boolean(value)}>
                <PropertyPreview
                    value={value}
                    property={property}
                    size={size}/>
            </Collapse>}

        </>
    );

}
