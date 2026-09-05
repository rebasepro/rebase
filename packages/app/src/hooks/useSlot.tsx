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
export function useSlot<K extends SlotName>(
    slot: K,
    props: SlotRegistry[K]
): React.ReactNode[] {
    const { resolvedSlots } = useCustomizationController();

    const propsRef = React.useRef(props);
    const currentProps = props as unknown as Record<string, unknown>;
    const prevProps = propsRef.current as unknown as Record<string, unknown>;

    let changed = false;
    if (currentProps !== prevProps) {
        const keys = Object.keys(currentProps);
        const prevKeys = Object.keys(prevProps);
        if (keys.length !== prevKeys.length) {
            changed = true;
        } else {
            for (let i = 0; i < keys.length; i++) {
                if (currentProps[keys[i]] !== prevProps[keys[i]]) {
                    changed = true;
                    break;
                }
            }
        }
    }

    if (changed) {
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
                const Component = s.Component as unknown as React.ComponentType<Record<string, unknown>>;
                return (
                    <ErrorBoundary key={`${slot}_${i}`}>
                        <Component {...(stableProps as unknown as Record<string, unknown>)} {...(s.props ?? {})}/>
                    </ErrorBoundary>
                );
            });
    }, [resolvedSlots, slot, stableProps]);
}
