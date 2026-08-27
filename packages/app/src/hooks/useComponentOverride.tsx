import React, { useContext, useMemo } from "react";
import type { OverridableComponentName } from "@rebasepro/cms-types";
import { ComponentOverrideContext } from "../contexts/ComponentOverrideContext";

/**
 * Resolves a potentially overridden component.
 *
 * Resolution order:
 * 1. Collection-scoped override (highest priority)
 * 2. Global override
 * 3. Default component (fallback)
 *
 * Supports two override modes:
 * - **Eject** (default): The override component fully replaces the default.
 * - **Wrap** (`wrap: true`): The override component wraps the default.
 *   The default is passed as `OriginalComponent` in props.
 *
 * @param name - The overridable component name (e.g. `"Entity.Form"`)
 * @param DefaultComponent - The built-in default component
 * @returns The resolved component — either the default, a full replacement, or a wrapper
 *
 * @example
 * ```tsx
 * import { useComponentOverride } from "@rebasepro/app";
 *
 * function EntityFormWrapper(props: EntityFormProps) {
 *     const ResolvedForm = useComponentOverride("Entity.Form", DefaultEntityForm);
 *     return <ResolvedForm {...props} />;
 * }
 * ```
 *
 * @group Hooks
 */
export function useComponentOverride<P>(
    name: OverridableComponentName,
    DefaultComponent: React.ComponentType<P>
): React.ComponentType<P> {
    const { globalOverrides, collectionOverrides } = useContext(ComponentOverrideContext);

    return useMemo(() => {
        // Collection-level overrides have highest priority
        const override = collectionOverrides[name] ?? globalOverrides[name];

        if (!override) return DefaultComponent;

        if (override.wrap) {
            // Wrapping mode: inject OriginalComponent as a prop
            const UserComponent = override.Component;
            const Wrapper = (props: P) => (
                <UserComponent {...(props as Record<string, unknown>)} OriginalComponent={DefaultComponent} />
            );
            Wrapper.displayName = `Wrapped(${name})`;
            return Wrapper as React.ComponentType<P>;
        }

        // Eject mode: full replacement
        return override.Component as React.ComponentType<P>;
    }, [collectionOverrides, globalOverrides, name, DefaultComponent]);
}
