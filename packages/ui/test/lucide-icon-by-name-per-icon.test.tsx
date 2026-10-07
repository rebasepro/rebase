import React from "react";
import { render, waitFor } from "@testing-library/react";
import { icons } from "lucide-react";

import { LucideIconByName } from "../src/icons/LucideIconByName";
import { lucideImportKeys } from "../src/icons/lucide_import_keys";

/**
 * An icon named at runtime costs that icon, not the icon set.
 *
 * `LucideIconByName` (and `getIcon`, which renders it for a collection's
 * `icon: "ShoppingCart"`) used to fetch lucide's whole `icons` map on the first
 * name it rendered: ~480 kB (~120 kB gzipped) for one sidebar icon. It now goes
 * through lucide's per-icon import table, one ~0.4 kB chunk per distinct name.
 * The map stays behind `loadLucideIcons` for callers that need every icon.
 *
 * jest cannot import lucide's `.mjs` table, so jest.config.cjs maps it to
 * test/__mocks__/lucideDynamicIconImports.cjs, built from the real one, which
 * records the keys fetched.
 */
let mockMapLoads = 0;
jest.mock("../src/icons/lucide_icon_map", () => {
    mockMapLoads++;
    return jest.requireActual("../src/icons/lucide_icon_map");
});

type IconModule = { default: unknown };
const { default: table, loads } = jest.requireActual<{
    default: Record<string, (() => Promise<IconModule>) | undefined>,
    loads: string[]
}>("lucide-react/dynamicIconImports.mjs");

describe("LucideIconByName, one icon at a time", () => {

    it("renders a named icon by fetching that icon, not the icon map", async () => {
        const { container } = render(<LucideIconByName name={"ShoppingCart"} size={24}/>);

        await waitFor(() => expect(container.querySelector("svg.lucide")).toBeTruthy());
        expect(loads).toEqual(["shopping-cart"]);
        expect(mockMapLoads).toBe(0);
    });

    it("renders a name it already fetched at once, with no second fetch", () => {
        const { container } = render(<LucideIconByName name={"ShoppingCart"} size={24}/>);

        expect(container.querySelector("svg.lucide")).toBeTruthy();
        expect(loads).toEqual(["shopping-cart"]);
    });

    it("falls back to CircleAlert for a name lucide does not have", async () => {
        const { container } = render(<LucideIconByName name={"NotAnIconAnybodyShipped"} size={24}/>);

        await waitFor(() => expect(container.querySelector("svg.lucide-circle-alert")).toBeTruthy());
        expect(mockMapLoads).toBe(0);
    });

    it("finds every icon lucide ships in the per-icon table, as itself", async () => {
        // The table is keyed by lucide's kebab file names and the map by
        // PascalCase names; the mapping between them is not invertible for
        // every icon (`Grid2x2` is `grid-2x2`, `ArrowDown01` is
        // `arrow-down-0-1`), so this checks all of them.
        const wrong: string[] = [];
        for (const [name, icon] of Object.entries(icons)) {
            const load = lucideImportKeys(name).map(key => table[key]).find(Boolean);
            if (!load || (await load()).default !== icon) wrong.push(name);
        }

        expect(wrong).toEqual([]);
    });
});
