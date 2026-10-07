"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";

import { lucideImportKeys } from "./lucide_import_keys";

/**
 * Rendering a Lucide icon chosen at runtime, without shipping all 1,750 of them
 * on the login screen.
 *
 * Two ways to get from a name to an icon component, for two callers:
 *
 * - {@link LucideIconByName} (and `getIcon` in `@rebasepro/app`, which renders
 *   it: a collection's `icon: "ShoppingCart"`) fetches ONE icon, through
 *   lucide's per-icon import table (`lucide-react/dynamicIconImports`): about
 *   1 kB per distinct icon, plus the table itself once.
 * - The icon picker needs every icon at once, so it fetches the whole map with
 *   {@link loadLucideIcons} / {@link useLucideIcons}: ~480 kB (~120 kB gzipped)
 *   in an async chunk of its own (see `lucide_icon_map.ts`).
 *
 * Neither is ever in a static chunk. The ~130 icons the product's own chrome
 * uses are plain named imports from `lucide-react`, which tree-shake to just
 * those.
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
    // A local module, not `import("lucide-react")`: lucide-react is statically
    // imported too, so importing IT dynamically cannot split anything off and
    // the map lands in the static chunk. See `lucide_icon_map.ts`.
    pending ??= import("./lucide_icon_map").then(({ icons }) => {
        loaded = icons as IconsMap;
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

type IconModule = { default: LucideIcon };
type IconImports = Record<string, (() => Promise<IconModule>) | undefined>;

let iconImports: Promise<IconImports | undefined> | undefined;

/**
 * lucide's `{ "shopping-cart": () => import(…) }` table, itself fetched on
 * first use. `undefined` when it cannot be loaded — a CommonJS test runner
 * cannot import lucide's `.mjs` — and then the icons come from the map.
 */
function loadIconImports(): Promise<IconImports | undefined> {
    iconImports ??= import("lucide-react/dynamicIconImports.mjs")
        .then(module => module.default as IconImports)
        .catch(error => {
            console.warn("[rebase] lucide's per-icon imports did not load; icons by name come from the full icon map", error);
            return undefined;
        });
    return iconImports;
}

/** Icons resolved by the name they were asked for, for the session. */
const iconsByName = new Map<string, LucideIcon>();
const iconsInFlight = new Map<string, Promise<LucideIcon | undefined>>();

/**
 * One icon by name: exact name, then PascalCase, then `CircleAlert` as the
 * visible "unknown icon" — the order {@link resolveLucideIcon} uses on the map.
 * The full map is used if something already fetched it ({@link loadLucideIcons});
 * otherwise only the icon is.
 */
function loadLucideIcon(name: string): Promise<LucideIcon | undefined> {
    const known = iconsByName.get(name);
    if (known) return Promise.resolve(known);
    let pending = iconsInFlight.get(name);
    if (!pending) {
        pending = (async () => {
            if (loaded) return resolveLucideIcon(loaded, name);
            const imports = await loadIconImports();
            if (!imports) return resolveLucideIcon(await loadLucideIcons(), name);
            for (const candidate of [name, toPascalCase(name), "CircleAlert"]) {
                const load = lucideImportKeys(candidate).map(key => imports[key]).find(Boolean);
                if (load) return (await load()).default;
            }
            return undefined;
        })()
            .then(icon => {
                if (icon) iconsByName.set(name, icon);
                return icon;
            })
            .finally(() => iconsInFlight.delete(name));
        iconsInFlight.set(name, pending);
    }
    return pending;
}

/** The icon for `name`, synchronously once any component has fetched it. */
function useLucideIcon(name: string): LucideIcon | undefined {
    const [icon, setIcon] = React.useState<{ name: string, icon: LucideIcon } | undefined>(() => {
        const known = iconsByName.get(name);
        return known ? { name, icon: known } : undefined;
    });
    const current = icon?.name === name ? icon.icon : iconsByName.get(name);
    React.useEffect(() => {
        if (current) return;
        let cancelled = false;
        loadLucideIcon(name)
            .then(resolved => { if (!cancelled && resolved) setIcon({ name, icon: resolved }); })
            .catch(error => console.error(`[rebase] could not load the icon "${name}"`, error));
        return () => { cancelled = true; };
    }, [name, current]);
    return current;
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
    /** Rendered while the icon is in flight. Defaults to a blank box of `size`. */
    fallback?: React.ReactNode;
};

/**
 * An icon named at runtime. Renders `fallback` until the icon arrives — one
 * small request the first time a name is shown, none after that.
 */
export const LucideIconByName = React.memo(
    function LucideIconByName({ name, size, className, fallback }: LucideIconByNameProps) {
        const Icon = useLucideIcon(name);

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
