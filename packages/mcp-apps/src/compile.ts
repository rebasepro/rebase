/**
 * Compile an app Claude wrote for the view: one TSX module, default-exporting
 * a React component, that imports only what the view provides.
 *
 * Run on the server, inside show_app, so a mistake comes back as the tool's
 * error — with the line — and the model fixes it in the same turn, before the
 * person sees anything. The output is CommonJS with the line numbers of the
 * source: the view runs it with a `require` that hands out its own modules
 * (`views/app/code-app.tsx`), and a runtime error's line is the line the model
 * wrote.
 *
 * Compiling checks the syntax and the imports, not the types: a component
 * the module does not export is caught when the view reaches for it, and
 * reported the same way.
 */
import { transform } from "sucrase";
import { APP_MODULES } from "./app-modules";

/** What compiling an app answers: the code to run, or why there is none. */
export type AppCompileResult = { ok: true; code: string } | { ok: false; error: string };

/** The longest app the view takes. A screen of this size is a page to build, not a view to open. */
export const MAX_APP_SOURCE = 60_000;

export function compileApp(source: string): AppCompileResult {
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
        .filter(name => !(APP_MODULES as readonly string[]).includes(name));
    if (unknown.length > 0) {
        return {
            ok: false,
            error: `The app imports ${[...new Set(unknown)].map(name => `"${name}"`).join(", ")}, which the view does not provide. `
                + `It provides ${APP_MODULES.filter(name => name !== "react/jsx-runtime").map(name => `"${name}"`).join(", ")}.`
        };
    }
    if (!/\bexports\.default\s*=/.test(code)) {
        return { ok: false, error: "The app has no default export. Export the component the view draws: `export default function App() { … }`." };
    }
    return { ok: true, code };
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
