import type { FieldProps } from "../../types/fields";
import type { VectorProperty } from "@rebasepro/types";
import React, { useState, useEffect, useCallback } from "react";
import {
    Button,
    CheckIcon,
    cls,
    defaultBorderMixin,
    EyeIcon,
    EyeOffIcon,
    IconButton,
    PencilIcon,
    TextField,
    Trash2Icon
} from "@rebasepro/ui";
import { FieldHelperText } from "../components/FieldHelperText";
import { LabelWithIcon } from "../components/LabelWithIcon";
import { useClearRestoreValue } from "../useClearRestoreValue";
import { PropertyIdCopyTooltip } from "../../components/PropertyIdCopyTooltip";
import { getIconForProperty } from "../../util/property_utils";

/**
 * Custom field binding to render vector fields (e.g. for high-dimensional embeddings).
 * Shows a compact metadata card by default, and lets users expand values or edit them.
 *
 * Automatically parses inputs to number arrays and packages them into the canonical
 * Vector object structure expected by Rebase driver.
 * @group Form fields
 */
export function VectorFieldBinding({
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
}: FieldProps<VectorProperty>) {
    const isVectorObject = (val: unknown): val is { value: number[] } => {
        return typeof val === "object" && val !== null && "value" in val;
    };

    // Extract array value from the custom { __type: "Vector", value: number[] } wrapper
    const arrayValue = isVectorObject(value)
        ? value.value
        : (Array.isArray(value) ? value : []);

    const [textValue, setTextValue] = useState(() => arrayValue.join(", "));
    const [isEditing, setIsEditing] = useState(false);
    const [showValues, setShowValues] = useState(false);

    useEffect(() => {
        setTextValue(arrayValue.join(", "));
    }, [JSON.stringify(arrayValue)]);

    useClearRestoreValue({
        property,
        value,
        setValue
    });

    const handleClearClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setValue(null);
        setTextValue("");
    }, [setValue]);

    const onChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const raw = event.target.value;
        setTextValue(raw);

        // Parse comma-separated string to number array
        const numbers = raw
            .split(",")
            .map(str => str.trim())
            .filter(str => str !== "")
            .map(Number);

        setValue({
            __type: "Vector",
            value: numbers
        });
    };

    const label = hideLabel ? null : (
        <LabelWithIcon
            icon={getIconForProperty(property, "small")}
            required={property.validation?.required}
            title={property.name ?? propertyKey}
        />
    );

    const isPopulated = arrayValue.length > 0;

    return (
        <div className="flex flex-col gap-2 w-full">
            {/* Only when there is a label to put in it — an empty row still
                spends its `mb-1` and the column's `gap-2`, and the control ends
                up below the one beside it under a label at the same height. */}
            {label && <div className="flex items-center justify-between mb-1">
                {label}
            </div>}

            <PropertyIdCopyTooltip propertyKey={propertyKey}>
                <div className="w-full">
                    {!isEditing ? (
                        /* Compact Preview Card */
                        <div className={cls("flex flex-col gap-3 p-4 rounded-xl border bg-surface-50/50 dark:bg-surface-800/20 backdrop-blur-sm transition-all duration-200", defaultBorderMixin)}>
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex items-center gap-2.5">
                                    {/* Status Dot */}
                                    <div className={`w-2.5 h-2.5 rounded-full ${isPopulated ? "bg-emerald-500 animate-pulse" : "bg-surface-300 dark:bg-surface-600"}`} />
                                    <span className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                                        {isPopulated ? `${arrayValue.length} Dimensions` : "Empty Vector"}
                                    </span>
                                    {isPopulated && (
                                        <span className="text-xs text-text-secondary dark:text-text-secondary-dark px-2 py-0.5 rounded-full bg-surface-100 dark:bg-surface-800 font-medium">
                                            Embedding
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    {isPopulated && (
                                        <Button
                                            variant="text"
                                            size="small"
                                            onClick={() => setShowValues(!showValues)}
                                            startIcon={showValues ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                                        >
                                            {showValues ? "Hide values" : "Show values"}
                                        </Button>
                                    )}
                                    {!disabled && (
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            onClick={() => setIsEditing(true)}
                                            startIcon={<PencilIcon size={14} />}
                                        >
                                            {isPopulated ? "Edit values" : "Add values"}
                                        </Button>
                                    )}
                                    {isPopulated && !disabled && (
                                        <IconButton size="small" onClick={handleClearClick} className="text-text-secondary hover:text-red-500">
                                            <Trash2Icon size={14} />
                                        </IconButton>
                                    )}
                                </div>
                            </div>

                            {/* Collapsible scrollable numbers list */}
                            {showValues && isPopulated && (
                                <div className="mt-1 p-3 rounded-lg bg-surface-100/50 dark:bg-surface-900/40 border border-surface-200/50 dark:border-surface-800/50 max-h-36 overflow-y-auto font-mono text-[11px] leading-relaxed text-text-secondary dark:text-text-secondary-dark break-all selection:bg-primary-100 dark:selection:bg-primary-900/40">
                                    {arrayValue.join(", ")}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Editing View: Text Input */
                        <div className={cls("flex flex-col gap-2 p-4 rounded-xl border bg-surface-50/20 dark:bg-surface-800/10", defaultBorderMixin)}>
                            <TextField
                                size={size}
                                value={textValue}
                                onChange={onChange}
                                autoFocus={true}
                                placeholder={`e.g., 0.15, -0.42, 0.88 (Requires ${property.dimensions} dimensions)`}
                                disabled={disabled}
                                error={showError ? !!error : undefined}
                                inputClassName={error ? "text-red-500 dark:text-red-600 font-mono text-xs" : "font-mono text-xs"}
                            />
                            <div className="flex justify-end gap-2 mt-2">
                                <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={() => setIsEditing(false)}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    variant="filled"
                                    size="small"
                                    onClick={() => setIsEditing(false)}
                                    startIcon={<CheckIcon size={14} />}
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
                showError={showError}
                error={error}
                disabled={disabled}
                property={property}
            />
        </div>
    );
}
