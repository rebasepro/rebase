/**
 * `engine: "firestore"` collections → `defineFirestoreCollection(...)` in the
 * CMS (`frontend/src/cms/<name>.ts`).
 *
 * A Firestore collection is not a table, so nothing is lifted: the file is
 * moved and rewritten in place, which keeps every function, comment and
 * import exactly as written. What changes is the shape `@rebasepro/firebase`
 * takes — `properties` is `fields`, a reference names its collection with
 * `target` instead of `path`, there is no `engine` — and the wrapper
 * (`defineFirestoreCollection` instead of `defineCollection` or a typed
 * literal).
 */
import path from "node:path";
import type { Node, ObjectLiteralExpression, SourceFile } from "ts-morph";

import { findCollectionSite, memberOf, resolveObject } from "./ast";
import { COMPONENT_KEYS } from "./customization";
import type { CollectionEntry, PlanContext } from "./plan-context";
import { planFile, refuse, relativeToRoot } from "./plan-context";

interface Edit {
    start: number;
    end: number;
    text: string;
}

/**
 * Rename `path` → `target` on every reference field of a literal fields map, recursively.
 * `renamed` collects the key path of each reference renamed (`store`, `lines.of.product`).
 */
function referenceEdits(plan: PlanContext, fields: ObjectLiteralExpression, edits: Edit[], renamed: Set<string>, prefix = ""): void {
    const { Node: N } = plan.ast.tsm;
    for (const member of fields.getProperties()) {
        if (!N.isPropertyAssignment(member)) continue;
        const field = resolveObject(plan.ast, member.getInitializer()).node;
        if (!field || field.getSourceFile() !== fields.getSourceFile()) continue;
        visitField(plan, field, edits, renamed, `${prefix}${member.getName().replace(/^["']|["']$/g, "")}`);
    }
}

function visitField(plan: PlanContext, field: ObjectLiteralExpression, edits: Edit[], renamed: Set<string>, key: string): void {
    const { Node: N } = plan.ast.tsm;
    const type = memberOf(plan.ast, field, "type").node?.value;
    const typeText = type && N.isStringLiteral(type) ? type.getLiteralValue() : undefined;
    if (typeText === "reference") {
        const pathMember = memberOf(plan.ast, field, "path").node;
        if (pathMember && N.isPropertyAssignment(pathMember.node)) {
            const nameNode = pathMember.node.getNameNode();
            edits.push({ start: nameNode.getStart(), end: nameNode.getEnd(), text: "target" });
            renamed.add(key);
        }
    }
    for (const nested of ["properties", "of"] as const) {
        const value = memberOf(plan.ast, field, nested).node?.value;
        const object = value ? resolveObject(plan.ast, value).node : undefined;
        if (!object || object.getSourceFile() !== field.getSourceFile()) continue;
        if (nested === "properties") referenceEdits(plan, object, edits, renamed, `${key}.`);
        else visitField(plan, object, edits, renamed, `${key}.of`);
    }
    const oneOf = memberOf(plan.ast, field, "oneOf").node?.value;
    const oneOfObject = oneOf ? resolveObject(plan.ast, oneOf).node : undefined;
    const variants = oneOfObject ? memberOf(plan.ast, oneOfObject, "properties").node?.value : undefined;
    const variantsObject = variants ? resolveObject(plan.ast, variants).node : undefined;
    if (variantsObject) referenceEdits(plan, variantsObject, edits, renamed, `${key}.oneOf.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every reference field of the EVALUATED collection that still sets `path`,
 * by key path (the same paths {@link referenceEdits} records), with the path.
 */
function evaluatedReferences(properties: unknown, prefix = "", out = new Map<string, string>()): Map<string, string> {
    if (!isRecord(properties)) return out;
    for (const [name, field] of Object.entries(properties)) visitEvaluated(field, `${prefix}${name}`, out);
    return out;
}

function visitEvaluated(field: unknown, key: string, out: Map<string, string>): void {
    if (!isRecord(field)) return;
    if (field.type === "reference" && "path" in field) out.set(key, String(field.path));
    evaluatedReferences(field.properties, `${key}.`, out);
    visitEvaluated(field.of, `${key}.of`, out);
    if (isRecord(field.oneOf)) evaluatedReferences(field.oneOf.properties, `${key}.oneOf.`, out);
}

/** The edits that turn the collection literal into `defineFirestoreCollection`'s argument and wrap it. */
function literalEdits(plan: PlanContext, sf: SourceFile, entry: CollectionEntry, destination: string): Edit[] | undefined {
    const { Node: N } = plan.ast.tsm;
    const site = findCollectionSite(plan.ast, sf);
    if (!site.node) {
        refuse(plan, entry, `is a Firestore collection whose literal the codemod cannot find: ${site.reason}.`);
        return undefined;
    }
    const literal = site.node.literal;
    const edits: Edit[] = [];
    for (const member of literal.getProperties()) {
        if (N.isSpreadAssignment(member)) {
            refuse(plan, entry, `is a Firestore collection whose literal spreads \`${member.getExpression().getText()}\` (line ${member.getStartLineNumber()}); its \`properties\` and \`engine\` cannot be rewritten through a spread. Write them in the literal.`);
            return undefined;
        }
    }
    const engine = memberOf(plan.ast, literal, "engine").node;
    if (engine) {
        const node = engine.node;
        const text = sf.getFullText();
        let end = node.getEnd();
        if (text[end] === ",") end += 1;
        const start = node.getFullStart();
        edits.push({ start, end, text: "" });
    }
    const properties = memberOf(plan.ast, literal, "properties").node;
    if (!properties) {
        refuse(plan, entry, "is a Firestore collection with no `properties` the codemod can read.");
        return undefined;
    }
    if (N.isPropertyAssignment(properties.node)) {
        const nameNode = properties.node.getNameNode();
        edits.push({ start: nameNode.getStart(), end: nameNode.getEnd(), text: "fields" });
    } else if (N.isShorthandPropertyAssignment(properties.node)) {
        edits.push({ start: properties.node.getStart(), end: properties.node.getEnd(), text: `fields: ${properties.node.getText()}` });
    }
    const fields = resolveObject(plan.ast, properties.value).node;
    const renamed = new Set<string>();
    if (fields && fields.getSourceFile() === sf) referenceEdits(plan, fields, edits, renamed);
    // A reference written outside the literal (a shared module, a helper's return
    // value, a spread of another collection's properties) is not renamed here, and
    // `defineFirestoreCollection` throws at import on its `path`: name each one.
    const outside = [...evaluatedReferences(entry.collection.properties)].filter(([key]) => !renamed.has(key));
    if (outside.length > 0) {
        plan.manualSteps.push({
            title: `Rename path → target in the references of ${entry.collection.slug} written outside its literal`,
            detail: `\`defineFirestoreCollection\` throws at import on a reference field that sets \`path\` ("sets \`path\`… write target instead"). ` +
                `These reference fields of ${entry.collection.slug} come from outside the collection's literal — a shared module, a helper's return value, or a spread of another collection's \`properties\` — so the codemod did not rename them: ` +
                outside.map(([key, target]) => `fields.${key} (path "${target}")`).join(", ") +
                ". Rename `path` → `target` where each is written. A value read from another converted collection's `properties` is the run-time shape, which carries `path`: spread that collection's `fields` (export them) instead.",
            file: relativeToRoot(plan, destination)
        });
    }

    // The wrapper.
    let parent: Node | undefined = literal.getParent();
    while (parent && (N.isAsExpression(parent) || N.isSatisfiesExpression(parent) || N.isParenthesizedExpression(parent))) parent = parent.getParent();
    if (parent && N.isCallExpression(parent)) {
        const callee = parent.getExpression();
        edits.push({ start: callee.getStart(), end: callee.getEnd(), text: "defineFirestoreCollection" });
        const typeArguments = parent.getTypeArguments();
        if (typeArguments.length > 0) {
            const first = typeArguments[0];
            const last = typeArguments[typeArguments.length - 1];
            edits.push({ start: first.getStart() - 1, end: last.getEnd() + 1, text: "" });
        }
    } else {
        edits.push({ start: literal.getStart(), end: literal.getStart(), text: "defineFirestoreCollection(" });
        edits.push({ start: literal.getEnd(), end: literal.getEnd(), text: ")" });
        if (parent && N.isVariableDeclaration(parent)) {
            const typeNode = parent.getTypeNode();
            if (typeNode) edits.push({ start: parent.getNameNode().getEnd(), end: typeNode.getEnd(), text: "" });
        }
    }
    return edits;
}

/**
 * Plan the move of one Firestore collection file.
 *
 * @param destination where the module goes; `<cmsDir>/<file name>` by default
 * @returns the new module and the identifier its default export can be imported as
 */
export function planFirestoreCollection(plan: PlanContext, entry: CollectionEntry, cmsDir: string, destination = path.join(cmsDir, path.basename(entry.file))): { file: string; identifier: string } | undefined {
    const text = entry.sourceFile.getFullText();
    const sf = plan.ast.project.createSourceFile(`/__rebase_migrate__/firestore-${path.basename(entry.file)}`, text, { overwrite: true });
    try {
        const edits = literalEdits(plan, sf, entry, destination);
        if (!edits) return undefined;
        const { Node: N } = plan.ast.tsm;
        // Drop `defineCollection` from its import, and import the new wrapper.
        for (const declaration of sf.getImportDeclarations()) {
            for (const specifier of declaration.getNamedImports()) {
                if (specifier.getName() !== "defineCollection") continue;
                const named = declaration.getNamedImports();
                if (named.length === 1 && !declaration.getDefaultImport() && !declaration.getNamespaceImport()) {
                    // The statement and its line break; its leading comments stay (they may be the file's header).
                    const end = sf.getFullText()[declaration.getEnd()] === "\n" ? declaration.getEnd() + 1 : declaration.getEnd();
                    edits.push({ start: declaration.getStart(), end, text: "" });
                } else {
                    const end = sf.getFullText()[specifier.getEnd()] === "," ? specifier.getEnd() + 1 : specifier.getEnd();
                    edits.push({ start: specifier.getStart(), end, text: "" });
                }
            }
        }
        // A component named by its module path (`Field: "../../src/X"`, which 0.30's Vite plugin
        // loaded lazily) is imported by value: 0.31 takes the component itself.
        const componentImports = new Map<string, string>();
        const taken = new Set(sf.getDescendantsOfKind(plan.ast.tsm.SyntaxKind.Identifier).map(identifier => identifier.getText()));
        for (const literal of sf.getDescendantsOfKind(plan.ast.tsm.SyntaxKind.StringLiteral)) {
            // `Field: "../X"`, or `Field: "../X" as any` (how 0.30 code got a path past the component type).
            const written: Node = N.isAsExpression(literal.getParent()) ? literal.getParentOrThrow() : literal;
            const parent = written.getParent();
            if (!N.isPropertyAssignment(parent) || parent.getInitializer() !== written || !COMPONENT_KEYS.has(parent.getName())) continue;
            const value = literal.getLiteralValue();
            if (!value.startsWith("./") && !value.startsWith("../")) continue;
            let local = componentImports.get(value);
            if (!local) {
                const stem = path.basename(value).replace(/\.(tsx?|jsx?)$/, "");
                const base = stem.split(/[^A-Za-z0-9]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join("") || "Component";
                local = base;
                for (let counter = 2; taken.has(local); counter++) local = `${base}${counter}`;
                taken.add(local);
                componentImports.set(value, local);
            }
            edits.push({ start: written.getStart(), end: written.getEnd(), text: local });
        }
        const imports = sf.getImportDeclarations();
        const insertAt = imports.length > 0 ? imports[0].getStart() : 0;
        const componentLines = [...componentImports].map(([specifier, local]) => `import ${local} from ${JSON.stringify(specifier)};\n`).join("");
        edits.push({ start: insertAt, end: insertAt, text: `import { defineFirestoreCollection } from "@rebasepro/firebase";\n${componentLines}` });
        let out = text;
        for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
        out = plan.relocator.moveSpecifiersInText(out, entry.file, destination, "frontend");
        planFile(plan, destination, out, `firestore collection ${entry.collection.slug}`);
        const site = findCollectionSite(plan.ast, entry.sourceFile);
        const binding = site.node?.binding;
        return { file: destination, identifier: binding ?? `${entry.collection.slug.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) => (next ?? "").toUpperCase())}Collection` };
    } catch (error) {
        refuse(plan, entry, error instanceof Error ? error.message : String(error));
        return undefined;
    } finally {
        plan.ast.project.removeSourceFile(sf);
    }
}
