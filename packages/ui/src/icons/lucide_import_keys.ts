/**
 * The keys lucide's per-icon import table (`lucide-react/dynamicIconImports`)
 * may file a PascalCase icon name under.
 *
 * The table is keyed by lucide's kebab-case file names, and lucide's own
 * kebab-to-PascalCase step is not invertible for every icon: `Grid2x2` is
 * `grid-2x2` but `ArrowDown01` is `arrow-down-0-1`. So a few spellings are
 * returned, most likely first. test/lucide-icon-by-name.test.tsx holds every
 * icon lucide ships to one of them.
 *
 * Not exported from the package: it is a detail of `LucideIconByName`.
 */
export function lucideImportKeys(name: string): string[] {
    const kebab = name
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
        .replace(/([a-zA-Z])(\d)/g, "$1-$2")
        .toLowerCase();
    return [
        kebab,
        // `grid-2x2`, not `grid-2x-2`.
        kebab.replace(/(\d)x-(\d)/g, "$1x$2"),
        name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
    ];
}
