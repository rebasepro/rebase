"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Rendering a Lucide icon chosen at runtime, without shipping all 1,600 of them
 * on the login screen.
 *
 * `@rebasepro/ui` used to re-export lucide's whole `icons` map:
 *
 *     export { icons as lucideIcons } from "lucide-react";
 *
 * That map is an object literal holding a reference to every icon component in
 * the library, so a tree-shaker cannot drop a single one — reaching the map
 * reaches all of them. Two callers reached it, both by name lookup: `getIcon`
 * in `@rebasepro/app` (a collection's `icon: "ShoppingCart"`) and the admin's
 * icon picker. That put 822 kB of SVG components into the entry chunk's static
 * graph, `modulepreload`ed before authentication.
 *
 * The ~130 icons the product's own chrome uses are still plain named imports
 * from `lucide-react`, which tree-shake to just those. Only the by-name lookup
 * goes through here, and it pays for the map once, asynchronously, the first
 * time a runtime-chosen icon is rendered.
 */

type IconsMap = Record<string, LucideIcon | undefined>;

let loaded: IconsMap | undefined;
let pending: Promise<IconsMap> | undefined;

/**
 * The full lucide icon map, fetched on first use and cached for the session.
 *
 * Prefer {@link LucideIconByName}. This is here for callers that need to know
 * whether a name resolves, such as the icon picker's grid.
 */
export function loadLucideIcons(): Promise<IconsMap> {
    if (loaded) return Promise.resolve(loaded);
    pending ??= import("lucide-react").then(({ icons }) => {
        loaded = icons as unknown as IconsMap;
        return loaded;
    });
    return pending;
}

/** The map if it has already been fetched, otherwise `undefined`. Never fetches. */
export function getLoadedLucideIcons(): IconsMap | undefined {
    return loaded;
}

/**
 * Subscribe to the icon map.
 *
 * Returns it synchronously once loaded — including on the very first render of
 * every icon after the first one anywhere, which is what stops a page full of
 * icons from each flashing its placeholder.
 */
export function useLucideIcons(): IconsMap | undefined {
    const [map, setMap] = React.useState<IconsMap | undefined>(loaded);
    React.useEffect(() => {
        if (map) return;
        let cancelled = false;
        loadLucideIcons()
            .then(resolved => { if (!cancelled) setMap(resolved); })
            .catch(error => console.error("[rebase] could not load the icon set", error));
        return () => { cancelled = true; };
    }, [map]);
    return map;
}

function toPascalCase(str: string): string {
    return str.split(/[-_]/).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join("");
}

/**
 * The same resolution order the two call sites used against the eager map:
 * exact name, then PascalCase, then `CircleAlert` as the visible "unknown icon".
 */
export function resolveLucideIcon(icons: IconsMap, name: string): LucideIcon | undefined {
    return icons[name] ?? icons[toPascalCase(name)] ?? icons.CircleAlert;
}

export type LucideIconByNameProps = {
    /**
     * A PascalCase lucide icon name, e.g. `"ShoppingCart"`. Whether a name
     * exists can be answered ahead of the fetch with `iconKeys`, which is a
     * plain string array and costs nothing.
     */
    name: string;
    size?: number;
    className?: string;
    /** Rendered while the icon set is in flight. Defaults to a blank box of `size`. */
    fallback?: React.ReactNode;
};

/**
 * An icon named at runtime. Renders `fallback` until the icon set arrives.
 */
export const LucideIconByName = React.memo(
    function LucideIconByName({ name, size, className, fallback }: LucideIconByNameProps) {
        const icons = useLucideIcons();
        const Icon = icons ? resolveLucideIcon(icons, name) : undefined;

        if (!Icon) {
            if (fallback !== undefined) return <>{fallback}</>;
            // A box of the right size, so the layout does not jump when the
            // icon lands.
            return <span aria-hidden={true}
                className={"inline-block shrink-0"}
                style={{ width: size, height: size }}/>;
        }

        return <Icon size={size}
            className={className}/>;
    }
);
