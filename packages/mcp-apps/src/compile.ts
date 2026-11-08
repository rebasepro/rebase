/**
 * Compile an app Claude wrote for the view: one TSX module, default-exporting
 * a React component, that imports only what the view serves.
 *
 * Run on the server, inside show_app, so a mistake comes back as the tool's
 * error — with the line — and the model fixes it in the same turn, before the
 * person sees anything. The output is CommonJS with the line numbers of the
 * source: the view runs it with a `require` that hands out its own modules
 * (`code_app.tsx` in `@rebasepro/cms/mcp-view`), and a runtime error's line is
 * the line the model wrote.
 *
 * Compiling checks the syntax and the imports — every module, and every name
 * imported from a module the view serves only part of — not the types.
 */
import { transform } from "sucrase";

/**
 * The modules the view serves and, from each, `"*"` for all of it or the
 * names it serves: `MCP_APP_MODULES` in `@rebasepro/types`, which the server
 * passes in.
 */
export type AppModules = Readonly<Record<string, "*" | readonly string[]>>;

/** What compiling an app answers: the code to run, or why there is none. */
export type AppCompileResult = { ok: true; code: string } | { ok: false; error: string };

/** The longest app the view takes. A screen of this size is a page to build, not a view to open. */
export const MAX_APP_SOURCE = 60_000;

export function compileApp(source: string, modules: AppModules): AppCompileResult {
    if (source.length > MAX_APP_SOURCE) {
        return { ok: false, error: `The app is ${source.length} characters; the view takes at most ${MAX_APP_SOURCE}.` };
    }
    if (/\bimport\s*\(/.test(source)) {
        return { ok: false, error: "The app imports a module at runtime (`import(…)`). Import what it uses at the top." };
    }
    let code: string;
    try {
        code = transform(source, {
            transforms: ["typescript", "jsx", "imports"],
            jsxRuntime: "automatic",
            production: true
        }).code;
    } catch (error) {
        return { ok: false, error: syntaxError(source, error) };
    }
    const unknown = [...code.matchAll(/\brequire\((['"])([^'"]+)\1\)/g)]
        .map(match => match[2])
        .filter(name => !Object.hasOwn(modules, name));
    if (unknown.length > 0) {
        return {
            ok: false,
            error: `The app imports ${[...new Set(unknown)].map(name => `"${name}"`).join(", ")}, which the view does not provide. `
                + `It provides ${Object.keys(modules).filter(name => name !== "react/jsx-runtime").map(name => `"${name}"`).join(", ")}.`
        };
    }
    const unserved = unservedImport(source, modules);
    if (unserved) return { ok: false, error: unserved };
    if (!/\bexports\.default\s*=/.test(code)) {
        return { ok: false, error: "The app has no default export. Export the component the view draws: `export default function App() { … }`." };
    }
    return { ok: true, code };
}

/**
 * The first name the source imports from a module the view serves only part
 * of, that the view does not serve: said with its line, and what the module
 * does serve. A type-only import leaves nothing at runtime and is not checked.
 */
function unservedImport(source: string, modules: AppModules): string | undefined {
    for (const match of source.matchAll(/(^|[;\n])\s*import\s+(?!type\s)([\w$\s{},*]+?)\s+from\s*(['"])([^'"]+)\3/g)) {
        const served = modules[match[4]];
        if (served === undefined || served === "*") continue;
        const missing = importedNames(match[2]).find(name => !served.includes(name));
        if (missing === undefined) continue;
        const line = source.slice(0, (match.index ?? 0) + match[0].indexOf("import")).split("\n").length;
        return `The app imports ${missing === "default" ? "a default export" : `"${missing}"`} from "${match[4]}" (line ${line}), `
            + `which the view does not serve. From "${match[4]}" it serves ${served.join(", ")}.`;
    }
    return undefined;
}

/** The runtime names an import clause takes: `default` for a default import, none for a namespace. */
function importedNames(clause: string): string[] {
    const names: string[] = [];
    const braces = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, "").replace(/\*\s*as\s+[\w$]+/, "");
    if (/[\w$]/.test(outside.replace(/,/g, ""))) names.push("default");
    for (const part of braces?.[1].split(",") ?? []) {
        const specifier = part.trim();
        if (specifier === "" || /^type\s/.test(specifier)) continue;
        names.push(specifier.split(/\s+as\s+/)[0].trim());
    }
    return names;
}

/** sucrase's message and position, with the line it is on. */
function syntaxError(source: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const loc = typeof error === "object" && error !== null && "loc" in error ? error.loc : undefined;
    const line = typeof loc === "object" && loc !== null && "line" in loc && typeof loc.line === "number" ? loc.line : undefined;
    if (line === undefined) return `The app does not compile: ${message}`;
    const text = source.split("\n")[line - 1]?.trim();
    return `The app does not compile: ${message}${text ? `, at line ${line}: ${text.slice(0, 160)}` : ""}`;
}
