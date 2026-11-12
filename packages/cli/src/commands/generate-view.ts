/**
 * `rebase generate view <slug>` — scaffold a custom admin screen and register it.
 *
 * Most back-office screens are a table, a form or a board, and the admin draws
 * those from the table. The rest — a dispatch board, a reconciliation
 * screen, a record's audit trail — are a hundred lines of React. Written inside
 * the admin they inherit the sign-in, the security rules, the sidebar, the UI
 * kit and the data layer; written as a separate app they have to rebuild every
 * one of those. This command writes the first version of that file where the
 * admin will find it, so the screen starts native and registered.
 *
 * Two places, one file each:
 *
 * - **A screen** (default): `<frontend>/src/views/<Name>View.tsx`, listed in
 *   `<frontend>/src/views/index.ts` as an `AppView`, which `App.tsx` hands to
 *   `<RebaseCMS views>`. The first run wires `App.tsx`; later runs only append
 *   to the list.
 * - **A record tab** (`--collection <slug>`, the slug of a table in
 *   `backend/schema`): the same file location, with a component that takes
 *   `EntityCustomViewParams`, added to the `entityViews` of that table's
 *   `customizeTable(…)` in `<frontend>/src/cms/` — imported directly, because
 *   that directory is the admin's own code and the backend never reads it. A
 *   table with no customization yet gets one, `<frontend>/src/cms/<slug>.tsx`,
 *   listed in `cms/index.ts`'s `tableCustomizations` when there is one.
 *
 * The frontend is where `rebase.json` says the CMS is (the static app with a
 * `cms` mount), which is `frontend/` in everything `rebase init` writes. A
 * project with no admin panel (`rebase init --headless`) is refused: there is
 * nowhere for a view to render.
 *
 * Edits to existing files are textual and conservative. When `App.tsx` already
 * passes its own `views`, or a customization's shape is not one this can read, the
 * view file is still written and the command prints the one line to add by
 * hand instead of guessing.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

import { tableIdentifier } from "@rebasepro/common";
import { cmsMountOf, loadManifest } from "../manifest";
import { resolveSchemaDir } from "../utils/schema-dir";
import { declaredTables } from "../utils/schema-text";
import { requireProjectRoot } from "../utils/project";
import { parseCommandArgs, UsageError, wantsHelp } from "../utils/args";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** What `rebase generate` dispatches. Read by `cli.ts` to name the subcommand. */
export const GENERATE_SUBCOMMANDS = ["view"] as const;

const VIEW_FLAGS = {
    "--collection": String,
    "--name": String,
    "--icon": String,
    "--dry-run": Boolean,
    "--force": Boolean
} as const;

/** A slug is a URL segment and an entity view key: kebab-case, starting with a letter. */
const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Top-level paths the admin's own routes answer (`RebaseRouteDefs` in
 * `@rebasepro/cms`): `/c/*` the collections, `/s` Studio, `/settings`. They are
 * declared before custom views, so a screen at one of them was listed in the
 * sidebar and opened the built-in page instead.
 */
const RESERVED_SCREEN_SLUGS: readonly string[] = ["c", "s", "settings"];

export interface GenerateViewOptions {
    projectRoot: string;
    slug: string;
    /** Register as a tab on this table's records (its slug) instead of as a screen. */
    collection?: string;
    /** The label in the sidebar or on the tab. Defaults to the slug in sentence case. */
    name?: string;
    /** A Lucide icon name for the sidebar. Screens only. */
    icon?: string;
    /** Replace an existing view file. Registration is never duplicated. */
    force?: boolean;
}

export interface PlannedFile {
    /** Absolute path. */
    path: string;
    contents: string;
    action: "create" | "update" | "replace";
}

export interface GenerateViewPlan {
    kind: "app" | "entity";
    componentName: string;
    viewFile: string;
    files: PlannedFile[];
    /** Steps the command could not take itself, as sentences to print. */
    manualSteps: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Names
// ─────────────────────────────────────────────────────────────────────────────

/** `orders-board` → `OrdersBoardView`; `sales-view` → `SalesView`, not `SalesViewView`. */
export function viewComponentName(slug: string): string {
    const pascal = slug.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("");
    return pascal.endsWith("View") ? pascal : `${pascal}View`;
}

/** `orders-board` → `Orders board`: labels are sentence case in the admin. */
export function viewLabel(slug: string): string {
    const words = slug.split("-").join(" ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading source without a parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The source with every string, template literal, regular expression and
 * comment blanked out, character for character, so brackets and keys can be
 * found by position without being fooled by a `{` inside a string. String
 * contents become `_` (they are still "something"), comments become spaces.
 *
 * Exported for its tests.
 */
export function maskCode(source: string): string {
    const out = source.split("");
    let i = 0;
    const blank = (from: number, to: number, fill: string) => {
        for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = fill;
    };
    const previousSignificant = (at: number): string => {
        for (let k = at - 1; k >= 0; k--) {
            const ch = out[k];
            if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") return ch;
        }
        return "";
    };
    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];
        if (ch === "/" && next === "/") {
            const end = source.indexOf("\n", i);
            const stop = end === -1 ? source.length : end;
            blank(i, stop, " ");
            i = stop;
        } else if (ch === "/" && next === "*") {
            const end = source.indexOf("*/", i + 2);
            const stop = end === -1 ? source.length : end + 2;
            blank(i, stop, " ");
            i = stop;
        } else if (ch === "\"" || ch === "'" || ch === "`") {
            let k = i + 1;
            while (k < source.length && source[k] !== ch) {
                if (source[k] === "\\") k++;
                k++;
            }
            blank(i + 1, k, "_");
            i = k + 1;
        } else if (ch === "/" && (previousSignificant(i) === "" || "(,=:[!&|?{;".includes(previousSignificant(i)))) {
            // A regular expression literal: `/` where a value is expected. Not
            // after `}`, which in a .tsx file is far more often `{value}/>`.
            let k = i + 1;
            let inClass = false;
            while (k < source.length && source[k] !== "\n") {
                if (source[k] === "\\") k++;
                else if (source[k] === "[") inClass = true;
                else if (source[k] === "]") inClass = false;
                else if (source[k] === "/" && !inClass) break;
                k++;
            }
            blank(i + 1, k, "_");
            i = k + 1;
        } else {
            i++;
        }
    }
    return out.join("");
}

const CLOSERS: Record<string, string> = { "{": "}", "[": "]", "(": ")" };

/** The index of the bracket closing the one at `open`, in masked source. */
function matchClose(masked: string, open: number): number {
    const stack: string[] = [];
    for (let i = open; i < masked.length; i++) {
        const ch = masked[i];
        if (ch in CLOSERS) stack.push(CLOSERS[ch]);
        else if (ch === "}" || ch === "]" || ch === ")") {
            if (stack.pop() !== ch) return -1;
            if (stack.length === 0) return i;
        }
    }
    return -1;
}

/** The index of the innermost `{` still open at `at`, in masked source. */
function enclosingBrace(masked: string, at: number): number {
    const stack: number[] = [];
    for (let i = 0; i < at; i++) {
        const ch = masked[i];
        if (ch === "{" || ch === "[" || ch === "(") stack.push(i);
        else if (ch === "}" || ch === "]" || ch === ")") stack.pop();
    }
    for (let k = stack.length - 1; k >= 0; k--) {
        if (masked[stack[k]] === "{") return stack[k];
    }
    return -1;
}

/**
 * The position of `key:` as a direct property of the object whose `{` is at
 * `open`, followed by `opener` (`{` or `[`) — or -1.
 */
function directProperty(masked: string, open: number, key: string, opener: "{" | "["): { keyAt: number; valueOpen: number } | undefined {
    const close = matchClose(masked, open);
    if (close === -1) return undefined;
    const pattern = new RegExp(`(^|[\\s,{])${key}\\s*:\\s*\\${opener}`, "g");
    const body = masked.slice(open + 1, close);
    for (const match of body.matchAll(pattern)) {
        const keyAt = open + 1 + (match.index ?? 0) + match[1].length;
        if (enclosingBrace(masked, keyAt) !== open) continue;
        return { keyAt, valueOpen: open + 1 + (match.index ?? 0) + match[0].length - 1 };
    }
    return undefined;
}

function lineStart(source: string, at: number): number {
    return source.lastIndexOf("\n", at - 1) + 1;
}

function indentAt(source: string, at: number): string {
    const start = lineStart(source, at);
    return /^[ \t]*/.exec(source.slice(start))?.[0] ?? "";
}

/**
 * The indentation step a file uses: the smallest non-zero leading run of
 * spaces, not counting the ` * ` lines of a block comment.
 */
function indentUnit(source: string): string {
    if (/^\t/m.test(source)) return "\t";
    let unit = Infinity;
    for (const match of source.matchAll(/^( +)[^\s*]/gm)) unit = Math.min(unit, match[1].length);
    return " ".repeat(Number.isFinite(unit) ? unit : 4);
}

function reindent(block: string, indent: string): string {
    return block.split("\n").map(line => (line ? indent + line : line)).join("\n");
}

/**
 * Insert `element` (already indented one level past `indent`) as the last item
 * of the array whose `[` is at `open`.
 */
function appendToArray(source: string, masked: string, open: number, element: string): string {
    const close = matchClose(masked, open);
    const inner = masked.slice(open + 1, close);
    const indent = indentAt(source, open);
    if (inner.trim() === "") {
        return `${source.slice(0, open + 1)}\n${element}\n${indent}${source.slice(close)}`;
    }
    // After the last non-blank character of the content, keeping any comment
    // after it where it was.
    let last = close - 1;
    while (last > open && /\s/.test(masked[last])) last--;
    const hasTrailingComma = masked[last] === ",";
    const insertAt = last + 1;
    return `${source.slice(0, insertAt)}${hasTrailingComma ? "" : ","}\n${element}${source.slice(insertAt)}`;
}

/** Add an import line after the file's last import statement. */
function addImport(source: string, line: string): string {
    const masked = maskCode(source);
    let end = 0;
    for (const match of masked.matchAll(/^import\b[\s\S]*?["'][^"'\n]*["'];?[ \t]*$/gm)) {
        end = (match.index ?? 0) + match[0].length;
    }
    if (end === 0) return `${line}\n${source}`;
    return `${source.slice(0, end)}\n${line}${source.slice(end)}`;
}

/** A path import from `fromDir` to `toFile`, without extension, always starting with `.`. */
function relativeImport(fromDir: string, toFile: string): string {
    const relative = path.relative(fromDir, toFile).split(path.sep).join("/").replace(/\.tsx?$/, "");
    return relative.startsWith(".") ? relative : `./${relative}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Where things are
// ─────────────────────────────────────────────────────────────────────────────

/** The admin's frontend directory: the static app that mounts the CMS, or `frontend/`. */
export function resolveFrontendDir(projectRoot: string): string | undefined {
    try {
        const cms = cmsMountOf(loadManifest(projectRoot).manifest);
        if (cms) return path.join(projectRoot, cms.app.root);
    } catch {
        // A malformed rebase.json is reported by the commands that own it.
    }
    const fallback = path.join(projectRoot, "frontend");
    return fs.existsSync(path.join(fallback, "src")) ? fallback : undefined;
}

/** The tables directory, as the backend app declares it — one resolver for every command. */
export { resolveSchemaDir };

/** Every source file under the admin's `src/cms`, sorted: where table customizations live. */
function customizationFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const out: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== "node_modules") out.push(...customizationFiles(full));
        } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec|d)\.tsx?$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Every `customizeTable("<slug>", {` of a table, in code (not in a comment or
 * a string): the file, and where the options object opens. Empty when no file
 * under `cmsDir` customizes the table.
 */
function findCustomization(cmsDir: string, slug: string): { file: string; optionsOpen: number }[] {
    const found: { file: string; optionsOpen: number }[] = [];
    const call = /\bcustomizeTable\s*(?:<[^>]*>)?\(\s*(["'`])([^"'`\n]+)\1\s*,\s*\{/g;
    for (const file of customizationFiles(cmsDir)) {
        const source = fs.readFileSync(file, "utf8");
        const masked = maskCode(source);
        for (const match of source.matchAll(call)) {
            const at = match.index ?? 0;
            if (match[2] !== slug || masked[at] !== "c") continue;
            found.push({ file, optionsOpen: at + match[0].length - 1 });
        }
    }
    return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// The files
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The scaffolds live in `templates/views/` rather than in template literals
 * here: they import React and the admin packages, and this package's sources
 * must not name those, even inside a string (`pnpm check:types-headless`).
 */
function viewTemplate(name: string): string {
    const cliRoot = findCliRoot(__dirname);
    if (!cliRoot) throw new Error(`The CLI's templates/views folder is missing from ${__dirname}.`);
    return fs.readFileSync(path.join(cliRoot, "templates", "views", name), "utf8");
}

/** Walk up to the package root, which holds `templates/views`. */
function findCliRoot(from: string): string | null {
    const root = path.parse(from).root;
    let dir = from;
    while (dir && dir !== root) {
        if (fs.existsSync(path.join(dir, "templates", "views"))) return dir;
        dir = path.dirname(dir);
    }
    return null;
}

type ViewTemplateOptions = { slug: string; componentName: string; label: string; collection: string };

/** The `{ key, name, Builder }` an entity view is registered as, with `unit` indentation inside. */
function entityViewEntry(view: { key: string; name: string; componentName: string }, unit: string): string {
    return [
        "{",
        `${unit}key: ${JSON.stringify(view.key)},`,
        `${unit}name: ${JSON.stringify(view.name)},`,
        `${unit}Builder: ${view.componentName}`,
        "}"
    ].join("\n");
}

/**
 * A label as JSX text: written as is when it is plain, as a string expression
 * when it holds a character JSX reads — `{`, `}`, `<`, `>`, `&`. Pasted raw,
 * `--name "KPIs {beta}"` wrote `<Typography>KPIs {beta}</Typography>`, and the
 * view did not compile ("Cannot find name 'beta'").
 */
function jsxText(text: string): string {
    return /[{}<>&]/.test(text) ? `{${JSON.stringify(text)}}` : text;
}

/** A label inside the leading `/** … *\/` comment: one line, and no `*\/` to close it early. */
function commentText(text: string): string {
    return text.replace(/[\r\n]+/g, " ").replaceAll("*/", "*\\/");
}

function fillViewTemplate(template: string, options: ViewTemplateOptions): string {
    const { slug, componentName, label, collection } = options;
    return template
        .replaceAll("\"__COLLECTION__\"", JSON.stringify(collection))
        .replaceAll("__COLLECTION__", collection)
        .replaceAll("__COMPONENT__", componentName)
        .replaceAll("__label_jsx__", jsxText(label.toLowerCase()))
        .replaceAll("__LABEL_JSX__", jsxText(label))
        .replaceAll("__label__", commentText(label.toLowerCase()))
        .replaceAll("__LABEL__", commentText(label))
        .replaceAll("__SLUG__", slug);
}

export function appViewSource(options: ViewTemplateOptions): string {
    return fillViewTemplate(viewTemplate("AppView.tsx.tmpl"), options);
}

export function entityViewSource(options: ViewTemplateOptions): string {
    return fillViewTemplate(viewTemplate("EntityView.tsx.tmpl"), options);
}

function viewsIndexHeader(): string {
    return viewTemplate("index.ts.tmpl");
}

function appViewEntry(options: { slug: string; label: string; icon: string; componentName: string }, unit: string): string {
    return [
        "{",
        `${unit}slug: ${JSON.stringify(options.slug)},`,
        `${unit}name: ${JSON.stringify(options.label)},`,
        `${unit}icon: ${JSON.stringify(options.icon)},`,
        `${unit}view: ${options.componentName}`,
        "}"
    ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Planning
// ─────────────────────────────────────────────────────────────────────────────

function readIfExists(file: string): string | undefined {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

/**
 * The frontend's package.json gains `@rebasepro/cms-types` when it lacks it.
 *
 * The view files import their prop types from it, and under pnpm a package the
 * frontend does not declare does not resolve from the frontend — the frontend's
 * `tsc` would fail on the first generated view. The version is the one the
 * frontend already uses for `@rebasepro/cms`, so the two cannot drift.
 */
function planCmsTypesDependency(frontendDir: string, files: PlannedFile[], manualSteps: string[]): void {
    const manifestFile = path.join(frontendDir, "package.json");
    const raw = readIfExists(manifestFile);
    if (raw === undefined) return;
    let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
        manifest = JSON.parse(raw);
    } catch {
        return;
    }
    const declared = { ...manifest.devDependencies, ...manifest.dependencies };
    if (declared["@rebasepro/cms-types"]) return;
    const version = declared["@rebasepro/cms"] ?? declared["@rebasepro/app"];
    if (!version) return;
    const dependencies = { ...manifest.dependencies, "@rebasepro/cms-types": version };
    const sorted = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)));
    const indent = /^(\s+)"/m.exec(raw)?.[1] ?? "  ";
    files.push({
        path: manifestFile,
        contents: `${JSON.stringify({ ...manifest, dependencies: sorted }, null, indent)}\n`,
        action: "update"
    });
    manualSteps.push(`Run your package manager's install: ${path.basename(frontendDir)}/package.json now depends on @rebasepro/cms-types, which the view imports its types from.`);
}

function defaultCollectionFor(projectRoot: string): string {
    const slugs = declaredTables(resolveSchemaDir(projectRoot)).map(entry => entry.slug);
    return slugs.find(slug => slug !== "users") ?? slugs[0] ?? "users";
}

/**
 * Everything `rebase generate view` would write, without writing it.
 *
 * @throws UsageError when the slug is not a slug, there is no admin panel, the
 *   view already exists (without `force`), or `--collection` names nothing.
 */
export function planGenerateView(options: GenerateViewOptions): GenerateViewPlan {
    const { projectRoot, slug } = options;
    if (!SLUG_PATTERN.test(slug)) {
        throw new UsageError(
            `"${slug}" is not a view slug: use lowercase letters, digits and dashes, starting with a letter (e.g. orders-board).`
        );
    }
    if (!options.collection && RESERVED_SCREEN_SLUGS.includes(slug)) {
        throw new UsageError(
            `"${slug}" is reserved: the admin's own routes answer /${slug}, so a screen there would never show. ` +
            `Pick another slug (e.g. ${slug === "settings" ? "app-settings" : `${slug}-view`}).`
        );
    }
    const frontendDir = resolveFrontendDir(projectRoot);
    if (!frontendDir) {
        throw new UsageError(
            "This project has no admin panel to add a view to: rebase.json declares no app with a `cms` mount, and there is no frontend/src. " +
            "A project created with `rebase init --headless` has no admin."
        );
    }

    const componentName = viewComponentName(slug);
    const label = options.name?.trim() || viewLabel(slug);
    const viewsDir = path.join(frontendDir, "src", "views");
    const viewFile = path.join(viewsDir, `${componentName}.tsx`);
    const files: PlannedFile[] = [];
    const manualSteps: string[] = [];

    const viewExists = fs.existsSync(viewFile);
    if (viewExists && !options.force) {
        throw new UsageError(
            `${path.relative(projectRoot, viewFile)} already exists. Pass --force to replace it; its registration is kept.`
        );
    }
    const viewAction: PlannedFile["action"] = viewExists ? "replace" : "create";

    if (options.collection) {
        const kind = "entity" as const;
        const table = options.collection;
        const schemaDir = resolveSchemaDir(projectRoot);
        const declared = declaredTables(schemaDir);
        if (!declared.some(entry => entry.slug === table)) {
            const known = [...new Set(declared.map(entry => entry.slug))].sort();
            throw new UsageError(
                `No table with slug "${table}" under ${path.relative(projectRoot, schemaDir) || "."}.` +
                (known.length ? ` Declared: ${known.join(", ")}.` : "")
            );
        }
        const cmsDir = path.join(frontendDir, "src", "cms");
        const customizations = findCustomization(cmsDir, table);
        if (customizations.length > 1) {
            throw new UsageError(
                `More than one customizeTable("${table}", …) under ${path.relative(projectRoot, cmsDir)}: ` +
                `${[...new Set(customizations.map(entry => path.relative(projectRoot, entry.file)))].join(", ")}.`
            );
        }

        files.push({
            path: viewFile,
            contents: entityViewSource({ slug, componentName, label, collection: table }),
            action: viewAction
        });

        const view = { key: slug, name: label, componentName };
        if (customizations.length === 1) {
            const [{ file, optionsOpen }] = customizations;
            const importLine = `import { ${componentName} } from "${relativeImport(path.dirname(file), viewFile)}";`;
            const source = fs.readFileSync(file, "utf8");
            const updated = registerEntityView(source, optionsOpen, view);
            const where = path.relative(projectRoot, file);
            if (updated === "already") {
                // Registered on an earlier run: --force replaced the file only.
            } else if (updated === undefined) {
                manualSteps.push(
                    `Add this to the entityViews of customizeTable("${table}", …) in ${where}: ` +
                    `{ key: ${JSON.stringify(slug)}, name: ${JSON.stringify(label)}, Builder: ${componentName} }, and ${importLine}`
                );
            } else {
                files.push({ path: file, contents: addImport(updated, importLine), action: "update" });
            }
        } else {
            const identifier = `${tableIdentifier(table)}Cms`;
            const file = path.join(cmsDir, `${table}.tsx`);
            if (fs.existsSync(file)) {
                throw new UsageError(
                    `${path.relative(projectRoot, file)} exists but holds no customizeTable("${table}", …): ` +
                    "add the record tab to the table's customization by hand, or move that file aside."
                );
            }
            const unit = "    ";
            files.push({
                path: file,
                contents: [
                    "import { customizeTable } from \"@rebasepro/cms\";",
                    `import { ${componentName} } from "${relativeImport(cmsDir, viewFile)}";`,
                    "",
                    `export const ${identifier} = customizeTable("${table}", {`,
                    `${unit}entityViews: [`,
                    reindent(entityViewEntry(view, unit), unit + unit),
                    `${unit}]`,
                    "});",
                    ""
                ].join("\n"),
                action: "create"
            });
            // Handed to the admin where the project lists its customizations:
            // a `tableCustomizations` list exported by `cms/index.ts`, else
            // the one `App.tsx` passes to `<RebaseCMS>`.
            const indexFile = path.join(cmsDir, "index.ts");
            const appFile = path.join(frontendDir, "src", "App.tsx");
            const index = readIfExists(indexFile);
            const app = readIfExists(appFile);
            const listedInIndex = index === undefined ? undefined : listCustomization(index, identifier, `./${table}`);
            const listedInApp = listedInIndex === undefined && app !== undefined
                ? listCustomization(app, identifier, `./cms/${table}`)
                : undefined;
            if (listedInIndex !== undefined) {
                if (listedInIndex !== "already") files.push({ path: indexFile, contents: listedInIndex, action: "update" });
            } else if (listedInApp !== undefined) {
                if (listedInApp !== "already") files.push({ path: appFile, contents: listedInApp, action: "update" });
            } else {
                manualSteps.push(
                    `Hand the customization to the admin: import { ${identifier} } from "./cms/${table}" and add it to ` +
                    `<RebaseCMS tableCustomizations={[…]}> in ${path.relative(projectRoot, appFile)}.`
                );
            }
        }
        planCmsTypesDependency(frontendDir, files, manualSteps);
        return { kind, componentName, viewFile, files, manualSteps };
    }

    files.push({
        path: viewFile,
        contents: appViewSource({ slug, componentName, label, collection: defaultCollectionFor(projectRoot) }),
        action: viewAction
    });

    // The list of screens.
    const indexFile = path.join(viewsDir, "index.ts");
    const existingIndex = readIfExists(indexFile);
    const icon = options.icon ?? "LayoutDashboard";
    if (existingIndex === undefined) {
        const unit = "    ";
        files.push({
            path: indexFile,
            contents: `${viewsIndexHeader()}import { ${componentName} } from "./${componentName}";\n\n` +
                `export const views: AppView[] = [\n${reindent(appViewEntry({ slug, label, icon, componentName }, unit), unit)}\n];\n`,
            action: "create"
        });
    } else {
        const updated = registerAppView(existingIndex, { slug, label, icon, componentName });
        if (updated === undefined) {
            manualSteps.push(
                `Add { slug: ${JSON.stringify(slug)}, name: ${JSON.stringify(label)}, view: ${componentName} } to the views in ${path.relative(projectRoot, indexFile)}.`
            );
        } else if (updated !== "already") {
            files.push({ path: indexFile, contents: updated, action: "update" });
        }
    }

    // App.tsx hands the list to <RebaseCMS>, once.
    const appFile = path.join(frontendDir, "src", "App.tsx");
    const app = readIfExists(appFile);
    const wired = app === undefined ? undefined : wireViewsIntoApp(app);
    if (wired === undefined) {
        manualSteps.push(
            `Pass the screens to the admin: import { views } from "./views" and add views={views} to <RebaseCMS> in ${path.relative(projectRoot, appFile)}` +
            " (or spread ...views into the views it already passes)."
        );
    } else if (wired !== "already") {
        files.push({ path: appFile, contents: wired, action: "update" });
    }

    planCmsTypesDependency(frontendDir, files, manualSteps);
    return { kind: "app", componentName, viewFile, files, manualSteps };
}

/**
 * `views/index.ts` with one more entry, `"already"` when the slug is listed, or
 * `undefined` when the file has no `export const views … = [`.
 *
 * Exported for its tests.
 */
export function registerAppView(
    source: string,
    options: { slug: string; label: string; icon: string; componentName: string }
): string | "already" | undefined {
    const masked = maskCode(source);
    const declaration = /export\s+const\s+views\b[^=]*=\s*\[/.exec(masked);
    if (!declaration) return undefined;
    const open = declaration.index + declaration[0].length - 1;
    if (matchClose(masked, open) === -1) return undefined;
    const close = matchClose(masked, open);
    const listed = source.slice(open, close);
    if (new RegExp(`slug\\s*:\\s*["']${options.slug}["']`).test(listed)) return "already";

    const unit = indentUnit(source);
    const indent = indentAt(source, open) + unit;
    const element = reindent(appViewEntry(options, unit), indent);
    const appended = appendToArray(source, masked, open, element);
    return addImport(appended, `import { ${options.componentName} } from "./${options.componentName}";`);
}

/**
 * `App.tsx` with `views={views}` on `<RebaseCMS>` and its import, `"already"`
 * when it passes exactly that, or `undefined` when it cannot be done safely:
 * no `<RebaseCMS`, a `views` prop of its own, or a `views` name already in scope.
 *
 * Exported for its tests.
 */
export function wireViewsIntoApp(source: string): string | "already" | undefined {
    const masked = maskCode(source);
    const tag = /<RebaseCMS\b/.exec(masked);
    if (!tag) return undefined;
    const tagEnd = masked.indexOf(">", tag.index);
    if (tagEnd === -1) return undefined;
    const attributes = masked.slice(tag.index, tagEnd);
    const importsViews = /import\s*\{\s*views\s*\}\s*from\s*["']\.\/views(?:\/index)?["']/.test(source);
    if (/\sviews\s*=/.test(attributes)) {
        return importsViews && /\sviews\s*=\s*\{\s*views\s*\}/.test(attributes) ? "already" : undefined;
    }
    if (/\bviews\b/.test(masked)) return undefined;

    const insertAt = tag.index + "<RebaseCMS".length;
    const afterTag = source.slice(insertAt);
    const nextLine = /^[ \t]*\r?\n([ \t]*)\S/.exec(afterTag);
    const attribute = nextLine ? `\n${nextLine[1]}views={views}` : " views={views}";
    const withProp = source.slice(0, insertAt) + attribute + source.slice(insertAt);
    return addImport(withProp, "import { views } from \"./views\";");
}

/**
 * The customization file with a `{ key, name, Builder }` entry in the
 * `entityViews` of the `customizeTable(…)` options object whose `{` is at
 * `optionsOpen`; `"already"` when that key is there; `undefined` when the
 * shape cannot be read. The component's import is the caller's to add.
 *
 * Exported for its tests.
 */
export function registerEntityView(
    source: string,
    optionsOpen: number,
    view: { key: string; name: string; componentName: string }
): string | "already" | undefined {
    const masked = maskCode(source);
    const close = matchClose(masked, optionsOpen);
    if (close === -1) return undefined;
    const unit = indentUnit(source);
    const entry = entityViewEntry(view, unit);

    const entityViews = directProperty(masked, optionsOpen, "entityViews", "[");
    if (entityViews) {
        const listClose = matchClose(masked, entityViews.valueOpen);
        if (listClose === -1) return undefined;
        const listed = source.slice(entityViews.valueOpen, listClose);
        if (new RegExp(`key\\s*:\\s*["']${view.key}["']|["']${view.key}["']`).test(listed)) return "already";
        const indent = indentAt(source, entityViews.keyAt) + unit;
        return appendToArray(source, masked, entityViews.valueOpen, reindent(entry, indent));
    }

    // `entityViews` as the first property of the options.
    const indent = indentAt(source, optionsOpen) + unit;
    const block = `${indent}entityViews: [\n${reindent(entry, indent + unit)}\n${indent}]`;
    const empty = masked.slice(optionsOpen + 1, close).trim() === "";
    const insertAt = optionsOpen + 1;
    return empty
        ? `${source.slice(0, insertAt)}\n${block}\n${indentAt(source, optionsOpen)}${source.slice(close)}`
        : `${source.slice(0, insertAt)}\n${block},${source.slice(insertAt)}`;
}

/**
 * A source with `identifier` imported from `importPath` and appended to its
 * list of table customizations — `export const tableCustomizations = [ … ]`
 * (`cms/index.ts`) or `tableCustomizations={[ … ]}` on `<RebaseCMS>`
 * (`App.tsx`); `"already"` when it is listed; `undefined` when the source has
 * no such list.
 *
 * Exported for its tests.
 */
export function listCustomization(source: string, identifier: string, importPath: string): string | "already" | undefined {
    const masked = maskCode(source);
    const declaration = /export\s+const\s+tableCustomizations\b[^=]*=\s*\[/.exec(masked)
        ?? /\btableCustomizations\s*=\s*\{\s*\[/.exec(masked);
    if (!declaration) return undefined;
    const open = declaration.index + declaration[0].length - 1;
    const close = matchClose(masked, open);
    if (close === -1) return undefined;
    if (new RegExp(`\\b${identifier}\\b`).test(masked.slice(open, close))) return "already";
    const inner = masked.slice(open + 1, close);
    let appended: string;
    if (inner.trim() !== "" && !inner.includes("\n")) {
        // A list written on one line stays on one line.
        let last = close - 1;
        while (last > open && /\s/.test(masked[last])) last--;
        const comma = masked[last] === "," ? " " : ", ";
        appended = `${source.slice(0, last + 1)}${comma}${identifier}${source.slice(last + 1)}`;
    } else {
        const unit = indentUnit(source);
        appended = appendToArray(source, masked, open, `${indentAt(source, open)}${unit}${identifier}`);
    }
    return addImport(appended, `import { ${identifier} } from "${importPath}";`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The command
// ─────────────────────────────────────────────────────────────────────────────

function printHelp(): void {
    console.log(`
${chalk.bold("rebase generate")} — scaffold code into this project

${chalk.bold("Usage")}
  rebase generate view <slug>                     A screen of the admin, in the sidebar
  rebase generate view <slug> --collection <slug> A tab on every record of a table

${chalk.bold("What it writes")}
  <frontend>/src/views/<Name>View.tsx  The component, drawn with @rebasepro/ui
  <frontend>/src/views/index.ts        The screens list (AppView[]), wired into
                                       <RebaseCMS views> in App.tsx on first run
  With --collection, the table's customizeTable(…) in <frontend>/src/cms gains
  an entityViews entry with the component (a new <slug>.tsx when it has none).

${chalk.bold("Options")}
  --collection <slug>          Register as a record tab of the table with this slug
  --name <label>               Sidebar or tab label ${chalk.gray("(default: the slug in sentence case)")}
  --icon <Lucide name>         Sidebar icon for a screen ${chalk.gray("(default: LayoutDashboard)")}
  --dry-run                    List what would change, and change nothing
  --force                      Replace an existing view file
  -h, --help                   Show this help
`.trim());
}

export async function generateCommand(subcommand: string | undefined, rawArgs: string[] = []): Promise<void> {
    if (subcommand === undefined || subcommand === "--help" || (subcommand !== "view" && wantsHelp(rawArgs))) {
        printHelp();
        return;
    }
    switch (subcommand) {
        case "view":
            await generateViewCommand(rawArgs);
            return;
        default:
            throw new UsageError(`Unknown generate command "${subcommand}". Available: ${GENERATE_SUBCOMMANDS.join(", ")}. See \`rebase generate --help\`.`);
    }
}

async function generateViewCommand(rawArgs: string[]): Promise<void> {
    if (wantsHelp(rawArgs)) {
        printHelp();
        return;
    }
    const { flags, positionals } = parseCommandArgs({
        spec: VIEW_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "generate view",
        maxPositionals: 1
    });
    const slug = positionals[0];
    if (!slug) {
        throw new UsageError("Name the view: `rebase generate view <slug>`, e.g. `rebase generate view orders-board`.");
    }
    if (flags["--icon"] && flags["--collection"]) {
        throw new UsageError("--icon is for a screen in the sidebar; a record tab (--collection) has no icon here.");
    }

    const projectRoot = requireProjectRoot();
    const plan = planGenerateView({
        projectRoot,
        slug,
        collection: flags["--collection"],
        name: flags["--name"],
        icon: flags["--icon"],
        force: Boolean(flags["--force"])
    });
    const dryRun = Boolean(flags["--dry-run"]);

    for (const file of plan.files) {
        if (!dryRun) {
            fs.mkdirSync(path.dirname(file.path), { recursive: true });
            fs.writeFileSync(file.path, file.contents);
        }
        const verb = file.action === "create" ? "created" : file.action === "replace" ? "replaced" : "updated";
        console.log(`${chalk.green("✓")} ${dryRun ? `would be ${verb}` : verb}  ${path.relative(projectRoot, file.path)}`);
    }
    for (const step of plan.manualSteps) {
        console.log(`${chalk.yellow("!")} ${step}`);
    }
    const where = plan.kind === "app" ? `/${slug} in the admin` : `a "${flags["--name"]?.trim() || viewLabel(slug)}" tab on each ${flags["--collection"]} record`;
    console.log(chalk.gray(`  ${plan.componentName} renders at ${where}. Edit ${path.relative(projectRoot, plan.viewFile)} to build the screen.`));
}
