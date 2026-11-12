/**
 * `rebase verify`, step "CMS customizations": the project's
 * `customizeTable(...)` calls held to the tables they customize.
 *
 * The panel applies a customization at runtime and, for a slug or a field the
 * tables do not have, only warns in the browser console in development
 * (`applyTableCustomizations`). An agent that misspells a slug, keeps a field
 * after renaming its column, or hides a required column from the form ships a
 * panel that silently ignores the edit — or one that cannot create a record.
 * The post-edit hook runs `rebase verify` after edits under `frontend/src/cms`,
 * so this step is what answers for those files.
 *
 * **Read statically.** A customization module imports `@rebasepro/cms` (React,
 * the browser panel) and the project's own components, so it cannot be
 * imported in Node without the frontend's toolchain. The calls are read with
 * ts-morph instead: the slug, the keys of `fields`, and the literal values of
 * the form options of each field. What a static read cannot see — a slug or
 * options computed at runtime, a spread, a computed key, a `dynamicProps` /
 * `conditions` that hides a field on some records, a global `beforeSave` hook
 * in `backend/hooks.ts` that fills a column — is either reported as not read
 * (`cms-not-static`) or not judged; it is never reported as a problem.
 *
 * Checks (stable ids):
 *
 * - `cms-unknown-table` — `customizeTable("x")` for a slug no table declares.
 * - `cms-unknown-field` — a `fields` key that is neither a column key nor a
 *   relation of that table.
 * - `cms-hidden-required` — a field kept off the form (`hiddenInForm`,
 *   `readOnly`, `disabled`) whose column is `NOT NULL` with no default, that
 *   neither the database nor the server fills, and that the customization does
 *   not mark `filledByServer`: no record can be created from the panel. A
 *   warning instead of an error when the table declares a `beforeSave` hook
 *   (or the column a `beforeSave` transform), which may be what fills it.
 * - `cms-duplicate-customization` — two `customizeTable` calls for one slug.
 *   The panel refuses to mount with both.
 * - `cms-not-static` — a call this step could not read (warning).
 * - `cms-ui-config-not-mounted` — `src/cms/ui-config.json` exists, where the
 *   collection editor saves presentation in development, but no `<RebaseCMS>`
 *   in the frontend passes `uiConfig`: the editor's changes are lost on
 *   reload and never ship (warning). Said only when a `<RebaseCMS>` element
 *   was found and none of them passes `uiConfig` or spreads props into it.
 * - `cms-backend-guard-missing` — the project has `backend/` and a frontend
 *   whose Vite config does not use `rebaseBackendGuard()`: nothing refuses a
 *   value import of a table, which would ship its server hooks to every
 *   visitor (`utils/backend-guard.ts`). Quiet when the config imports a local
 *   module that may add it, and checked whether or not `src/cms` exists.
 */
import fs from "fs";
import path from "path";
import type { ColumnDescriptor, TableDescriptor } from "@rebasepro/types";
import type { Expression, Node, ObjectLiteralExpression, Project, SourceFile } from "ts-morph";
import { loadManifest } from "../manifest";
import { BACKEND_GUARD_FIX, backendGuardMissingMessage, backendGuardStates } from "../utils/backend-guard";

type TsMorph = typeof import("ts-morph");

/** The package `customizeTable` is imported from. */
const CMS_PACKAGE = "@rebasepro/cms";
const CUSTOMIZE = "customizeTable";
/** The panel's mount, and the file the collection editor writes presentation to in development. */
const MOUNT = "RebaseCMS";
const UI_CONFIG_FILE = "ui-config.json";
const SOURCE = /\.(ts|tsx|mts|js|jsx|mjs)$/;
const NOT_SOURCE = /\.(d|test|spec)\.[cm]?[jt]sx?$/;

/** The form options that keep a field from being edited on the form. */
const OFF_FORM_OPTIONS = ["hiddenInForm", "readOnly", "disabled"] as const;
type OffFormOption = typeof OFF_FORM_OPTIONS[number];

/** A finding of this step, in `rebase verify`'s finding shape (step `cms`). */
export interface CmsFinding {
    check: "cms-unknown-table" | "cms-unknown-field" | "cms-hidden-required" | "cms-duplicate-customization" | "cms-not-static" | "cms-ui-config-not-mounted" | "cms-backend-guard-missing";
    severity: "error" | "warning";
    message: string;
    fix?: string;
    table?: string;
    /** Relative to the project root. */
    file: string;
    line: number;
    /** `customizeTable("posts").fields.title`. */
    path?: string;
}

/** What the step read and found. */
export interface CmsCheckResult {
    /** The customization directories read, relative to the project root. Empty: nothing to check. */
    directories: string[];
    /** How many `customizeTable` calls were found. */
    customizations: number;
    findings: CmsFinding[];
}

/** One field of a customization, as far as a static read says. */
interface FieldRead {
    key: string;
    line: number;
    /** The off-form options written as `true` (an object for `disabled` counts). */
    offForm: OffFormOption[];
    /** `filledByServer` as written: true or false, `undefined` when not stated, `"unknown"` when not a literal. */
    filledByServer: boolean | undefined | "unknown";
    /** A spread in the field's options: what it carries is not known. */
    opaque: boolean;
}

/** One `customizeTable(...)` call, as far as a static read says. */
interface CustomizationRead {
    slug: string;
    file: string;
    line: number;
    fields: FieldRead[];
    /** What could not be read in it. */
    unread: string[];
}

/**
 * The directories that hold the project's table customizations: `src/cms` of
 * each static app `rebase.json` declares, and `frontend/src/cms`, the layout
 * `rebase init` writes. Only those that exist; none for a headless project.
 */
export function cmsDirectories(projectRoot: string): string[] {
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
        const dir = path.resolve(projectRoot, root, "src", "cms");
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && !out.includes(dir)) out.push(dir);
    }
    return out;
}

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (SOURCE.test(entry.name) && !NOT_SOURCE.test(entry.name)) out.push(full);
    }
    return out.sort();
}

// ─── The static read ──────────────────────────────────────────────────────────

class Reader {
    constructor(private readonly tsm: TsMorph) {}

    private unwrap(node: Node): Node {
        const N = this.tsm.Node;
        let current = node;
        while (N.isAsExpression(current) || N.isSatisfiesExpression(current) || N.isParenthesizedExpression(current) ||
            N.isNonNullExpression(current) || N.isTypeAssertion(current)) {
            current = current.getExpression();
        }
        return current;
    }

    /** The initializer of the top-level `const` an identifier names, in its own file. */
    private constOf(node: Node): Expression | undefined {
        const N = this.tsm.Node;
        if (!N.isIdentifier(node)) return undefined;
        const declaration = node.getSourceFile().getVariableDeclaration(node.getText());
        const statement = declaration?.getVariableStatement();
        if (!declaration || !statement || !N.isSourceFile(statement.getParent())) return undefined;
        if (statement.getDeclarationKind() !== this.tsm.VariableDeclarationKind.Const) return undefined;
        return declaration.getInitializer();
    }

    /** A string a node denotes: a literal, or a same-file `const` holding one. */
    string(node: Node | undefined, depth = 0): string | undefined {
        if (!node || depth > 4) return undefined;
        const N = this.tsm.Node;
        const current = this.unwrap(node);
        if (N.isStringLiteral(current) || N.isNoSubstitutionTemplateLiteral(current)) return current.getLiteralValue();
        const initializer = this.constOf(current);
        return initializer ? this.string(initializer, depth + 1) : undefined;
    }

    /** The object literal a node denotes: itself, or a same-file `const` holding one. */
    object(node: Node | undefined, depth = 0): ObjectLiteralExpression | undefined {
        if (!node || depth > 4) return undefined;
        const N = this.tsm.Node;
        const current = this.unwrap(node);
        if (N.isObjectLiteralExpression(current)) return current;
        const initializer = this.constOf(current);
        return initializer ? this.object(initializer, depth + 1) : undefined;
    }

    /** A property's name as written, or undefined for a computed one. */
    name(member: Node): string | undefined {
        const N = this.tsm.Node;
        if (!N.isPropertyAssignment(member) && !N.isShorthandPropertyAssignment(member) && !N.isMethodDeclaration(member)) return undefined;
        const nameNode = member.getNameNode();
        if (N.isIdentifier(nameNode)) return nameNode.getText();
        if (N.isStringLiteral(nameNode) || N.isNoSubstitutionTemplateLiteral(nameNode)) return nameNode.getLiteralValue();
        if (N.isNumericLiteral(nameNode)) return String(nameNode.getLiteralValue());
        if (N.isComputedPropertyName(nameNode)) return this.string(nameNode.getExpression());
        return undefined;
    }

    /** The value of a member: an assignment's initializer, a shorthand's identifier. */
    value(member: Node): Node | undefined {
        const N = this.tsm.Node;
        if (N.isPropertyAssignment(member)) return member.getInitializer();
        if (N.isShorthandPropertyAssignment(member)) return member.getNameNode();
        return undefined;
    }

    /** `true` / `false` as written, an object literal as `true` (for `disabled: { … }`), else unknown. */
    flag(node: Node | undefined, objectIsTrue: boolean): boolean | "unknown" {
        if (!node) return "unknown";
        const N = this.tsm.Node;
        const { SyntaxKind } = this.tsm;
        const current = this.unwrap(node);
        if (current.getKind() === SyntaxKind.TrueKeyword) return true;
        if (current.getKind() === SyntaxKind.FalseKeyword) return false;
        if (objectIsTrue && N.isObjectLiteralExpression(current)) return true;
        return "unknown";
    }

    /** The local names `customizeTable` is bound to, and namespaces of the CMS package. */
    private bindings(sf: SourceFile): { names: Set<string>; namespaces: Set<string> } {
        const names = new Set<string>();
        const namespaces = new Set<string>();
        for (const declaration of sf.getImportDeclarations()) {
            if (declaration.getModuleSpecifierValue() !== CMS_PACKAGE || declaration.isTypeOnly()) continue;
            const namespace = declaration.getNamespaceImport();
            if (namespace) namespaces.add(namespace.getText());
            for (const named of declaration.getNamedImports()) {
                if (named.getName() === CUSTOMIZE && !named.isTypeOnly()) names.add(named.getAliasNode()?.getText() ?? CUSTOMIZE);
            }
        }
        return { names, namespaces };
    }

    field(key: string, member: Node): FieldRead {
        const N = this.tsm.Node;
        const read: FieldRead = { key, line: member.getStartLineNumber(), offForm: [], filledByServer: undefined, opaque: false };
        const options = this.object(this.value(member));
        if (!options) {
            read.opaque = true;
            return read;
        }
        for (const property of options.getProperties()) {
            if (N.isSpreadAssignment(property)) {
                read.opaque = true;
                continue;
            }
            const name = this.name(property);
            if (name === undefined) {
                read.opaque = true;
                continue;
            }
            const value = this.value(property);
            if (name === "filledByServer") read.filledByServer = this.flag(value, false);
            const option = OFF_FORM_OPTIONS.find(candidate => candidate === name);
            if (option && this.flag(value, option === "disabled") === true) read.offForm.push(option);
        }
        return read;
    }

    /** Every `customizeTable(...)` call in a file, read as far as the source says. */
    customizations(sf: SourceFile, relativeFile: string): CustomizationRead[] {
        const N = this.tsm.Node;
        const { SyntaxKind } = this.tsm;
        const { names, namespaces } = this.bindings(sf);
        if (names.size === 0 && namespaces.size === 0) return [];
        const out: CustomizationRead[] = [];
        for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
            const callee = call.getExpression();
            const isCustomize = (N.isIdentifier(callee) && names.has(callee.getText())) ||
                (N.isPropertyAccessExpression(callee) && callee.getName() === CUSTOMIZE && namespaces.has(callee.getExpression().getText()));
            if (!isCustomize) continue;
            const [slugNode, optionsNode] = call.getArguments();
            const read: CustomizationRead = { slug: "", file: relativeFile, line: call.getStartLineNumber(), fields: [], unread: [] };
            const slug = this.string(slugNode);
            if (slug === undefined) {
                read.unread.push(`the slug \`${slugNode?.getText() ?? ""}\` is not a string literal or a \`const\` of one in this file`);
                out.push(read);
                continue;
            }
            read.slug = slug;
            const options = this.object(optionsNode);
            if (!options) {
                read.unread.push(`the options \`${optionsNode?.getText().split("\n")[0] ?? ""}\` are not an object literal or a \`const\` of one in this file`);
                out.push(read);
                continue;
            }
            let fieldsNode: Node | undefined;
            for (const property of options.getProperties()) {
                if (N.isSpreadAssignment(property)) {
                    read.unread.push(`\`...${property.getExpression().getText()}\` (line ${property.getStartLineNumber()}) may carry \`fields\``);
                    continue;
                }
                if (this.name(property) === "fields") fieldsNode = this.value(property);
            }
            if (fieldsNode) {
                const fields = this.object(fieldsNode);
                if (!fields) {
                    read.unread.push(`\`fields\` (line ${fieldsNode.getStartLineNumber()}) is not an object literal or a \`const\` of one in this file`);
                } else {
                    for (const member of fields.getProperties()) {
                        const key = this.name(member);
                        if (key === undefined) {
                            read.unread.push(`\`${member.getText().split("\n")[0]}\` (line ${member.getStartLineNumber()}) in \`fields\``);
                            continue;
                        }
                        read.fields.push(this.field(key, member));
                    }
                }
            }
            out.push(read);
        }
        return out;
    }
}

// ─── The checks ───────────────────────────────────────────────────────────────

/** Levenshtein distance, for "did you mean". */
function distance(a: string, b: string): number {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
}

function closest(name: string, candidates: Iterable<string>): string | undefined {
    let best: string | undefined;
    let bestDistance = Math.max(2, Math.floor(name.length / 3)) + 1;
    for (const candidate of candidates) {
        const d = distance(name, candidate);
        if (d < bestDistance) {
            best = candidate;
            bestDistance = d;
        }
    }
    return best;
}

const SERIAL_KINDS: ReadonlySet<string> = new Set(["smallserial", "serial", "bigserial"]);

/**
 * Whether a create may leave the column out and still succeed without the
 * server's help from a hook: it is nullable, has a default (literal, SQL,
 * random uuid, identity, the database's), is a serial, is generated, is
 * stamped or read-only (the server writes it), or is the tenant column (the
 * server fills it from the caller).
 */
function fillsItself(table: TableDescriptor, column: ColumnDescriptor): boolean {
    return column.nullable ||
        column.default !== undefined ||
        SERIAL_KINDS.has(column.type.kind) ||
        column.generated !== undefined ||
        column.stamp !== undefined ||
        column.readOnly === true ||
        table.tenant?.field === column.key;
}

/** The column a field key edits: the column itself, or the foreign key of a `belongsTo` relation. */
function columnOfField(table: TableDescriptor, key: string): ColumnDescriptor | undefined {
    return table.columns.find(column => column.key === key) ??
        table.columns.find(column => column.foreignKeyOf === key);
}

function describeOffForm(options: readonly OffFormOption[]): string {
    return options.map(option => `\`${option}\``).join(" and ");
}

function checkCustomization(read: CustomizationRead, table: TableDescriptor): CmsFinding[] {
    const findings: CmsFinding[] = [];
    const where = `customizeTable("${read.slug}")`;
    const columnKeys = new Set(table.columns.map(column => column.key));
    const relationNames = new Set(table.relations.map(relation => relation.name));
    for (const field of read.fields) {
        const at = { table: table.slug, file: read.file, line: field.line, path: `${where}.fields.${field.key}` };
        if (!columnKeys.has(field.key) && !relationNames.has(field.key)) {
            const bySqlName = table.columns.find(column => column.column === field.key);
            const guess = bySqlName?.key ?? closest(field.key, [...columnKeys, ...relationNames]);
            findings.push({
                check: "cms-unknown-field",
                severity: "error",
                ...at,
                message: `${where} customizes \`fields.${field.key}\`, which is neither a column nor a relation of the "${table.slug}" table` +
                    (bySqlName ? ` — that is the SQL name of the column whose key is \`${bySqlName.key}\`.` : "."),
                fix: guess
                    ? `Rename the key to \`${guess}\`${bySqlName ? " (fields are keyed by the column's key, as in `columns`)" : ""}, or remove it.`
                    : "Remove it, or key it by one of the table's columns or relations (`columns` / `relations` in its `defineTable`)."
            });
            continue;
        }
        if (field.offForm.length === 0 || field.filledByServer === true) continue;
        // A spread or a non-literal `filledByServer` may say it: not judged.
        if (field.opaque || field.filledByServer === "unknown") continue;
        const column = columnOfField(table, field.key);
        if (!column || fillsItself(table, column)) continue;
        const hooked = table.hooks?.beforeSave === true || column.transforms?.beforeSave === true;
        const what = column.key === field.key ? `the column \`${column.column}\`` : `its foreign key \`${column.column}\``;
        findings.push({
            check: "cms-hidden-required",
            severity: hooked ? "warning" : "error",
            ...at,
            message: `${where} keeps \`${field.key}\` off the form (${describeOffForm(field.offForm)}), but ${what} is NOT NULL with no default ` +
                (hooked
                    ? `and only the table's \`beforeSave\` hook could fill it: unless it does, creating a record from the panel fails.`
                    : `and nothing on the server fills it: creating a "${table.slug}" record from the panel always fails.`),
            fix: hooked
                ? `If the hook fills it on create, say so: \`${field.key}: { …, filledByServer: true }\`. Otherwise let the form edit it.`
                : `Let the form edit it (drop ${describeOffForm(field.offForm)}), give the column a default in its \`defineTable\` (\`.default(…)\`), ` +
                    `or fill it in a \`beforeSave\` hook and mark the field \`filledByServer: true\`.`
        });
    }
    return findings;
}

/**
 * Read every `customizeTable(...)` call under the project's customization
 * directories and hold it to `tables`. Never throws on a file it cannot parse
 * as intended: what it cannot read is a `cms-not-static` warning.
 */
export async function checkCmsCustomizations(projectRoot: string, tables: readonly TableDescriptor[]): Promise<CmsCheckResult> {
    const directories = cmsDirectories(projectRoot);
    const result: CmsCheckResult = { directories: directories.map(dir => path.relative(projectRoot, dir)), customizations: 0, findings: [] };
    result.findings.push(...await backendGuardFindings(projectRoot));
    if (directories.length === 0) return result;

    const tsm: TsMorph = await import("ts-morph");
    const project = new tsm.Project({
        useInMemoryFileSystem: true,
        skipAddingFilesFromTsConfig: true,
        compilerOptions: { allowJs: true, jsx: tsm.ts.JsxEmit.Preserve, noLib: true }
    });
    const reader = new Reader(tsm);
    const bySlug = new Map(tables.map(table => [table.slug, table]));
    const first = new Map<string, CustomizationRead>();

    for (const dir of directories) {
        for (const file of sourceFiles(dir)) {
            const text = fs.readFileSync(file, "utf-8");
            if (!text.includes(CUSTOMIZE)) continue;
            const relativeFile = path.relative(projectRoot, file);
            const sf = project.createSourceFile(file, text, { overwrite: true });
            for (const read of reader.customizations(sf, relativeFile)) {
                result.customizations++;
                const label = read.slug ? `customizeTable("${read.slug}")` : "customizeTable(…)";
                if (read.unread.length > 0) {
                    result.findings.push({
                        check: "cms-not-static",
                        severity: "warning",
                        file: read.file,
                        line: read.line,
                        ...(read.slug && { table: read.slug, path: label }),
                        message: `${label} was not fully checked: ${read.unread.join("; ")}. ` +
                            "`rebase verify` reads customizations without running them, so only literals in the call are checked.",
                        fix: "Write the slug and the `fields` object as literals in the call (a `const` in the same file also works), or ignore this warning."
                    });
                }
                if (!read.slug) continue;
                const earlier = first.get(read.slug);
                if (earlier) {
                    result.findings.push({
                        check: "cms-duplicate-customization",
                        severity: "error",
                        table: read.slug,
                        file: read.file,
                        line: read.line,
                        path: label,
                        message: `${label} is written twice: here and in ${earlier.file}:${earlier.line}. The panel refuses to start with both.`,
                        fix: "Merge them into one `customizeTable` call and remove the other."
                    });
                    continue;
                }
                first.set(read.slug, read);
                const table = bySlug.get(read.slug);
                if (!table) {
                    const guess = closest(read.slug, bySlug.keys());
                    result.findings.push({
                        check: "cms-unknown-table",
                        severity: "error",
                        table: read.slug,
                        file: read.file,
                        line: read.line,
                        path: label,
                        message: `${label} customizes "${read.slug}", which no table in the schema declares as its slug. The panel ignores it.`,
                        fix: guess
                            ? `Did you mean "${guess}"? The first argument is the table's slug (its \`defineTable\` name, unless it sets \`slug\`).`
                            : "Pass the slug of a table the schema index exports (its `defineTable` name, unless it sets `slug`), or remove the customization."
                    });
                    continue;
                }
                result.findings.push(...checkCustomization(read, table));
            }
            project.removeSourceFile(sf);
        }
        const unmounted = uiConfigNotMounted(tsm, project, projectRoot, dir);
        if (unmounted) result.findings.push(unmounted);
    }
    return result;
}

/**
 * The `cms-ui-config-not-mounted` finding for one customization directory, or
 * nothing. Undecided — no `<RebaseCMS>` element found under `src/` (mounted
 * through a wrapper, rendered without JSX) — is nothing, not a warning.
 */
function uiConfigNotMounted(tsm: TsMorph, project: Project, projectRoot: string, cmsDir: string): CmsFinding | undefined {
    const uiConfig = path.join(cmsDir, UI_CONFIG_FILE);
    if (!fs.existsSync(uiConfig)) return undefined;
    const N = tsm.Node;
    const { SyntaxKind } = tsm;
    const mounts: { file: string; line: number; passes: boolean }[] = [];
    for (const file of sourceFiles(path.dirname(cmsDir))) {
        const text = fs.readFileSync(file, "utf-8");
        if (!text.includes(MOUNT)) continue;
        const sf = project.createSourceFile(file, text, { overwrite: true });
        const names = new Set<string>();
        for (const declaration of sf.getImportDeclarations()) {
            if (declaration.getModuleSpecifierValue() !== CMS_PACKAGE) continue;
            for (const named of declaration.getNamedImports()) {
                if (named.getName() === MOUNT) names.add(named.getAliasNode()?.getText() ?? MOUNT);
            }
        }
        const elements = [
            ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
            ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
        ];
        for (const element of elements) {
            if (!names.has(element.getTagNameNode().getText())) continue;
            const passes = element.getAttributes().some(attribute =>
                N.isJsxSpreadAttribute(attribute) || attribute.getNameNode().getText() === "uiConfig");
            mounts.push({ file: path.relative(projectRoot, file), line: element.getStartLineNumber(), passes });
        }
        project.removeSourceFile(sf);
    }
    if (mounts.length === 0 || mounts.some(mount => mount.passes)) return undefined;
    const [first] = mounts;
    return {
        check: "cms-ui-config-not-mounted",
        severity: "warning",
        file: first.file,
        line: first.line,
        message: `${path.relative(projectRoot, uiConfig)} holds what the collection editor saves in development, but \`<RebaseCMS>\` is not given it: ` +
            "presentation edited in the editor is gone after a reload and never ships.",
        fix: `Import it and pass it: \`import uiConfig from "./cms/${UI_CONFIG_FILE}";\` and \`<RebaseCMS … uiConfig={uiConfig} />\` ` +
            "(the frontend's tsconfig needs `resolveJsonModule`)."
    };
}

/**
 * `cms-backend-guard-missing`, one per frontend whose Vite config does not use
 * the guard. Nothing for a frontend the static read cannot decide.
 */
async function backendGuardFindings(projectRoot: string): Promise<CmsFinding[]> {
    return (await backendGuardStates(projectRoot))
        .filter(state => state.state === "missing")
        .map(state => ({
            check: "cms-backend-guard-missing",
            severity: "error",
            file: state.viteConfig,
            line: state.line,
            message: backendGuardMissingMessage(state),
            fix: BACKEND_GUARD_FIX
        }));
}
