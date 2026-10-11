/**
 * The UI reference (`/debug/ui`) is the design source of truth for the kit
 * (AGENTS.md, ui-components.md). A kit component it never renders has no
 * reference: agents and contributors who are told to "read UIReferenceView
 * before building a view" find nothing for it and improvise — the audit found
 * Dialog (41 product uses), ExpandablePanel, BooleanSwitchWithLabel and a dozen
 * more absent, and screens rebuilding them from raw elements.
 *
 * So every component exported from `packages/ui/src/components` must appear as
 * a JSX tag somewhere under `packages/app/src/debug/`. The few that are not
 * visual, or only make sense inside another component, are listed below with
 * the reason. Adding a component to the kit without showing it fails here.
 */
import * as fs from "fs";
import * as path from "path";

const COMPONENTS_DIR = path.resolve(__dirname, "../../ui/src/components");
const DEBUG_DIR = path.resolve(__dirname, "../src/debug");

/** Exported, but deliberately not rendered on their own in the reference. */
const NOT_SHOWN: Record<string, string> = {
    // Context plumbing, not UI.
    MultiSelectContext: "the context MultiSelect provides to its items",
    VirtualTableSelectionProvider: "selection context VirtualTable mounts itself",
    TooltipProvider: "the app root mounts it once; every Tooltip on the page uses it",
    // Radix structural parts that only exist inside a Menubar the reference renders.
    MenubarPortal: "rendered by MenubarContent",
    MenubarItemIndicator: "rendered by MenubarCheckboxItem/MenubarRadioItem",
    MenubarSubTriggerIndicator: "rendered by MenubarSubTrigger",
    // Radix primitives re-exported so packages need no direct @radix-ui dependency.
    Portal: "a Radix primitive, re-exported",
    PopoverPrimitive: "a Radix primitive, re-exported",
    Slot: "a Radix primitive, re-exported",
    // Error plumbing: renders nothing until a child throws.
    ErrorBoundary: "renders only its children until one throws",
    // Cell editors VirtualTable mounts in edit mode; the reference shows the table.
    VirtualTableInput: "a VirtualTable cell editor",
    VirtualTableNumberInput: "a VirtualTable cell editor",
    VirtualTableSwitch: "a VirtualTable cell editor",
    VirtualTableDateField: "a VirtualTable cell editor",
    VirtualTableSelect: "a VirtualTable cell editor"
};

function resolveModule(fromDir: string, spec: string): string {
    const base = path.resolve(fromDir, spec);
    for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
        if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`Cannot resolve ${spec} from ${fromDir}`);
}

/** Exported PascalCase values (components), following `export *` re-exports. */
function exportedComponents(file: string, seen = new Set<string>()): Set<string> {
    const names = new Set<string>();
    if (seen.has(file)) return names;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const m of source.matchAll(/^export\s+\*\s+from\s+["'](\.[^"']+)["']/gm)) {
        exportedComponents(resolveModule(path.dirname(file), m[1]), seen).forEach(n => names.add(n));
    }
    for (const m of source.matchAll(/^export\s+(?:const|function|class)\s+([A-Z][A-Za-z0-9]*)/gm)) {
        names.add(m[1]);
    }
    // `export { A, B }` and `export { A } from "./x"`, but not `export type { … }`.
    for (const m of source.matchAll(/^export\s+\{([^}]*)\}/gm)) {
        for (const part of m[1].split(",")) {
            const trimmed = part.trim();
            if (!trimmed || trimmed.startsWith("type ")) continue;
            const exported = trimmed.split(/\s+as\s+/).pop()!.trim();
            if (/^[A-Z]/.test(exported)) names.add(exported);
        }
    }
    return names;
}

function debugSources(dir: string): string {
    let out = "";
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out += debugSources(full);
        else if (/\.tsx?$/.test(entry.name)) out += fs.readFileSync(full, "utf8") + "\n";
    }
    return out;
}

describe("the UI reference shows every kit component", () => {
    const components = exportedComponents(resolveModule(COMPONENTS_DIR, "./index"));
    const debug = debugSources(DEBUG_DIR);

    it("finds the kit's components (the scanner itself works)", () => {
        // A regex that matched nothing would make the next test pass vacuously.
        expect(components.size).toBeGreaterThan(60);
        for (const known of ["Dialog", "Button", "TableRow", "MenubarItem", "RadioGroupItem", "VirtualTable"]) {
            expect(components).toContain(known);
        }
    });

    it("renders each exported component as a JSX tag under app/src/debug", () => {
        const missing = [...components]
            .filter(name => !(name in NOT_SHOWN))
            .filter(name => !new RegExp(`<${name}[\\s/><]`).test(debug))
            .sort();
        expect(missing).toEqual([]);
    });

    it("lists only real exports as not shown", () => {
        const stale = Object.keys(NOT_SHOWN).filter(name => !components.has(name));
        expect(stale).toEqual([]);
    });
});
