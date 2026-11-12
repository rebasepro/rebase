/**
 * Whether a project's frontend builds with `rebaseBackendGuard()`, read from
 * its Vite config without running it.
 *
 * A frontend imports the backend's tables as types only; a value import of
 * `backend/` ships the table's hooks, and every server module and secret they
 * reach, to every visitor. `rebaseBackendGuard()` (from
 * `@rebasepro/app/vitePlugin`) is what refuses that, in the project's own Vite
 * build and dev server. The CLI does not drive Vite itself — `rebase build`
 * runs the app's declared build command, `rebase dev` its dev script — so it
 * cannot add the plugin to a build; it can refuse to run one without it. This
 * module is that check, shared by `rebase build` (refuses), the frontend fold
 * of `rebase build` / `rebase cloud deploy` (refuses), `rebase dev` (warns)
 * and `rebase verify` (`cms-backend-guard-missing`).
 *
 * **Quiet when it cannot tell.** A config that imports a local module (a
 * shared preset may add the guard) or that does not parse is `unknown`, never
 * `missing`. A project without `backend/`, or a frontend without a Vite
 * config, has nothing to check.
 */
import fs from "fs";
import path from "path";
import type { ts as TsApi } from "ts-morph";
import { loadManifest } from "../manifest";

type TsMorph = typeof import("ts-morph");

/** The module the guard is exported from, and its name. */
export const BACKEND_GUARD_MODULE = "@rebasepro/app/vitePlugin";
export const BACKEND_GUARD_EXPORT = "rebaseBackendGuard";

/** The Vite config file names Vite itself looks for, in its order. */
const VITE_CONFIGS = ["vite.config.js", "vite.config.mjs", "vite.config.ts", "vite.config.cjs", "vite.config.mts", "vite.config.cts"];

/** What a static read of one frontend's Vite config says. */
export interface BackendGuardState {
    state: "guarded" | "missing" | "unknown";
    /** The frontend directory, relative to the project root. */
    frontend: string;
    /** The Vite config, relative to the project root. */
    viteConfig: string;
    /** 1-based line of the config's `plugins`, or 1. */
    line: number;
    /** Why the read could not decide (`unknown` only). */
    reason?: string;
}

/** The lines to add, for a message or a codemod's manual step. */
export const BACKEND_GUARD_SNIPPET =
    `import { ${BACKEND_GUARD_EXPORT} } from "${BACKEND_GUARD_MODULE}";\n\n` +
    `// in defineConfig({ … }):\nplugins: [\n    // …your plugins\n    ${BACKEND_GUARD_EXPORT}()\n]`;

/**
 * The frontend directories of a project: `frontend/`, and the `root` of each
 * static app `rebase.json` declares — those that exist.
 */
function frontendDirectories(projectRoot: string): string[] {
    const roots = new Set<string>(["frontend"]);
    try {
        const { manifest } = loadManifest(projectRoot);
        for (const app of Object.values(manifest.apps)) {
            if (app.type === "static" && typeof app.root === "string") roots.add(app.root);
        }
    } catch {
        // No rebase.json, or one another command reports: the conventional layout.
    }
    const out: string[] = [];
    for (const root of roots) {
        const dir = path.resolve(projectRoot, root);
        if (dir !== path.resolve(projectRoot) && fs.existsSync(dir) && fs.statSync(dir).isDirectory() && !out.includes(dir)) out.push(dir);
    }
    return out;
}

/**
 * Read one Vite config's text: does it call the guard?
 *
 * Guarded: `rebaseBackendGuard` is imported (by name, aliased or not, or as a
 * member of a namespace import) from `@rebasepro/app/vitePlugin` and called.
 * Unknown: it is not, but the config imports a local module, which may add
 * it. Missing: neither.
 */
export function readViteConfigGuard(tsm: TsMorph, file: string, text: string): { state: BackendGuardState["state"]; line: number; reason?: string } {
    const { ts } = tsm;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const names = new Set<string>();
    const namespaces = new Set<string>();
    let localImport: string | undefined;
    let pluginsLine = 1;
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const from = statement.moduleSpecifier.text;
        if (from.startsWith(".") || from.startsWith("/")) localImport ??= from;
        const clause = statement.importClause;
        if (from !== BACKEND_GUARD_MODULE || !clause || clause.isTypeOnly) continue;
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
                if ((element.propertyName ?? element.name).text === BACKEND_GUARD_EXPORT && !element.isTypeOnly) names.add(element.name.text);
            }
        }
    }
    let called = false;
    const visit = (node: TsApi.Node): void => {
        if (ts.isCallExpression(node)) {
            const callee = node.expression;
            if ((ts.isIdentifier(callee) && names.has(callee.text)) ||
                (ts.isPropertyAccessExpression(callee) && callee.name.text === BACKEND_GUARD_EXPORT &&
                    ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text))) {
                called = true;
            }
        }
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "plugins" && pluginsLine === 1) {
            pluginsLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    if (called) return { state: "guarded", line: pluginsLine };
    if (localImport !== undefined) {
        return { state: "unknown", line: pluginsLine, reason: `it imports "${localImport}", which may add the guard` };
    }
    return { state: "missing", line: pluginsLine };
}

/**
 * The guard's state for each frontend of the project that has a Vite config.
 * Empty when the project has no `backend/` directory: there is nothing to
 * import by mistake.
 */
export async function backendGuardStates(projectRoot: string): Promise<BackendGuardState[]> {
    if (!fs.existsSync(path.join(projectRoot, "backend"))) return [];
    const configs: { frontend: string; file: string }[] = [];
    for (const frontend of frontendDirectories(projectRoot)) {
        const name = VITE_CONFIGS.find(candidate => fs.existsSync(path.join(frontend, candidate)));
        if (name) configs.push({ frontend, file: path.join(frontend, name) });
    }
    if (configs.length === 0) return [];
    const tsm: TsMorph = await import("ts-morph");
    return configs.map(({ frontend, file }) => {
        const relative = { frontend: path.relative(projectRoot, frontend), viteConfig: path.relative(projectRoot, file) };
        try {
            return { ...relative, ...readViteConfigGuard(tsm, file, fs.readFileSync(file, "utf-8")) };
        } catch (error) {
            return { ...relative, state: "unknown", line: 1, reason: `it could not be read (${error instanceof Error ? error.message : String(error)})` };
        }
    });
}

/** What a frontend without the guard is told, by `rebase build`, `rebase dev` and `rebase verify`. */
export function backendGuardMissingMessage(state: BackendGuardState): string {
    return `${state.viteConfig} does not use ${BACKEND_GUARD_EXPORT}(): nothing stops a value import of backend/ ` +
        "from shipping its tables' server hooks — and every module and secret they reach — to every visitor of the site.";
}

/** The fix, in one line. */
export const BACKEND_GUARD_FIX =
    `Add \`import { ${BACKEND_GUARD_EXPORT} } from "${BACKEND_GUARD_MODULE}";\` and \`${BACKEND_GUARD_EXPORT}()\` to the config's \`plugins\`.`;

/**
 * Throw when a frontend of the project builds without the guard. For
 * `rebase build` and the frontend fold; `unknown` passes.
 */
export async function assertBackendGuarded(projectRoot: string): Promise<void> {
    const missing = (await backendGuardStates(projectRoot)).filter(state => state.state === "missing");
    if (missing.length === 0) return;
    throw new Error(
        missing.map(backendGuardMissingMessage).join("\n") +
        `\n${BACKEND_GUARD_FIX}\n` +
        "It fails the build when anything in the frontend imports a value from backend/; import tables as types (`import type { posts } from …`)."
    );
}
