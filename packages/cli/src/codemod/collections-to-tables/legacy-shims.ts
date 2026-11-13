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
 * project still on 0.30 packages loads the same values). The shims live in
 * the system's temporary directory, named by their content, never in the
 * project.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

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
 * @param aliases the run's module aliases (in-repo runs map `@rebasepro/*` to source)
 */
export function legacyLoadAliases(configDir: string, aliases: Readonly<Record<string, string>> = {}): Record<string, string> {
    const out: Record<string, string> = { ...aliases };
    const types = resolveFrom(configDir, aliases, TYPES);
    if (!types) return out;
    for (const name of SHIMMED) {
        const real = resolveFrom(configDir, aliases, name);
        if (!real) continue;
        const text = [
            `// Written by rebase migrate collections-to-tables to load a 0.30 config/: ${name} as installed, plus 0.30's defineCollection.`,
            `export * from ${JSON.stringify(real)};`,
            `export { resolveResourceRefs as defineCollection } from ${JSON.stringify(types)};`,
            ""
        ].join("\n");
        const dir = path.join(os.tmpdir(), "rebase-legacy-shims", createHash("sha256").update(text).digest("hex").slice(0, 16));
        const shim = path.join(dir, `${name.replace(/[@/]/g, "_")}.ts`);
        if (!fs.existsSync(shim)) {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(shim, text);
        }
        Object.assign(out, subpathAliases(configDir, aliases, name));
        out[name] = shim;
    }
    return out;
}
