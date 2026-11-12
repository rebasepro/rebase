/**
 * Reading the legacy source with ts-morph: where a collection's object
 * literal is, the node at a path inside it, and the code a node needs carried
 * with it (the imports and top-level declarations it references).
 *
 * The codemod evaluates collections for their data; it reads the AST only for
 * what a value cannot say — the text of a function, the comment above a
 * property, the module a component came from. So everything here answers one
 * question about one node, and says why when it cannot.
 *
 * ts-morph is loaded once per run (`await import("ts-morph")`) and handed in;
 * nothing here imports it at module load, so the CLI's start-up never pays
 * for it.
 */
import path from "node:path";
import type {
    ArrayLiteralExpression,
    Expression,
    Identifier,
    MethodDeclaration,
    Node,
    ObjectLiteralExpression,
    Project,
    SourceFile,
    Statement
} from "ts-morph";

import { dedent } from "./print-js";

/** The ts-morph module, loaded lazily by the run. */
export type TsMorph = typeof import("ts-morph");

/** What every AST helper needs. */
export interface AstContext {
    tsm: TsMorph;
    /** An in-memory project holding the legacy files at their absolute paths, and scratch files. */
    project: Project;
}

/** Create the in-memory project the legacy files are read into. */
export function createAstContext(tsm: TsMorph): AstContext {
    const project = new tsm.Project({
        useInMemoryFileSystem: true,
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {
            allowJs: true,
            jsx: tsm.ts.JsxEmit.Preserve,
            target: tsm.ts.ScriptTarget.ES2022,
            module: tsm.ts.ModuleKind.ESNext,
            moduleResolution: tsm.ts.ModuleResolutionKind.Bundler,
            noLib: true
        }
    });
    return { tsm, project };
}

/** Add a legacy file to the project, at its absolute path. */
export function addSourceFile(ctx: AstContext, absolutePath: string, text: string): SourceFile {
    return ctx.project.createSourceFile(absolutePath, text, { overwrite: true });
}

/** The node a lookup ended on, or why it could not get there. */
export type Located<T> = { node: T; reason?: undefined } | { node?: undefined; reason: string };

/** Strip `as`, `satisfies`, parentheses, `!` and `<T>` casts. */
export function unwrap(ctx: AstContext, node: Node): Node {
    const { Node: N } = ctx.tsm;
    let current = node;
    for (;;) {
        if (N.isAsExpression(current) || N.isSatisfiesExpression(current) || N.isParenthesizedExpression(current) ||
            N.isNonNullExpression(current) || N.isTypeAssertion(current)) {
            current = current.getExpression();
            continue;
        }
        return current;
    }
}

/** The top-level `const` an identifier names in its own file, or undefined. */
export function sameFileConst(ctx: AstContext, identifier: Identifier): Expression | undefined {
    const { Node: N, VariableDeclarationKind } = ctx.tsm;
    const sf = identifier.getSourceFile();
    const declaration = sf.getVariableDeclaration(identifier.getText());
    if (!declaration) return undefined;
    const list = declaration.getVariableStatement();
    if (!list || !N.isSourceFile(list.getParent())) return undefined;
    if (list.getDeclarationKind() !== VariableDeclarationKind.Const) return undefined;
    return declaration.getInitializer();
}

/** The names a builder call that wraps a collection literal may have. */
const WRAPPER_CALLS = new Set(["defineCollection", "defineFirestoreCollection"]);

/**
 * Follow a node to the object literal it denotes: through casts, a wrapper
 * call (`defineCollection({...})`) and a same-file `const`.
 */
export function resolveObject(ctx: AstContext, node: Node | undefined, depth = 0): Located<ObjectLiteralExpression> {
    const { Node: N } = ctx.tsm;
    if (!node) return { reason: "there is no expression to read" };
    if (depth > 8) return { reason: "the expression refers to itself" };
    const current = unwrap(ctx, node);
    if (N.isObjectLiteralExpression(current)) return { node: current };
    if (N.isCallExpression(current)) {
        const callee = current.getExpression().getText();
        if (WRAPPER_CALLS.has(callee)) return resolveObject(ctx, current.getArguments()[0], depth + 1);
        return { reason: `it is the result of calling \`${callee}(...)\`, which the codemod cannot read through` };
    }
    if (N.isIdentifier(current)) {
        const initializer = sameFileConst(ctx, current);
        if (initializer) return resolveObject(ctx, initializer, depth + 1);
        return { reason: `it is \`${current.getText()}\`, which is not a \`const\` declared in the same file` };
    }
    return { reason: `it is a ${current.getKindName()}, not an object literal` };
}

/** Like {@link resolveObject}, for an array literal. */
export function resolveArray(ctx: AstContext, node: Node | undefined, depth = 0): Located<ArrayLiteralExpression> {
    const { Node: N } = ctx.tsm;
    if (!node) return { reason: "there is no expression to read" };
    if (depth > 8) return { reason: "the expression refers to itself" };
    const current = unwrap(ctx, node);
    if (N.isArrayLiteralExpression(current)) return { node: current };
    if (N.isIdentifier(current)) {
        const initializer = sameFileConst(ctx, current);
        if (initializer) return resolveArray(ctx, initializer, depth + 1);
        return { reason: `it is \`${current.getText()}\`, which is not a \`const\` declared in the same file` };
    }
    return { reason: `it is a ${current.getKindName()}, not an array literal` };
}

/** The literal text of a property name, or undefined for a computed one that is not a string literal. */
function memberName(ctx: AstContext, member: Node): string | undefined {
    const { Node: N } = ctx.tsm;
    if (!N.isPropertyAssignment(member) && !N.isShorthandPropertyAssignment(member) && !N.isMethodDeclaration(member) &&
        !N.isGetAccessorDeclaration(member) && !N.isSetAccessorDeclaration(member)) {
        return undefined;
    }
    const nameNode = member.getNameNode();
    if (N.isIdentifier(nameNode) || N.isPrivateIdentifier(nameNode)) return nameNode.getText();
    if (N.isStringLiteral(nameNode) || N.isNoSubstitutionTemplateLiteral(nameNode)) return nameNode.getLiteralValue();
    if (N.isNumericLiteral(nameNode)) return String(nameNode.getLiteralValue());
    if (N.isComputedPropertyName(nameNode)) {
        const expression = nameNode.getExpression();
        if (N.isStringLiteral(expression) || N.isNoSubstitutionTemplateLiteral(expression)) return expression.getLiteralValue();
    }
    return undefined;
}

/** One member of an object literal, found by name. */
export interface Member {
    /** The member node: a property assignment, a shorthand, or a method. */
    node: Node;
    /** The value expression (absent for a method, which is its own value). */
    value?: Expression;
    /** Present for a method. */
    method?: MethodDeclaration;
}

/**
 * The member of an object literal named `name`. Refuses (with the reason)
 * when the literal has a spread or a computed key that could be providing
 * it, because then the literal alone does not say where the value is from.
 */
export function memberOf(ctx: AstContext, literal: ObjectLiteralExpression, name: string): Located<Member> {
    const { Node: N } = ctx.tsm;
    let found: Member | undefined;
    let opaque: string | undefined;
    for (const member of literal.getProperties()) {
        if (N.isSpreadAssignment(member)) {
            // A later explicit member wins over a spread; an earlier one does not.
            found = undefined;
            opaque = `\`...${member.getExpression().getText()}\` (line ${member.getStartLineNumber()})`;
            continue;
        }
        const memberKey = memberName(ctx, member);
        if (memberKey === undefined) {
            opaque = `the computed key \`${member.getText().split(":")[0]}\` (line ${member.getStartLineNumber()})`;
            continue;
        }
        if (memberKey !== name) continue;
        opaque = undefined;
        if (N.isPropertyAssignment(member)) found = { node: member, value: member.getInitializerOrThrow() };
        else if (N.isShorthandPropertyAssignment(member)) found = { node: member, value: member.getNameNode() };
        else if (N.isMethodDeclaration(member)) found = { node: member, method: member };
        else return { reason: `\`${name}\` is an accessor (line ${member.getStartLineNumber()})` };
    }
    if (found) return { node: found };
    if (opaque) return { reason: `\`${name}\` may come from ${opaque}, which the codemod does not read through` };
    return { reason: `there is no \`${name}\` in the object literal at line ${literal.getStartLineNumber()}` };
}

/** A path segment: a member name, or an array index. */
export type PathSegment = string | number;

/**
 * The member at `segments` below an object literal: each name read with
 * {@link memberOf}, each index from an array literal, every step resolved
 * through same-file `const`s.
 */
export function nodeAtPath(ctx: AstContext, root: ObjectLiteralExpression, segments: readonly PathSegment[]): Located<Member> {
    let current: Member = { node: root, value: root };
    const walked: string[] = [];
    for (const segment of segments) {
        const label = walked.length > 0 ? walked.join("") : "the collection";
        if (typeof segment === "number") {
            const array = resolveArray(ctx, current.value);
            if (!array.node) return { reason: `${label}: ${array.reason}` };
            const elements = array.node.getElements();
            if (elements.slice(0, segment + 1).some(element => ctx.tsm.Node.isSpreadElement(element))) {
                return { reason: `${label} spreads another array before item ${segment}, which the codemod does not read through` };
            }
            const element = elements[segment];
            if (!element) return { reason: `${label} has no item ${segment}` };
            current = { node: element, value: element };
            walked.push(`[${segment}]`);
            continue;
        }
        if (current.method) return { reason: `${label} is a method, not an object` };
        const object = resolveObject(ctx, current.value);
        if (!object.node) return { reason: `${label}: ${object.reason}` };
        const member = memberOf(ctx, object.node, segment);
        if (!member.node) return { reason: `${label}: ${member.reason}` };
        current = member.node;
        walked.push(walked.length > 0 ? `.${segment}` : segment);
    }
    return { node: current };
}

/** The whitespace a node's first line starts with in its file. */
export function lineIndent(node: Node): string {
    const sf = node.getSourceFile();
    const text = sf.getFullText();
    const start = node.getStart();
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const prefix = text.slice(lineStart, start);
    const match = /^[ \t]*/.exec(prefix);
    return match ? match[0] : "";
}

/** A node's text with the indentation of its line removed from every later line. */
export function nodeText(node: Node): string {
    return dedent(node.getText(), lineIndent(node));
}

/** `file:line` for messages, relative to `root`. */
export function where(node: Node, root: string): { file: string; line: number } {
    return { file: toPosix(path.relative(root, node.getSourceFile().getFilePath())), line: node.getStartLineNumber() };
}

/** A path with `/` separators. */
export function toPosix(value: string): string {
    return value.split(path.sep).join("/");
}

// ── The collection literal ───────────────────────────────────────────────────

/** Where a collection file's default export is. */
export interface CollectionSite {
    /** The object literal the collection is written as. */
    literal: ObjectLiteralExpression;
    /** The local name the collection is bound to, when it is bound (`usersCollection`). */
    binding?: string;
    /** The statements that declare and default-export it, which are not carried anywhere. */
    statements: Statement[];
}

/** Find the object literal a collection file default-exports. */
export function findCollectionSite(ctx: AstContext, sf: SourceFile): Located<CollectionSite> {
    const { Node: N } = ctx.tsm;
    const statements: Statement[] = [];
    let expression: Node | undefined;
    for (const statement of sf.getStatements()) {
        if (N.isExportAssignment(statement) && !statement.isExportEquals()) {
            expression = statement.getExpression();
            statements.push(statement);
        } else if (N.isExportDeclaration(statement)) {
            for (const specifier of statement.getNamedExports()) {
                if ((specifier.getAliasNode()?.getText() ?? specifier.getName()) === "default" && !statement.getModuleSpecifier()) {
                    expression = specifier.getNameNode();
                    statements.push(statement);
                }
            }
        }
    }
    if (!expression) return { reason: "the file has no `export default` the codemod can read" };
    let binding: string | undefined;
    const bare = unwrap(ctx, expression);
    if (N.isIdentifier(bare)) {
        binding = bare.getText();
        const declaration = sf.getVariableDeclaration(binding);
        const statement = declaration?.getVariableStatement();
        if (statement) statements.push(statement);
    }
    const literal = resolveObject(ctx, expression);
    if (!literal.node) return { reason: `the default export is not an object literal the codemod can read: ${literal.reason}` };
    return { node: { literal: literal.node, ...(binding ? { binding } : {}), statements } };
}

/**
 * Assignments to the collection after its declaration, at the top level of
 * its file: `usersCollection.securityRules = [...]`. Keyed by the assigned
 * path (`securityRules`, `properties.title.callbacks`).
 */
export function postDeclarationAssignments(ctx: AstContext, sf: SourceFile, binding: string): Map<string, { value: Expression; statement: Statement }> {
    const { Node: N, SyntaxKind } = ctx.tsm;
    const out = new Map<string, { value: Expression; statement: Statement }>();
    for (const statement of sf.getStatements()) {
        if (!N.isExpressionStatement(statement)) continue;
        const expression = statement.getExpression();
        if (!N.isBinaryExpression(expression) || expression.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
        const parts: string[] = [];
        let left: Node = expression.getLeft();
        while (N.isPropertyAccessExpression(left)) {
            parts.unshift(left.getName());
            left = left.getExpression();
        }
        if (N.isIdentifier(left) && left.getText() === binding && parts.length > 0) {
            out.set(parts.join("."), { value: expression.getRight(), statement });
        }
    }
    return out;
}

// ── What a node references ───────────────────────────────────────────────────

/** One import binding a carried node uses. */
export interface ImportUse {
    /** The module specifier as written. */
    specifier: string;
    /** The file it was written in (absolute), to resolve a relative specifier from. */
    fromFile: string;
    /** `default`, `*` (namespace) or the imported name. */
    imported: string;
    /** The local name. */
    local: string;
    /** Whether only types are imported. */
    typeOnly: boolean;
}

/** The imports and top-level declarations some nodes reference, transitively. */
export interface References {
    imports: ImportUse[];
    /** Top-level statements, in file order, each once. */
    statements: Statement[];
    /** Names that resolve to a statement that may not be carried (the collection itself). */
    forbidden: { name: string; line: number }[];
}

/**
 * Whether an identifier is read as a name in scope, rather than written as a
 * property name (`a.b`'s `b`, `{ b: 1 }`'s `b`, a method's or a member's own
 * name). A shorthand `{ b }` is a reference.
 */
function isReferencePosition(ctx: AstContext, identifier: Identifier): boolean {
    const { Node: N } = ctx.tsm;
    const parent = identifier.getParent();
    if (!parent) return true;
    if (N.isPropertyAccessExpression(parent) && parent.getNameNode() === identifier) return false;
    if (N.isQualifiedName(parent) && parent.getRight() === identifier) return false;
    if ((N.isPropertyAssignment(parent) || N.isMethodDeclaration(parent) || N.isPropertySignature(parent) ||
        N.isMethodSignature(parent) || N.isPropertyDeclaration(parent) || N.isGetAccessorDeclaration(parent) ||
        N.isSetAccessorDeclaration(parent) || N.isEnumMember(parent)) && parent.getNameNode() === identifier) {
        return false;
    }
    if (N.isBindingElement(parent) && parent.getPropertyNameNode() === identifier) return false;
    if (N.isJsxAttribute(parent)) return false;
    return true;
}

/** The top-level statement a declaration node belongs to, when it is one. */
function topLevelStatement(ctx: AstContext, declaration: Node): Statement | undefined {
    const { Node: N } = ctx.tsm;
    let current: Node | undefined = declaration;
    while (current && !N.isSourceFile(current.getParent() ?? current)) {
        current = current.getParent();
    }
    if (!current || !N.isStatement(current)) return undefined;
    return N.isSourceFile(current.getParent()) ? current : undefined;
}

/**
 * Collect what `nodes` reference at the top level of their file: import
 * bindings, and the statements declaring other names (followed
 * transitively). `exclude` are statements that must not be carried — a
 * reference to one is reported in `forbidden`.
 */
export function collectReferences(ctx: AstContext, nodes: readonly Node[], exclude: readonly Statement[]): References {
    const { Node: N, SyntaxKind } = ctx.tsm;
    const imports: ImportUse[] = [];
    const statements = new Set<Statement>();
    const forbidden: { name: string; line: number }[] = [];
    const queue: Node[] = [...nodes];
    const visited = new Set<Node>();
    while (queue.length > 0) {
        const node = queue.shift();
        if (!node || visited.has(node)) continue;
        visited.add(node);
        const identifiers = N.isIdentifier(node) ? [node] : node.getDescendantsOfKind(SyntaxKind.Identifier);
        for (const identifier of identifiers) {
            if (!isReferencePosition(ctx, identifier)) continue;
            const symbol = identifier.getSymbol();
            if (!symbol) continue;
            for (const declaration of symbol.getDeclarations()) {
                if (declaration.getSourceFile() !== identifier.getSourceFile()) continue;
                if (N.isImportSpecifier(declaration) || N.isImportClause(declaration) || N.isNamespaceImport(declaration)) {
                    const importDeclaration = declaration.getFirstAncestorByKindOrThrow(SyntaxKind.ImportDeclaration);
                    const specifier = importDeclaration.getModuleSpecifierValue();
                    const local = identifier.getText();
                    const typeOnly = importDeclaration.isTypeOnly() || (N.isImportSpecifier(declaration) && declaration.isTypeOnly());
                    const imported = N.isImportSpecifier(declaration) ? declaration.getName()
                        : N.isNamespaceImport(declaration) ? "*"
                            : "default";
                    if (!imports.some(use => use.local === local && use.specifier === specifier)) {
                        imports.push({ specifier, fromFile: identifier.getSourceFile().getFilePath(), imported, local, typeOnly });
                    }
                    continue;
                }
                const statement = topLevelStatement(ctx, declaration);
                if (!statement || nodes.includes(statement)) continue;
                // A declaration inside the node itself (a parameter, a local) is not a reference out of it.
                if (nodes.some(root => root !== statement && (declaration === root || declaration.getAncestors().includes(root)))) continue;
                if (exclude.includes(statement)) {
                    if (!forbidden.some(entry => entry.name === identifier.getText())) {
                        forbidden.push({ name: identifier.getText(), line: identifier.getStartLineNumber() });
                    }
                    continue;
                }
                if (!statements.has(statement)) {
                    statements.add(statement);
                    queue.push(statement);
                }
            }
        }
    }
    const ordered = [...statements].sort((a, b) => a.getStart() - b.getStart());
    return { imports, statements: ordered, forbidden };
}

/** The leading comments of a node worth carrying: block and line comments, not lint or compiler directives. */
export function leadingComments(node: Node): string[] {
    const out: string[] = [];
    for (const range of node.getLeadingCommentRanges()) {
        const text = range.getText();
        if (/^\/\/\s*(@ts-|eslint|prettier|#)/.test(text) || /^\/\*\s*(eslint|prettier|@ts-)/.test(text)) continue;
        out.push(text);
    }
    return out;
}
