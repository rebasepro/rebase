import type { Property } from "@rebasepro/types";
import { useEffect, useRef } from "react";
;

/**
 * Hook we use to restore a value after it has been cleared
 * @param property
 * @param value
 * @param setValue
 * @ignore
 */
export function useClearRestoreValue<T>({
    property,
    value,
    setValue
}:
    {
        property: Property,
        value: T | null,
        setValue: (value: T | null, shouldValidate?: boolean) => void
    }) {

    // Boxed, so "nothing was cleared" is not confused with a cleared 0,
    // `false` or "" — each of which the field would otherwise never get back.
    const clearedRef = useRef<{ value: T } | null>(null);
    useEffect(() => {
        const shouldClearValueIfDisabled = typeof property.admin?.disabled === "object" && Boolean(property.admin?.disabled.clearOnDisabled);
        if (shouldClearValueIfDisabled) {
            if (value != null) {
                clearedRef.current = { value };
                setValue(null);
            }
        } else if (clearedRef.current) {
            setValue(clearedRef.current.value);
            clearedRef.current = null;
        }
    }, [property]);
}
