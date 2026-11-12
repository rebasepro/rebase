/**
 * Importing a `backend/schema` directory as it *would be* after an edit.
 *
 * The schema editor refuses an edit whose result does not compile, and the
 * result is text that has not been written anywhere the project reads. So the
 * edited modules are evaluated from that text: each is transpiled to CommonJS
 * with the TypeScript that ships with ts-morph and run in this process, with
 * a `require` that serves the edited text for every module of the schema
 * directory and the disk for everything else.
 *
 * The builders a schema module imports (`@rebasepro/server/schema`, which
 * only re-exports `@rebasepro/types`) are served from this process's own
 * copy, so a definition evaluated here is the same kind of object the server
 * runs — the definitions it yields are what the server is refreshed with after
 * an apply.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { ts } from "ts-morph";
import * as schemaBuilders from "@rebasepro/types";

import type { SchemaModuleImporter } from "../schema/load-schema";

/** The module specifiers served from this process's builders. */
const BUILDER_SPECIFIERS = new Set(["@rebasepro/server/schema", "@rebasepro/types"]);

/** What a module file may be named, in the order an extensionless import tries them. */
const RESOLVE_SUFFIXES = [".ts", ".mts", ".tsx", ".js", ".mjs", ".cjs", ".json", "/index.ts", "/index.mts", "/index.js", "/index.mjs"];
const TRANSPILED = /\.(ts|mts|cts|tsx|js|mjs|cjs|jsx)$/;

/**
 * Options of {@link createSourceImporter}.
 */
export interface SourceImporterOptions {
    /** The edited text of every module of the schema directory, by real absolute path. */
    sources: ReadonlyMap<string, string>;
    /** The schema directory the edited text belongs to. */
    realDir: string;
    /**
     * The directory the loader is pointed at — a scratch copy of `realDir`
     * holding the edited files, so it can list them. Paths under it are read
     * as the same paths under `realDir`.
     */
    scratchDir: string;
    /**
     * Where a bare specifier (`slugify`, `@acme/lib`) is resolved from: the
     * importing module's real location when absent. A schema fetched from a
     * repository into a scratch directory has no `node_modules` above it, so
     * its caller names the runtime's own directory.
     */
    resolveBareFrom?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

/**
 * A {@link SchemaModuleImporter} that sees the edited text.
 *
 * Modules are cached for the importer's lifetime, so the index and a sibling
 * that import the same table get the same object, as under Node.
 */
export function createSourceImporter(options: SourceImporterOptions): SchemaModuleImporter {
    const { sources, realDir, scratchDir } = options;
    const cache = new Map<string, { exports: unknown }>();
    const bareRequire = options.resolveBareFrom
        ? createRequire(path.join(options.resolveBareFrom, "noop.js"))
        : undefined;

    const realPathOf = (file: string): string => {
        const relative = path.relative(scratchDir, file);
        return relative.startsWith("..") || path.isAbsolute(relative) ? file : path.join(realDir, relative);
    };

    const exists = (file: string): boolean =>
        sources.has(file) || (fs.existsSync(file) && fs.statSync(file).isFile());

    const resolveRelative = (specifier: string, from: string): string => {
        const base = path.resolve(path.dirname(from), specifier);
        const candidates = [base, ...RESOLVE_SUFFIXES.map(suffix => base + suffix)];
        // `./users.js` written for a `.ts` file, as TypeScript's own resolution allows.
        if (/\.[mc]?js$/.test(base)) candidates.push(base.replace(/\.([mc]?)js$/, ".$1ts"));
        const found = candidates.find(exists);
        if (!found) throw new Error(`Cannot find module "${specifier}" imported from ${from}.`);
        return found;
    };

    const evaluate = (file: string): unknown => {
        const cached = cache.get(file);
        if (cached) return cached.exports;
        const text = sources.get(file) ?? fs.readFileSync(file, "utf8");
        if (file.endsWith(".json")) {
            const parsed: unknown = JSON.parse(text);
            cache.set(file, { exports: parsed });
            return parsed;
        }
        if (!TRANSPILED.test(file)) throw new Error(`Cannot import ${file}: not a module.`);
        const { outputText } = ts.transpileModule(text, {
            fileName: file,
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
                jsx: ts.JsxEmit.ReactJSX,
                sourceMap: false
            }
        });
        const module: { exports: unknown } = { exports: {} };
        cache.set(file, module);
        const localRequire = (specifier: string): unknown => {
            if (BUILDER_SPECIFIERS.has(specifier)) return schemaBuilders;
            if (specifier.startsWith(".") || path.isAbsolute(specifier)) return evaluate(resolveRelative(specifier, file));
            return (bareRequire ?? createRequire(file))(specifier);
        };
        const wrapper: unknown = vm.runInThisContext(
            `(function (exports, require, module, __filename, __dirname) {${outputText}\n})`,
            { filename: file }
        );
        if (typeof wrapper !== "function") throw new Error(`Could not evaluate ${file}.`);
        Reflect.apply(wrapper, undefined, [module.exports, localRequire, module, file, path.dirname(file)]);
        return module.exports;
    };

    return async (file: string): Promise<Record<string, unknown>> => {
        const exported = evaluate(realPathOf(file));
        return isRecord(exported) ? exported : { default: exported };
    };
}
