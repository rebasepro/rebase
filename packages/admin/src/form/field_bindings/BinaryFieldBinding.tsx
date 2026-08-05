import type { FieldProps } from "../../types/fields";
import type { BinaryProperty } from "@rebasepro/types";
import React, { useCallback, useEffect, useState } from "react";
import { Button, CheckIcon, cls, defaultBorderMixin, IconButton, PencilIcon, TextField, Trash2Icon } from "@rebasepro/ui";

import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";
import { getIconForProperty } from "../../util/property_utils";

/** Base64, optionally padded. Empty is allowed — that is a cleared field. */
export const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decoded byte count of a base64 string, without decoding it. */
export function decodedBytes(base64: string): number {
    const clean = base64.replace(/\s/g, "");
    if (!clean) return 0;
    const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    return Math.max(0, (clean.length * 3) / 4 - padding);
}

export function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Field binding for `type: "binary"`, whose value is a base64-encoded string.
 *
 * Before this there was no binary field. The widget lookup mapped the type
 * straight to `text_field`, so a binary column rendered as an ordinary string
 * input — offering multiline, markdown and email options that mean nothing for
 * bytes, and, worse, pushing the property through a widget whose editor merges
 * `type: "string"`. Opening a binary property and touching its widget silently
 * changed its type.
 *
 * Shown collapsed by default. Base64 is long, unreadable and never worth
 * scrolling past to reach the next field; what a person actually wants to know
 * is whether there is anything in there and how big it is.
 *
 * @group Form fields
 */
export function BinaryFieldBinding({
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
}: FieldProps<BinaryProperty>) {

    const stored = typeof value === "string" ? value : "";
    const [text, setText] = useState(stored);
    const [isEditing, setIsEditing] = useState(false);

    useEffect(() => {
        setText(typeof value === "string" ? value : "");
    }, [value]);

    useClearRestoreValue({ property, value, setValue });

    const handleClear = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setText("");
        setValue(null);
    }, [setValue]);

    const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const raw = e.target.value;
        setText(raw);
        setValue(raw === "" ? null : (raw as never));
    }, [setValue]);

    const malformed = text.trim() !== "" && !BASE64.test(text.replace(/\s/g, ""));
    const bytes = malformed ? 0 : decodedBytes(text);
    const isPopulated = text.trim() !== "";

    const localError = malformed ? "Not valid base64" : undefined;

    return (
        <div className="flex flex-col gap-2 w-full">
            {/* The row goes away with the label rather than emptying out. Left
                unconditional it still contributed its `mb-1` and the column's
                `gap-2`, which — on top of the `mt-2` that used to sit on the
                wrapper — pushed this control 20px below the one next to it
                while the two labels stayed level. */}
            {!hideLabel && <div className="flex items-center justify-between mb-1">
                <LabelWithIcon
                    icon={getIconForProperty(property, "small")}
                    required={property.validation?.required}
                    title={property.name ?? propertyKey}
                />
            </div>}

            <PropertyIdCopyTooltip propertyKey={propertyKey}>
                <div className="w-full">
                    {!isEditing ? (
                        <div className={cls("flex items-center justify-between gap-2 p-4 rounded-xl border bg-surface-50/50 dark:bg-surface-800/20", defaultBorderMixin)}>
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isPopulated ? "bg-emerald-500" : "bg-surface-300 dark:bg-surface-600"}`}/>
                                <span className="text-sm font-semibold text-text-primary truncate">
                                    {malformed
                                        ? "Invalid base64"
                                        : isPopulated ? `${humanSize(bytes)} of binary data` : "Empty"}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {!disabled && (
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        onClick={() => setIsEditing(true)}
                                        startIcon={<PencilIcon size={14}/>}
                                    >
                                        {isPopulated ? "Edit base64" : "Add base64"}
                                    </Button>
                                )}
                                {isPopulated && !disabled && (
                                    <IconButton
                                        size="small"
                                        onClick={handleClear}
                                        className="text-text-secondary hover:text-red-500"
                                        aria-label="Clear binary value"
                                    >
                                        <Trash2Icon size={14}/>
                                    </IconButton>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className={cls("flex flex-col gap-2 p-4 rounded-xl border", defaultBorderMixin)}>
                            <TextField
                                size={size}
                                value={text}
                                onChange={onChange}
                                autoFocus={autoFocus ?? true}
                                multiline
                                minRows={4}
                                disabled={disabled}
                                placeholder="Base64-encoded bytes, e.g. iVBORw0KGgo…"
                                error={showError ? Boolean(error) || malformed : malformed}
                                inputClassName={`font-mono text-xs ${malformed ? "text-red-500" : ""}`}
                            />
                            <div className="flex justify-end">
                                <Button
                                    variant="filled"
                                    size="small"
                                    onClick={() => setIsEditing(false)}
                                    startIcon={<CheckIcon size={14}/>}
                                >
                                    Done
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </PropertyIdCopyTooltip>

            <FieldHelperText
                includeDescription={includeDescription}
                showError={showError || malformed}
                error={error || localError}
                disabled={disabled}
                property={property}
            />
        </div>
    );
}
