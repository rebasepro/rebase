/**
 * `rebase apps add admin [--path <path>]`: the admin panel, added to a project
 * that has none.
 *
 * A project scaffolded with `rebase init --headless`, or ported from elsewhere,
 * has a backend and no `frontend/`. Adding the admin by hand meant scaffolding a
 * second project and copying its `frontend/`, the workspace entries, the app in
 * `rebase.json` and the backend's build script across. This writes the same
 * thing `rebase init` without `--headless` would have, from the same templates:
 *
 * - `frontend/` — the template's, with the blank preset's `App.tsx`. The
 *   `users` customization comes with it only when the project declares the auth
 *   table in `backend/schema/users.ts` as the template does; it names that
 *   table's columns, and every other table is listed by the admin with no file.
 * - `rebase.json` — the template's admin app, at `--path` (default `/`, or
 *   `/admin` when another app is already at `/`), with this project's package
 *   manager in its build command.
 * - the workspace — `frontend` in `package.json` and `pnpm-workspace.yaml`.
 * - with tables in code (`backend/schema/index.ts`), the scripts and backend
 *   dependencies the full scaffold has over the headless one: the schema
 *   scripts, the backend build that generates the schema first, and the
 *   `ts-morph` the Studio's schema editor runs on.
 *
 * Every `@rebasepro/*` package is pinned to the version the project already
 * uses, not this CLI's, so one install never mixes two releases.
 *
 * Nothing is written until every check has passed, the frontend is assembled
 * in a staging directory and moved into place in one rename, and a failed
 * write puts back every file written before it.
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import {
    parseAppAddress,
    type RebaseAppConfig,
    type RebaseProjectManifest,
    type RebaseStaticAppConfig
} from "@rebasepro/types";
import { failAsJson, requireProjectRoot, type JsonFailureIssue } from "../utils/project";
import { detectPackageManager, getPMCommands, type PMCommands } from "../utils/package-manager";
import { cliVersion } from "../utils/version";
import { classifySpec, FRAMEWORK_SCOPE, PIN_FIELDS, type PinField } from "../upgrade";
import {
    cmsMountOf,
    DEFAULT_TABLES_DIR,
    findBackendApp,
    loadManifest,
    ManifestError,
    manifestExists,
    manifestPath,
    resolveBackendPaths,
    staticAppAddress,
    validateManifest,
    writeManifest
} from "../manifest";
import {
    applyPreset,
    copyTemplateTree,
    fillTemplatePlaceholders,
    TEMPLATE_PLACEHOLDER_FILES,
    templatesPath
} from "./init";

/** What `rebase apps add` can add. */
export const ADDABLE_APPS = ["admin"] as const;

/** Where the admin goes when the project root is already another app's. */
const ADMIN_FALLBACK_PATH = "/admin";

/** A refusal: the code is the `--json` envelope's, and nothing has been written. */
export class AppsAddRefusal extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly hint?: string,
        readonly issues?: JsonFailureIssue[]
    ) {
        super(message);
        this.name = "AppsAddRefusal";
    }
}

/** One file the addition rewrites, and what changes in it. */
interface FileEdit {
    /** Relative to the project root. */
    file: string;
    before: string;
    after: string;
    changes: string[];
}

/** Everything `rebase apps add admin` will do, decided before anything is written. */
export interface AdminAdditionPlan {
    projectRoot: string;
    appName: string;
    app: RebaseStaticAppConfig;
    manifest: RebaseProjectManifest;
    /** There was no `rebase.json`: the one written is inferred, with the admin added. */
    manifestCreated: boolean;
    projectName: string;
    /** The `@rebasepro/*` spec the admin's packages are pinned to. */
    version: string;
    /** Which declared package the version was read from, or null when it is this CLI's. */
    versionSource: string | null;
    /** Why the version is this CLI's, when the project names none to follow. */
    versionNote?: string;
    /** The table customizations written into `frontend/src/cms/`. */
    customizations: string[];
    tablesInCode: boolean;
    edits: FileEdit[];
    /** Scripts that differ from both scaffolds, left as the project wrote them. */
    kept: string[];
    pm: PMCommands;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The string-valued entries of a JSON object, or `{}` for anything else. */
function stringEntries(value: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (!isRecord(value)) return result;
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string") result[key] = entry;
    }
    return result;
}

function readJsonObject(file: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!isRecord(parsed)) throw new Error(`${file} does not hold a JSON object`);
    return parsed;
}

/** The indentation a JSON file uses, so a rewrite keeps it. */
function jsonIndent(text: string): string {
    return /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? "    ";
}

function serializeJson(value: Record<string, unknown>, original: string): string {
    return JSON.stringify(value, null, jsonIndent(original)) + (original.endsWith("\n") ? "\n" : "");
}

/** A workspace pattern as a directory: `./frontend/` is `frontend`. */
function normalWorkspace(pattern: string): string {
    return pattern.trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Whether a list of workspace patterns already takes in `dir`. */
function coversWorkspace(patterns: readonly string[], dir: string): boolean {
    return patterns.some(pattern => {
        const normal = normalWorkspace(pattern);
        return normal === dir || normal === "*" || normal === "**";
    });
}

/** `dir` in a workspace list, before `backend` as the scaffold orders them, or last. */
function withWorkspace(patterns: readonly string[], dir: string): string[] {
    const backend = patterns.findIndex(pattern => normalWorkspace(pattern) === "backend");
    const next = [...patterns];
    next.splice(backend === -1 ? next.length : backend, 0, dir);
    return next;
}

/**
 * `dir` added to `pnpm-workspace.yaml`'s `packages`, keeping every other line
 * as written. Returns the text unchanged when the list already takes it in, and
 * null when there is no list this can read.
 */
export function addPnpmWorkspacePackage(text: string, dir: string): string | null {
    const lines = text.split("\n");
    const header = lines.findIndex(line => /^packages:\s*(#.*)?$/.test(line.replace(/\r$/, "")));
    if (header === -1) {
        const flow = lines.findIndex(line => /^packages:\s*\[.*\]\s*(#.*)?$/.test(line.replace(/\r$/, "")));
        if (flow === -1) return null;
        const inner = /\[(.*)\]/.exec(lines[flow])![1];
        const items = inner.split(",").map(item => item.trim()).filter(Boolean);
        const unquoted = items.map(item => item.replace(/^["']|["']$/g, ""));
        if (coversWorkspace(unquoted, dir)) return text;
        const quote = items[0]?.startsWith("'") ? "'" : "\"";
        const backend = unquoted.findIndex(item => normalWorkspace(item) === "backend");
        items.splice(backend === -1 ? items.length : backend, 0, `${quote}${dir}${quote}`);
        lines[flow] = lines[flow].replace(/\[.*\]/, `[${items.join(", ")}]`);
        return lines.join("\n");
    }

    const items: Array<{ index: number; value: string; indent: string; quote: string }> = [];
    for (let i = header + 1; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, "");
        if (line.trim() === "" || /^\s+#/.test(line)) continue;
        const item = /^(\s+)-\s+(["']?)([^"'#]*?)\2\s*(#.*)?$/.exec(line);
        if (!item) break;
        items.push({ index: i, indent: item[1], quote: item[2], value: item[3] });
    }
    if (coversWorkspace(items.map(item => item.value), dir)) return text;

    const style = items[0] ?? { indent: "  ", quote: "\"" };
    const entry = `${style.indent}- ${style.quote}${dir}${style.quote}`;
    const backend = items.find(item => normalWorkspace(item.value) === "backend");
    const at = backend ? backend.index : (items.length > 0 ? items[items.length - 1].index + 1 : header + 1);
    lines.splice(at, 0, entry);
    return lines.join("\n");
}

/** The template's admin app: its name and its config in `templates/template/rebase.json`. */
function templateAdminApp(): { name: string; app: RebaseStaticAppConfig } {
    const { manifest, issues } = validateManifest(readJsonObject(templatesPath("template", "rebase.json")));
    const declared = manifest ? cmsMountOf(manifest) : undefined;
    if (!declared) {
        throw new Error(`The CLI's template rebase.json declares no admin app${issues.length > 0 ? `: ${issues[0].message}` : ""}.`);
    }
    return { name: declared.appName, app: declared.app };
}

/**
 * The `@rebasepro/*` version the project is on: the first plain version among
 * its declared framework packages, `@rebasepro/server` first. A project that
 * names none — or only links, workspace references or tags — gets this CLI's
 * version, with the reason.
 */
export function projectFrameworkVersion(projectRoot: string): { version: string; source: string | null; note?: string } {
    const found: Array<{ file: string; name: string; spec: string }> = [];
    for (const file of ["backend/package.json", "package.json"]) {
        const full = path.join(projectRoot, file);
        if (!fs.existsSync(full)) continue;
        let pkg: Record<string, unknown>;
        try {
            pkg = readJsonObject(full);
        } catch {
            continue;
        }
        for (const field of PIN_FIELDS) {
            for (const [name, spec] of Object.entries(stringEntries(pkg[field]))) {
                if (name.startsWith(FRAMEWORK_SCOPE)) found.push({ file, name, spec });
            }
        }
    }
    const ordered = [...found].sort((a, b) => Number(b.name === "@rebasepro/server") - Number(a.name === "@rebasepro/server"));
    const pinned = ordered.find(entry => classifySpec(entry.spec).kind === "movable");
    if (pinned) return { version: pinned.spec, source: `${pinned.name} in ${pinned.file}` };

    const version = cliVersion();
    if (version === "unknown") {
        throw new AppsAddRefusal(
            "There is no @rebasepro version to pin the admin's packages to.",
            "no_version",
            "The project pins no @rebasepro package to a version, and this CLI cannot read its own. Pin @rebasepro/server in backend/package.json, then run this again."
        );
    }
    const first = ordered[0];
    return {
        version,
        source: null,
        note: first
            ? `${first.name} is "${first.spec}" in ${first.file}, which names no release, so the admin's packages take this CLI's version`
            : "the project pins no @rebasepro package, so the admin's packages take this CLI's version"
    };
}

/** The scripts and dependencies the full scaffold's package.json has over the headless one's. */
interface ScaffoldDelta {
    scripts: Array<{ name: string; headless: string | undefined; full: string }>;
    dependencies: Array<{ field: PinField; name: string; spec: string }>;
}

function scaffoldDelta(full: Record<string, unknown>, headless: Record<string, unknown>): ScaffoldDelta {
    const fullScripts = stringEntries(full.scripts);
    const headlessScripts = stringEntries(headless.scripts);
    const scripts = Object.entries(fullScripts)
        .filter(([name, value]) => headlessScripts[name] !== value)
        .map(([name, value]) => ({ name, headless: headlessScripts[name], full: value }));

    const headlessDeps = new Set(PIN_FIELDS.flatMap(field => Object.keys(stringEntries(headless[field]))));
    const dependencies = PIN_FIELDS.flatMap(field =>
        Object.entries(stringEntries(full[field]))
            .filter(([name]) => !headlessDeps.has(name))
            .map(([name, spec]) => ({ field, name, spec })));
    return { scripts, dependencies };
}

/**
 * Bring a project's package.json to the full scaffold's: a script the project
 * lacks or still has as the headless scaffold wrote it becomes the full one; a
 * dependency it declares nowhere is added. A script the project changed is kept.
 */
function applyScaffoldDelta(
    pkg: Record<string, unknown>,
    delta: ScaffoldDelta,
    version: string,
    kept: string[],
    label: string
): string[] {
    const changes: string[] = [];
    if (delta.scripts.length > 0) {
        const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
        for (const script of delta.scripts) {
            const current = scripts[script.name];
            if (current === script.full) continue;
            if (current === undefined || current === script.headless) {
                scripts[script.name] = script.full;
                changes.push(`scripts.${script.name}`);
            } else {
                kept.push(`${label} scripts.${script.name} (the scaffold's: ${script.full})`);
            }
        }
        if (changes.length > 0) pkg.scripts = scripts;
    }

    const declared = new Set(PIN_FIELDS.flatMap(field => Object.keys(stringEntries(pkg[field]))));
    for (const dependency of delta.dependencies) {
        if (declared.has(dependency.name)) continue;
        const block = isRecord(pkg[dependency.field]) ? pkg[dependency.field] : {};
        if (!isRecord(block)) continue;
        block[dependency.name] = dependency.name.startsWith(FRAMEWORK_SCOPE) && dependency.spec.startsWith("workspace:")
            ? version
            : dependency.spec;
        pkg[dependency.field] = block;
        changes.push(`${dependency.field}.${dependency.name}`);
    }
    return changes;
}

/** Whether the project declares the auth table the template's `users` customization is written for. */
function declaresTemplateUsersTable(projectRoot: string, tablesDir: string): boolean {
    if (tablesDir !== DEFAULT_TABLES_DIR) return false;
    const usersFile = path.join(projectRoot, tablesDir, "users.ts");
    const indexFile = path.join(projectRoot, tablesDir, "index.ts");
    if (!fs.existsSync(usersFile) || !fs.existsSync(indexFile)) return false;
    return /export\s+const\s+users\s*=\s*defineAuthTable\s*\(/.test(fs.readFileSync(usersFile, "utf8"))
        && /export\s*\{[^}]*\busers\b[^}]*\}\s*from\s*["']\.\/users["']/.test(fs.readFileSync(indexFile, "utf8"));
}

/**
 * Decide everything `rebase apps add admin` will write, refusing — with
 * nothing written — when it cannot.
 */
export function planAdminAddition(projectRoot: string, requestedPath: string | undefined): AdminAdditionPlan {
    const template = templateAdminApp();
    const root = template.app.root;

    if (fs.existsSync(path.join(projectRoot, root))) {
        throw new AppsAddRefusal(
            `${root}/ already exists. rebase apps add admin writes a new ${root}/ and never merges into one.`,
            "frontend_exists",
            `If ${root}/ is an admin already, declare it under "apps" in rebase.json; otherwise move it aside and run this again.`
        );
    }

    let loaded: ReturnType<typeof loadManifest>;
    try {
        loaded = loadManifest(projectRoot);
    } catch (err) {
        if (!(err instanceof ManifestError)) throw err;
        throw new AppsAddRefusal(err.message, "manifest_invalid", "Fix rebase.json, then run this again.",
            err.issues.map(issue => ({ path: issue.path, message: issue.message })));
    }
    const manifest = loaded.manifest;

    if (manifest.apps[template.name]) {
        throw new AppsAddRefusal(
            `rebase.json already declares an app named "${template.name}".`,
            "admin_declared",
            "The admin is added once. Remove that app from rebase.json first if it is something else."
        );
    }
    const cms = cmsMountOf(manifest);
    if (cms) {
        throw new AppsAddRefusal(
            `App "${cms.appName}" already declares the CMS (cms: "${cms.path}"), and a project has one.`,
            "admin_declared"
        );
    }
    const sameRoot = Object.entries(manifest.apps)
        .find(([, app]) => app.type === "static" && normalWorkspace(app.root) === root);
    if (sameRoot) {
        throw new AppsAddRefusal(
            `App "${sameRoot[0]}" already builds from ${root}/.`,
            "admin_declared",
            `Remove it from rebase.json, or move its sources out of ${root}/, then run this again.`
        );
    }

    const rootTaken = Object.entries(manifest.apps).some(([name, app]) => {
        if (app.type !== "static") return false;
        const address = staticAppAddress(name, app);
        return !address.host && address.path === "/";
    });
    const appPath = requestedPath ?? (rootTaken ? ADMIN_FALLBACK_PATH : template.app.path ?? "/");
    const parsedPath = parseAppAddress(appPath);
    const pmName = detectPackageManager(projectRoot);
    const pm = getPMCommands(pmName);
    const app: RebaseStaticAppConfig = {
        ...template.app,
        build: pm.runWorkspace(root, "build").join(" "),
        path: appPath,
        cms: parsedPath.ok ? parsedPath.address.path : appPath
    };
    const apps: Record<string, RebaseAppConfig> = { ...manifest.apps, [template.name]: app };
    const next: RebaseProjectManifest = { ...manifest, apps };
    const { issues } = validateManifest(JSON.parse(JSON.stringify(next)));
    if (issues.length > 0) {
        const own = issues.some(issue => issue.path.startsWith(`apps.${template.name}.`));
        throw new AppsAddRefusal(
            own ? `The admin cannot be served at "${appPath}".` : "rebase.json would not be valid with the admin added.",
            own ? "invalid_path" : "manifest_invalid",
            own ? "Pass another --path, like --path /admin." : undefined,
            issues.map(issue => ({ path: issue.path, message: issue.message }))
        );
    }

    const packageFile = path.join(projectRoot, "package.json");
    if (!fs.existsSync(packageFile)) {
        throw new AppsAddRefusal(
            "There is no package.json at the project root to add the admin's workspace to.",
            "no_package_json",
            "The admin is a workspace beside backend/, as rebase init scaffolds it."
        );
    }
    const packageText = fs.readFileSync(packageFile, "utf8");
    let pkg: Record<string, unknown>;
    try {
        pkg = readJsonObject(packageFile);
    } catch (err) {
        throw new AppsAddRefusal(`package.json cannot be read: ${err instanceof Error ? err.message : String(err)}`, "package_json_invalid");
    }

    const { version, source: versionSource, note: versionNote } = projectFrameworkVersion(projectRoot);

    const backend = findBackendApp(manifest);
    const backendPaths = backend ? resolveBackendPaths(backend.app, projectRoot) : undefined;
    const tablesInCode = backendPaths?.hasTables ?? false;
    const customizations = backendPaths && tablesInCode && declaresTemplateUsersTable(projectRoot, backendPaths.tables)
        ? ["users"]
        : [];

    const edits: FileEdit[] = [];
    const kept: string[] = [];

    // package.json: the workspace, and with tables in code, the schema scripts.
    const rootChanges: string[] = [];
    const workspaces = pkg.workspaces;
    if (Array.isArray(workspaces)) {
        const patterns = workspaces.filter((entry): entry is string => typeof entry === "string");
        if (!coversWorkspace(patterns, root)) {
            pkg.workspaces = withWorkspace(patterns, root);
            rootChanges.push(`workspaces + ${root}`);
        }
    } else if (isRecord(workspaces) && Array.isArray(workspaces.packages)) {
        const patterns = workspaces.packages.filter((entry): entry is string => typeof entry === "string");
        if (!coversWorkspace(patterns, root)) {
            workspaces.packages = withWorkspace(patterns, root);
            rootChanges.push(`workspaces + ${root}`);
        }
    } else if (workspaces === undefined) {
        pkg.workspaces = fs.existsSync(path.join(projectRoot, "backend", "package.json")) ? [root, "backend"] : [root];
        rootChanges.push(`workspaces + ${root}`);
    } else {
        throw new AppsAddRefusal("package.json's \"workspaces\" is neither a list nor { packages: [...] }.", "package_json_invalid",
            `Add "${root}" to it by hand, or make it a list, then run this again.`);
    }
    if (tablesInCode) {
        const delta = scaffoldDelta(readJsonObject(templatesPath("template", "package.json")),
            readJsonObject(templatesPath("overlays", "baas", "package.json")));
        rootChanges.push(...applyScaffoldDelta(pkg, delta, version, kept, "package.json"));
    }
    if (rootChanges.length > 0) {
        edits.push({ file: "package.json", before: packageText, after: serializeJson(pkg, packageText), changes: rootChanges });
    }

    // backend/package.json: with tables in code, the build that generates the
    // schema first and the dependencies the Studio's schema editor needs.
    const backendPackageFile = path.join(projectRoot, "backend", "package.json");
    if (tablesInCode && fs.existsSync(backendPackageFile)) {
        const backendText = fs.readFileSync(backendPackageFile, "utf8");
        let backendPkg: Record<string, unknown>;
        try {
            backendPkg = readJsonObject(backendPackageFile);
        } catch (err) {
            throw new AppsAddRefusal(`backend/package.json cannot be read: ${err instanceof Error ? err.message : String(err)}`, "package_json_invalid");
        }
        const delta = scaffoldDelta(readJsonObject(templatesPath("template", "backend", "package.json")),
            readJsonObject(templatesPath("overlays", "baas", "backend", "package.json")));
        const changes = applyScaffoldDelta(backendPkg, delta, version, kept, "backend/package.json");
        if (changes.length > 0) {
            edits.push({ file: "backend/package.json", before: backendText, after: serializeJson(backendPkg, backendText), changes });
        }
    }

    // pnpm-workspace.yaml, when the project has one.
    const workspaceFile = path.join(projectRoot, "pnpm-workspace.yaml");
    if (fs.existsSync(workspaceFile)) {
        const workspaceText = fs.readFileSync(workspaceFile, "utf8");
        const updated = addPnpmWorkspacePackage(workspaceText, root);
        if (updated === null) {
            throw new AppsAddRefusal(
                "pnpm-workspace.yaml has no packages list this command can read.",
                "workspace_unreadable",
                `Add "${root}" under packages: by hand, then run this again.`
            );
        }
        if (updated !== workspaceText) {
            edits.push({ file: "pnpm-workspace.yaml", before: workspaceText, after: updated, changes: [`packages + ${root}`] });
        }
    }

    return {
        projectRoot,
        appName: template.name,
        app,
        manifest: next,
        manifestCreated: !manifestExists(projectRoot),
        projectName: typeof pkg.name === "string" && pkg.name ? pkg.name : path.basename(projectRoot),
        version,
        versionSource,
        ...(versionNote ? { versionNote } : {}),
        customizations,
        tablesInCode,
        edits,
        kept,
        pm
    };
}

/**
 * Assemble the admin's `frontend/` in `stagingDir` exactly as `rebase init`
 * does — the template's frontend, the blank preset over it, the placeholders
 * filled — then take out the customizations the project has no table for.
 */
async function stageFrontend(stagingDir: string, plan: AdminAdditionPlan): Promise<string> {
    const root = plan.app.root;
    await copyTemplateTree(templatesPath("template", root), path.join(stagingDir, root));
    const applied = await applyPreset(stagingDir, "blank");
    if (applied !== "blank") throw new Error("The CLI's blank preset is missing from its templates.");

    for (const file of TEMPLATE_PLACEHOLDER_FILES.filter(entry => entry.startsWith(`${root}/`))) {
        const full = path.join(stagingDir, file);
        if (!fs.existsSync(full)) continue;
        fs.writeFileSync(full, fillTemplatePlaceholders(fs.readFileSync(full, "utf8"), plan.projectName, plan.version), "utf8");
    }

    if (!plan.customizations.includes("users")) {
        fs.rmSync(path.join(stagingDir, root, "src", "cms", "users.tsx"), { force: true });
        const appFile = path.join(stagingDir, root, "src", "App.tsx");
        const source = fs.readFileSync(appFile, "utf8");
        const importLine = /^import \{ usersCms \} from "\.\/cms\/users";\r?\n/m;
        const list = "tableCustomizations={[usersCms]}";
        if (!importLine.test(source) || !source.includes(list)) {
            throw new Error("The blank preset's App.tsx no longer lists usersCms the way rebase apps add expects.");
        }
        fs.writeFileSync(appFile, source.replace(importLine, "").replace(list, "tableCustomizations={[]}"), "utf8");
    }
    return path.join(stagingDir, root);
}

/**
 * Write the plan: the staged frontend moved into place, then each file. A
 * failure puts every file back as it was and removes the frontend.
 */
export async function applyAdminAddition(plan: AdminAdditionPlan): Promise<void> {
    const { projectRoot } = plan;
    const target = path.join(projectRoot, plan.app.root);
    const staging = fs.mkdtempSync(path.join(projectRoot, ".rebase-apps-add-"));
    const touched: Array<{ file: string; before: string | null }> = [];
    let moved = false;
    try {
        const staged = await stageFrontend(staging, plan);
        fs.renameSync(staged, target);
        moved = true;
        for (const edit of plan.edits) {
            const file = path.join(projectRoot, edit.file);
            touched.push({ file, before: edit.before });
            fs.writeFileSync(file, edit.after, "utf8");
        }
        const manifestFile = manifestPath(projectRoot);
        touched.push({ file: manifestFile, before: fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, "utf8") : null });
        writeManifest(projectRoot, plan.manifest);
    } catch (err) {
        const unrestored: string[] = [];
        for (const { file, before } of touched.reverse()) {
            try {
                const now = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
                if (now === before) continue;
                if (before === null) fs.rmSync(file, { force: true });
                else fs.writeFileSync(file, before, "utf8");
            } catch {
                unrestored.push(path.relative(projectRoot, file));
            }
        }
        if (moved) fs.rmSync(target, { recursive: true, force: true });
        const reason = err instanceof Error ? err.message : String(err);
        throw new AppsAddRefusal(
            `Adding the admin failed, and nothing was kept: ${reason}`,
            "write_failed",
            unrestored.length > 0 ? `These could not be put back and may be changed: ${unrestored.join(", ")}.` : undefined
        );
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

/** The commands to run next, as the project's package manager spells them. */
function nextStepCommands(plan: AdminAdditionPlan): string[][] {
    let hasDevScript = false;
    try {
        hasDevScript = typeof stringEntries(readJsonObject(path.join(plan.projectRoot, "package.json")).scripts).dev === "string";
    } catch {
        hasDevScript = false;
    }
    return [plan.pm.install, hasDevScript ? plan.pm.run("dev") : plan.pm.exec("rebase", ["dev"])];
}

function printRefusal(refusal: AppsAddRefusal): never {
    console.error(chalk.red(`✗ ${refusal.message}`));
    for (const issue of refusal.issues ?? []) {
        console.error(chalk.red(`    ${issue.path ? `${issue.path}: ` : ""}${issue.message}`));
    }
    if (refusal.hint) console.error(chalk.dim(`  ${refusal.hint}`));
    process.exit(1);
}

/** `rebase apps add <kind>`. */
export async function addApp(kind: string | undefined, options: { path?: string; json: boolean }): Promise<void> {
    const { json } = options;
    const refuse = (refusal: AppsAddRefusal): never => json
        ? failAsJson(refusal.message, refusal.code, refusal.hint, refusal.issues)
        : printRefusal(refusal);

    if (kind !== "admin") {
        refuse(new AppsAddRefusal(
            kind === undefined
                ? "Which app? Usage: rebase apps add admin [--path <path>]"
                : `rebase apps add cannot add "${kind}". It adds: ${ADDABLE_APPS.join(", ")}.`,
            kind === undefined ? "app_kind_not_named" : "unknown_app_kind",
            "rebase apps add admin writes the admin panel rebase init scaffolds: frontend/, its workspace and its app in rebase.json."
        ));
    }

    const projectRoot = requireProjectRoot();
    let plan: AdminAdditionPlan;
    try {
        plan = planAdminAddition(projectRoot, options.path);
        await applyAdminAddition(plan);
    } catch (err) {
        if (err instanceof AppsAddRefusal) refuse(err);
        throw err;
    }

    const next = nextStepCommands(plan);
    const root = plan.app.root;
    const changed = [
        { file: `${root}/`, changes: [`rebase init's admin, @rebasepro/* at ${plan.version}`, ...plan.customizations.map(table => `src/cms/${table}.tsx`)] },
        { file: "rebase.json", changes: [`${plan.manifestCreated ? "created, " : ""}apps.${plan.appName} at ${plan.app.path}`] },
        ...plan.edits.map(edit => ({ file: edit.file, changes: edit.changes }))
    ];

    if (json) {
        console.log(JSON.stringify({
            app: plan.appName,
            root,
            path: plan.app.path,
            cms: plan.app.cms,
            build: plan.app.build,
            version: plan.version,
            versionSource: plan.versionSource,
            customizations: plan.customizations,
            changed,
            kept: plan.kept,
            nextSteps: next.map(command => command.join(" "))
        }, null, 2));
        return;
    }

    console.log(chalk.green(`✓ Added the admin panel: app "${plan.appName}" at ${plan.app.path}`));
    console.log("");
    const width = Math.max(...changed.map(entry => entry.file.length));
    for (const entry of changed) {
        console.log(`  ${chalk.cyan(entry.file.padEnd(width))}  ${chalk.dim(entry.changes.join("; "))}`);
    }
    console.log("");
    console.log(chalk.dim(plan.versionSource
        ? `@rebasepro/* pinned to ${plan.version}, as ${plan.versionSource}.`
        : `@rebasepro/* pinned to ${plan.version}: ${plan.versionNote ?? "this CLI's version"}.`));
    const own = cliVersion();
    if (plan.versionSource && own !== "unknown" && plan.version.replace(/^[\^~]/, "") !== own) {
        console.log(chalk.dim(`The files are this CLI's (${own}) template. If they do not build on ${plan.version}, \`rebase upgrade\` moves the project to one release.`));
    }
    for (const entry of plan.kept) {
        console.log(chalk.yellow(`• Kept your ${entry}.`));
    }
    if (plan.customizations.length === 0) {
        console.log(chalk.dim(`Every table the backend serves is listed in the admin with no file; customize one in ${root}/src/cms/<table>.tsx.`));
    }

    console.log("");
    console.log(chalk.bold("Next steps:"));
    console.log("");
    for (const command of next) console.log(`  ${chalk.cyan(command.join(" "))}`);
    console.log("");
    console.log(chalk.gray("  # Open the Admin URL dev prints. Sign in: the first account you register becomes the admin."));
    if (plan.app.path !== "/") {
        console.log(chalk.gray(`  # Built and deployed, the admin is served at ${plan.app.path}.`));
    }
}
