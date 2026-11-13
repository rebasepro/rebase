/**
 * Path aliases a project imports `config/` through.
 *
 * A frontend often reaches `config/` as `@config/collections/posts` — a
 * tsconfig `paths` entry for the type checker, a Vite `resolve.alias` for the
 * bundler. Such an import is an import of `config/` like a relative one, so
 * the codemod resolves both kinds of alias to the file they name and treats
 * the import as if it had been written relative.
 */
import fs from "node:fs";
import path from "node:path";

import { toPosix } from "./ast";

/** One alias: `prefix` (with its trailing `/` for a wildcard) → an absolute path. */
export interface PathAlias {
    /** What a specifier starts with: `@config/` for `@config/*`, `@config` for a Vite alias, the whole key for an exact entry. */
    prefix: string;
    /** Whether the rest of the specifier is appended to `target` (`@config/*`, or a Vite alias). */
    wildcard: boolean;
    /** Exact (non-wildcard) Vite aliases also match `prefix/…`. */
    vite: boolean;
    /** The directory (wildcard) or module (exact) it names, absolute. */
    target: string;
    /** The directory whose files the alias applies to (the tsconfig's or Vite config's), absolute. */
    scope: string;
}

const IGNORED = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

/** JSON with comments and trailing commas, as tsconfig files are written. */
function parseJsonc(text: string): unknown {
    let out = "";
    let index = 0;
    while (index < text.length) {
        const char = text[index];
        if (char === "\"") {
            const start = index++;
            while (index < text.length && text[index] !== "\"") index += text[index] === "\\" ? 2 : 1;
            out += text.slice(start, ++index);
        } else if (char === "/" && text[index + 1] === "/") {
            while (index < text.length && text[index] !== "\n") index++;
        } else if (char === "/" && text[index + 1] === "*") {
            const end = text.indexOf("*/", index + 2);
            index = end === -1 ? text.length : end + 2;
        } else {
            out += char;
            index++;
        }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tsconfigAliases(file: string): PathAlias[] {
    let json: unknown;
    try {
        json = parseJsonc(fs.readFileSync(file, "utf8"));
    } catch {
        return [];
    }
    const options = isRecord(json) && isRecord(json.compilerOptions) ? json.compilerOptions : undefined;
    if (!options || !isRecord(options.paths)) return [];
    const dir = path.dirname(file);
    const base = typeof options.baseUrl === "string" ? path.resolve(dir, options.baseUrl) : dir;
    const out: PathAlias[] = [];
    for (const [key, value] of Object.entries(options.paths)) {
        const first = Array.isArray(value) ? value.find((entry): entry is string => typeof entry === "string") : undefined;
        if (first === undefined) continue;
        const wildcard = key.endsWith("/*") && first.endsWith("/*");
        if (!wildcard && (key.includes("*") || first.includes("*"))) continue;
        out.push(wildcard
            ? { prefix: key.slice(0, -1), wildcard: true, vite: false, target: path.resolve(base, first.slice(0, -2)), scope: dir }
            : { prefix: key, wildcard: false, vite: false, target: path.resolve(base, first), scope: dir });
    }
    return out;
}

/** `"@x": path.resolve(__dirname, "../config")` (or `resolve(…)`, `import.meta.dirname`) in a Vite config. */
const VITE_ALIAS = /["']([^"'\s]+)["']\s*:\s*(?:path\.)?resolve\(\s*(?:__dirname|import\.meta\.dirname)\s*,\s*["']([^"']+)["']\s*\)/g;

function viteAliases(file: string): PathAlias[] {
    const text = fs.readFileSync(file, "utf8");
    const dir = path.dirname(file);
    return [...text.matchAll(VITE_ALIAS)].map(match => ({ prefix: match[1], wildcard: true, vite: true, target: path.resolve(dir, match[2]), scope: dir }));
}

/**
 * Every alias the project's tsconfig files (`compilerOptions.paths`) and Vite
 * configs (`resolve.alias` written as `path.resolve(__dirname, …)`) declare,
 * in the project root and the directories below it. A tsconfig that extends
 * another is read as written: its own `paths` only.
 */
export function readPathAliases(root: string): PathAlias[] {
    const out: PathAlias[] = [];
    const visit = (dir: string, depth: number): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || IGNORED.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (depth < 2) visit(full, depth + 1);
            } else if (/^tsconfig.*\.json$/.test(entry.name)) {
                out.push(...tsconfigAliases(full));
            } else if (/^vite\.config\.(ts|mts|js|mjs)$/.test(entry.name)) {
                out.push(...viteAliases(full));
            }
        }
    };
    visit(root, 0);
    return out;
}

/**
 * The relative specifier an aliased one stands for, from `fromFile` — or
 * undefined when no alias in scope matches it. Longer prefixes win, as both
 * TypeScript and Vite match the most specific entry.
 */
export function aliasToRelative(aliases: readonly PathAlias[], fromFile: string, specifier: string): string | undefined {
    const inScope = aliases
        .filter(alias => {
            const relative = path.relative(alias.scope, fromFile);
            return !relative.startsWith("..") && !path.isAbsolute(relative);
        })
        .sort((a, b) => b.prefix.length - a.prefix.length);
    for (const alias of inScope) {
        let target: string | undefined;
        if (alias.vite) {
            if (specifier === alias.prefix) target = alias.target;
            else if (specifier.startsWith(`${alias.prefix}/`)) target = path.join(alias.target, specifier.slice(alias.prefix.length + 1));
        } else if (alias.wildcard) {
            if (specifier.startsWith(alias.prefix)) target = path.join(alias.target, specifier.slice(alias.prefix.length));
        } else if (specifier === alias.prefix) {
            target = alias.target.replace(/\.(tsx?|mts)$/, "");
        }
        if (target === undefined) continue;
        const relative = toPosix(path.relative(path.dirname(fromFile), target));
        return relative.startsWith(".") ? relative : `./${relative}`;
    }
    return undefined;
}
