/**
 * Everything around the collections: `rebase.json`, the workspace, the
 * packages and tsconfigs that named the config package, the other modules of
 * `config/` (resources, storage access, the generated registration), and the
 * frontend's wiring.
 *
 * Arbitrary code is never rewritten. A file in the scaffold's known shape —
 * the `App.tsx`, `vite.config.ts` and `virtual.d.ts` `rebase init` writes — is
 * rewritten exactly; anything else is reported as a manual step with the
 * snippet to apply.
 */
import fs from "node:fs";
import path from "node:path";

import type { PlanContext } from "./plan-context";
import { planFile, relativeToRoot } from "./plan-context";

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
export function planWorkspace(plan: PlanContext, configDir: string, frontendRoot: string | undefined): void {
    const root = plan.root;
    const configRelative = relativeToRoot(plan, configDir);
    const packageName = configPackageName(configDir);

    const rootPackage = readJson(path.join(root, "package.json"));
    if (rootPackage) {
        const value = { ...rootPackage.value };
        let changed = false;
        if (Array.isArray(value.workspaces)) {
            const kept = value.workspaces.filter(entry => entry !== configRelative && entry !== `./${configRelative}`);
            if (kept.length !== value.workspaces.length) {
                value.workspaces = kept;
                changed = true;
            }
        }
        if (isObject(value.scripts)) {
            const scripts: JsonObject = {};
            for (const [name, script] of Object.entries(value.scripts)) {
                const next = typeof script === "string" ? withoutConfigFilter(script.replace(COLLECTIONS_FLAG, ""), configRelative) : script;
                if (next !== script) changed = true;
                scripts[name] = next;
            }
            value.scripts = scripts;
        }
        if (changed) planFile(plan, path.join(root, "package.json"), writeJson(rootPackage.text, value), "package.json (workspaces, scripts)");
    }

    const workspaceFile = path.join(root, "pnpm-workspace.yaml");
    if (fs.existsSync(workspaceFile)) {
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
            if (!isObject(deps) || packageName === undefined || !(packageName in deps)) continue;
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
                    next = script.replace(COLLECTIONS_FLAG, "").replace(/\s+--watch=\.\.\/config\/\S*/g, "");
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

/** backend/tsconfig.json: `../config/**` out of `include`, the new modules in. */
export function planBackendTsconfig(plan: PlanContext, wanted: readonly string[]): void {
    const file = path.join(plan.root, "backend", "tsconfig.json");
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, "utf8");
    const match = /"include"\s*:\s*\[([^\]]*)\]/.exec(text);
    if (!match) return;
    const entries = [...match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(found => found[1]);
    const kept = entries.filter(entry => !entry.startsWith("../config"));
    if (kept.length === entries.length) return;
    const covers = (pattern: string): boolean => kept.includes(pattern) || kept.includes("**/*") || kept.includes("**/*.ts");
    const next = [...kept, ...wanted.filter(entry => !covers(entry))];
    const replaced = `${text.slice(0, match.index)}"include": [${next.map(entry => JSON.stringify(entry)).join(", ")}]${text.slice(match.index + match[0].length)}`;
    planFile(plan, file, replaced, "backend/tsconfig.json");
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

/** The frontend's wiring: `App.tsx`, `vite.config.ts`, `virtual.d.ts`. */
export function planFrontendWiring(plan: PlanContext, frontendDir: string, hasExternal: boolean): void {
    const names = hasExternal ? "tableCustomizations, externalCollections" : "tableCustomizations";
    const appFile = path.join(frontendDir, "src", "App.tsx");
    const importLine = `import { ${names} } from "./cms";`;
    const props = hasExternal ? ["tableCustomizations={tableCustomizations}", "externalCollections={externalCollections}"] : ["tableCustomizations={tableCustomizations}"];
    if (fs.existsSync(appFile)) {
        const text = fs.readFileSync(appFile, "utf8");
        const importCount = text.split(SCAFFOLD_COLLECTIONS_IMPORT).length - 1;
        const propCount = text.split(SCAFFOLD_COLLECTIONS_PROP).length - 1;
        if (importCount === 1 && propCount === 1 && !/\bcollections\b/.test(text.replace(SCAFFOLD_COLLECTIONS_IMPORT, "").replace(SCAFFOLD_COLLECTIONS_PROP, ""))) {
            const propLine = text.split("\n").find(line => line.includes(SCAFFOLD_COLLECTIONS_PROP)) ?? "";
            const indent = /^[ \t]*/.exec(propLine)?.[0] ?? "";
            const next = text
                .replace(SCAFFOLD_COLLECTIONS_IMPORT, importLine)
                .replace(SCAFFOLD_COLLECTIONS_PROP, props.join(`\n${indent}`));
            planFile(plan, appFile, next, "App.tsx (mount the customizations)");
        } else if (text.includes("virtual:rebase-collections") || /<RebaseCMS[\s\S]*?collections=/.test(text)) {
            plan.manualSteps.push({
                title: "Mount the table customizations",
                detail: "The admin panel no longer takes `collections`: it projects every table from the backend and layers the customizations over it. Replace the `virtual:rebase-collections` import and the `collections` prop of `<RebaseCMS>`.",
                snippet: `${importLine}\n\n<RebaseCMS\n    ${props.join("\n    ")}\n    {/* …the other props you pass */}\n/>`,
                file: relativeToRoot(plan, appFile)
            });
        }
    }

    const viteFile = ["vite.config.ts", "vite.config.mts", "vite.config.js"].map(name => path.join(frontendDir, name)).find(candidate => fs.existsSync(candidate));
    if (viteFile) {
        const text = fs.readFileSync(viteFile, "utf8");
        const pluginLine = /^[ \t]*rebaseCollectionsPlugin\(\{\s*collectionsDir:\s*["'][^"']*["']\s*\}\),?[ \t]*\r?\n/m;
        if (pluginLine.test(text) && (text.match(/rebaseCollectionsPlugin/g) ?? []).length === 2) {
            const next = text
                .replace(pluginLine, "")
                .replace(/(import\s*\{[^}]*?)\brebaseCollectionsPlugin\s*,\s*/, "$1")
                .replace(/(import\s*\{[^}]*?),\s*rebaseCollectionsPlugin\b/, "$1");
            planFile(plan, viteFile, next, "vite config (drop the collections plugin)");
        } else if (text.includes("rebaseCollectionsPlugin")) {
            plan.manualSteps.push({
                title: "Remove the collections Vite plugin",
                detail: "`rebaseCollectionsPlugin` built the panel's collections from config/collections, which no longer exists. Remove it from the plugins (and its import); keep `rebaseMcpViewPlugin`.",
                file: relativeToRoot(plan, viteFile)
            });
        }
    }

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
    specifier: string;
    target: string;
}

const SOURCE_FILE = /\.(ts|tsx|mts|js|jsx|mjs)$/;
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']*)["']/g;

/**
 * Every module outside `config/` that imports something inside it — a custom
 * backend entry importing `config/collections/users`, a test importing a
 * collection. After the migration those imports point at nothing.
 *
 * @param skip files the run rewrites itself
 */
export function findConfigImporters(root: string, configDir: string, skip: ReadonlySet<string>): ConfigImporter[] {
    return scanSources(root, configDir, skip).importers;
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
export function findLegacyApiUses(root: string, configDir: string, skip: ReadonlySet<string>): LegacyApiUse[] {
    return scanSources(root, configDir, skip).apis;
}

function scanSources(root: string, configDir: string, skip: ReadonlySet<string>): { importers: ConfigImporter[]; apis: LegacyApiUse[] } {
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
            const text = fs.readFileSync(full, "utf8");
            for (const legacy of LEGACY_APIS) {
                for (const match of text.matchAll(legacy.pattern)) {
                    apis.push({ file: full, line: text.slice(0, match.index).split("\n").length, api: legacy.api, replacement: legacy.replacement });
                }
            }
            if (!text.includes("config")) continue;
            for (const match of text.matchAll(SPECIFIER)) {
                const specifier = match[1];
                const target = path.resolve(path.dirname(full), specifier);
                if (!inConfig(target)) continue;
                const line = text.slice(0, match.index).split("\n").length;
                out.push({ file: full, line, specifier, target });
            }
        }
    };
    walk(root);
    return { importers: out, apis };
}
