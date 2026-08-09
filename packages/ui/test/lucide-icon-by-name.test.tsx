import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

import { LucideIconByName, loadLucideIcons, resolveLucideIcon } from "../src/icons/LucideIconByName";
import { coolIconKeys } from "../src/icons/cool_icon_keys";
import { iconKeys } from "../src/icons/icon_keys";

/**
 * That every icon name the admin can produce still resolves to an icon.
 *
 * `@rebasepro/ui` used to re-export lucide's whole `icons` map. That map holds
 * a reference to every icon in the library, so exporting it defeated
 * tree-shaking outright — 822 kB in the entry chunk, preloaded before login —
 * and the two callers that used it did so by name lookup, which is the only
 * reason it had to exist.
 *
 * The map is fetched on first use now, and the failure mode of getting that
 * wrong is silent: a missing icon renders as an empty box the right size, which
 * looks like a design decision rather than a bug. So this asserts the resolution
 * itself over the whole key space, not just that one icon appears.
 */
describe("LucideIconByName", () => {

    it("renders the named icon once the set has loaded", async () => {
        render(<LucideIconByName name={"ShoppingCart"} size={24}/>);

        await waitFor(() => {
            const svg = document.querySelector("svg");
            expect(svg).toBeTruthy();
            expect(svg?.getAttribute("class") ?? "").toContain("lucide");
        });
    });

    it("holds the layout with a box of the right size while the set is in flight", () => {
        // Rendered synchronously, before the dynamic import can settle.
        const { container } = render(<LucideIconByName name={"Users"} size={20}/>);
        const placeholder = container.querySelector("span[aria-hidden]") as HTMLElement | null;

        // Either the icon is already there (a previous test warmed the module
        // cache) or the placeholder is, and the placeholder must be sized.
        if (placeholder) {
            expect(placeholder.style.width).toBe("20px");
            expect(placeholder.style.height).toBe("20px");
        } else {
            expect(container.querySelector("svg")).toBeTruthy();
        }
    });

    it("passes size and className through to the icon", async () => {
        render(<LucideIconByName name={"Database"} size={32} className={"text-red-500"}/>);

        await waitFor(() => {
            const svg = document.querySelector("svg");
            expect(svg?.getAttribute("width")).toBe("32");
            expect(svg?.getAttribute("class") ?? "").toContain("text-red-500");
        });
    });

    it("never resolves a product key to nothing", async () => {
        const icons = await loadLucideIcons();

        // `iconKeys` is what `getIcon` validates against and `coolIconKeys` is
        // what a collection with no icon of its own falls back to, so between
        // them they are every name the product itself can hand this component.
        // None may resolve to `undefined`, because `undefined` is the blank box.
        const unresolved = [...iconKeys, ...coolIconKeys]
            .filter(key => resolveLucideIcon(icons, key) === undefined);

        expect(unresolved).toEqual([]);
    });

    it("resolves the overwhelming majority of keys to their own icon", async () => {
        const icons = await loadLucideIcons();
        const direct = iconKeys.filter(key => icons[key] !== undefined).length;

        // 243 of the 1,934 names in `icon_keys.ts` are aliases lucide dropped on
        // its way to 1.x — `XCircle` is `CircleX` now, `Layout` is `PanelsTopLeft`
        // — and they landed on the CircleAlert fallback through the eager map
        // too, so this is drift that predates the lazy lookup rather than
        // anything it caused. A floor rather than an exact count: an exact one
        // would fail on every lucide bump, which is the kind of gate people
        // regenerate without reading. It fails hard if the map ever stops
        // resolving wholesale — a casing change, a bad interop shape, a lookup
        // against the wrong object — which is what would turn the sidebar into
        // a column of warning triangles.
        expect(direct / iconKeys.length).toBeGreaterThan(0.85);
    });

    it("falls back to a visible icon for a name lucide does not have", async () => {
        const icons = await loadLucideIcons();

        // Not `undefined`: an unknown name used to land on CircleAlert, and a
        // blank box in its place is the silent failure this whole test exists
        // to rule out.
        expect(resolveLucideIcon(icons, "NotAnIconAnybodyShipped")).toBe(icons.CircleAlert);
    });

    it("fetches the icon set once, however many icons render", async () => {
        const first = await loadLucideIcons();
        const second = await loadLucideIcons();

        expect(second).toBe(first);
    });
});
