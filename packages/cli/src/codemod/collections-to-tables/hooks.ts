/**
 * Moving a collection callback's source into a table hook.
 *
 * The code is carried as written. What changes is the props object it is
 * called with: a table hook gets `table` (the descriptor) where a collection
 * callback got `collection`, and `afterRead` / `beforeDelete` / `afterDelete`
 * get the row as `values` where they got `row`. The parameter is rewritten so
 * the body keeps its own names — `({ row })` becomes `({ values: row })` —
 * and where a use cannot be rewritten mechanically (the props passed on
 * whole, a property of the collection the descriptor does not have) the text
 * is kept, a `// TODO(rebase-migrate):` line says what to check, and the run
 * reports it. Nothing is rewritten to something that silently means less.
 */
import type { ArrowFunction, FunctionExpression, Identifier, Node, ParameterDeclaration } from "ts-morph";

import type { AstContext, Member } from "./ast";
import { nodeText } from "./ast";

/** The props a callback's parameter is renamed on. */
export interface PropRenames {
    /** Always `table`: the descriptor replaces the collection. */
    collection: "table";
    /** `values`, for the hooks that received the row as `row`. */
    row?: "values";
    /**
     * The renamed `collection` was a plain value (a slug) and `table` is the
     * same value — `StorageAuthorizeData.collection` → `.table` — so no use of
     * it needs checking.
     */
    collectionIsValue?: boolean;
}

/** The hooks whose legacy props named the row `row`. */
const ROW_HOOKS = new Set(["afterRead", "beforeDelete", "afterDelete"]);

/** The renames for one table hook, or one column transform. */
export function renamesFor(hook: string): PropRenames {
    return ROW_HOOKS.has(hook) ? { collection: "table", row: "values" } : { collection: "table" };
}

/** Properties of the collection a callback may read on the descriptor too, with the same meaning. */
const DESCRIPTOR_SAFE_READS = new Set(["slug"]);

/** A function carried into a table, and what to check in it. */
export interface CarriedFunction {
    /** The source text, ready to print: its first line at column 0. */
    text: string;
    /** One sentence per use the codemod could not rewrite; each is also a `TODO(rebase-migrate)` line in the text. */
    todos: string[];
}

interface Edit {
    start: number;
    end: number;
    text: string;
}

let scratchCounter = 0;

/** The function text a member denotes: a method becomes the function expression it is. */
export function memberFunctionText(ctx: AstContext, member: Member): string {
    const method = member.method;
    if (!method) return member.value ? nodeText(member.value) : nodeText(member.node);
    const { SyntaxKind } = ctx.tsm;
    const body = method.getBody();
    const usesThis = body !== undefined && (
        body.getDescendantsOfKind(SyntaxKind.ThisKeyword).length > 0 ||
        body.getDescendantsOfKind(SyntaxKind.SuperKeyword).length > 0 ||
        body.getDescendantsOfKind(SyntaxKind.Identifier).some(identifier => identifier.getText() === "arguments")
    );
    const isAsync = method.isAsync();
    const isGenerator = method.isGenerator();
    const typeParameters = method.getTypeParameters().map(parameter => parameter.getText());
    const typeParameterText = typeParameters.length > 0 ? `<${typeParameters.join(", ")}>` : "";
    const parameters = method.getParameters().map(parameter => parameter.getText()).join(", ");
    const returnType = method.getReturnTypeNode();
    const returnText = returnType ? `: ${returnType.getText()}` : "";
    const bodyText = body ? nodeText(body) : "{}";
    if (usesThis || isGenerator) {
        return `${isAsync ? "async " : ""}function${isGenerator ? "*" : ""} ${method.getName()}${typeParameterText}(${parameters})${returnText} ${bodyText}`;
    }
    return `${isAsync ? "async " : ""}${typeParameterText}(${parameters})${returnText} => ${bodyText}`;
}

/** The identifiers in `scope` bound by `declaration` (the parameter or a binding element). */
function referencesTo(ctx: AstContext, scope: Node, name: Identifier): Identifier[] {
    const { SyntaxKind } = ctx.tsm;
    const symbol = name.getSymbol();
    if (!symbol) return [];
    return scope.getDescendantsOfKind(SyntaxKind.Identifier)
        .filter(identifier => identifier !== name && identifier.getText() === name.getText() && identifier.getSymbol() === symbol);
}

/** Whether `identifier` is read as `identifier.<safe>` only. */
function isSafeDescriptorRead(ctx: AstContext, identifier: Identifier): boolean {
    const { Node: N } = ctx.tsm;
    const parent = identifier.getParent();
    return parent !== undefined && N.isPropertyAccessExpression(parent) && parent.getExpression() === identifier &&
        DESCRIPTOR_SAFE_READS.has(parent.getName());
}

/**
 * Rewrite the props a function receives. Returns the edits to make on its
 * text, and the uses it could not rewrite.
 */
function rewriteParameter(
    ctx: AstContext,
    fn: ArrowFunction | FunctionExpression,
    parameter: ParameterDeclaration,
    renames: PropRenames,
    edits: Edit[],
    todos: string[]
): void {
    const { Node: N } = ctx.tsm;
    const renamed: Record<string, string> = { collection: renames.collection, ...(renames.row ? { row: renames.row } : {}) };
    const nameNode = parameter.getNameNode();
    const body = fn.getBody();

    // An inline type for the props names the old keys too: `{ collection: string }`.
    const typeNode = parameter.getTypeNode();
    if (typeNode && N.isTypeLiteral(typeNode)) {
        for (const member of typeNode.getMembers()) {
            if (!N.isPropertySignature(member)) continue;
            const next = renamed[member.getName()];
            if (next !== undefined) edits.push({ start: member.getNameNode().getStart(), end: member.getNameNode().getEnd(), text: next });
        }
    }

    if (N.isObjectBindingPattern(nameNode)) {
        for (const element of nameNode.getElements()) {
            const propertyNameNode = element.getPropertyNameNode();
            const local = element.getNameNode();
            if (element.getDotDotDotToken()) {
                if (!N.isIdentifier(local)) continue;
                rewriteMemberReads(ctx, body, local, renamed, edits, todos, `the rest of the props, \`...${local.getText()}\``, renames.collectionIsValue === true);
                continue;
            }
            const key = propertyNameNode ? propertyNameNode.getText() : local.getText();
            const next = renamed[key];
            if (next === undefined) continue;
            if (propertyNameNode) {
                edits.push({ start: propertyNameNode.getStart(), end: propertyNameNode.getEnd(), text: next });
            } else {
                edits.push({ start: local.getStart(), end: local.getEnd(), text: `${next}: ${local.getText()}` });
            }
            if (key !== "collection" || renames.collectionIsValue) continue;
            if (N.isIdentifier(local)) {
                const unsafe = referencesTo(ctx, body, local).filter(identifier => !isSafeDescriptorRead(ctx, identifier));
                if (unsafe.length > 0) {
                    todos.push(`\`${local.getText()}\` is now the table's descriptor, not the collection: check every use but \`.slug\` (line ${unsafe[0].getStartLineNumber()} of the hook).`);
                }
            } else if (N.isObjectBindingPattern(local)) {
                const reads = local.getElements().map(inner => inner.getPropertyNameNode()?.getText() ?? inner.getNameNode().getText());
                const unsafe = reads.filter(read => !DESCRIPTOR_SAFE_READS.has(read));
                if (unsafe.length > 0) todos.push(`reads ${unsafe.map(read => `\`${read}\``).join(", ")} off the collection; the descriptor it gets now is a table, which may not have them.`);
            } else {
                todos.push("destructures the collection in a form the codemod does not rewrite; the descriptor it gets now is a table.");
            }
        }
        return;
    }
    if (N.isIdentifier(nameNode)) {
        rewriteMemberReads(ctx, body, nameNode, renamed, edits, todos, `the props object, \`${nameNode.getText()}\``, renames.collectionIsValue === true);
        return;
    }
    todos.push("takes its props in a form the codemod does not rewrite; it now gets `table` for `collection` and `values` for `row`.");
}

/** Rewrite `props.row` → `props.values` and `props.collection` → `props.table`; anything else is a TODO. */
function rewriteMemberReads(
    ctx: AstContext,
    scope: Node,
    binding: Identifier,
    renamed: Record<string, string>,
    edits: Edit[],
    todos: string[],
    what: string,
    collectionIsValue = false
): void {
    const { Node: N } = ctx.tsm;
    for (const reference of referencesTo(ctx, scope, binding)) {
        const parent = reference.getParent();
        if (parent && N.isPropertyAccessExpression(parent) && parent.getExpression() === reference) {
            const name = parent.getName();
            const next = renamed[name];
            if (next === undefined) continue;
            const nameNode = parent.getNameNode();
            edits.push({ start: nameNode.getStart(), end: nameNode.getEnd(), text: next });
            if (name === "collection" && !collectionIsValue) {
                const outer = parent.getParent();
                const safe = outer !== undefined && N.isPropertyAccessExpression(outer) && outer.getExpression() === parent &&
                    DESCRIPTOR_SAFE_READS.has(outer.getName());
                if (!safe) todos.push(`reads \`${parent.getText()}\`, which is now the table's descriptor, not the collection (line ${reference.getStartLineNumber()} of the hook).`);
            }
            continue;
        }
        if (parent && N.isElementAccessExpression(parent) && parent.getExpression() === reference) {
            todos.push(`reads ${what} by a computed key (\`${parent.getText()}\`); \`collection\` is \`table\` and \`row\` is \`values\` now.`);
            continue;
        }
        todos.push(`passes ${what} on (line ${reference.getStartLineNumber()} of the hook); whatever reads it gets \`table\` for \`collection\`${renamed.row ? " and `values` for `row`" : ""} now.`);
    }
}

function applyEdits(text: string, edits: Edit[], offset: number): string {
    const sorted = [...edits].sort((a, b) => b.start - a.start);
    let out = text;
    for (const edit of sorted) {
        out = out.slice(0, edit.start - offset) + edit.text + out.slice(edit.end - offset);
    }
    return out;
}

/** Insert the TODO lines where a reader will see them: first in a block body, above an expression body. */
function withTodos(ctx: AstContext, text: string, todos: readonly string[]): string {
    if (todos.length === 0) return text;
    const comment = todos.map(todo => `// TODO(rebase-migrate): ${todo}`);
    const sf = ctx.project.createSourceFile(`/__rebase_migrate__/todo-${scratchCounter++}.ts`, `const __hook = ${text};`, { overwrite: true });
    const offset = "const __hook = ".length;
    try {
        const initializer = sf.getVariableDeclarationOrThrow("__hook").getInitializerOrThrow();
        const { Node: N } = ctx.tsm;
        if ((N.isArrowFunction(initializer) || N.isFunctionExpression(initializer))) {
            const body = initializer.getBody();
            if (N.isBlock(body)) {
                const first = body.getStatements()[0];
                if (first) {
                    const start = first.getStart() - offset;
                    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
                    const indent = /^[ \t]*/.exec(text.slice(lineStart, start))?.[0] ?? "    ";
                    return `${text.slice(0, start)}${comment.join(`\n${indent}`)}\n${indent}${text.slice(start)}`;
                }
            }
        }
        return `${comment.join("\n")}\n${text}`;
    } finally {
        ctx.project.removeSourceFile(sf);
    }
}

/**
 * The source of one hook (or one transform callback), its props renamed.
 *
 * @param member where it is in the legacy literal
 * @param hook the hook's name: decides whether `row` is renamed
 * @param options `collectionIsValue` when the renamed `collection` held a plain value
 */
export function carryHook(ctx: AstContext, member: Member, hook: string, options: { collectionIsValue?: boolean } = {}): CarriedFunction {
    const text = memberFunctionText(ctx, member);
    const renames: PropRenames = { ...renamesFor(hook), ...(options.collectionIsValue ? { collectionIsValue: true } : {}) };
    const sf = ctx.project.createSourceFile(`/__rebase_migrate__/hook-${scratchCounter++}.ts`, `const __hook = ${text};`, { overwrite: true });
    const offset = "const __hook = ".length;
    const todos: string[] = [];
    try {
        const initializer = sf.getVariableDeclarationOrThrow("__hook").getInitializerOrThrow();
        const { Node: N } = ctx.tsm;
        const edits: Edit[] = [];
        if (N.isArrowFunction(initializer) || N.isFunctionExpression(initializer)) {
            const parameter = initializer.getParameters()[0];
            if (parameter) rewriteParameter(ctx, initializer, parameter, renames, edits, todos);
        } else {
            todos.push(`is \`${text.split("\n")[0]}\`, not a function written here, so the props it receives cannot be rewritten: it now gets \`table\` for \`collection\`${renames.row ? " and `values` for `row`" : ""}.`);
        }
        const rewritten = applyEdits(text, edits, offset);
        return { text: withTodos(ctx, rewritten, todos), todos };
    } finally {
        ctx.project.removeSourceFile(sf);
    }
}

/**
 * The source of a `callbacks` object of a property — `{ beforeSave, afterRead }`
 * — as the column's `.transform({...})` argument, each callback carried with
 * {@link carryHook}.
 */
export function carryTransform(ctx: AstContext, members: { name: string; member: Member }[]): CarriedFunction {
    const todos: string[] = [];
    const lines = members.map(({ name, member }) => {
        const carried = carryHook(ctx, member, name);
        todos.push(...carried.todos.map(todo => `${name} ${todo}`));
        return `    ${name}: ${carried.text.split("\n").join("\n    ")}`;
    });
    return { text: `{\n${lines.join(",\n")}\n}`, todos };
}
