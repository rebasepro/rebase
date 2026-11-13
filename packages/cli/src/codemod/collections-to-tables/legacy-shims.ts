/**
 * The one value a 0.30 collection file imports that 0.31 no longer exports:
 * `defineCollection`, from `@rebasepro/cms-types` or `@rebasepro/common`.
 *
 * The codemod evaluates `config/collections` with the project's installed
 * packages — after an upgrade, 0.31's — so a file that starts
 * `import { defineCollection } from "@rebasepro/cms-types"` would fail to
 * load and the migration could not run on exactly the projects it is for.
 * For that load only, each of the two packages is aliased to a shim that
 * re-exports the package as installed and adds `defineCollection` as 0.30
 * defined it: `resolveResourceRefs(collection)` from `@rebasepro/types` (the
 * legacy loader resolves resource handles the same way afterwards, so a
 * project still on 0.30 packages loads the same values). The shims live in a
 * directory of this run's own ({@link createShimDir}), never in the project.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * The directory one run writes its shims into, and what it wrote there.
 *
 * Fresh per run — `mkdtemp` under the system's temporary directory, which
 * creates it with a random name and mode 0700 — because the shims are code the
 * run then evaluates: a directory any other user could have written to first
 * (the fixed, content-named path this used to be, on a shared `/tmp`) would
 * run whatever they planted there, `--dry-run` included. Every file is
 * created exclusively (`wx`), so a file the run did not write is never used.
 * {@link removeShimDir} deletes it when the run is over, failed or not.
 */
export interface ShimDir {
    /** The directory, absolute. */
    path: string;
    /** The files this run created in it, by name. */
    written: Map<string, string>;
}

/** A private directory for one run's shims. */
export function createShimDir(): ShimDir {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-legacy-shims-"));
    // `mkdtemp` already creates it 0700 on POSIX; said again for an umask or
    // platform that does not.
    fs.chmodSync(dir, 0o700);
    return { path: dir, written: new Map() };
}

/** Delete a run's shim directory and everything in it. */
export function removeShimDir(dir: ShimDir): void {
    fs.rmSync(dir.path, { recursive: true, force: true });
}

/**
 * Write one shim into the run's directory and answer its path. A name this
 * run already wrote with the same text is answered again; anything else on
 * disk under that name is refused (`wx`), never read.
 */
function writeShim(dir: ShimDir, name: string, text: string): string {
    const file = path.join(dir.path, name);
    const previous = dir.written.get(name);
    if (previous === text) return file;
    if (previous !== undefined) {
        throw new Error(`Two different shims were asked for under one name (${name}); this is a bug in the migration.`);
    }
    fs.writeFileSync(file, text, { flag: "wx", mode: 0o600 });
    dir.written.set(name, text);
    return file;
}

/** The packages whose 0.30 `defineCollection` the shim restores. */
const SHIMMED = ["@rebasepro/cms-types", "@rebasepro/common"] as const;
const TYPES = "@rebasepro/types";

/** Where a specifier resolves for the project's config: an alias, or the config package's own resolution. */
function resolveFrom(configDir: string, aliases: Readonly<Record<string, string>>, specifier: string): string | undefined {
    if (Object.prototype.hasOwnProperty.call(aliases, specifier)) return aliases[specifier];
    try {
        return createRequire(path.join(configDir, "package.json")).resolve(specifier);
    } catch {
        return undefined;
    }
}

/** The subpath exports of an installed package (`@rebasepro/common/migrate`), resolved, so the shim's alias does not swallow them. */
function subpathAliases(configDir: string, aliases: Readonly<Record<string, string>>, name: string): Record<string, string> {
    const out: Record<string, string> = {};
    let manifest: string;
    try {
        manifest = createRequire(path.join(configDir, "package.json")).resolve(`${name}/package.json`);
    } catch {
        return out;
    }
    let exportsField: unknown;
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
        exportsField = typeof parsed === "object" && parsed !== null && "exports" in parsed ? parsed.exports : undefined;
    } catch {
        return out;
    }
    if (typeof exportsField !== "object" || exportsField === null) return out;
    for (const key of Object.keys(exportsField)) {
        if (!key.startsWith("./") || key === "./package.json" || key.includes("*")) continue;
        const specifier = `${name}/${key.slice(2)}`;
        const target = resolveFrom(configDir, aliases, specifier);
        if (target) out[specifier] = target;
    }
    return out;
}

/**
 * The module aliases to evaluate a legacy `config/` with: the given ones,
 * plus a shim for each package that lost `defineCollection`.
 *
 * @param configDir the project's `config/`, absolute
 * @param shimDir the run's private shim directory ({@link createShimDir})
 * @param aliases the run's module aliases (in-repo runs map `@rebasepro/*` to source)
 */
export function legacyLoadAliases(configDir: string, shimDir: ShimDir, aliases: Readonly<Record<string, string>> = {}): Record<string, string> {
    const out: Record<string, string> = { ...aliases };
    const types = resolveFrom(configDir, aliases, TYPES);
    if (!types) return out;
    // 0.30's `policy.existsIn({ collection, where })`: 0.31's builder reads `table` and would drop the name.
    const typesShim = [
        `// Written by rebase migrate collections-to-tables to load a 0.30 config/: ${TYPES} as installed, with 0.30's policy.existsIn({ collection }).`,
        `export * from ${JSON.stringify(types)};`,
        `import { policy as installedPolicy } from ${JSON.stringify(types)};`,
        "export const policy = installedPolicy && {",
        "    ...installedPolicy,",
        "    existsIn: (args) => installedPolicy.existsIn({ ...args, table: args.table ?? args.collection })",
        "};",
        ""
    ].join("\n");
    const typesFile = writeShim(shimDir, "_rebasepro_types.ts", typesShim);
    Object.assign(out, subpathAliases(configDir, aliases, TYPES));
    out[TYPES] = typesFile;
    for (const name of SHIMMED) {
        const real = resolveFrom(configDir, aliases, name);
        if (!real) continue;
        const text = [
            `// Written by rebase migrate collections-to-tables to load a 0.30 config/: ${name} as installed, plus 0.30's defineCollection.`,
            `export * from ${JSON.stringify(real)};`,
            `export { resolveResourceRefs as defineCollection } from ${JSON.stringify(types)};`,
            ""
        ].join("\n");
        const shim = writeShim(shimDir, `${name.replace(/[@/]/g, "_")}.ts`, text);
        Object.assign(out, subpathAliases(configDir, aliases, name));
        out[name] = shim;
    }
    return out;
}

/** A module importer (the run's jiti importer). */
type Importer = (file: string) => Promise<Record<string, unknown>>;

/**
 * Shims for the names a 0.30 `config/` imports from a package that 0.31 moved
 * elsewhere — `import { EntityRelation } from "@rebasepro/types"`, now in
 * `@rebasepro/cms-types` — so the collection files load with 0.31's packages
 * installed. A name is re-exported from its new package only when the package
 * as installed no longer exports it and the new one does: a project still on
 * 0.30 packages loads exactly as before.
 *
 * @param shimDir the run's private shim directory ({@link createShimDir})
 * @param aliases the aliases the load uses so far ({@link legacyLoadAliases})
 * @param importModule an importer built with those aliases
 * @param moves the moved-symbol table
 */
export async function movedNameAliases(
    configDir: string,
    shimDir: ShimDir,
    aliases: Readonly<Record<string, string>>,
    importModule: Importer,
    moves: readonly { symbol: string; from: string; to: string | null; as?: string }[]
): Promise<Record<string, string>> {
    const out: Record<string, string> = { ...aliases };
    const byPackage = new Map<string, { symbol: string; to: string; as?: string }[]>();
    for (const move of moves) {
        if (move.to === null || move.to === move.from) continue;
        byPackage.set(move.from, [...(byPackage.get(move.from) ?? []), { symbol: move.symbol, to: move.to, ...(move.as ? { as: move.as } : {}) }]);
    }
    const load = async (file: string): Promise<Record<string, unknown> | undefined> => {
        try {
            return await importModule(file);
        } catch {
            return undefined;
        }
    };
    for (const [name, rows] of byPackage) {
        const current = resolveFrom(configDir, aliases, name);
        if (!current) continue;
        const installed = await load(current);
        if (!installed) continue;
        const lines: string[] = [];
        const byDestination = new Map<string, string[]>();
        for (const row of rows) {
            if (row.symbol in installed) continue;
            const destination = resolveFrom(configDir, aliases, row.to);
            if (!destination) continue;
            const exported = row.as ?? row.symbol;
            const module = await load(destination);
            if (!module || !(exported in module)) continue;
            byDestination.set(destination, [...(byDestination.get(destination) ?? []), exported === row.symbol ? row.symbol : `${exported} as ${row.symbol}`]);
        }
        if (byDestination.size === 0) continue;
        lines.push(`// Written by rebase migrate collections-to-tables to load a 0.30 config/: ${name} as installed, plus the names 0.31 moved out of it.`);
        lines.push(`export * from ${JSON.stringify(current)};`);
        for (const [destination, names] of byDestination) lines.push(`export { ${names.join(", ")} } from ${JSON.stringify(destination)};`);
        const text = `${lines.join("\n")}\n`;
        const shim = writeShim(shimDir, `${name.replace(/[@/]/g, "_")}-moved.ts`, text);
        if (!Object.prototype.hasOwnProperty.call(out, name)) Object.assign(out, subpathAliases(configDir, aliases, name));
        out[name] = shim;
    }
    return out;
}
