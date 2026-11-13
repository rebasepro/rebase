/**
 * The Drizzle-alignment sweep: rewrites every retired `col.*` spelling to the
 * canonical, Drizzle-style one.
 *
 * Contract: `tooling/scripts/drizzle-alignment-renames.json` lists the 20
 * retired spellings and what each becomes. The printers (`rebase migrate
 * collections-to-tables`, `rebase schema introspect`, the Studio schema editor)
 * already write the canonical spelling; this converts what people wrote by hand.
 *
 *   col.varchar(160)                    → col.varchar({ length: 160 })
 *   col.timestamptz().defaultSql("now()") → col.timestamp({ withTimezone: true }).defaultNow()
 *   col.array(col.text()).notNull()     → col.text().array().notNull()
 *   col.enum(["a", "b"], { name: "s" }) → const sEnum = pgEnum("s", ["a", "b"]); … sEnum()
 *   col.text().column("legacy")         → col.text("legacy")
 *   …
 *
 * Only the builder chains are rewritten: comments and formatting outside them
 * are kept. The tool is idempotent (a converted file converts to itself), skips
 * a file with uncommitted changes (someone else may be editing it; pass
 * `--include-dirty` to convert it anyway) and reports what it could not
 * convert, with the line and the reason, instead of guessing.
 *
 * Run (from the repository, so `@rebasepro/*` resolves to source for --verify):
 *
 *   TSX_TSCONFIG_PATH=tsconfig.typecheck.json node --import tsx \
 *     tooling/scripts/drizzle-sweep.mts [options] <file or dir>...
 *
 * In a project of your own: `npx tsx drizzle-sweep.mts backend/schema`.
 *
 * Options:
 *   --dry-run         report, write nothing
 *   --verify          prove each rewrite means the same: every rewritten chain is
 *                     evaluated before and after and the column definitions
 *                     compared; every converted module that exports tables is
 *                     compiled from its git pre-image and from the new text and
 *                     the descriptors compared. A difference is a failure (exit 1).
 *   --md              also convert ```ts / ```tsx fences in .md / .mdx files
 *   --include-dirty   convert files with uncommitted changes too
 *   --exclude <part>  skip paths containing <part> (repeatable)
 *   --json <file>     write the report as JSON
 *
 * Exit code: 0 clean, 1 a --verify difference, 2 usage error.
 */
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "ts-morph";

// ─── Transformer ─────────────────────────────────────────────────────────

/** Something the transformer saw and left alone, with why. */
export interface SweepProblem {
    line: number;
    reason: string;
}

/** One rewritten chain, for --verify: both texts must build the same column. */
export interface ChainRewrite {
    line: number;
    before: string;
    after: string;
    /** `pgEnum` declarations the texts may name. */
    enums: { ident: string; name: string; values: string }[];
}

/** What {@link transformSource} did to one file. */
export interface TransformResult {
    text: string;
    changed: boolean;
    problems: SweepProblem[];
    rewrites: ChainRewrite[];
}

const TEMPORAL_BUILDERS = new Set(["timestamptz", "timestamp", "date", "time"]);
const TEXT_BUILDERS = new Set(["text", "varchar", "char"]);
/** Modifiers that describe the column, not each item: refused before `.array()`. */
const COLUMN_ONLY_MODIFIERS = new Set([
    "notNull", "primaryKey", "default", "defaultSql", "defaultNow", "defaultRandom", "dbDefault", "generatedAs",
    "generatedAlwaysAs", "readOnly", "private", "identity", "generatedByDefaultAsIdentity", "onCreateNow",
    "onUpdateNow", "onCreateUser", "onUpdateUser", "column", "array", "multiple"
]);
/** Chain methods only a column builder has: a chain holding one is a column even when it does not start at `col.`. */
const BUILDER_METHODS = new Set([
    "notNull", "primaryKey", "unique", "default", "defaultSql", "defaultNow", "defaultRandom", "dbDefault",
    "generatedAs", "generatedAlwaysAs", "readOnly", "private", "access", "describe", "validate", "transform",
    "oneOf", "identity", "generatedByDefaultAsIdentity", "onCreateNow", "onUpdateNow", "onCreateUser",
    "onUpdateUser", "userId", "multiple", "array", "$type"
]);
/** Retired chain methods, converted wherever the chain starts. */
const RETIRED_METHODS = new Set(["column", "defaultSql", "generatedAs", "identity"]);

interface Link {
    call: ts.CallExpression;
    access: ts.PropertyAccessExpression;
    name: string;
}

interface Chain {
    top: ts.CallExpression;
    /** What the chain hangs off: `col` for a `col.*` chain. */
    base: ts.Expression;
    /** The `col.<builder>(…)` call, when the chain starts there. */
    root?: Link;
    methods: Link[];
}

interface EnumDeclaration {
    ident: string;
    values: string;
    scope: ts.Node;
}

interface EnumRequest {
    name: string;
    ident: string;
    values: string;
    /** Where the declaration goes: before this statement. */
    statement: ts.Statement;
    scope: ts.Node;
}

interface ChainResult {
    text: string;
    changed: boolean;
    problems: SweepProblem[];
    needSql: boolean;
    enums: EnumRequest[];
}

class FileContext {
    readonly text: string;
    readonly sf: ts.SourceFile;
    readonly identifiers = new Set<string>();
    readonly enums = new Map<string, EnumDeclaration[]>();
    /** The import that brings `col`, where `sql` / `pgEnum` are added. */
    colImport: ts.ImportDeclaration | undefined;
    sqlOk = true;
    pgEnumOk = true;
    /** The file imports or declares `col`, `defineTable` & co.: chains not starting at `col.` may be columns. */
    readonly schemaFile: boolean;

    constructor(text: string, fileName: string) {
        this.text = text;
        const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        this.sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
        let schema = false;
        const visit = (node: ts.Node): void => {
            if (ts.isIdentifier(node)) this.identifiers.add(node.text);
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer) &&
                ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === "pgEnum") {
                const [first, second] = node.initializer.arguments;
                if (first && ts.isStringLiteralLike(first) && second) {
                    const list = this.enums.get(first.text) ?? [];
                    list.push({ ident: node.name.text, values: this.slice(second), scope: scopeOf(node) });
                    this.enums.set(first.text, list);
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(this.sf);
        for (const statement of this.sf.statements) {
            if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.isTypeOnly) continue;
            const bindings = statement.importClause.namedBindings;
            if (!bindings || !ts.isNamedImports(bindings)) continue;
            for (const element of bindings.elements) {
                const local = element.name.text;
                if (local === "col" && !element.isTypeOnly) this.colImport = statement;
                if (["col", "defineTable", "defineAuthTable", "defineView"].includes(local)) schema = true;
            }
        }
        if (this.identifiers.has("col")) schema = true;
        this.schemaFile = schema;
        // `sql` / `pgEnum` bound to something else (drizzle's `sql`, a local) cannot be used.
        const colModule = this.colImport ? moduleOf(this.colImport) : undefined;
        for (const statement of this.sf.statements) {
            if (ts.isImportDeclaration(statement) && statement.importClause) {
                const names: string[] = [];
                const clause = statement.importClause;
                if (clause.name) names.push(clause.name.text);
                if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                    for (const element of clause.namedBindings.elements) names.push(element.name.text);
                }
                if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text);
                if (moduleOf(statement) !== colModule) {
                    if (names.includes("sql")) this.sqlOk = false;
                    if (names.includes("pgEnum")) this.pgEnumOk = false;
                }
            }
        }
        const declares = (name: string): boolean => {
            let found = false;
            const look = (node: ts.Node): void => {
                if (found) return;
                if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isParameter(node)) &&
                    node.name && ts.isIdentifier(node.name) && node.name.text === name) found = true;
                ts.forEachChild(node, look);
            };
            look(this.sf);
            return found;
        };
        if (declares("sql")) this.sqlOk = false;
        if (declares("pgEnum") && !this.enums.size) this.pgEnumOk = false;
    }

    slice(node: ts.Node): string {
        return this.text.slice(node.getStart(this.sf), node.end);
    }

    line(node: ts.Node): number {
        return this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf)).line + 1;
    }
}

function moduleOf(statement: ts.ImportDeclaration): string {
    return ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
}

/** The block (or file) a node's statement lives in. */
function scopeOf(node: ts.Node): ts.Node {
    let current: ts.Node = node;
    while (current.parent) {
        const parent = current.parent;
        if (ts.isSourceFile(parent) || ts.isBlock(parent) || ts.isModuleBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
            return parent;
        }
        current = parent;
    }
    return current;
}

/** The statement directly inside a block (or the file) that holds a node. */
function statementOf(node: ts.Node): ts.Statement | undefined {
    let current: ts.Node = node;
    while (current.parent) {
        const parent = current.parent;
        if (ts.isSourceFile(parent) || ts.isBlock(parent) || ts.isModuleBlock(parent) || ts.isCaseClause(parent) || ts.isDefaultClause(parent)) {
            return ts.isStatement(current) ? current : undefined;
        }
        current = parent;
    }
    return undefined;
}

function isChainContinuation(node: ts.CallExpression): boolean {
    const parent = node.parent;
    return Boolean(parent && ts.isPropertyAccessExpression(parent) && parent.expression === node &&
        parent.parent && ts.isCallExpression(parent.parent) && parent.parent.expression === parent);
}

function chainOf(top: ts.CallExpression): Chain {
    const links: Link[] = [];
    let node: ts.Expression = top;
    while (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        links.unshift({ call: node, access: node.expression, name: node.expression.name.text });
        node = node.expression.expression;
    }
    if (ts.isIdentifier(node) && node.text === "col" && links.length > 0) {
        return { top, base: node, root: links[0], methods: links.slice(1) };
    }
    return { top, base: node, methods: links };
}

const camel = (name: string): string =>
    name.replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, (_match, letter: string) => letter.toUpperCase()).replace(/^[^A-Za-z_$]+/, "");

const normalizeValues = (text: string): string => text.replace(/\s+/g, "").replace(/,(?=[\])])/g, "").replace(/asconst$/, "").replace(/'/g, "\"");

/** The text of a template literal whose cooked value is `value`. */
export function templateText(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/** A number literal or arithmetic on one: `3`, `MAX + 1`, `-1`. */
function isNumberish(node: ts.Node): boolean {
    if (ts.isNumericLiteral(node)) return true;
    if (ts.isParenthesizedExpression(node)) return isNumberish(node.expression);
    if (ts.isPrefixUnaryExpression(node)) return isNumberish(node.operand) || ts.isIdentifier(node.operand);
    if (ts.isBinaryExpression(node)) {
        const arithmetic = [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken];
        return arithmetic.includes(node.operatorToken.kind) && (isNumberish(node.left) || isNumberish(node.right));
    }
    return false;
}

function isStringish(node: ts.Node): boolean {
    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
}

/** Free identifiers an expression reads, ignoring property names. */
function freeIdentifiers(node: ts.Node): string[] {
    const found: string[] = [];
    const visit = (current: ts.Node): void => {
        if (ts.isIdentifier(current)) {
            const parent = current.parent;
            const isName = parent && ((ts.isPropertyAccessExpression(parent) && parent.name === current) ||
                (ts.isPropertyAssignment(parent) && parent.name === current));
            if (!isName && current.text !== "undefined") found.push(current.text);
        }
        if (ts.isTypeNode(current)) return;
        ts.forEachChild(current, visit);
    };
    visit(node);
    return found;
}

/** Whether every identifier an expression reads is declared in `scope` or an enclosing one, before `before`. */
function visibleAt(ctx: FileContext, names: string[], scope: ts.Node): boolean {
    for (const name of names) {
        let ok = false;
        const look = (node: ts.Node): void => {
            if (ok) return;
            if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isImportSpecifier(node) ||
                ts.isImportClause(node) || ts.isNamespaceImport(node)) && node.name && ts.isIdentifier(node.name) && node.name.text === name) {
                const declaredIn = ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node) ? ctx.sf : scopeOf(node);
                let walk: ts.Node | undefined = scope;
                while (walk) {
                    if (walk === declaredIn) ok = true;
                    walk = walk.parent;
                }
            }
            ts.forEachChild(node, look);
        };
        look(ctx.sf);
        if (!ok) return false;
    }
    return true;
}

interface EnumAllocator {
    request(name: string, values: ts.Expression, at: ts.Node): EnumRequest | string | { existing: string };
}

function makeAllocator(ctx: FileContext, pending: Map<string, EnumRequest>): EnumAllocator {
    return {
        request(name, valuesNode, at) {
            const values = ctx.slice(valuesNode);
            const scope = scopeOf(at);
            for (const declaration of ctx.enums.get(name) ?? []) {
                let walk: ts.Node | undefined = scope;
                while (walk) {
                    if (walk === declaration.scope) {
                        if (normalizeValues(declaration.values) === normalizeValues(values)) return { existing: declaration.ident };
                        return `pgEnum "${name}" is already declared here (${declaration.ident}) with other labels`;
                    }
                    walk = walk.parent;
                }
            }
            const statement = statementOf(at);
            if (!statement) return "could not find the statement to declare the pgEnum above";
            const target = scopeOf(statement);
            if (!visibleAt(ctx, freeIdentifiers(valuesNode), target)) {
                return `the labels of pgEnum "${name}" read a name not visible where the declaration would go`;
            }
            const key = `${name}\u0000${normalizeValues(values)}\u0000${target.pos}:${target.end}`;
            const already = pending.get(key);
            if (already) return already;
            let ident = `${camel(name)}Enum`;
            let suffix = 2;
            const taken = new Set([...ctx.identifiers, ...[...pending.values()].map(entry => entry.ident)]);
            while (taken.has(ident)) ident = `${camel(name)}Enum${suffix++}`;
            const request: EnumRequest = { name, ident, values, statement, scope: target };
            pending.set(key, request);
            return request;
        }
    };
}

interface ChainOptions {
    leadingName?: string;
}

function transformChain(ctx: FileContext, chain: Chain, allocator: EnumAllocator, options: ChainOptions = {}): ChainResult {
    const problems: SweepProblem[] = [];
    const enums: EnumRequest[] = [];
    let needSql = false;
    let changed = false;
    const text = ctx.text;
    const builder = chain.root?.name;
    const problem = (node: ts.Node, reason: string): ChainResult => {
        problems.push({ line: ctx.line(node), reason });
        return { text: ctx.slice(chain.top), changed: false, problems, needSql: false, enums: [] };
    };

    // ── The chain methods ──
    let leadingName = options.leadingName;
    let enumConfig: string | undefined;
    const segments: string[] = [];
    let prevEnd = chain.root ? chain.root.call.end : chain.base.end;
    for (const link of chain.methods) {
        const original = text.slice(prevEnd, link.call.end);
        const dot = link.access.questionDotToken ?? link.access.getChildren(ctx.sf).find(child => child.kind === ts.SyntaxKind.DotToken);
        const leading = dot ? text.slice(prevEnd, dot.getStart(ctx.sf)) : "";
        const keepLeading = /\/[/*]/.test(leading) ? leading.replace(/\s+$/, "") : "";
        prevEnd = link.call.end;
        const args = link.call.arguments;
        switch (link.name) {
            case "column": {
                if (args.length !== 1) return problem(link.call, "`.column()` with other than one argument");
                if (chain.methods.slice(0, chain.methods.indexOf(link)).some(other => other.name === "array")) {
                    return problem(link.call, "`.column()` after `.array()`: move the name onto the item builder by hand");
                }
                leadingName = ctx.slice(args[0]);
                segments.push(keepLeading);
                changed = true;
                continue;
            }
            case "oneOf": {
                if (builder && TEXT_BUILDERS.has(builder) && !chain.methods.slice(0, chain.methods.indexOf(link)).some(other => other.name === "array")) {
                    if (args.length !== 1) return problem(link.call, "`.oneOf()` with other than one argument");
                    if (enumConfig !== undefined) return problem(link.call, "two `.oneOf()` calls on one column");
                    enumConfig = ctx.slice(args[0]);
                    segments.push(keepLeading);
                    changed = true;
                    continue;
                }
                break;
            }
            case "defaultSql":
            case "generatedAs": {
                const arg = args[0];
                if (args.length !== 1 || !ts.isStringLiteralLike(arg)) {
                    return problem(link.call, `\`.${link.name}()\` with an expression that is not a string literal: write \`${link.name === "defaultSql" ? ".default" : ".generatedAlwaysAs"}(sql\`…\`)\` by hand`);
                }
                if (!ctx.sqlOk) return problem(link.call, "`sql` is already bound to something else in this file");
                const value = arg.text;
                if (link.name === "defaultSql" && value === "now()" && builder && TEMPORAL_BUILDERS.has(builder)) {
                    segments.push(`${leading}.defaultNow()`);
                } else {
                    if (value.trim().length === 0) return problem(link.call, `\`.${link.name}("")\` is empty`);
                    const method = link.name === "defaultSql" ? "default" : "generatedAlwaysAs";
                    segments.push(`${leading}.${method}(sql\`${templateText(value)}\`)`);
                    needSql = true;
                }
                changed = true;
                continue;
            }
            case "identity": {
                if (args.length !== 0) break;
                if (!chain.root && !isColumnish(ctx, chain)) break;
                segments.push(`${leading}.generatedByDefaultAsIdentity()`);
                changed = true;
                continue;
            }
            default:
                break;
        }
        segments.push(original);
    }

    // ── The root ──
    let rootText: string;
    if (!chain.root) {
        rootText = ctx.slice(chain.base);
        if (leadingName !== undefined) {
            if (!isColumnish(ctx, chain)) return { text: ctx.slice(chain.top), changed: false, problems: [], needSql: false, enums: [] };
            const base = chain.base;
            const enumIdents = new Set([...ctx.enums.values()].flat().map(entry => entry.ident));
            if (ts.isCallExpression(base) && ts.isIdentifier(base.expression) && base.arguments.length === 0 && enumIdents.has(base.expression.text)) {
                rootText = `${base.expression.text}(${leadingName})`;
            } else {
                return problem(chain.top, "`.column()` on a chain that does not start at a `col.*` builder or a pgEnum: give the name to the builder by hand");
            }
        }
        if (!changed) return { text: ctx.slice(chain.top), changed: false, problems, needSql: false, enums: [] };
        return { text: rootText + segments.join(""), changed, problems, needSql, enums };
    }

    const root = chain.root;
    const rootCall = root.call;
    const argNodes = [...rootCall.arguments];
    let args = argNodes.map(node => ctx.slice(node));
    let callee = `col.${builder}`;
    let typeArgs = rootCall.typeArguments ? text.slice(rootCall.typeArguments.pos, rootCall.typeArguments.end) : undefined;
    let rootChanged = false;
    let rootOverride: string | undefined;
    /** The root became a pgEnum: its only argument is the SQL name. */
    let pgEnumCallee = false;
    const afterRoot: string[] = [];
    const A0 = argNodes[0];
    const A1 = argNodes[1];
    const objectProps = (node: ts.Node | undefined): string[] | undefined =>
        node && ts.isObjectLiteralExpression(node) ? node.properties.map(property => ctx.slice(property)) : undefined;

    switch (builder) {
        case "timestamptz": {
            if (argNodes.length > 1) return problem(rootCall, "`col.timestamptz()` with more than one argument");
            callee = "col.timestamp";
            args = [...args, "{ withTimezone: true }"];
            rootChanged = true;
            break;
        }
        case "varchar":
        case "char": {
            if (argNodes.length === 0) {
                args = [`{ length: 255${enumConfig !== undefined ? `, enum: ${enumConfig}` : ""} }`];
                enumConfig = undefined;
                rootChanged = true;
            } else if (ts.isNumericLiteral(A0)) {
                if (argNodes.length > 1) return problem(rootCall, `\`col.${builder}(n, …)\` with a second argument`);
                args = [`{ length: ${args[0]}${enumConfig !== undefined ? `, enum: ${enumConfig}` : ""} }`];
                enumConfig = undefined;
                rootChanged = true;
            } else if (!isStringish(A0) && !ts.isObjectLiteralExpression(A0) && !(A1 && ts.isObjectLiteralExpression(A1))) {
                // `col.varchar(size)` or `col.varchar(name)`: a variable says nothing. A leftover old
                // spelling fails to compile once the old overloads are gone.
                break;
            }
            break;
        }
        case "bigint":
        case "bigserial": {
            if (argNodes.length === 0) {
                args = ["{ mode: \"number\" }"];
                rootChanged = true;
            }
            break;
        }
        case "numeric": {
            if (A0 && (ts.isNumericLiteral(A0) || (ts.isIdentifier(A0) && A0.text === "undefined"))) {
                if (!ts.isNumericLiteral(A0)) return problem(rootCall, "`col.numeric(undefined, scale)`: a scale needs a precision");
                args = [`{ precision: ${args[0]}${A1 ? `, scale: ${args[1]}` : ""} }`];
                rootChanged = true;
            }
            break;
        }
        case "vector": {
            if (A0 && isNumberish(A0) && (A1 === undefined || !ts.isObjectLiteralExpression(A1) ||
                !A1.properties.some(property => property.name !== undefined && ts.isIdentifier(property.name) && property.name.text === "dimensions"))) {
                const props = objectProps(A1);
                const rest = A1 === undefined ? "" : props !== undefined ? props.map(prop => `, ${prop}`).join("") : `, ...(${args[1]})`;
                args = [`{ dimensions: ${args[0]}${rest} }`];
                rootChanged = true;
            }
            break;
        }
        case "jsonb":
        case "json": {
            if (typeArgs !== undefined && argNodes.length === 0) {
                afterRoot.push(`.$type<${typeArgs}>()`);
                typeArgs = undefined;
                rootChanged = true;
            }
            break;
        }
        case "custom": {
            if (argNodes.length === 1 && !ts.isObjectLiteralExpression(A0)) {
                if (!ts.isStringLiteralLike(A0)) return problem(rootCall, "`col.custom(<expression>)`: cannot tell a type from a column name; write `col.custom({ dataType })` by hand");
                args = [`{ dataType: ${args[0]} }`];
                if (typeArgs !== undefined) {
                    afterRoot.push(`.$type<${typeArgs}>()`);
                    typeArgs = undefined;
                }
                rootChanged = true;
            }
            break;
        }
        case "enum": {
            // `col.enum(values, { name })`. `col.enum(name, values)` is the new spelling; two variables say nothing.
            if (argNodes.length === 2 && !isStringish(A0) && ts.isObjectLiteralExpression(A1)) {
                if (A1.properties.length === 0) {
                    args = [args[0]];
                    rootChanged = true;
                    break;
                }
                const nameProp = A1.properties[0];
                if (A1.properties.length !== 1 || !ts.isPropertyAssignment(nameProp) || !ts.isIdentifier(nameProp.name) ||
                    nameProp.name.text !== "name" || !ts.isStringLiteralLike(nameProp.initializer)) {
                    return problem(rootCall, "`col.enum(values, { … })` with options other than a literal `name`");
                }
                if (!ctx.pgEnumOk) return problem(rootCall, "`pgEnum` is already bound to something else in this file");
                const enumName = nameProp.initializer.text;
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(enumName)) {
                    return problem(rootCall, `enum name ${JSON.stringify(enumName)} is not a plain SQL identifier, which \`pgEnum\` requires`);
                }
                const result = allocator.request(enumName, A0, chain.top);
                if (typeof result === "string") return problem(rootCall, result);
                if ("existing" in result) {
                    callee = result.existing;
                } else {
                    callee = result.ident;
                    enums.push(result);
                }
                args = [];
                pgEnumCallee = true;
                rootChanged = true;
            }
            break;
        }
        case "array": {
            if (argNodes.length !== 1) return problem(rootCall, "`col.array()` with other than one argument");
            const inner = A0;
            let innerText: string;
            if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
                const innerChain = chainOf(inner);
                const blocked = innerChain.methods.find(method => COLUMN_ONLY_MODIFIERS.has(method.name));
                if (blocked) {
                    return problem(rootCall, `\`col.array(… .${blocked.name}())\`: \`.${blocked.name}()\` on the item has no \`.array()\` spelling; convert by hand`);
                }
                const result = transformChain(ctx, innerChain, allocator, leadingName !== undefined ? { leadingName } : {});
                if (result.problems.length > 0) {
                    problems.push(...result.problems);
                    return { text: ctx.slice(chain.top), changed: false, problems, needSql: false, enums: [] };
                }
                innerText = result.text;
                needSql ||= result.needSql;
                enums.push(...result.enums);
            } else if (leadingName !== undefined) {
                const enumIdents = new Set([...ctx.enums.values()].flat().map(entry => entry.ident));
                if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && inner.arguments.length === 0 && enumIdents.has(inner.expression.text)) {
                    innerText = `${inner.expression.text}(${leadingName})`;
                } else {
                    return problem(rootCall, "`col.array(<expression>).column()`: give the name to the item builder by hand");
                }
            } else {
                innerText = ctx.slice(inner);
            }
            leadingName = undefined;
            rootOverride = `${innerText}.array()`;
            rootChanged = true;
            break;
        }
        default:
            break;
    }

    if (enumConfig !== undefined) {
        // `col.text().oneOf([...])` and the canonical varchar/char with a later `.oneOf()`.
        const nameFirst = argNodes.length > 0 && isStringish(argNodes[0]);
        const configIndex = nameFirst ? 1 : 0;
        const config = argNodes[configIndex];
        if (rootChanged && builder !== "text") return problem(rootCall, "`.oneOf()` on a builder that was also rewritten: convert by hand");
        if (config === undefined) {
            if (builder !== "text") return problem(rootCall, `\`col.${builder}()\` without a length and a \`.oneOf()\``);
            args = [...args.slice(0, configIndex), `{ enum: ${enumConfig} }`];
        } else {
            const props = objectProps(config);
            if (props === undefined || props.some(prop => /^enum\b/.test(prop))) return problem(rootCall, "`.oneOf()` beside a config that is not a plain object literal");
            args[configIndex] = `{ ${[...props, `enum: ${enumConfig}`].join(", ")} }`;
        }
        rootChanged = true;
    }

    if (leadingName !== undefined) {
        const alreadyNamed = builder === "custom" || builder === "enum"
            ? argNodes.length === 2 && isStringish(argNodes[0])
            : argNodes.length > 0 && isStringish(argNodes[0]);
        if (alreadyNamed) {
            return problem(rootCall, "`.column()` on a builder that already has a leading SQL name");
        }
        if (pgEnumCallee) {
            // A pgEnum: `xEnum(name)`.
            args = [leadingName];
        } else {
            args = [leadingName, ...args];
        }
        rootChanged = true;
    }

    if (rootChanged) changed = true;
    if (!changed) return { text: ctx.slice(chain.top), changed: false, problems, needSql: false, enums: [] };
    rootText = rootOverride ?? (rootChanged
        ? `${callee}${typeArgs !== undefined ? `<${typeArgs}>` : ""}(${args.join(", ")})`
        : text.slice(chain.base.getStart(ctx.sf), rootCall.end));
    return { text: rootText + afterRoot.join("") + segments.join(""), changed, problems, needSql, enums };
}

/** A chain not starting at `col.` that is still a column builder by its methods. */
function isColumnish(ctx: FileContext, chain: Chain): boolean {
    if (!ctx.schemaFile) return false;
    if (chain.methods.some(method => BUILDER_METHODS.has(method.name) && method.name !== "identity")) return true;
    const base = chain.base;
    if (ts.isCallExpression(base) && ts.isIdentifier(base.expression)) {
        const enumIdents = new Set([...ctx.enums.values()].flat().map(entry => entry.ident));
        return enumIdents.has(base.expression.text);
    }
    return false;
}

function collectChains(ctx: FileContext): Chain[] {
    const chains: Chain[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && !isChainContinuation(node)) {
            const chain = chainOf(node);
            if (chain.root || (ctx.schemaFile && chain.methods.some(method => RETIRED_METHODS.has(method.name)))) chains.push(chain);
        }
        ts.forEachChild(node, visit);
    };
    visit(ctx.sf);
    return chains;
}

interface Edit {
    start: number;
    end: number;
    text: string;
}

function applyEdits(text: string, edits: Edit[]): string {
    let out = text;
    for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    return out;
}

/** Where a declaration goes above a statement: before its leading comments. */
function declarationPosition(ctx: FileContext, statement: ts.Statement): number {
    const comments = ts.getLeadingCommentRanges(ctx.text, statement.pos);
    return comments && comments.length > 0 ? comments[0].pos : statement.getStart(ctx.sf);
}

function indentAt(text: string, position: number): string {
    const lineStart = text.lastIndexOf("\n", position - 1) + 1;
    return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
}

/** Add `sql` / `pgEnum` to the import that brings `col`. */
function addImports(text: string, fileName: string, names: string[]): { text: string; problem?: string } {
    if (names.length === 0) return { text };
    const ctx = new FileContext(text, fileName);
    const declaration = ctx.colImport;
    if (!declaration) return { text, problem: `uses ${names.join(" and ")} but no import of \`col\` to add ${names.length > 1 ? "them" : "it"} to` };
    const bindings = declaration.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return { text };
    const present = new Set(bindings.elements.map(element => element.name.text));
    const missing = names.filter(name => !present.has(name));
    if (missing.length === 0) return { text };
    const last = bindings.elements[bindings.elements.length - 1];
    const multiline = ctx.slice(bindings).includes("\n");
    const insertion = multiline
        ? missing.map(name => `,\n${indentAt(text, last.getStart(ctx.sf))}${name}`).join("")
        : missing.map(name => `, ${name}`).join("");
    return { text: text.slice(0, last.end) + insertion + text.slice(last.end) };
}

/**
 * Rewrite every retired `col.*` spelling in one TypeScript source text.
 *
 * Pure: reads and returns text. Runs passes until nothing changes, so a chain
 * nested in another (`col.array(col.enum(…, { name }))`) converts inside out.
 */
export function transformSource(input: string, fileName = "file.ts"): TransformResult {
    let text = input;
    const rewrites: ChainRewrite[] = [];
    let problems: SweepProblem[] = [];
    let needSql = false;
    let needPgEnum = false;
    for (let pass = 0; pass < 12; pass++) {
        const ctx = new FileContext(text, fileName);
        const pending = new Map<string, EnumRequest>();
        const allocator = makeAllocator(ctx, pending);
        const chains = collectChains(ctx).sort((a, b) => (a.top.end - a.top.pos) - (b.top.end - b.top.pos));
        const edits: Edit[] = [];
        const chosen: { start: number; end: number }[] = [];
        const committed = new Map<string, { request: EnumRequest; position: number }>();
        const passProblems: SweepProblem[] = [];
        const enumDecls = (): { ident: string; name: string; values: string }[] => [...ctx.enums.entries()].flatMap(([name, list]) =>
            list.map(entry => ({ ident: entry.ident, name, values: entry.values })));
        for (const chain of chains) {
            const start = chain.top.getStart(ctx.sf);
            const end = chain.top.end;
            const result = transformChain(ctx, chain, allocator);
            passProblems.push(...result.problems);
            if (!result.changed) continue;
            if (chosen.some(range => range.start < end && start < range.end)) continue;
            chosen.push({ start, end });
            edits.push({ start, end, text: result.text });
            needSql ||= result.needSql;
            for (const request of result.enums) {
                needPgEnum = true;
                // Above this chain's own statement: the request is shared by every chain of the name in the scope.
                const position = declarationPosition(ctx, statementOf(chain.top) ?? request.statement);
                const known = committed.get(request.ident);
                if (!known || position < known.position) committed.set(request.ident, { request, position });
            }
            rewrites.push({
                line: ctx.line(chain.top),
                before: ctx.slice(chain.top),
                after: result.text,
                enums: [...enumDecls(), ...result.enums.map(request => ({ ident: request.ident, name: request.name, values: request.values }))]
            });
        }
        for (const { request, position } of committed.values()) {
            const indent = indentAt(ctx.text, position);
            edits.push({ start: position, end: position, text: `const ${request.ident} = pgEnum(${JSON.stringify(request.name)}, ${request.values});\n\n${indent}` });
        }
        if (edits.length === 0) {
            problems = passProblems;
            break;
        }
        text = applyEdits(text, edits);
    }
    const imports = addImports(text, fileName, [...(needPgEnum ? ["pgEnum"] : []), ...(needSql ? ["sql"] : [])]);
    if (imports.problem && !fileName.endsWith(".md") && !fileName.endsWith(".mdx")) problems.push({ line: 1, reason: imports.problem });
    text = imports.text;
    // De-duplicate: a problem inside an array item is reported by both chains.
    const seen = new Set<string>();
    problems = problems.filter(entry => {
        const key = `${entry.line}:${entry.reason}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return { text, changed: text !== input, problems, rewrites };
}

// ─── Markdown ────────────────────────────────────────────────────────────

const FENCE_LANGUAGES = new Set(["ts", "tsx", "typescript", "mts"]);

/** Rewrite the ```ts / ```tsx fences of a Markdown text with {@link transformSource}. */
export function transformMarkdown(input: string, fileName = "file.md"): TransformResult {
    const lines = input.split("\n");
    const out: string[] = [];
    const problems: SweepProblem[] = [];
    const rewrites: ChainRewrite[] = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const open = /^(\s*)(`{3,}|~{3,})\s*([A-Za-z]+)?(.*)$/.exec(line);
        if (!open) {
            out.push(line);
            continue;
        }
        const [, indent, fence, language = ""] = open;
        const close = lines.findIndex((candidate, at) => at > index && candidate.trim().startsWith(fence) && candidate.trim().replace(/[`~]/g, "") === "");
        if (close === -1) {
            out.push(line);
            continue;
        }
        const body = lines.slice(index + 1, close);
        if (!FENCE_LANGUAGES.has(language.toLowerCase())) {
            out.push(line, ...body, lines[close]);
            index = close;
            continue;
        }
        const stripped = body.map(entry => (entry.startsWith(indent) ? entry.slice(indent.length) : entry.trimStart()));
        const result = transformSource(stripped.join("\n"), `${fileName}.${language === "tsx" ? "tsx" : "ts"}`);
        for (const entry of result.problems) problems.push({ line: index + 1 + entry.line, reason: entry.reason });
        for (const entry of result.rewrites) rewrites.push({ ...entry, line: index + 1 + entry.line });
        const converted = result.changed ? result.text.split("\n").map(entry => (entry.length > 0 ? indent + entry : entry)) : body;
        out.push(line, ...converted, lines[close]);
        index = close;
    }
    const text = out.join("\n");
    return { text, changed: text !== input, problems, rewrites };
}

// ─── Verification ────────────────────────────────────────────────────────

/** A stable rendering of a value: sorted keys, functions by their source, cycles cut. */
export function stableRender(value: unknown): string {
    const seen = new WeakSet<object>();
    const render = (current: unknown): unknown => {
        if (typeof current === "function") return `fn:${current.toString()}`;
        if (typeof current !== "object" || current === null) return current;
        if (seen.has(current)) return "[cycle]";
        seen.add(current);
        let out: unknown;
        if (Array.isArray(current)) out = current.map(render);
        else {
            const sorted: Record<string, unknown> = {};
            for (const key of Object.keys(current).sort()) sorted[key] = render(Reflect.get(current, key));
            out = sorted;
        }
        seen.delete(current);
        return out;
    };
    return JSON.stringify(render(value));
}

type SchemaModule = typeof import("@rebasepro/server/schema");
type CommonModule = typeof import("@rebasepro/common");

let schemaModule: Promise<SchemaModule> | undefined;
/** `@rebasepro/server/schema`, as the project resolves it (in this repository: the source, via tsconfig paths). */
async function loadSchema(): Promise<SchemaModule> {
    schemaModule ??= import("@rebasepro/server/schema");
    return schemaModule;
}

/** The compiler, when it resolves (a project of your own may not list `@rebasepro/common`): the check then compares definitions only. */
async function loadCommon(): Promise<CommonModule | undefined> {
    try {
        return await import("@rebasepro/common");
    } catch {
        return undefined;
    }
}

/** `Date`, with `new Date()` frozen, so `.default(new Date())` evaluates the same twice. */
class FixedDate extends Date {
    constructor(...args: ConstructorParameters<typeof Date>) {
        if (args.length === 0) super(0);
        else super(...args);
    }
}

/** Evaluate a builder chain's text with `col`, `sql`, `pgEnum`, `json` (and the file's pgEnums) in scope. */
function evaluateChain(schema: SchemaModule, enums: ChainRewrite["enums"], expression: string): { def?: string; error?: string } {
    const declarations = enums.map(entry => `let ${entry.ident}; try { ${entry.ident} = pgEnum(${JSON.stringify(entry.name)}, ${entry.values}); } catch {}`);
    const source = `${declarations.join("\n")}\nreturn (${expression});`;
    const js = ts.transpileModule(source.replace(/^/, "function __sweep__() {\n") + "\n}", {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
    }).outputText;
    try {
        const factory = new Function("col", "sql", "pgEnum", "json", "Date", `${js}\nreturn __sweep__();`);
        const built: unknown = factory(schema.col, schema.sql, schema.pgEnum, schema.json, FixedDate);
        if (typeof built !== "object" || built === null || !("def" in built)) return { error: "not a column builder" };
        return { def: stableRender(built.def) };
    } catch (error) {
        return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
}

interface ChainVerdict {
    verified: number;
    unverifiable: { line: number; reason: string }[];
    differ: { line: number; before: string; after: string }[];
}

async function verifyChains(rewrites: ChainRewrite[]): Promise<ChainVerdict> {
    const schema = await loadSchema();
    const verdict: ChainVerdict = { verified: 0, unverifiable: [], differ: [] };
    for (const rewrite of rewrites) {
        const before = evaluateChain(schema, rewrite.enums, rewrite.before);
        const after = evaluateChain(schema, rewrite.enums, rewrite.after);
        if (before.def !== undefined && after.def !== undefined) {
            if (before.def === after.def) verdict.verified++;
            else verdict.differ.push({ line: rewrite.line, before: rewrite.before, after: rewrite.after });
        } else if (before.error !== undefined && before.error === after.error && /ReferenceError/.test(before.error)) {
            verdict.unverifiable.push({ line: rewrite.line, reason: before.error });
        } else if (before.def === undefined && after.def === undefined) {
            verdict.unverifiable.push({ line: rewrite.line, reason: `${before.error} / ${after.error}` });
        } else {
            verdict.differ.push({ line: rewrite.line, before: `${rewrite.before}  [${before.error ?? "ok"}]`, after: `${rewrite.after}  [${after.error ?? "ok"}]` });
        }
    }
    return verdict;
}

/** Whether a module exports a table and may be imported (not a test file). */
function exportsTables(text: string): boolean {
    return /export\s+const\s+\w+\s*=\s*(defineTable|defineAuthTable|defineView)\s*\(/.test(text) &&
        !/^\s*(describe|it|test)(\.\w+)?\s*\(\s*["'`]/m.test(text);
}

/** Rewrite relative module specifiers to absolute paths, so a copy elsewhere imports the same siblings. */
function absolutizeImports(text: string, dir: string): string {
    return text.replace(/(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']*)\2/g,
        (_match, lead: string, quote: string, specifier: string) => `${lead}${quote}${path.resolve(dir, specifier)}${quote}`);
}

/** Compile a module's exported tables and render them. Runs in a child process (`--verify-module`). */
async function renderModuleTables(file: string): Promise<Record<string, string>> {
    const schema = await loadSchema();
    const common = await loadCommon();
    const module: Record<string, unknown> = await import(pathToFileURL(file).href);
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(module)) {
        if (!schema.isTableDef(value) && !schema.isViewDef(value)) continue;
        let rendered: string;
        try {
            const result = common?.compileTable(value, thunk => {
                const target = thunk();
                return schema.isTableDef(target) || schema.isViewDef(target)
                    ? { ok: true, target }
                    : { ok: false, message: "unresolved relation target" };
            });
            rendered = stableRender({ config: value.config, descriptor: result?.descriptor, problems: result?.problems });
        } catch (error) {
            rendered = `threw: ${error instanceof Error ? error.message : String(error)}`;
        }
        out[name] = rendered;
    }
    return out;
}

function gitRoot(file: string): string | undefined {
    try {
        return execFileSync("git", ["-c", "core.fsmonitor=false", "rev-parse", "--show-toplevel"], { cwd: path.dirname(file), encoding: "utf8" }).trim();
    } catch {
        return undefined;
    }
}

function preImage(file: string): string | undefined {
    const root = gitRoot(file);
    if (!root) return undefined;
    try {
        return execFileSync("git", ["-c", "core.fsmonitor=false", "show", `HEAD:${path.relative(root, file)}`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch {
        return undefined;
    }
}

/** `"module"` or `"commonjs"`: what the nearest package.json makes a `.ts` file. */
function moduleType(file: string): string {
    for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
        const manifest = path.join(dir, "package.json");
        if (fs.existsSync(manifest)) {
            const parsed: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
            return typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "module" ? "module" : "commonjs";
        }
        if (path.dirname(dir) === dir) return "commonjs";
    }
}

/** Where two renderings first part, with a little context from each. */
function firstDifference(a: string, b: string): string {
    let index = 0;
    while (index < a.length && index < b.length && a[index] === b[index]) index++;
    const from = Math.max(0, index - 60);
    return `at ${index}: before …${a.slice(from, index + 60)}… after …${b.slice(from, index + 60)}…`;
}

function verifyModule(file: string, before: string): { ok: boolean; detail: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-sweep-"));
    const copy = path.join(dir, `pre-${crypto.randomBytes(4).toString("hex")}-${path.basename(file)}`);
    fs.writeFileSync(copy, absolutizeImports(before, path.dirname(file)));
    // Load the copy as the same module kind as the original (functions are compared by their compiled source).
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ type: moduleType(file) }));
    try {
        const run = (target: string): Record<string, string> | string => {
            const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "--verify-module", target], {
                encoding: "utf8", env: process.env, maxBuffer: 256 * 1024 * 1024
            });
            if (child.status !== 0) {
                const output = (child.stderr || child.stdout).split("\n");
                return `failed to load: ${output.find(line => /^\w*Error\b/.test(line)) ?? output.slice(-6).join("\n")}`;
            }
            const lastLine = child.stdout.trim().split("\n").pop() ?? "{}";
            return JSON.parse(lastLine);
        };
        const pre = run(copy);
        const post = run(file);
        if (typeof pre === "string" || typeof post === "string") return { ok: false, detail: typeof pre === "string" ? `pre-image ${pre}` : `working file ${post}` };
        const names = new Set([...Object.keys(pre), ...Object.keys(post)]);
        if (names.size === 0) return { ok: false, detail: "exports no table after loading" };
        const differing = [...names].filter(name => pre[name] !== post[name]);
        return differing.length === 0
            ? { ok: true, detail: `${names.size} table(s) identical` }
            : { ok: false, detail: `differs: ${differing.map(name => `${name} ${firstDifference(pre[name] ?? "", post[name] ?? "")}`).join("; ")}` };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ─── CLI ─────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "build", ".next", ".astro", "coverage", ".turbo", "lib"]);
const PREFILTER = /col\.|\.defaultSql\(|\.generatedAs\(|\.identity\(\)|\.column\(/;

function walk(entry: string, md: boolean, out: string[]): void {
    const stat = fs.statSync(entry, { throwIfNoEntry: false });
    if (!stat) return;
    if (stat.isFile()) {
        out.push(entry);
        return;
    }
    for (const child of fs.readdirSync(entry)) {
        if (SKIP_DIRS.has(child)) continue;
        const full = path.join(entry, child);
        const childStat = fs.statSync(full, { throwIfNoEntry: false });
        if (!childStat) continue;
        if (childStat.isDirectory()) walk(full, md, out);
        else if (/\.(ts|tsx|mts)$/.test(child) && !child.endsWith(".d.ts")) out.push(full);
        else if (md && /\.(md|mdx)$/.test(child)) out.push(full);
    }
}

const dirtyCache = new Map<string, Set<string>>();
function dirtyFiles(root: string): Set<string> {
    let set = dirtyCache.get(root);
    if (set) return set;
    set = new Set<string>();
    const git = (args: string[]): string => execFileSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const line of git(["diff", "HEAD", "--name-only"]).split("\n")) if (line) set.add(path.join(root, line));
    for (const line of git(["ls-files", "--others", "--exclude-standard"]).split("\n")) if (line) set.add(path.join(root, line));
    dirtyCache.set(root, set);
    return set;
}

function isDirty(file: string): boolean {
    const root = gitRoot(file);
    if (!root) return false;
    if (dirtyFiles(root).has(file)) return true;
    // Re-check this one file right before writing: other people commit and edit while we run.
    try {
        execFileSync("git", ["-c", "core.fsmonitor=false", "diff", "HEAD", "--quiet", "--", file], { cwd: root });
        return false;
    } catch {
        return true;
    }
}

/** Files the sweep never rewrites: the builders themselves and the tests that pair each old spelling with its new one. */
const ALWAYS_EXCLUDED = [
    "packages/types/src/schema/columns.ts",
    "packages/common/test/schema/drizzle-alignment.test.ts",
    "packages/types/test/schema/drizzle-spelling.test.ts",
    "tooling/scripts/drizzle-sweep.mts"
];

interface FileReport {
    file: string;
    problems?: SweepProblem[];
    verify?: string;
}

/**
 * `--recheck`: for files already changed against HEAD, prove the change is
 * exactly the sweep's output for the HEAD text, then run both --verify checks
 * on it. What a commit of swept files is checked with.
 */
async function recheck(files: string[]): Promise<number> {
    let failures = 0;
    let checked = 0;
    for (const file of files) {
        const shown = path.relative(process.cwd(), file);
        const before = preImage(file);
        if (before === undefined) continue;
        const now = fs.readFileSync(file, "utf8");
        if (now === before) continue;
        checked++;
        const isMd = /\.(md|mdx)$/.test(file);
        const result = isMd ? transformMarkdown(before, file) : transformSource(before, file);
        if (result.text !== now) {
            console.log(`  ${shown}: the working file is not the sweep's output for HEAD (other edits in it)`);
            failures++;
            continue;
        }
        const chains = await verifyChains(result.rewrites);
        let line = `  ${shown}: chains ${chains.verified} identical${chains.unverifiable.length ? `, ${chains.unverifiable.length} not self-contained` : ""}`;
        if (chains.differ.length > 0) {
            failures++;
            line += `; DIFFER at ${chains.differ.map(entry => entry.line).join(", ")}`;
        }
        if (!isMd && exportsTables(now)) {
            const verdict = verifyModule(file, before);
            line += `; module: ${verdict.detail}`;
            if (!verdict.ok) failures++;
        }
        console.log(line);
    }
    console.log(`recheck: ${checked} changed file(s), ${failures} failure(s)`);
    return failures > 0 ? 1 : 0;
}

async function main(argv: string[]): Promise<number> {
    if (argv[0] === "--verify-module") {
        const rendered = await renderModuleTables(path.resolve(argv[1]));
        process.stdout.write(`\n${JSON.stringify(rendered)}\n`);
        return 0;
    }
    const flags = new Set<string>();
    const excludes: string[] = [];
    const roots: string[] = [];
    let jsonOut: string | undefined;
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === "--exclude") excludes.push(argv[++index]);
        else if (arg === "--json") jsonOut = argv[++index];
        else if (["--dry-run", "--verify", "--md", "--include-dirty", "--recheck"].includes(arg)) flags.add(arg);
        else if (arg === "--help" || arg === "-h") {
            console.log("Usage: drizzle-sweep.mts [--dry-run] [--verify] [--md] [--include-dirty] [--exclude <part>]... [--json <file>] <file or dir>...");
            return 0;
        } else if (arg.startsWith("-")) {
            console.error(`Unknown option ${arg}`);
            return 2;
        } else roots.push(path.resolve(arg));
    }
    if (roots.length === 0) {
        console.error("Usage: drizzle-sweep.mts [options] <file or dir>...");
        return 2;
    }
    const md = flags.has("--md");
    const files: string[] = [];
    for (const root of roots) walk(root, md, files);
    if (flags.has("--recheck")) return recheck([...new Set(files)].sort());

    const converted: FileReport[] = [];
    const skippedDirty: string[] = [];
    const nothing: string[] = [];
    const couldNot: FileReport[] = [];
    const verifyFailures: FileReport[] = [];
    let chainsVerified = 0;
    let chainsUnverifiable = 0;
    for (const file of [...new Set(files)].sort()) {
        const shown = path.relative(process.cwd(), file);
        if (excludes.some(part => file.includes(part)) || ALWAYS_EXCLUDED.some(part => file.endsWith(part))) continue;
        const text = fs.readFileSync(file, "utf8");
        if (!PREFILTER.test(text)) continue;
        const isMd = /\.(md|mdx)$/.test(file);
        const result = isMd ? transformMarkdown(text, file) : transformSource(text, file);
        if (!result.changed) {
            if (result.problems.length > 0) couldNot.push({ file: shown, problems: result.problems });
            else nothing.push(shown);
            continue;
        }
        if (!flags.has("--include-dirty") && isDirty(file)) {
            skippedDirty.push(shown);
            continue;
        }
        const report: FileReport = { file: shown };
        if (result.problems.length > 0) couldNot.push({ file: shown, problems: result.problems });
        if (flags.has("--verify")) {
            const chains = await verifyChains(result.rewrites);
            chainsVerified += chains.verified;
            chainsUnverifiable += chains.unverifiable.length;
            if (chains.differ.length > 0) {
                verifyFailures.push({ file: shown, verify: chains.differ.map(entry => `line ${entry.line}: ${entry.before}  ⇒  ${entry.after}`).join("\n    ") });
                continue;
            }
            report.verify = `chains ${chains.verified} identical${chains.unverifiable.length ? `, ${chains.unverifiable.length} not self-contained` : ""}`;
        }
        if (!flags.has("--dry-run")) fs.writeFileSync(file, result.text);
        if (flags.has("--verify") && !isMd && exportsTables(result.text)) {
            const before = preImage(file) ?? text;
            const verdict = flags.has("--dry-run") ? { ok: true, detail: "module check skipped (dry run)" } : verifyModule(file, before);
            report.verify += `; module: ${verdict.detail}`;
            if (!verdict.ok) {
                verifyFailures.push({ file: shown, verify: verdict.detail });
                if (!flags.has("--dry-run")) fs.writeFileSync(file, text);
                continue;
            }
        }
        converted.push(report);
    }

    console.log(`\nconverted (${converted.length})${flags.has("--dry-run") ? " [dry run]" : ""}`);
    for (const entry of converted) console.log(`  ${entry.file}${entry.verify ? `  — ${entry.verify}` : ""}`);
    console.log(`\nskipped-dirty (${skippedDirty.length})`);
    for (const entry of skippedDirty) console.log(`  ${entry}`);
    console.log(`\nnothing-to-do (${nothing.length})`);
    console.log(`\ncould-not-convert (${couldNot.length})`);
    for (const entry of couldNot) for (const item of entry.problems ?? []) console.log(`  ${entry.file}:${item.line}  ${item.reason}`);
    if (flags.has("--verify")) {
        console.log(`\nverify: ${chainsVerified} chain(s) identical, ${chainsUnverifiable} not self-contained (checked by module/tests), ${verifyFailures.length} failure(s)`);
        for (const entry of verifyFailures) console.log(`  ${entry.file}\n    ${entry.verify}`);
    }
    if (jsonOut) {
        fs.writeFileSync(jsonOut, JSON.stringify({ converted, skippedDirty, nothing, couldNot, verifyFailures, chainsVerified, chainsUnverifiable }, null, 2));
    }
    return verifyFailures.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = await main(process.argv.slice(2));
}
