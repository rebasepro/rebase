import type { Property } from "@rebasepro/types";
import { IconButton, InfoIcon, Tooltip, Typography } from "@rebasepro/ui";

/**
 * Normalize an error value to a displayable string.
 * Handles cases where the error is an array (e.g. per-element validation
 * errors from array fields) or an object (e.g. raw Zod issue objects).
 */
function normalizeError(error: unknown): string | undefined {
    if (error === undefined || error === null) return undefined;
    if (typeof error === "string") return error;
    if (Array.isArray(error)) {
        // Find the first non-falsy element and extract its message
        const firstError = error.find((e) => !!e);
        if (!firstError) return undefined;
        return normalizeError(firstError);
    }
    if (typeof error === "object") {
        if ("message" in error) {
            return String((error as { message: unknown }).message);
        }

        // Extract all string values from the object (e.g., nested validation errors)
        const messages: string[] = [];
        const extractMessages = (obj: Record<string, unknown>) => {
            for (const key in obj) {
                if (typeof obj[key] === "string") {
                    messages.push(obj[key] as string);
                } else if (typeof obj[key] === "object" && obj[key] !== null) {
                    extractMessages(obj[key] as Record<string, unknown>);
                }
            }
        };
        extractMessages(error as Record<string, unknown>);
        if (messages.length > 0) {
            return Array.from(new Set(messages)).join(", ");
        }
    }
    return String(error);
}

/**
 * Component in charge of rendering the description of a field
 * as well as the error message if any.
 */
export function FieldHelperText<T>({
    error,
    showError,
    property,
    includeDescription = true,
    disabled
}: {
    error?: string,
    showError?: boolean,
    property: Property | Property,
    includeDescription?: boolean,
    disabled?: boolean,
}
) {

    const displayError = normalizeError(error);
    const hasDescription = property.description !== undefined && property.description.trim().length > 0;

    if (!(showError && displayError) && (!includeDescription || !hasDescription))
        return null;

    if (showError && displayError) {
        return <Typography variant={"caption"}
            className={"ml-3.5 text-red-500 dark:text-red-500"}>
            {displayError}
        </Typography>
    }

    const disabledTooltip: string | undefined = typeof property.admin?.disabled === "object" ? property.admin?.disabled.disabledMessage : undefined;

    return <div className={"flex ml-3.5 mt-1"}>
        <Typography variant={"caption"}
            color={disabled ? "disabled" : "secondary"}
            className={"grow"}>
            {disabledTooltip || property.description}
        </Typography>

    </div>
}
