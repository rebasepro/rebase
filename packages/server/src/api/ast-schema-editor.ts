import { Project, SyntaxKind, Node, ObjectLiteralExpression, ObjectLiteralElementLike, PropertyAssignment, SourceFile, IndentationText } from "ts-morph";
import { nestAdminCollectionKeys, nestAdminPropertyKeys } from "@rebasepro/types";
import * as path from "path";
import * as fs from "fs";

/**
 * The helpers a collection file may be wrapped in.
 *
 * `rebase init` scaffolds every collection as
 * `const postsCollection = defineCollection({ … })` — a call expression, not the
 * bare object literal `rebase introspect` emits. An editor that only understood
 * the bare form found nothing to patch in any stock project, and then rewrote the
 * file from the panel's JSON: no wrapper, no imports, no relation thunks.
 */
const COLLECTION_FACTORIES = new Set(["defineCollection"]);

/**
 * A value that must be emitted as source code rather than as JSON.
 *
 * Everything reaching the writer has been through `JSON.stringify` on the wire,
 * so a function-valued key arrives either missing or as a string. A relation's
 * `target` is a thunk in the file and a slug in the payload; this is how the
 * thunk gets written back.
 */
class RawExpression {
    constructor(public readonly text: string) {
    }
}

/**
 * Move presentation keys into the `admin` block.
 *
 * The rule itself lives in `@rebasepro/types`, next to `ADMIN_COLLECTION_KEYS`,
 * because `@rebasepro/admin-types` has to apply the identical one on the panel's
 * side and this package cannot import that one. Two copies used to exist and
 * they disagreed about precedence, which decided whether a presentation edit was
 * saved or silently reverted to the value the user had just changed away from.
 */
export function nestAdminKeys(collectionData: Record<string, unknown>): Record<string, unknown> {
    return nestAdminCollectionKeys(collectionData);
}

export class AstSchemaEditor {
    private project: Project;
    private collectionsDir: string;

    constructor(collectionsDir: string) {
        this.project = new Project({
            manipulationSettings: {
                indentationText: IndentationText.FourSpaces
            }
        });
        if (fs.existsSync(collectionsDir)) {
            this.project.addSourceFilesAtPaths(`${collectionsDir}/**/*.ts`);
        }
        this.collectionsDir = path.resolve(collectionsDir);
    }

    /**
     * Sanitize collectionId to prevent path traversal attacks.
     * Only allows alphanumeric characters, underscores, and hyphens.
     */
    private sanitizeCollectionId(collectionId: string): string {
        const sanitized = collectionId.replace(/[^a-zA-Z0-9_-]/g, "");
        if (!sanitized || sanitized !== collectionId) {
            throw new Error(`Invalid collection ID: "${collectionId}". Only alphanumeric characters, underscores, and hyphens are allowed.`);
        }
        return sanitized;
    }

    /**
     * Resolve a file path and ensure it falls within the collectionsDir.
     */
    private safePath(filename: string): string {
        const resolved = path.resolve(this.collectionsDir, filename);
        if (!resolved.startsWith(this.collectionsDir + path.sep) && resolved !== this.collectionsDir) {
            throw new Error("Path traversal detected: resolved path is outside the collections directory.");
        }
        return resolved;
    }

    private getCollectionFile(collectionId: string) {
        const safeId = this.sanitizeCollectionId(collectionId);
        const filePath = this.safePath(`${safeId}.ts`);
        let file = this.project.getSourceFile(filePath);
        if (!file && fs.existsSync(filePath)) {
            this.project.addSourceFilesAtPaths(`${this.collectionsDir}/**/*.ts`);
            file = this.project.getSourceFile(filePath);
        }
        return file;
    }

    /**
     * Find the object literal a collection is declared with, through whatever
     * wraps it.
     *
     * `defineCollection({ … })` is the shape `rebase init` writes and the one the
     * docs recommend; `satisfies` / `as` / parentheses are the other ways an
     * author can dress the same literal. Returning `null` for any of them meant
     * the three callers below each failed differently, and the worst of them
     * overwrote the file.
     */
    private unwrapCollectionObject(node: Node | undefined): ObjectLiteralExpression | null {
        if (!node) return null;
        if (Node.isObjectLiteralExpression(node)) return node;
        if (Node.isParenthesizedExpression(node) ||
            Node.isAsExpression(node) ||
            Node.isSatisfiesExpression(node) ||
            Node.isTypeAssertion(node) ||
            Node.isNonNullExpression(node)) {
            return this.unwrapCollectionObject(node.getExpression());
        }
        if (Node.isCallExpression(node)) {
            // `defineCollection`, `admin.defineCollection`, `defineCollection<Post>`
            const callee = node.getExpression().getText().split(".").pop();
            if (callee && COLLECTION_FACTORIES.has(callee)) {
                return this.unwrapCollectionObject(node.getArguments()[0]);
            }
        }
        return null;
    }

    private getCollectionObject(collectionId: string): ObjectLiteralExpression | null {
        const file = this.getCollectionFile(collectionId);
        if (!file) return null;

        const defaultExport = file.getDefaultExportSymbol();
        if (defaultExport) {
            const declaration = defaultExport.getDeclarations()[0];
            if (declaration && declaration.getKind() === SyntaxKind.ExportAssignment) {
                const expr = declaration.asKind(SyntaxKind.ExportAssignment)?.getExpression();
                if (expr && expr.getKind() === SyntaxKind.Identifier) {
                    const varName = expr.getText();
                    const varDecl = file.getVariableDeclaration(varName);
                    const unwrapped = this.unwrapCollectionObject(varDecl?.getInitializer());
                    if (unwrapped) return unwrapped;
                } else {
                    // `export default defineCollection({ … })`
                    const unwrapped = this.unwrapCollectionObject(expr);
                    if (unwrapped) return unwrapped;
                }
            }
        }
        // Fallback: the first VariableDeclaration that holds a collection literal
        for (const varDecl of file.getVariableDeclarations()) {
            const init = this.unwrapCollectionObject(varDecl.getInitializer());
            if (init) return init;
        }
        return null;
    }

    /**
     * The collection's object literal, or a refusal that says what to do.
     *
     * Every caller needs this to be all-or-nothing: a missing object literal used
     * to mean "throw", "report success and do nothing" and "recreate the file
     * from scratch" depending on which method you called.
     */
    private requireCollectionObject(collectionId: string): ObjectLiteralExpression {
        const file = this.getCollectionFile(collectionId);
        if (!file) {
            throw new Error(`Collection "${collectionId}" has no file at ${path.join(this.collectionsDir, `${collectionId}.ts`)}.`);
        }
        const collectionObj = this.getCollectionObject(collectionId);
        if (!collectionObj) {
            throw new Error(this.unreadableFileMessage(collectionId, file));
        }
        return collectionObj;
    }

    private unreadableFileMessage(collectionId: string, file: SourceFile): string {
        return `Could not find the collection object in ${file.getFilePath()}. ` +
            "The schema editor can only edit a collection declared as `const x = defineCollection({ … })` " +
            "or `const x: CollectionConfig = { … }` and exported as the file's default. " +
            `Edit "${collectionId}" in code instead.`;
    }

    /** Look a key up on an object literal, quoted or not. */
    private findProperty(obj: ObjectLiteralExpression, name: string): ObjectLiteralElementLike | undefined {
        return obj.getProperty((p: ObjectLiteralElementLike) =>
            "getName" in p &&
            typeof (p as PropertyAssignment).getName === "function" &&
            ((p as PropertyAssignment).getName() === name ||
                (p as PropertyAssignment).getName() === `"${name}"` ||
                (p as PropertyAssignment).getName() === `'${name}'`));
    }

    private static quoteKey(key: string): string {
        return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    }

    private static isPlainObject(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof RawExpression);
    }

    private convertJsonToAstString(obj: unknown, indentLevel = 0, oldAstNode?: ObjectLiteralExpression): string {
        // Base TS-morph parses arrays as 2 levels deep from the property key:
        // PropertiesObject = level 1, PropertyConfig = level 2.
        // We calibrate the spacing multiples to keep the items flush with standard TS format.
        const indentStr = "    ";
        const indent = indentStr.repeat(indentLevel);
        const innerIndent = indentStr.repeat(indentLevel + 1);

        if (obj instanceof RawExpression) {
            return obj.text;
        }
        if (obj === null || obj === undefined) {
            return "undefined";
        }
        if (typeof obj === "string") {
            return JSON.stringify(obj);
        }
        if (typeof obj === "number" || typeof obj === "boolean") {
            return String(obj);
        }
        if (Array.isArray(obj)) {
            if (obj.length === 0) return "[]";
            const items = obj.map(item => this.convertJsonToAstString(item, indentLevel + 1));
            return `[\n${innerIndent}${items.join(`,\n${innerIndent}`)}\n${indent}]`;
        }
        if (typeof obj === "object") {
            const record = obj as Record<string, unknown>;
            const keys = Object.keys(record);

            // Collect preserved AST properties
            const preservedProps: string[] = [];
            if (oldAstNode) {
                const oldProps = oldAstNode.getProperties();
                for (const oldProp of oldProps) {
                    if (oldProp.isKind(SyntaxKind.PropertyAssignment)) {
                        const nameNode = oldProp.getNameNode();
                        let name = nameNode.getText();
                        if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1);
                        if (name.startsWith("'") && name.endsWith("'")) name = name.slice(1, -1);

                        // If the JSON object doesn't have this key, check if we should preserve it
                        if (!(name in record)) {
                            const init = oldProp.getInitializer();
                            if (init) {
                                const kind = init.getKind();
                                const isCode = kind === SyntaxKind.ArrowFunction ||
                                    kind === SyntaxKind.FunctionExpression ||
                                    kind === SyntaxKind.Identifier ||
                                    kind === SyntaxKind.CallExpression ||
                                    kind === SyntaxKind.JsxElement;

                                if (isCode || name === "target" || name === "callbacks" || name === "permissions" || name === "securityRules") {
                                    // Preserve this property exactly as it was
                                    preservedProps.push(`${AstSchemaEditor.quoteKey(name)}: ${init.getText()}`);
                                }
                            }
                        }
                    }
                }
            }

            if (keys.length === 0 && preservedProps.length === 0) return "{}";

            const props = keys.map(key => {
                const keyStr = AstSchemaEditor.quoteKey(key);

                // If the value is an object, pass the old AST node to recurse
                let childAstNode: ObjectLiteralExpression | undefined;
                if (oldAstNode && AstSchemaEditor.isPlainObject(record[key])) {
                    const oldProp = this.findProperty(oldAstNode, key);
                    if (oldProp && oldProp.isKind(SyntaxKind.PropertyAssignment)) {
                        childAstNode = oldProp.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
                    }
                }

                return `${keyStr}: ${this.convertJsonToAstString(record[key], indentLevel + 1, childAstNode)}`;
            });

            const allProps = [...props, ...preservedProps];
            return `{\n${innerIndent}${allProps.join(`,\n${innerIndent}`)}\n${indent}}`;
        }
        return "undefined";
    }

    /**
     * Write only the keys the patch names, leaving every sibling alone.
     *
     * A patch says what changed, not what the collection is. The panel sends one
     * — `{ propertiesOrder }` is what adding a column posts — and rewriting the
     * `admin` block from it deleted the collection's icon, group, list columns
     * and kanban config in the same write.
     */
    private mergeIntoObjectLiteral(target: ObjectLiteralExpression, data: Record<string, unknown>, indentLevel: number): void {
        for (const [key, value] of Object.entries(data)) {
            const existing = this.findProperty(target, key);
            const existingObj = existing && existing.isKind(SyntaxKind.PropertyAssignment)
                ? existing.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression)
                : undefined;

            if (existingObj && AstSchemaEditor.isPlainObject(value)) {
                this.mergeIntoObjectLiteral(existingObj, value, indentLevel + 1);
                continue;
            }

            const initializer = this.convertJsonToAstString(value, indentLevel, existingObj);
            if (existing && existing.isKind(SyntaxKind.PropertyAssignment)) {
                existing.setInitializer(initializer);
            } else {
                target.addPropertyAssignment({
                    name: AstSchemaEditor.quoteKey(key),
                    initializer
                });
            }
        }
    }

    public async saveProperty(collectionId: string, propertyKey: string, propertyConfig: Record<string, unknown>) {
        const collectionObj = this.requireCollectionObject(collectionId);

        // The panel's property forms bind to the flat names — `readOnly`,
        // `hideFromCollection` — while on disk they belong inside the property's
        // own `admin` block. Written flat they are not merely ignored: the boot
        // validator treats a moved key as fatal.
        const nestedConfig = nestAdminPropertyKeys(propertyConfig);

        let propertiesProp = collectionObj.getProperty("properties") as PropertyAssignment;
        if (!propertiesProp) {
            propertiesProp = collectionObj.addPropertyAssignment({
                name: "properties",
                initializer: "{}"
            });
        }

        const propsObj = propertiesProp.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
        if (propsObj) {
            const existingProp = this.findProperty(propsObj, propertyKey);

            let oldPropAstNode: ObjectLiteralExpression | undefined;
            if (existingProp && existingProp.isKind(SyntaxKind.PropertyAssignment)) {
                oldPropAstNode = existingProp.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
            }

            const newInitializer = this.convertJsonToAstString(nestedConfig, 2, oldPropAstNode);

            if (existingProp) {
                if (existingProp.isKind(SyntaxKind.PropertyAssignment)) {
                    existingProp.setInitializer(newInitializer);
                }
            } else {
                propsObj.addPropertyAssignment({
                    name: AstSchemaEditor.quoteKey(propertyKey),
                    initializer: newInitializer
                });
            }

            const file = this.getCollectionFile(collectionId);
            if (file) {
                file.formatText();
            }
            await this.project.save();
        }
    }

    public async deleteProperty(collectionId: string, propertyKey: string) {
        const collectionObj = this.requireCollectionObject(collectionId);

        const propertiesProp = collectionObj.getProperty("properties") as PropertyAssignment;
        if (propertiesProp) {
            const propsObj = propertiesProp.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
            if (propsObj) {
                const existingProp = this.findProperty(propsObj, propertyKey);
                if (existingProp) {
                    existingProp.remove();
                    const file = this.getCollectionFile(collectionId);
                    if (file) {
                        file.formatText();
                    }
                    await this.project.save();
                }
            }
        }
    }

    /**
     * Write a collection back to its file.
     *
     * `partial` is the difference between "this is the collection" and "this is
     * what changed about it". The panel sends both — a full save from the editor
     * dialog, and a one-key patch whenever a property is added, deleted or
     * reordered — and they cannot be told apart by looking at the payload. Read
     * as a full save, a patch deletes everything it does not mention, including
     * `securityRules`; the loader then hands the collection the directory
     * default, which in the scaffold is `access: "public"`.
     */
    public async saveCollection(collectionId: string, collectionData: Record<string, unknown>, options: { partial?: boolean } = {}) {
        const partial = options.partial === true;
        let file = this.getCollectionFile(collectionId);
        const collectionObj = file ? this.getCollectionObject(collectionId) : null;

        if (file && !collectionObj) {
            // The file is there and we could not read it. Recreating it from the
            // panel's JSON would drop the imports, the callbacks and the relation
            // thunks that JSON cannot carry.
            throw new Error(this.unreadableFileMessage(collectionId, file));
        }

        if (!file || !collectionObj) {
            if (partial) {
                throw new Error(`Cannot apply a partial update to "${collectionId}": it has no collection file yet.`);
            }
            // Create a new file
            const safeId = this.sanitizeCollectionId(collectionId);
            const newFilePath = this.safePath(`${safeId}.ts`);
            if (fs.existsSync(newFilePath)) {
                throw new Error(`Refusing to overwrite ${newFilePath}: a file for "${collectionId}" already exists but could not be parsed.`);
            }
            file = this.project.createSourceFile(newFilePath, `import { CollectionConfig } from "@rebasepro/types";\n\nconst ${safeId}Collection: CollectionConfig = ${this.convertJsonToAstString(nestAdminKeys(collectionData))};\n\nexport default ${safeId}Collection;\n`);
        } else {
            // Update root level properties gracefully

            if (!partial) {
                // Force delete securityRules if empty or undefined to handle Formex / serialization stripping
                if (!("securityRules" in collectionData) || collectionData.securityRules === undefined || (Array.isArray(collectionData.securityRules) && collectionData.securityRules.length === 0)) {
                    const srProp = collectionObj.getProperty("securityRules");
                    if (srProp) {
                        srProp.remove();
                    }

                    // If it was in collectionData as an empty array, delete it so the loop below doesn't add it back as "[]"
                    // Actually, if it's "[]", omitting it entirely from the TS file achieves the same logical effect (no RLS rules)
                    // and correctly triggers "unmapped policies" if the DB still has them.
                    delete collectionData["securityRules"];
                }
            }

            // The panel works with a flat view model — presentation merged onto the
            // collection — so what arrives here has `icon` and `listProperties` at
            // the top level. On disk they belong inside `admin`. Writing them flat
            // would produce a file the backend loads and ignores and the panel
            // never reads back, which looks exactly like the edit not saving.
            collectionData = nestAdminKeys(collectionData);

            for (const key of Object.keys(collectionData)) {
                if (key === "relations") {
                    this.writeRelations(collectionId, file, collectionObj, collectionData[key]);
                    continue;
                }

                const prop = collectionObj.getProperty(key) as PropertyAssignment;

                let oldAstNode: ObjectLiteralExpression | undefined;
                if (prop && prop.isKind(SyntaxKind.PropertyAssignment)) {
                    oldAstNode = prop.getInitializerIfKind(SyntaxKind.ObjectLiteralExpression);
                }

                if (partial && oldAstNode && AstSchemaEditor.isPlainObject(collectionData[key])) {
                    this.mergeIntoObjectLiteral(oldAstNode, collectionData[key] as Record<string, unknown>, 2);
                    continue;
                }

                const newInit = this.convertJsonToAstString(collectionData[key], 1, oldAstNode);
                if (prop) {
                    prop.setInitializer(newInit);
                } else {
                    collectionObj.addPropertyAssignment({
                        name: key,
                        initializer: newInit
                    });
                }
            }
        }
        if (file) {
            file.formatText();
        }
        await this.project.save();
    }

    /**
     * Write the collection-level `relations` array.
     *
     * Relations are the one key whose values are not all data: `target` is a
     * thunk in the file, and the panel sends the target collection's slug (or,
     * for a relation it did not touch, nothing at all — `JSON.stringify` drops
     * the function). So each entry's target is resolved in that order: a slug
     * becomes `() => xCollection` plus the import it needs, and anything else
     * falls back to the thunk already in the file.
     *
     * This used to be a `continue` with a comment saying relations were handled
     * elsewhere. Nothing handled them; every edit in the Relations tab was
     * dropped without a word.
     */
    private writeRelations(collectionId: string, file: SourceFile, collectionObj: ObjectLiteralExpression, value: unknown): void {
        if (!Array.isArray(value)) return;

        const existing = this.findProperty(collectionObj, "relations");
        const oldArray = existing && existing.isKind(SyntaxKind.PropertyAssignment)
            ? existing.getInitializerIfKind(SyntaxKind.ArrayLiteralExpression)
            : undefined;

        const oldElements = oldArray?.getElements() ?? [];
        const oldTargetsByName = new Map<string, string>();
        // Only for entries the file left unnamed — `relationName` is optional, and
        // those cannot be matched any other way. Positional matching is off the
        // moment the array's length changes, because then a position no longer
        // means the same relation.
        const anonymousTargetsByIndex: (string | undefined)[] = [];
        oldElements.forEach((element, index) => {
            const elementObj = element.asKind(SyntaxKind.ObjectLiteralExpression);
            if (!elementObj) return;
            const targetProp = this.findProperty(elementObj, "target");
            const targetInit = targetProp && targetProp.isKind(SyntaxKind.PropertyAssignment)
                ? targetProp.getInitializer()
                : undefined;
            if (!targetInit) return;

            const nameProp = this.findProperty(elementObj, "relationName");
            const nameInit = nameProp && nameProp.isKind(SyntaxKind.PropertyAssignment)
                ? nameProp.getInitializerIfKind(SyntaxKind.StringLiteral)
                : undefined;
            if (nameInit) oldTargetsByName.set(nameInit.getLiteralValue(), targetInit.getText());
            else anonymousTargetsByIndex[index] = targetInit.getText();
        });

        const items = value.map((entry, index) => {
            if (!AstSchemaEditor.isPlainObject(entry)) return entry;
            const relation: Record<string, unknown> = { ...entry };
            const relationName = typeof relation.relationName === "string" ? relation.relationName : undefined;
            const rawTarget = relation.target;

            let targetText: string | undefined;
            if (typeof rawTarget === "string" && rawTarget.trim().length > 0) {
                targetText = rawTarget.includes("=>")
                    ? rawTarget.trim()
                    : this.targetThunk(file, rawTarget.trim());
            } else if (relationName && oldTargetsByName.has(relationName)) {
                targetText = oldTargetsByName.get(relationName);
            } else if (value.length === oldElements.length) {
                targetText = anonymousTargetsByIndex[index];
            }

            if (!targetText) {
                throw new Error(`Relation "${relationName ?? `#${index}`}" on collection "${collectionId}" has no target collection. Pick one before saving.`);
            }

            relation.target = new RawExpression(targetText);
            return relation;
        });

        const initializer = this.convertJsonToAstString(items, 1);
        if (existing && existing.isKind(SyntaxKind.PropertyAssignment)) {
            existing.setInitializer(initializer);
        } else {
            collectionObj.addPropertyAssignment({ name: "relations", initializer });
        }
    }

    /**
     * `() => targetCollection` for a target named by its slug, importing it if
     * the file does not already.
     */
    private targetThunk(file: SourceFile, targetSlug: string): string {
        const targetFile = this.getCollectionFile(targetSlug);
        if (!targetFile) {
            throw new Error(`Cannot link to collection "${targetSlug}": no file for it in ${this.collectionsDir}.`);
        }

        const identifier = this.getDefaultExportName(targetFile);
        if (!identifier) {
            throw new Error(`Cannot link to collection "${targetSlug}": ${targetFile.getFilePath()} has no default export to import.`);
        }

        if (targetFile.getFilePath() !== file.getFilePath() && !this.hasDefaultImport(file, identifier)) {
            const relative = path.relative(path.dirname(file.getFilePath()), targetFile.getFilePath())
                .split(path.sep)
                .join("/")
                .replace(/\.tsx?$/, ".js");
            file.addImportDeclaration({
                defaultImport: identifier,
                moduleSpecifier: relative.startsWith(".") ? relative : `./${relative}`
            });
        }

        return `() => ${identifier}`;
    }

    private hasDefaultImport(file: SourceFile, identifier: string): boolean {
        return file.getImportDeclarations().some(decl => decl.getDefaultImport()?.getText() === identifier);
    }

    private getDefaultExportName(file: SourceFile): string | undefined {
        const declaration = file.getDefaultExportSymbol()?.getDeclarations()[0];
        const expr = declaration?.asKind(SyntaxKind.ExportAssignment)?.getExpression();
        if (expr && expr.getKind() === SyntaxKind.Identifier) return expr.getText();

        for (const varDecl of file.getVariableDeclarations()) {
            if (this.unwrapCollectionObject(varDecl.getInitializer())) return varDecl.getName();
        }
        return undefined;
    }

    public async deleteCollection(collectionId: string) {
        const file = this.getCollectionFile(collectionId);
        if (file) {
            file.deleteImmediatelySync();
        }
    }
}
