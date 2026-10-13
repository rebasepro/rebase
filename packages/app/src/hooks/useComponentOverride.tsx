import React, { useContext, useMemo } from "react";
import type { ComponentOverrideMap, OverridableComponentName } from "@rebasepro/cms-types";
import { ComponentOverrideContext } from "../contexts/ComponentOverrideContext";
import { resolveComponentRef } from "./useResolvedComponent";

/**
 * Resolves a potentially overridden component.
 *
 * The two scopes compose, innermost first:
 * 1. Default component
 * 2. Global override (`<Rebase components>`), applied to the default
 * 3. Collection-scoped override (`admin.components`), applied to the result
 *    of 2
 *
 * Supports two override modes:
 * - **Eject** (default): The override component fully replaces what it is
 *   applied to.
 * - **Wrap** (`wrap: true`): The override component wraps what it is applied
 *   to, passed as `OriginalComponent` in props — so a collection's wrapper
 *   wraps the global override when there is one, not the built-in default.
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
        const AfterGlobal = applyOverride(name, globalOverrides[name], DefaultComponent);
        return applyOverride(name, collectionOverrides[name], AfterGlobal);
    }, [collectionOverrides, globalOverrides, name, DefaultComponent]);
}

/**
 * One override applied to the component below it: the override itself when it
 * ejects, a wrapper handing it `Base` as `OriginalComponent` when it wraps, and
 * `Base` unchanged when there is no override or it cannot be resolved.
 */
function applyOverride<P>(
    name: OverridableComponentName,
    override: ComponentOverrideMap[OverridableComponentName],
    Base: React.ComponentType<P>
): React.ComponentType<P> {
    if (!override) return Base;

    // `Component` is a `ComponentRef`, so a collection may name its override
    // by module path — which is the only form a `config/collections` file
    // can use without importing React into the backend. The resolver turns
    // a path (already rewritten to a lazy ref by the Vite transform) or an
    // `import()` into a component, and hands a direct reference straight
    // back.
    //
    // Resolved at the map's own props type — `ComponentOverride` is declared
    // without a type argument there, so the override is written against
    // `Record<string, unknown>` and the single widening to `P` happens at
    // the return, exactly where it did before this was a ref.
    const UserComponent = resolveComponentRef(override.Component);
    // An override that cannot be resolved is not an override. The resolver
    // has already said why on the console; rendering what it would have
    // replaced beats rendering nothing at all.
    if (!UserComponent) return Base;

    if (override.wrap) {
        const Wrapper = (props: P) => (
            <UserComponent {...(props as Record<string, unknown>)} OriginalComponent={Base} />
        );
        Wrapper.displayName = `Wrapped(${name})`;
        return Wrapper as React.ComponentType<P>;
    }

    return UserComponent as React.ComponentType<P>;
}
