/**
 * Everything around the collections: `rebase.json`, the workspace, the
 * packages and tsconfigs that named the config package, the other modules of
 * `config/` (resources, storage access, the generated registration), and the
 * frontend's wiring.
 *
 * Arbitrary code is never rewritten. A file in the scaffold's known shape —
 * the `App.tsx`, `vite.config.ts` and `virtual.d.ts` `rebase init` writes — is
 * rewritten exactly; anything else is reported as a manual step with the
 * snippet to apply. The Vite config gains `rebaseBackendGuard()` either way.
 */
import fs from "node:fs";
import path from "node:path";

import type { AstContext } from "./ast";
import { toPosix } from "./ast";
import { aliasToRelative, type PathAlias } from "./path-aliases";
import { resolveRelative } from "./modules";
import type { PlanContext } from "./plan-context";
import type { ManualStep } from "./types";
import { note, planFile, relativeToRoot } from "./plan-context";
import { BACKEND_GUARD_EXPORT, BACKEND_GUARD_SNIPPET } from "../../utils/backend-guard";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): { value: JsonObject; text: string } | undefined {
    if (!fs.existsSync(file)) return undefined;
    const text = fs.readFileSync(file, "utf8");
    try {
        const value: unknown = JSON.parse(text);
        return isObject(value) ? { value, text } : undefined;
    } catch {
        return undefined;
    }
}

/** JSON written back with the file's own indentation and trailing newline. */
function writeJson(original: string, value: JsonObject): string {
    const indent = /\n([ \t]+)"/.exec(original)?.[1] ?? "  ";
    return `${JSON.stringify(value, null, indent)}${original.endsWith("\n") ? "\n" : ""}`;
}

/** What `rebase.json` says about the layout, read raw (the CLI's parser refuses the legacy keys). */
export interface RawManifest {
    file: string;
    text: string;
    value: JsonObject;
    /** The backend app's key in `apps`. */
    backendName?: string;
    /** The config directory, relative to the root. */
    configDir: string;
    /** The frontend (static) app's root, relative to the root, when there is one. */
    frontendRoot?: string;
}

/** Read `rebase.json`, if there is one. */
export function readRawManifest(root: string): RawManifest {
    const file = path.join(root, "rebase.json");
    const read = readJson(file);
    const apps = read && isObject(read.value.apps) ? read.value.apps : {};
    let backendName: string | undefined;
    let configDir = "config";
    let frontendRoot: string | undefined;
    for (const [name, app] of Object.entries(apps)) {
        if (!isObject(app)) continue;
        if (app.type === "backend" && backendName === undefined) {
            backendName = name;
            if (typeof app.config === "string") configDir = app.config;
        }
        if (app.type === "static" && frontendRoot === undefined && typeof app.root === "string" && typeof app.cms === "string") {
            frontendRoot = app.root;
        }
    }
    if (frontendRoot === undefined && fs.existsSync(path.join(root, "frontend", "src"))) frontendRoot = "frontend";
    return { file, text: read?.text ?? "", value: read?.value ?? {}, ...(backendName ? { backendName } : {}), configDir, ...(frontendRoot ? { frontendRoot } : {}) };
}

/** `rebase.json` without `config` and `usersCollection` (the tables directory is the default, so no `tables` key). */
export function planManifest(plan: PlanContext, manifest: RawManifest): void {
    if (!manifest.text || !manifest.backendName) return;
    const apps = manifest.value.apps;
    if (!isObject(apps)) return;
    const backend = apps[manifest.backendName];
    if (!isObject(backend) || (!("config" in backend) && !("usersCollection" in backend))) return;
    const { config: _config, usersCollection: _users, ...rest } = backend;
    void _config;
    void _users;
    const next = { ...manifest.value, apps: { ...apps, [manifest.backendName]: rest } };
    planFile(plan, manifest.file, writeJson(manifest.text, next), "rebase.json");
}

/** The config package's name, from `config/package.json`. */
function configPackageName(configDir: string): string | undefined {
    const read = readJson(path.join(configDir, "package.json"));
    return read && typeof read.value.name === "string" ? read.value.name : undefined;
}

const COLLECTIONS_FLAG = /\s+--collections(?:=|\s+)\S+/g;

/** `--filter "./config"` (any quoting) in a workspace script: the package is gone. */
function withoutConfigFilter(script: string, configRelative: string): string {
    const escaped = configRelative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return script.replace(new RegExp(`\\s+--filter(?:=|\\s+)(["']?)(?:\\./)?${escaped}\\1(?=\\s|$)`, "g"), "");
}

/** The workspace, the packages and the scripts that named the config package or directory. */
export function planWorkspace(plan: PlanContext, configDir: string, frontendRoot: string | undefined, keepConfigPackage = false): void {
    // When config/ keeps modules of the project's own, it stays a workspace
    // package, depended on as before: only the collections flags go.
    const root = plan.root;
    const configRelative = relativeToRoot(plan, configDir);
    const packageName = configPackageName(configDir);

    const rootPackage = readJson(path.join(root, "package.json"));
    if (rootPackage) {
        const value = { ...rootPackage.value };
        let changed = false;
        if (Array.isArray(value.workspaces) && !keepConfigPackage) {
            const kept = value.workspaces.filter(entry => entry !== configRelative && entry !== `./${configRelative}`);
            if (kept.length !== value.workspaces.length) {
                value.workspaces = kept;
                changed = true;
            }
        }
        if (isObject(value.scripts)) {
            const scripts: JsonObject = {};
            for (const [name, script] of Object.entries(value.scripts)) {
                const flagless = typeof script === "string" ? script.replace(COLLECTIONS_FLAG, "") : script;
                const next = typeof flagless === "string" && !keepConfigPackage ? withoutConfigFilter(flagless, configRelative) : flagless;
                if (next !== script) changed = true;
                scripts[name] = next;
            }
            value.scripts = scripts;
        }
        if (changed) planFile(plan, path.join(root, "package.json"), writeJson(rootPackage.text, value), "package.json (workspaces, scripts)");
    }

    const workspaceFile = path.join(root, "pnpm-workspace.yaml");
    if (fs.existsSync(workspaceFile) && !keepConfigPackage) {
        const text = fs.readFileSync(workspaceFile, "utf8");
        const escaped = configRelative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const next = text.replace(new RegExp(`^[ \\t]*-[ \\t]*["']?(?:\\./)?${escaped}["']?[ \\t]*\\r?\\n`, "m"), "");
        if (next !== text) planFile(plan, workspaceFile, next, "pnpm-workspace.yaml");
    }

    const members = ["backend", ...(frontendRoot ? [frontendRoot] : [])];
    for (const member of members) {
        const file = path.join(root, member, "package.json");
        const read = readJson(file);
        if (!read) continue;
        const value = { ...read.value };
        let changed = false;
        for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
            const deps = value[field];
            if (!isObject(deps) || packageName === undefined || !(packageName in deps) || keepConfigPackage) continue;
            const { [packageName]: _removed, ...rest } = deps;
            void _removed;
            value[field] = rest;
            changed = true;
        }
        if (isObject(value.scripts)) {
            const scripts: JsonObject = {};
            for (const [name, script] of Object.entries(value.scripts)) {
                let next = script;
                if (typeof script === "string") {
                    const flagless = script.replace(COLLECTIONS_FLAG, "");
                    next = keepConfigPackage ? flagless : flagless.replace(/\s+--watch=\.\.\/config\/\S*/g, "");
                }
                if (next !== script) changed = true;
                scripts[name] = next;
            }
            value.scripts = scripts;
        }
        if (changed) planFile(plan, file, writeJson(read.text, value), `${member}/package.json`);
        if (member === "backend") {
            const deps = isObject(value.dependencies) ? value.dependencies : {};
            if (!("@rebasepro/server" in deps)) {
                const sibling = Object.entries(deps).find(([name]) => name.startsWith("@rebasepro/"))?.[1];
                plan.manualSteps.push({
                    title: "Add @rebasepro/server to the backend",
                    detail: "The schema modules import their builders from `@rebasepro/server/schema`, and backend/package.json does not depend on `@rebasepro/server`. Add it beside the other @rebasepro packages, then install.",
                    snippet: `"@rebasepro/server": ${JSON.stringify(typeof sibling === "string" ? sibling : "<the version of your other @rebasepro packages>")}`,
                    file: relativeToRoot(plan, file)
                });
            }
        }
    }
}

/** The comment the scaffold now writes above `rootDir`. */
const ROOT_DIR_COMMENT = [
    "    // Everything this program compiles lives under backend/, so the emit",
    "    // mirrors it: `dist/schema/…`, `dist/functions/…`, `dist/src/…`. Saying so",
    "    // is required from TypeScript 6, which refuses to infer it (TS5011)."
];

/** The `//` comment lines directly above line `index`. */
function commentBlockAbove(lines: readonly string[], index: number): { start: number; end: number } {
    let start = index;
    while (start > 0 && /^\s*\/\//.test(lines[start - 1])) start--;
    return { start, end: index };
}

/** Drop the paragraphs of a `//` comment block that talk about the config package. */
function withoutConfigParagraphs(block: readonly string[]): string[] {
    const paragraphs: string[][] = [[]];
    for (const line of block) {
        if (/^\s*\/\/\s*$/.test(line)) paragraphs.push([line]);
        else paragraphs[paragraphs.length - 1].push(line);
    }
    const kept = paragraphs.filter(paragraph => !paragraph.some(line => /\.\.\/config\b|config\/\*\*|\bconfig (package|workspace)\b/.test(line)));
    const out = kept.flat();
    while (out.length > 0 && /^\s*\/\/\s*$/.test(out[0])) out.shift();
    return out;
}

/**
 * backend/tsconfig.json once `config/` is gone: `../config/**` out of
 * `include` and the new modules in; `rootDir ".."` (which existed only so the
 * program could reach ../config) back to `"."`, its comment and the include's
 * comment rid of the config package; a `drizzle.config.ts` include that names
 * no file dropped. With `rootDir "."` the emit moves from `dist/backend/src` to
 * `dist/src`, so the scripts, `entrypoint.sh` and Dockerfile that name the old
 * path follow. A tsconfig not in that shape is a manual step.
 */
export function planBackendTsconfig(plan: PlanContext, wanted: readonly string[], keepConfig = false): void {
    const backendDir = path.join(plan.root, "backend");
    const file = path.join(backendDir, "tsconfig.json");
    if (!fs.existsSync(file)) return;
    const original = fs.readFileSync(file, "utf8");
    const match = /"include"\s*:\s*\[([^\]]*)\]/.exec(original);
    const entries = match ? [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(found => found[1]) : [];
    const namesConfig = entries.some(entry => entry.startsWith("../config"));
    const rootUp = /"rootDir"\s*:\s*"\.\."/.test(original);
    if (keepConfig) {
        // The backend still compiles the project's own modules of config/: only add what the migration writes.
        if (!match) return;
        const covers = (pattern: string): boolean => entries.includes(pattern) || entries.includes("**/*") || entries.includes("**/*.ts");
        const missing = wanted.filter(entry => !covers(entry));
        if (missing.length === 0) return;
        const next = [...entries, ...missing];
        planFile(plan, file, `${original.slice(0, match.index)}"include": [${next.map(entry => JSON.stringify(entry)).join(", ")}]${original.slice(match.index + match[0].length)}`, "backend/tsconfig.json");
        return;
    }
    if (!namesConfig && !rootUp) return;
    if (!match) {
        plan.manualSteps.push({
            title: "Point backend/tsconfig.json at the backend only",
            detail: "backend/tsconfig.json has `rootDir: \"..\"` (it compiled ../config) but no `include` the codemod can read. Set `rootDir` to `\".\"`, include `schema/**/*` and the other backend modules, and run the built entry from `dist/src/` (it was `dist/backend/src/`).",
            file: relativeToRoot(plan, file)
        });
        return;
    }
    const kept = entries.filter(entry => !entry.startsWith("../config") && !(entry === "drizzle.config.ts" && !fs.existsSync(path.join(backendDir, entry))));
    const covers = (pattern: string): boolean => kept.includes(pattern) || kept.includes("**/*") || kept.includes("**/*.ts");
    const next = [...kept, ...wanted.filter(entry => !covers(entry))];
    let text = `${original.slice(0, match.index)}"include": [${next.map(entry => JSON.stringify(entry)).join(", ")}]${original.slice(match.index + match[0].length)}`;

    const lines = text.split("\n");
    const includeLine = lines.findIndex(line => /"include"\s*:/.test(line));
    if (includeLine >= 0) {
        const block = commentBlockAbove(lines, includeLine);
        lines.splice(block.start, block.end - block.start, ...withoutConfigParagraphs(lines.slice(block.start, block.end)));
    }
    let movedEmit = false;
    const rootLine = lines.findIndex(line => /"rootDir"\s*:\s*"\.\."/.test(line));
    if (rootLine >= 0) {
        lines[rootLine] = lines[rootLine].replace(/"rootDir"\s*:\s*"\.\."/, `"rootDir": "."`);
        const block = commentBlockAbove(lines, rootLine);
        const comments = lines.slice(block.start, block.end);
        if (comments.length === 0 || comments.some(line => /config/.test(line))) lines.splice(block.start, block.end - block.start, ...ROOT_DIR_COMMENT);
        movedEmit = true;
    }
    // No `rootDir` at all: tsc took the common directory of the inputs, which `../config/**`
    // lifted to the project root. Without it that directory is backend/, so the emit moves the same way.
    if (namesConfig && !/"rootDir"\s*:/.test(original)) movedEmit = true;
    text = lines.join("\n");
    planFile(plan, file, text, "backend/tsconfig.json");
    if (movedEmit) planEmitPathMove(plan);
}

/** `dist/backend/src` → `dist/src` wherever the project names the old emit path. */
function planEmitPathMove(plan: PlanContext): void {
    const candidates = [
        path.join(plan.root, "package.json"),
        path.join(plan.root, "backend", "package.json"),
        path.join(plan.root, "backend", "entrypoint.sh"),
        path.join(plan.root, "backend", "Dockerfile"),
        path.join(plan.root, "Dockerfile")
    ];
    for (const candidate of candidates) {
        const planned = plan.files.get(candidate);
        const current = planned?.content ?? (fs.existsSync(candidate) ? fs.readFileSync(candidate, "utf8") : undefined);
        if (current === undefined || !current.includes("dist/backend/")) continue;
        const next = current.split("dist/backend/").join("dist/");
        plan.files.set(candidate, { content: next, role: planned ? `${planned.role}, emit path` : `${relativeToRoot(plan, candidate)} (emit path dist/src)` });
    }
}

/** A legacy config module that moves to `backend/`, with its imports moved. */
export function planMove(plan: PlanContext, from: string, to: string, role: string): boolean {
    if (!fs.existsSync(from)) return false;
    const text = fs.readFileSync(from, "utf8");
    planFile(plan, to, plan.relocator.moveSpecifiersInText(text, from, to, "backend"), role);
    return true;
}

const SCAFFOLD_COLLECTIONS_IMPORT = `import { collections } from "virtual:rebase-collections";`;
const SCAFFOLD_COLLECTIONS_PROP = "collections={collections}";

/**
 * The file the collection editor writes presentation to in development, as
 * `rebase init` ships it (`templates/template/frontend/src/cms/ui-config.json`),
 * and the two lines that mount it — the import and the `<RebaseCMS>` prop.
 */
export const UI_CONFIG_CONTENT = "{\n  \"tables\": {}\n}\n";
const UI_CONFIG_IMPORT = "// How the collection editor laid out the tables in development (labels, columns, views).\nimport uiConfig from \"./cms/ui-config.json\";";
const UI_CONFIG_PROP = "uiConfig={uiConfig}";

/** The frontend's wiring: `App.tsx`, `vite.config.ts`, `virtual.d.ts`, `src/cms/ui-config.json`. */
export function planFrontendWiring(plan: PlanContext, frontendDir: string, hasExternal: boolean): void {
    const names = hasExternal ? "tableCustomizations, externalCollections" : "tableCustomizations";
    const appFile = path.join(frontendDir, "src", "App.tsx");

    // The collection editor's file: created empty, never overwritten. Without
    // it mounted, what the editor saves in development is gone on reload and
    // never ships.
    const uiConfigFile = path.join(frontendDir, "src", "cms", "ui-config.json");
    const appText = fs.existsSync(appFile) ? fs.readFileSync(appFile, "utf8") : "";
    const mountsUiConfig = /\buiConfig\s*=/.test(appText);
    if (!fs.existsSync(uiConfigFile) && !plan.files.has(uiConfigFile)) {
        planFile(plan, uiConfigFile, UI_CONFIG_CONTENT, "ui-config.json (the collection editor's presentation file)");
    }
    const wireUiConfig = !mountsUiConfig;
    const importLine = `import { ${names} } from "./cms";${wireUiConfig ? `\n${UI_CONFIG_IMPORT}` : ""}`;
    const props = [
        "tableCustomizations={tableCustomizations}",
        ...(hasExternal ? ["externalCollections={externalCollections}"] : []),
        ...(wireUiConfig ? [UI_CONFIG_PROP] : [])
    ];
    if (wireUiConfig) {
        const tsconfig = path.join(frontendDir, "tsconfig.json");
        const tsconfigText = fs.existsSync(tsconfig) ? fs.readFileSync(tsconfig, "utf8") : undefined;
        if (tsconfigText !== undefined && !tsconfigText.includes("resolveJsonModule") && !tsconfigText.includes("\"extends\"")) {
            note(plan, undefined, `${relativeToRoot(plan, tsconfig)} does not set \`resolveJsonModule\`; the type check needs it for \`import uiConfig from "./cms/ui-config.json"\` (Vite itself imports JSON as is).`);
        }
    }
    const mountStep = (file: string) => plan.manualSteps.push({
        title: "Mount the table customizations",
        detail: "The admin panel no longer takes `collections`: it projects every table from the backend and layers the customizations over it. Replace the `virtual:rebase-collections` import and the `collections` prop of `<RebaseCMS>`." +
            (wireUiConfig ? " Pass `uiConfig` too: in development the collection editor saves presentation to src/cms/ui-config.json, and without the prop it is lost on reload and never ships." : ""),
        snippet: `${importLine}\n\n<RebaseCMS\n    ${props.join("\n    ")}\n    {/* …the other props you pass */}\n/>`,
        file: relativeToRoot(plan, file)
    });
    const mountsCollections = (text: string) => text.includes("virtual:rebase-collections") || /<RebaseCMS[\s\S]*?collections=/.test(text);
    if (fs.existsSync(appFile) && (appText.includes(SCAFFOLD_COLLECTIONS_IMPORT) || mountsCollections(appText))) {
        const text = appText;
        const importCount = text.split(SCAFFOLD_COLLECTIONS_IMPORT).length - 1;
        const propCount = text.split(SCAFFOLD_COLLECTIONS_PROP).length - 1;
        if (importCount === 1 && propCount === 1 && !/\bcollections\b/.test(text.replace(SCAFFOLD_COLLECTIONS_IMPORT, "").replace(SCAFFOLD_COLLECTIONS_PROP, ""))) {
            const propLine = text.split("\n").find(line => line.includes(SCAFFOLD_COLLECTIONS_PROP)) ?? "";
            const indent = /^[ \t]*/.exec(propLine)?.[0] ?? "";
            const next = text
                .replace(SCAFFOLD_COLLECTIONS_IMPORT, importLine)
                .replace(SCAFFOLD_COLLECTIONS_PROP, props.join(`\n${indent}`));
            planFile(plan, appFile, next, "App.tsx (mount the customizations)");
        } else {
            mountStep(appFile);
        }
    } else {
        // The panel is mounted somewhere other than src/App.tsx (an `AdminApp.tsx`, a
        // route module): name every source file that still imports the collections
        // module or passes `collections` to <RebaseCMS>, or nothing tells the author.
        for (const file of frontendSourceFiles(path.join(frontendDir, "src"))) {
            if (mountsCollections(fs.readFileSync(file, "utf8"))) mountStep(file);
        }
    }

    const viteFile = ["vite.config.ts", "vite.config.mts", "vite.config.js"].map(name => path.join(frontendDir, name)).find(candidate => fs.existsSync(candidate));
    if (viteFile) planViteConfig(plan, viteFile);

    const virtualFile = path.join(frontendDir, "src", "virtual.d.ts");
    if (fs.existsSync(virtualFile)) {
        const text = fs.readFileSync(virtualFile, "utf8");
        const block = /\r?\n?declare module "virtual:rebase-collections" \{\s*export const collections: [^;]+;\s*\}\r?\n?/;
        if (block.test(text)) {
            planFile(plan, virtualFile, text.replace(block, "\n").replace(/\n{3,}/g, "\n\n"), "virtual.d.ts (drop the collections module)");
        } else if (text.includes("virtual:rebase-collections")) {
            plan.manualSteps.push({
                title: "Drop the virtual collections module declaration",
                detail: "Remove the `declare module \"virtual:rebase-collections\"` block: nothing provides it any more.",
                file: relativeToRoot(plan, virtualFile)
            });
        }
    }
}

/** The frontend's own .ts/.tsx sources (no declaration files, no node_modules, not the generated cms/). */
function frontendSourceFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules" && entry.name !== "cms") out.push(...frontendSourceFiles(full));
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
            out.push(full);
        }
    }
    return out.sort();
}

/**
 * The frontend's Vite config: the collections plugin goes, the backend guard
 * comes.
 *
 * `rebaseCollectionsPlugin` built the panel's collections from
 * config/collections and kept their server half out of the browser bundle.
 * Tables now live in backend/ with their hooks, and the frontend references
 * them as types; `rebaseBackendGuard()` is what refuses a value import of
 * backend/ in the build (and `rebase build` refuses a frontend without it).
 * In the scaffold's shape — the plugin on a line of its own, imported from
 * `@rebasepro/app/vitePlugin` — the one becomes the other in place; any other
 * shape is a manual step with the exact lines.
 */
function planViteConfig(plan: PlanContext, viteFile: string): void {
    const text = fs.readFileSync(viteFile, "utf8");
    const guarded = /\brebaseBackendGuard\s*\(/.test(text);
    const pluginLine = /^([ \t]*)rebaseCollectionsPlugin\(\{\s*collectionsDir:\s*["'][^"']*["']\s*\}\)(,?)[ \t]*(\r?\n)/m;
    const importLine = /(import\s*\{[^}]*?)\brebaseCollectionsPlugin\b([^}]*\}\s*from\s*["']@rebasepro\/app\/vitePlugin["'])/;
    const scaffoldShape = pluginLine.test(text) && importLine.test(text) && (text.match(/rebaseCollectionsPlugin/g) ?? []).length === 2;
    if (scaffoldShape) {
        const next = guarded
            ? text
                .replace(pluginLine, "")
                .replace(/(import\s*\{[^}]*?)\brebaseCollectionsPlugin\s*,\s*/, "$1")
                .replace(/(import\s*\{[^}]*?),\s*rebaseCollectionsPlugin\b/, "$1")
            : text
                .replace(pluginLine, (_line, indent: string, comma: string, eol: string) => `${indent}${BACKEND_GUARD_EXPORT}()${comma}${eol}`)
                .replace(importLine, `$1${BACKEND_GUARD_EXPORT}$2`);
        planFile(plan, viteFile, next, guarded ? "vite config (drop the collections plugin)" : "vite config (the collections plugin → rebaseBackendGuard)");
        return;
    }
    if (text.includes("rebaseCollectionsPlugin")) {
        plan.manualSteps.push({
            title: "Remove the collections Vite plugin",
            detail: "`rebaseCollectionsPlugin` built the panel's collections from config/collections, which no longer exists. Remove it from the plugins (and its import); keep `rebaseMcpViewPlugin`.",
            file: relativeToRoot(plan, viteFile)
        });
    }
    if (!guarded) {
        plan.manualSteps.push({
            title: "Add the backend guard to the Vite config",
            detail: "The frontend imports the tables in backend/ as types only; a value import would ship their server hooks, and every module and secret they reach, to every visitor. " +
                "`rebaseBackendGuard()` fails the build and the dev server when anything in the frontend resolves to a file under backend/, and `rebase build` refuses a frontend whose Vite config does not use it.",
            snippet: BACKEND_GUARD_SNIPPET,
            file: relativeToRoot(plan, viteFile)
        });
    }
}

/**
 * The other static apps `rebase.json` declares (a public site beside the
 * panel): `rebase build` refuses every one whose Vite config lacks
 * `rebaseBackendGuard()`, not only `frontend/`. Each without it is a manual
 * step — the codemod does not add a dependency on `@rebasepro/app` to an app
 * that may not have one.
 */
export function planStaticAppGuards(plan: PlanContext, frontendDir: string | undefined): void {
    // Read raw: a legacy rebase.json (a backend `config` key) does not validate against today's manifest.
    const read = readJson(path.join(plan.root, "rebase.json"));
    const apps = read && isObject(read.value.apps) ? Object.values(read.value.apps) : [];
    const roots = apps.flatMap(app => (isObject(app) && app.type === "static" && typeof app.root === "string" ? [path.resolve(plan.root, app.root)] : []));
    for (const root of new Set(roots)) {
        if (root === plan.root || (frontendDir && root === path.resolve(frontendDir))) continue;
        const viteFile = ["vite.config.ts", "vite.config.mts", "vite.config.js"].map(name => path.join(root, name)).find(file => fs.existsSync(file));
        if (!viteFile || /\brebaseBackendGuard\s*\(/.test(fs.readFileSync(viteFile, "utf8"))) continue;
        const pkgFile = path.join(root, "package.json");
        const hasApp = fs.existsSync(pkgFile) && fs.readFileSync(pkgFile, "utf8").includes('"@rebasepro/app"');
        plan.manualSteps.push({
            title: "Add the backend guard to the Vite config",
            detail: `${relativeToRoot(plan, root)}/ is a static app of rebase.json, and \`rebase build\` refuses a static app whose Vite config does not use \`rebaseBackendGuard()\`` +
                (hasApp ? "." : `. Add \`@rebasepro/app\` to its devDependencies (${relativeToRoot(plan, pkgFile)}) for \`@rebasepro/app/vitePlugin\`.`),
            snippet: BACKEND_GUARD_SNIPPET,
            file: relativeToRoot(plan, viteFile)
        });
    }
}

/** Files of `config/` nothing the codemod moved needs, which the user should look at before deleting the directory. */
export function unmovedConfigFiles(plan: PlanContext, configDir: string, handled: ReadonlySet<string>): string[] {
    const out: string[] = [];
    const skip = new Set(["node_modules", "dist", "generated"]);
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (handled.has(full)) continue;
            if (/\.d\.ts$/.test(entry.name) || entry.name === "package.json" || /^tsconfig.*\.json$/.test(entry.name)) continue;
            if (!/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) continue;
            out.push(relativeToRoot(plan, full));
        }
    };
    if (fs.existsSync(configDir)) walk(configDir);
    return out.sort();
}

/** Where a module that imported something from `config/` should import it from now. */
export interface ConfigImporter {
    file: string;
    line: number;
    /** As written: relative, or through a path alias (`@config/collections/posts`). */
    specifier: string;
    /** The same import written relative to the file (equal to `specifier` when it was). */
    relativeSpecifier: string;
    target: string;
}

const SOURCE_FILE = /\.(ts|tsx|mts|js|jsx|mjs)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"'\s]+)["']/g;

/**
 * Every module outside `config/` that imports something inside it — a custom
 * backend entry importing `config/collections/users`, a test importing a
 * collection — relative, or through a path alias the project's tsconfig
 * `paths` or Vite `resolve.alias` declares. After the migration those imports
 * point at nothing.
 *
 * @param skip files the run rewrites itself
 */
export function findConfigImporters(root: string, configDir: string, skip: ReadonlySet<string>, aliases: readonly PathAlias[] = []): ConfigImporter[] {
    return scanSources(root, configDir, skip, aliases).importers;
}

/** A use of a server API the table model renamed. */
export interface LegacyApiUse {
    file: string;
    line: number;
    /** The legacy name as written. */
    api: string;
    /** What it is now. */
    replacement: string;
}

/** Server APIs of the collection model, and what replaces each. */
const LEGACY_APIS: readonly { pattern: RegExp; api: string; replacement: string }[] = [
    { pattern: /\bsetCollectionCallbacks\s*\(/g, api: "setCollectionCallbacks", replacement: "`backend.setTableHooks(slug, hooks)` — table hooks get `table` for `collection`, and `values` for `row` in afterRead / beforeDelete / afterDelete" },
    { pattern: /\bcollectionRegistry\b/g, api: "collectionRegistry", replacement: "`backend.getTableDescriptor(slug)` / `backend.getTableDescriptors()` to read a table, and `backend.setTableHooks(slug, hooks)` to attach hooks" },
    { pattern: /\bcollectionsDir\s*:/g, api: "collectionsDir", replacement: "`schemaDir` (the directory whose index exports the tables) or `tables`" }
];

/** Every use of a renamed collection-model server API in the project's own code (outside `config/`). */
export function findLegacyApiUses(root: string, configDir: string, skip: ReadonlySet<string>, handled: ReadonlySet<string> = new Set()): LegacyApiUse[] {
    return scanSources(root, configDir, skip).apis.filter(use => !handled.has(use.api));
}

/**
 * The text with every comment blanked to spaces, newlines kept, so offsets
 * and line numbers still point into the original. Strings and template
 * literals are skipped over (a `//` inside a URL is not a comment). The
 * scaffold's example script ships its typed-SDK import commented out
 * (`// import type { Database } from "../config/database.types"`): read
 * as code, every such project got a manual step for a line that is not there.
 */
function blankComments(text: string): string {
    const out = text.split("");
    let index = 0;
    const blank = (from: number, to: number): void => {
        for (let at = from; at < to; at++) if (out[at] !== "\n") out[at] = " ";
    };
    while (index < text.length) {
        const char = text[index];
        const next = text[index + 1];
        if (char === "/" && next === "/") {
            const end = text.indexOf("\n", index);
            const stop = end === -1 ? text.length : end;
            blank(index, stop);
            index = stop;
        } else if (char === "/" && next === "*") {
            const end = text.indexOf("*/", index + 2);
            const stop = end === -1 ? text.length : end + 2;
            blank(index, stop);
            index = stop;
        } else if (char === "\"" || char === "'" || char === "`") {
            index++;
            while (index < text.length && text[index] !== char) {
                if (text[index] === "\\") index++;
                else if (char !== "`" && text[index] === "\n") break;
                index++;
            }
            index++;
        } else {
            index++;
        }
    }
    return out.join("");
}

function scanSources(root: string, configDir: string, skip: ReadonlySet<string>, aliases: readonly PathAlias[] = []): { importers: ConfigImporter[]; apis: LegacyApiUse[] } {
    const out: ConfigImporter[] = [];
    const apis: LegacyApiUse[] = [];
    const ignored = new Set(["node_modules", "dist", "build", ".git", "coverage", ".turbo", ".next"]);
    const inConfig = (file: string): boolean => {
        const relative = path.relative(configDir, file);
        return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    };
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!inConfig(full)) walk(full);
                continue;
            }
            if (!SOURCE_FILE.test(entry.name) || entry.name.endsWith(".d.ts") || skip.has(full)) continue;
            const text = blankComments(fs.readFileSync(full, "utf8"));
            for (const legacy of LEGACY_APIS) {
                for (const match of text.matchAll(legacy.pattern)) {
                    apis.push({ file: full, line: text.slice(0, match.index).split("\n").length, api: legacy.api, replacement: legacy.replacement });
                }
            }
            if (!text.includes("config") && !aliases.some(alias => text.includes(alias.prefix))) continue;
            for (const match of text.matchAll(SPECIFIER)) {
                const specifier = match[1];
                const relativeSpecifier = /^\.{1,2}\//.test(specifier) ? specifier : aliasToRelative(aliases, full, specifier);
                if (relativeSpecifier === undefined) continue;
                const target = path.resolve(path.dirname(full), relativeSpecifier);
                if (!inConfig(target)) continue;
                const line = text.slice(0, match.index).split("\n").length;
                out.push({ file: full, line, specifier, relativeSpecifier, target });
            }
        }
    };
    walk(root);
    return { importers: out, apis };
}

/**
 * The modules of `config/` that are the project's own: everything but what
 * Rebase read — `config/collections`, the wiring the run moves to `backend/`
 * (`resources.ts`, `storage.ts`, `generated/register.ts`), the package's index,
 * declarations and package files. 0.31 stops reading `config/collections`, not
 * `config/`: these stay where they are, importable as before.
 *
 * @param moved the wiring files the run moves, absolute
 */
export function keptConfigModules(plan: PlanContext, configDir: string, collectionsDir: string, moved: readonly string[]): string[] {
    const out: string[] = [];
    const skip = new Set(["node_modules", "dist", "generated"]);
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || skip.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (full !== collectionsDir) walk(full);
                continue;
            }
            if (moved.includes(full) || full === path.join(configDir, "index.ts") || full === path.join(configDir, "index.js")) continue;
            if (/\.d\.ts$/.test(entry.name) || entry.name === "package.json" || /^tsconfig.*\.json$/.test(entry.name)) continue;
            if (!/\.(ts|tsx|mts|js|mjs|json)$/.test(entry.name)) continue;
            out.push(relativeToRoot(plan, full));
        }
    };
    if (fs.existsSync(configDir)) walk(configDir);
    return out.sort();
}

/**
 * The kept modules of `config/` nothing will import once the run is written:
 * no file outside `config/` (read as the run leaves it), no kept module that is
 * itself imported, and not the kept `config/index.ts`. A module whose only
 * importers were the collections is dead weight once they are tables — it goes
 * in the printed `git rm` line instead of staying as "the project's own".
 *
 * @param kept the kept modules, absolute
 * @param removed files the run removes or moves (collections, moved wiring, a dropped index), absolute
 * @param indexKept whether `config/index.ts` stays (its imports are live: the package entry)
 */
export function unimportedConfigModules(
    plan: PlanContext,
    configDir: string,
    kept: readonly string[],
    removed: readonly string[],
    indexKept: boolean,
    aliases: readonly PathAlias[] = []
): string[] {
    const ignored = new Set(["node_modules", "dist", "build", ".git", "coverage", ".turbo", ".next"]);
    const gone = (file: string): boolean => removed.some(target => file === target || !path.relative(target, file).startsWith(".."));
    const inConfig = (file: string): boolean => !path.relative(configDir, file).startsWith("..");
    const configPackage = readJson(path.join(configDir, "package.json"));
    const packageName = configPackage && typeof configPackage.value.name === "string" ? configPackage.value.name : undefined;
    const files = new Set<string>();
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (gone(full)) continue;
            if (entry.isDirectory()) walk(full);
            else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) files.add(full);
        }
    };
    walk(plan.root);
    for (const file of plan.files.keys()) if (SOURCE_FILE.test(file) && !gone(file)) files.add(file);
    const indexFile = ["index.ts", "index.js"].map(name => path.join(configDir, name)).find(file => fs.existsSync(file));
    const targetsOf = (file: string): string[] => {
        const planned = plan.files.get(file);
        const text = blankComments(planned ? planned.content : fs.readFileSync(file, "utf8"));
        const out: string[] = [];
        for (const match of text.matchAll(SPECIFIER)) {
            const specifier = match[1];
            if (packageName && (specifier === packageName || specifier.startsWith(`${packageName}/`))) {
                const sub = specifier.slice(packageName.length + 1);
                if (sub) out.push(resolveRelative(path.join(configDir, "index.ts"), `./${sub}`).target);
                else if (indexFile) out.push(indexFile);
                continue;
            }
            const relative = /^\.{1,2}\//.test(specifier) ? specifier : aliasToRelative(aliases, file, specifier);
            if (relative !== undefined) out.push(resolveRelative(file, relative).target);
        }
        return out;
    };
    const used = new Set<string>();
    const queue: string[] = [];
    const reach = (target: string): void => {
        if (!kept.includes(target) || used.has(target)) return;
        used.add(target);
        queue.push(target);
    };
    for (const file of files) if (!inConfig(file)) targetsOf(file).forEach(reach);
    if (indexKept && indexFile) targetsOf(indexFile).forEach(reach);
    while (queue.length > 0) {
        const next = queue.pop();
        if (next !== undefined) targetsOf(next).forEach(reach);
    }
    return kept.filter(file => !used.has(file));
}

/** The names a module's text exports (`export { a, b as c }`, `export const x`); `export *` is not followed. */
export function exportedNamesOf(text: string): Set<string> {
    const out = new Set<string>();
    for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
        for (const part of match[1].split(",")) {
            const name = part.trim().split(/\s+as\s+/).pop()?.trim();
            if (name) out.add(name);
        }
    }
    for (const match of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) out.add(match[1]);
    if (/export\s+default\b/.test(text)) out.add("default");
    return out;
}

/**
 * The project's own code that still reads what the migration removes from
 * `config/` in a way no import rewrite can fix — each a manual step with
 * file:line, since the codemod cannot rewrite an assertion:
 *
 * - an import of a name `config/index.ts` no longer exports (`collections`,
 *   `storageAuthorize`, … — the re-exports of what Rebase read), relative, through
 *   a path alias, or by the config package's name;
 * - a file that reads `config/collections` as TEXT (`readFileSync`, `readdirSync`,
 *   a path built with `path.join(…, "config", "collections")`): a test asserting
 *   over the collection files' source, a script listing them.
 *
 * @param removedIndexNames what the index exported before the run and does not after
 *   (every export when the index goes)
 */
export function findLegacyConfigReads(
    plan: PlanContext,
    configDir: string,
    collectionsDir: string,
    removedIndexNames: ReadonlySet<string>,
    aliases: readonly PathAlias[] = []
): ManualStep[] {
    const steps: ManualStep[] = [];
    const ignored = new Set(["node_modules", "dist", "build", ".git", "coverage", ".turbo", ".next"]);
    const inConfig = (file: string): boolean => !path.relative(configDir, file).startsWith("..");
    const configPackage = readJson(path.join(configDir, "package.json"));
    const packageName = configPackage && typeof configPackage.value.name === "string" ? configPackage.value.name : undefined;
    const files = new Set<string>();
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!inConfig(full)) walk(full);
            } else if (SOURCE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")) {
                files.add(full);
            }
        }
    };
    walk(plan.root);
    for (const file of plan.files.keys()) if (SOURCE_FILE.test(file) && !inConfig(file)) files.add(file);
    const collectionsRelative = toPosix(path.relative(plan.root, collectionsDir));
    const segments = collectionsRelative.split("/").map(segment => `["'\`]${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`).join("\\s*,\\s*");
    const textRead = new RegExp(`["'\`][^"'\`\\n]*\\b${collectionsRelative.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b|${segments}`);
    for (const file of [...files].sort()) {
        const planned = plan.files.get(file);
        const text = blankComments(planned ? planned.content : fs.readFileSync(file, "utf8"));
        const relative = relativeToRoot(plan, file);
        const lineOf = (index: number | undefined): number => text.slice(0, index ?? 0).split("\n").length;
        // Imports of names the index lost.
        if (removedIndexNames.size > 0) {
            const lost: string[] = [];
            for (const match of text.matchAll(/import\s+(type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*))?\s*from\s*["']([^"']+)["']/g)) {
                const specifier = match[5];
                const isPackage = packageName !== undefined && specifier === packageName;
                const relativeSpecifier = /^\.{1,2}\//.test(specifier) ? specifier : aliasToRelative(aliases, file, specifier);
                const target = relativeSpecifier !== undefined ? resolveRelative(file, relativeSpecifier).target : undefined;
                const isIndex = isPackage || (target !== undefined && (target === configDir || (path.dirname(target) === configDir && /^index\.(tsx?|mts|jsx?|mjs)$/.test(path.basename(target)))));
                if (!isIndex) continue;
                const named = (match[3] ?? "").split(",").map(part => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim()).filter((name): name is string => Boolean(name));
                const names = named.filter(name => removedIndexNames.has(name));
                const namespace = match[4];
                if (namespace) for (const name of removedIndexNames) if (new RegExp(`\\b${namespace}\\.${name}\\b`).test(text)) names.push(`${namespace}.${name}`);
                if (names.length > 0) lost.push(`line ${lineOf(match.index)}: ${names.map(name => `\`${name}\``).join(", ")} from "${specifier}"`);
            }
            if (lost.length > 0) {
                steps.push({
                    title: `Replace what ${relative} imports from config/index.ts`,
                    detail: `${lost.join("; ")} — config/index.ts no longer exports ${lost.length > 1 ? "these" : "this"}: it re-exported what Rebase read (the collections, storageAuthorize), which is gone or moved. Read the tables from backend/schema (\`compileTables\` for their descriptors), presentation from frontend/src/cms, storageAuthorize from backend/storage. The codemod cannot rewrite what a test asserts about them.`,
                    file: relative
                });
            }
        }
        // Reads of config/collections as files.
        const lines: number[] = [];
        let offset = 0;
        for (const line of text.split("\n")) {
            if (textRead.test(line) && !/\bcollectionsDir\b/.test(line) && !/^\s*(import|export)\b|\bfrom\s*["']|\bimport\s*\(|\brequire\s*\(/.test(line)) lines.push(lineOf(offset));
            offset += line.length + 1;
        }
        if (lines.length > 0) {
            steps.push({
                title: `Stop reading ${collectionsRelative} in ${relative}`,
                detail: `Line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}: ${relative} reads ${collectionsRelative} as files (a path to it), which the migration removes. Point it at backend/schema (the tables) or frontend/src/cms (the customizations), or assert on the compiled tables instead of their source text. The codemod cannot rewrite an assertion.`,
                file: relative
            });
        }
    }
    return steps;
}

/** Where a relative specifier written in `fromFile` points, without its extension. */
function specifierStem(fromFile: string, specifier: string): string {
    return path.resolve(path.dirname(fromFile), specifier).replace(/\.(tsx?|mts|jsx?|mjs)$/, "").replace(/[\\/]index$/, "");
}

/**
 * `config/index.ts` without its re-exports of what Rebase read
 * (`export { collections } from "./collections"`, `export { storageAuthorize }
 * from "./storage"`), so the package keeps exporting the project's own modules.
 * Undefined when nothing but comments would be left: the index goes too.
 */
export function withoutRebaseReexports(ctx: AstContext, indexFile: string, collectionsDir: string, moved: readonly string[]): string | undefined {
    const text = fs.readFileSync(indexFile, "utf8");
    const sf = ctx.project.createSourceFile(`/__rebase_migrate__/config-index-${path.basename(indexFile)}`, text, { overwrite: true });
    try {
        const movedStems = moved.map(file => file.replace(/\.(tsx?|mts|jsx?|mjs)$/, ""));
        const isRebases = (specifier: string | undefined): boolean => {
            if (specifier === undefined || !specifier.startsWith(".")) return false;
            const stem = specifierStem(indexFile, specifier);
            const relative = path.relative(collectionsDir, stem);
            return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) || movedStems.includes(stem);
        };
        const drop = [...sf.getExportDeclarations(), ...sf.getImportDeclarations()].filter(declaration => isRebases(declaration.getModuleSpecifierValue()));
        if (drop.length === 0) return text;
        let out = text;
        for (const declaration of [...drop].sort((a, b) => b.getStart() - a.getStart())) {
            const end = out[declaration.getEnd()] === "\n" ? declaration.getEnd() + 1 : declaration.getEnd();
            out = out.slice(0, declaration.getFullStart() === 0 ? 0 : declaration.getStart()) + out.slice(end);
        }
        const remaining = ctx.project.createSourceFile(`/__rebase_migrate__/config-index-rest-${path.basename(indexFile)}`, out, { overwrite: true });
        const empty = remaining.getStatements().length === 0;
        ctx.project.removeSourceFile(remaining);
        return empty ? undefined : out;
    } finally {
        ctx.project.removeSourceFile(sf);
    }
}
