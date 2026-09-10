import type { SlotName, SlotRegistry } from "@rebasepro/cms-types";
import React, { useMemo } from "react";
;
import { useCustomizationController } from "./useCustomizationController";
import { ErrorBoundary } from "@rebasepro/ui";

/**
 * Hook that retrieves and renders all slot contributions for a given slot name.
 *
 * @param slot - The slot name to render contributions for.
 * @param props - Props passed to each slot component.
 * @returns An array of rendered React nodes, each wrapped in an ErrorBoundary.
 *
 * @example
 * ```tsx
 * const actions = useSlot("home.actions", { context });
 * return <div>{actions}</div>;
 * ```
 *
 * @group Hooks
 */
/**
 * Are these two prop objects the same, one level down?
 *
 * Its own function so the comparison can be typed on `object` rather than on
 * the slot's props. `SlotRegistry[K]` is a union of interfaces, and an
 * interface has no implicit index signature, so reading it as
 * `Record<string, unknown>` — which the loop this replaces did, to both
 * arguments — is a conversion tsc refuses and `as unknown as` was suppressing.
 * `Object.keys` needs no such claim.
 */
function shallowEqual(a: object, b: object): boolean {
    if (a === b) return true;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => a[key as keyof typeof a] === b[key as keyof typeof b]);
}

export function useSlot<K extends SlotName>(
    slot: K,
    props: SlotRegistry[K]
): React.ReactNode[] {
    const { resolvedSlots } = useCustomizationController();

    const propsRef = React.useRef(props);
    if (!shallowEqual(props, propsRef.current)) {
        propsRef.current = props;
    }

    const stableProps = propsRef.current;

    return useMemo(() => {
        return resolvedSlots
            .filter(s => s.slot === slot)
            .sort((a, b) => (a.order ?? 50) - (b.order ?? 50))
            .map((s, i) => {
                // `filter` cannot narrow a discriminated union through a
                // callback, so `s.Component` is still "some slot's component"
                // here and its props are the union of every slot's. The line
                // above is what makes this safe, and it is one line above.
                //
                // This one deliberate cast is the price of `SlotContribution`
                // declaring `ComponentType<SlotRegistry[K]>` instead of
                // `ComponentType<any>` — which is what turns a component
                // written against the wrong slot's props into an error where
                // it is registered, rather than `undefined` at render.
                const Component = s.Component as React.ComponentType<SlotRegistry[K]>;
                return (
                    <ErrorBoundary key={`${slot}_${i}`}>
                        <Component {...stableProps} {...(s.props ?? {})}/>
                    </ErrorBoundary>
                );
            });
    }, [resolvedSlots, slot, stableProps]);
}
