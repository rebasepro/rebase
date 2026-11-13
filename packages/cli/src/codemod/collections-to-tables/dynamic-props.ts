/**
 * A `dynamicProps` builder's return shape, 0.30 → 0.31.
 *
 * On 0.30 a builder returned a partial property: `{ admin: { readOnly: true } }`.
 * On 0.31 it returns a field customization, flat: `{ readOnly: true }`, each
 * key under the name `customizeTable` gives it (`hideFromCollection` →
 * `hidden`, as the codemod routes a static `admin`). When every value the
 * function can return is an object literal — directly, through a ternary, an
 * early `return`, or a top-level `const` of the same file used only there —
 * and each holds nothing but an `admin` block of routable keys, the literals
 * are rewritten in place. Anything else (a spread, a computed value, a key
 * that would collide or has no destination) is left for the manual step.
 */
import type { Node, ObjectLiteralExpression, SourceFile } from "ts-morph";

import type { AstContext } from "./ast";
import { unwrap } from "./ast";
import type { SourceEdit } from "./helper-hooks";
import { own } from "./own";
import { PROPERTY_ADMIN_DESTINATIONS } from "./vocabulary";

/** The rewrite of one builder: edits into its file, or why it is left. */
export type DynamicPropsRewrite = { edits: SourceEdit[]; reason?: undefined } | { edits?: undefined; reason: string };

function propertyName(ctx: AstContext, member: Node): string | undefined {
    const { Node: N } = ctx.tsm;
    if (!N.isPropertyAssignment(member) && !N.isShorthandPropertyAssignment(member)) return undefined;
    const name = member.getNameNode();
    if (N.isIdentifier(name)) return name.getText();
    if (N.isStringLiteral(name) || N.isNoSubstitutionTemplateLiteral(name)) return name.getLiteralValue();
    return undefined;
}

/** `{ admin: { readOnly: true } }` → `{ readOnly: true }`, or why not. */
function flatten(ctx: AstContext, literal: ObjectLiteralExpression): { text: string } | { reason: string } {
    const { Node: N } = ctx.tsm;
    const properties = literal.getProperties();
    if (properties.length === 0) return { text: literal.getText() };
    const out: string[] = [];
    const seen = new Set<string>();
    for (const property of properties) {
        if (propertyName(ctx, property) !== "admin" || !N.isPropertyAssignment(property)) {
            return { reason: `it returns \`${property.getText().split("\n")[0]}\`, which is not an \`admin\` block` };
        }
        const admin = unwrap(ctx, property.getInitializerOrThrow());
        if (!N.isObjectLiteralExpression(admin)) return { reason: "its `admin` block is not an object literal" };
        for (const entry of admin.getProperties()) {
            const key = propertyName(ctx, entry);
            const destination = key === undefined ? undefined : own(PROPERTY_ADMIN_DESTINATIONS, key);
            if (key === undefined || typeof destination !== "string" || key === "disabled") {
                return { reason: `its \`admin.${key ?? entry.getText().split("\n")[0]}\` has no flat equivalent the codemod can write` };
            }
            if (seen.has(destination)) return { reason: `two of its \`admin\` keys would both be \`${destination}\`` };
            seen.add(destination);
            const value = N.isShorthandPropertyAssignment(entry) ? entry.getName() : N.isPropertyAssignment(entry) ? entry.getInitializerOrThrow().getText() : undefined;
            if (value === undefined) return { reason: `its \`admin.${key}\` is not a plain value` };
            out.push(`${destination}: ${value}`);
        }
    }
    return { text: out.length === 0 ? "{}" : `{ ${out.join(", ")} }` };
}

/** The literals a function can return, or why not every return is one. */
function returnedLiterals(ctx: AstContext, fn: Node, sf: SourceFile): { literals: ObjectLiteralExpression[]; consts: Set<string> } | { reason: string } {
    const { Node: N, SyntaxKind } = ctx.tsm;
    const literals: ObjectLiteralExpression[] = [];
    const consts = new Set<string>();
    const leaves = (node: Node): string | undefined => {
        const current = unwrap(ctx, node);
        if (N.isConditionalExpression(current)) return leaves(current.getWhenTrue()) ?? leaves(current.getWhenFalse());
        if (N.isObjectLiteralExpression(current)) {
            literals.push(current);
            return undefined;
        }
        if (N.isIdentifier(current)) {
            const declaration = sf.getVariableDeclaration(current.getText());
            const statement = declaration?.getVariableStatement();
            const initializer = declaration?.getInitializer();
            const value = initializer ? unwrap(ctx, initializer) : undefined;
            if (declaration && statement && N.isSourceFile(statement.getParent()) && value && N.isObjectLiteralExpression(value)) {
                consts.add(current.getText());
                literals.push(value);
                return undefined;
            }
        }
        return `it returns \`${current.getText().split("\n")[0]}\`, not an object literal`;
    };
    if (!(N.isArrowFunction(fn) || N.isFunctionExpression(fn) || N.isMethodDeclaration(fn) || N.isFunctionDeclaration(fn))) return { reason: "it is not a function written here" };
    const body = fn.getBody();
    if (!body) return { reason: "it has no body" };
    if (!N.isBlock(body)) {
        const problem = leaves(body);
        return problem ? { reason: problem } : { literals, consts };
    }
    const returns = fn.getDescendantsOfKind(SyntaxKind.ReturnStatement).filter(statement =>
        statement.getFirstAncestor(ancestor => N.isArrowFunction(ancestor) || N.isFunctionExpression(ancestor) || N.isFunctionDeclaration(ancestor) || N.isMethodDeclaration(ancestor)) === fn);
    if (returns.length === 0) return { reason: "it returns nothing" };
    for (const statement of returns) {
        const expression = statement.getExpression();
        if (!expression) return { reason: "a `return` gives no value" };
        const problem = leaves(expression);
        if (problem) return { reason: problem };
    }
    return { literals, consts };
}

/** Every function of a file written as the value of a `dynamicProps` member. */
export function dynamicPropsBuilders(ctx: AstContext, sf: SourceFile): Node[] {
    const { Node: N, SyntaxKind } = ctx.tsm;
    const out: Node[] = [];
    for (const member of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
        if (member.getName() !== "dynamicProps") continue;
        const value = unwrap(ctx, member.getInitializerOrThrow());
        if (N.isArrowFunction(value) || N.isFunctionExpression(value)) out.push(value);
    }
    for (const method of sf.getDescendantsOfKind(SyntaxKind.MethodDeclaration)) if (method.getName() === "dynamicProps") out.push(method);
    return out;
}

/**
 * Rewrite a builder's returned literals to the flat shape.
 *
 * @param fn the builder (arrow, function expression or method) in `sf`
 * @param ownedBuilders every builder function of the file being rewritten: a
 *   `const` returned by one may only be read by such builders
 */
export function rewriteDynamicProps(ctx: AstContext, fn: Node, sf: SourceFile, ownedBuilders: readonly Node[] = dynamicPropsBuilders(ctx, sf)): DynamicPropsRewrite {
    const { SyntaxKind } = ctx.tsm;
    const found = returnedLiterals(ctx, fn, sf);
    if ("reason" in found) return { reason: found.reason };
    // A shared `const` (`READ_ONLY`) is rewritten only when every read of it is a builder's return.
    for (const name of found.consts) {
        const reads = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter(identifier =>
            identifier.getText() === name && identifier.getParentIfKind(SyntaxKind.VariableDeclaration)?.getNameNode() !== identifier);
        const outside = reads.filter(identifier => !ownedBuilders.some(builder => identifier.getAncestors().includes(builder)));
        if (outside.length > 0) return { reason: `\`${name}\` is also read outside the builders (line ${outside[0].getStartLineNumber()})` };
    }
    const edits: SourceEdit[] = [];
    for (const literal of found.literals) {
        const flat = flatten(ctx, literal);
        if ("reason" in flat) return { reason: flat.reason };
        if (flat.text !== literal.getText()) edits.push({ start: literal.getStart(), end: literal.getEnd(), text: flat.text });
    }
    return { edits };
}
