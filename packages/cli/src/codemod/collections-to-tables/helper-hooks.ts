/**
 * Collection callbacks that come from the project's own helper:
 * `callbacks: softDeleteCallbacks("company")`, `callbacks: customerCallbacks`
 * (imported), `callbacks: readOnlyRecordCallbacks(what, instead)`.
 *
 * The callbacks → hooks conversion is a mapping of each function's props
 * (`values` for `row` in `afterRead` / `beforeDelete` / `afterDelete`, the
 * descriptor for `collection`), so it is applied where the functions are
 * written — the helper's definition, followed through imports, `const`s,
 * property reads and a function's single `return` — and the table says
 * `hooks: softDeleteCallbacks("company")`, importing the helper. The edits to
 * the helper are planned like any other file the run writes (a helper inside
 * `config/collections` is edited in the copy the relocator makes).
 *
 * What cannot be followed statically (a package's export, two returns, a
 * spread) still becomes `hooks: <the same expression>`, with a step naming
 * the hooks to check.
 */
import fs from "node:fs";
import path from "node:path";

import type { Node, ObjectLiteralExpression, SourceFile } from "ts-morph";

import type { Member } from "./ast";
import { addSourceFile, lineIndent, memberOf, unwrap } from "./ast";
import { carryHook, memberFunctionText } from "./hooks";
import { resolveRelative } from "./modules";
import type { PlanContext } from "./plan-context";

/** An edit to a file the run did not write as a collection: offsets into the file as it is on disk. */
export interface SourceEdit {
    start: number;
    end: number;
    text: string;
}

/** What following a helper found. */
export interface HelperHooks {
    /** Edits to apply to each defining file (absolute path), so its functions take table-hook props. */
    edits: Map<string, SourceEdit[]>;
    /** Lines a carried hook left marked `TODO(rebase-migrate)`, with the file. */
    todos: { file: string; hook: string; todo: string }[];
    /** The defining files outside `config/collections` (edited in place). */
    files: Set<string>;
    /** Why the helper could not be followed, or which hooks were not found in it. */
    unresolved?: string;
}

export type Found = { literal: ObjectLiteralExpression; reason?: undefined } | { literal?: undefined; reason: string };

function loadFile(plan: PlanContext, file: string): SourceFile | undefined {
    if (!fs.existsSync(file) || file.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
    return plan.ast.project.getSourceFile(file) ?? addSourceFile(plan.ast, file, fs.readFileSync(file, "utf8"));
}

/** The declaration an identifier names: in its file, or the export of a relative import it binds. */
function declarationOf(plan: PlanContext, identifier: Node): Node | string {
    const { Node: N } = plan.ast.tsm;
    let declaration: Node | undefined;
    try {
        declaration = identifier.getSymbol()?.getDeclarations()[0];
    } catch {
        declaration = undefined;
    }
    if (!declaration) return `\`${identifier.getText()}\` is not declared in its file`;
    if (N.isImportSpecifier(declaration) || N.isImportClause(declaration)) {
        const importDeclaration = declaration.getFirstAncestor(ancestor => N.isImportDeclaration(ancestor));
        if (!importDeclaration || !N.isImportDeclaration(importDeclaration)) return "an import the codemod cannot read";
        const specifier = importDeclaration.getModuleSpecifierValue();
        if (!specifier.startsWith(".")) return `\`${identifier.getText()}\` comes from the package "${specifier}"`;
        const { target } = resolveRelative(declaration.getSourceFile().getFilePath(), specifier);
        const sf = loadFile(plan, target);
        if (!sf) return `"${specifier}" could not be read`;
        const name = N.isImportSpecifier(declaration) ? declaration.getName() : "default";
        if (name === "default") {
            const assignment = sf.getExportAssignment(candidate => !candidate.isExportEquals());
            return assignment ? assignment.getExpression() : `"${specifier}" has no default export`;
        }
        return sf.getVariableDeclaration(name) ?? sf.getFunction(name) ?? `"${specifier}" declares no \`${name}\` of its own (a re-export?)`;
    }
    return declaration;
}

/** The function a callee names, if it is a function declaration or a `const` arrow / function expression. */
function functionOf(plan: PlanContext, callee: Node): Node | string {
    const { Node: N } = plan.ast.tsm;
    if (!N.isIdentifier(callee)) return `the call to \`${callee.getText()}\` is not to a named function`;
    const declaration = declarationOf(plan, callee);
    if (typeof declaration === "string") return declaration;
    if (N.isFunctionDeclaration(declaration)) return declaration;
    if (N.isVariableDeclaration(declaration)) {
        const initializer = declaration.getInitializer();
        if (initializer && (N.isArrowFunction(initializer) || N.isFunctionExpression(initializer))) return initializer;
    }
    return `\`${callee.getText()}\` is not a function the codemod can read`;
}

/** Follow an expression to the object literal it evaluates to. */
export function findLiteral(plan: PlanContext, node: Node, depth = 0): Found {
    const { Node: N, SyntaxKind } = plan.ast.tsm;
    if (depth > 10) return { reason: "the helper refers to itself" };
    const current = unwrap(plan.ast, node);
    if (N.isObjectLiteralExpression(current)) return { literal: current };
    if (N.isIdentifier(current)) {
        const declaration = declarationOf(plan, current);
        if (typeof declaration === "string") return { reason: declaration };
        if (N.isVariableDeclaration(declaration)) {
            const initializer = declaration.getInitializer();
            return initializer ? findLiteral(plan, initializer, depth + 1) : { reason: `\`${current.getText()}\` has no initializer` };
        }
        if (N.isExpression(declaration)) return findLiteral(plan, declaration, depth + 1);
        return { reason: `\`${current.getText()}\` is not a value the codemod can read` };
    }
    if (N.isPropertyAccessExpression(current)) {
        const owner = findLiteral(plan, current.getExpression(), depth + 1);
        if (!owner.literal) return owner;
        const member = memberOf(plan.ast, owner.literal, current.getName());
        if (!member.node) return { reason: member.reason };
        if (!member.node.value) return { reason: `\`${current.getText()}\` is a method` };
        return findLiteral(plan, member.node.value, depth + 1);
    }
    if (N.isCallExpression(current)) {
        const fn = functionOf(plan, current.getExpression());
        if (typeof fn === "string") return { reason: fn };
        if (N.isArrowFunction(fn) && !N.isBlock(fn.getBody())) return findLiteral(plan, fn.getBody(), depth + 1);
        const returns = fn.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter(statement =>
            statement.getFirstAncestor(ancestor => N.isFunctionDeclaration(ancestor) || N.isArrowFunction(ancestor) || N.isFunctionExpression(ancestor) || N.isMethodDeclaration(ancestor)) === fn);
        const values = returns.map(statement => statement.getExpression()).filter((expression): expression is NonNullable<typeof expression> => expression !== undefined);
        if (values.length !== 1 || returns.length !== 1) return { reason: `\`${current.getExpression().getText()}\` has ${returns.length} return statements; the codemod follows exactly one` };
        return findLiteral(plan, values[0], depth + 1);
    }
    return { reason: `it is a ${current.getKindName()}` };
}

/**
 * Follow a callbacks expression that is not an object literal to the
 * helper's object literal, and plan its functions' props as table hooks.
 *
 * @param hookNames the hooks the evaluated collection had
 */
export function carryHelperHooks(plan: PlanContext, value: Node, hookNames: readonly string[]): HelperHooks {
    const result: HelperHooks = { edits: new Map(), todos: [], files: new Set() };
    const found = findLiteral(plan, value);
    if (!found.literal) {
        result.unresolved = found.reason;
        return result;
    }
    const literal = found.literal;
    const file = literal.getSourceFile().getFilePath();
    const missing: string[] = [];
    const edits: SourceEdit[] = [];
    for (const hook of hookNames) {
        const located = memberOf(plan.ast, literal, hook);
        if (!located.node) {
            missing.push(`${hook} (${located.reason})`);
            continue;
        }
        const member: Member = located.node;
        const carried = carryHook(plan.ast, member, hook);
        for (const todo of carried.todos) result.todos.push({ file, hook, todo });
        if (carried.text === memberFunctionText(plan.ast, member)) continue;
        // The carried text is dedented; it goes back at the member's own indentation.
        const indent = lineIndent(member.node);
        const text = carried.text.split("\n").map((line, index) => (index === 0 || line === "" ? line : `${indent}${line}`)).join("\n");
        if (member.method || !member.value) edits.push({ start: member.node.getStart(), end: member.node.getEnd(), text: `${hook}: ${text}` });
        else edits.push({ start: member.value.getStart(), end: member.value.getEnd(), text });
    }
    if (edits.length > 0) result.edits.set(file, edits);
    result.files.add(file);
    if (missing.length > 0) result.unresolved = `the helper's object (${path.basename(file)}, line ${literal.getStartLineNumber()}) does not say where ${missing.join(", ")} come from`;
    return result;
}

/** A file's text with source edits applied (offsets into the original text). */
export function applySourceEdits(text: string, edits: readonly SourceEdit[] | undefined): string {
    if (!edits || edits.length === 0) return text;
    let out = text;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    return out;
}
