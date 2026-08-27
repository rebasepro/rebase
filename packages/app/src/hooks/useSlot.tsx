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
            .map((s, i) => (
                <ErrorBoundary key={`${slot}_${i}`}>
                    <s.Component {...(stableProps as unknown as Record<string, unknown>)} {...(s.props ?? {})}/>
                </ErrorBoundary>
            ));
    }, [resolvedSlots, slot, stableProps]);
}
