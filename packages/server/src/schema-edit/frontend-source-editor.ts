import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Node, Project, ts, type CallExpression, type ObjectLiteralExpression, type SourceFile } from "ts-morph";
import { printSchemaValue } from "@rebasepro/common";

import { IDENTIFIER, isData, member, memberName, opaqueMembers, printKey, unwrapExpression, literalString } from "../api/table-source-editor";
import { applyEdits, insertListItem, itemText, listShape, removeListItem, replaceNode, type TextEdit } from "./source-text";

/**
 * Edits to the object-literal argument of one call in the project's frontend
 * source, from the admin panel, in development.
 *
 * The backend knows nothing about what the call means. A request names a
 * callee (`defineFirestoreCollection`), the key and string value that pick
 * one call out (`slug: "fs_events"`), and a list of operations on paths into
 * the call's object argument: set a value, remove a key, rename a key, move a
 * key. What those calls are — a Firestore collection, its fields — is the
 * admin panel's business, which translates its own edits into these.
 *
 * The safety model is the table source editor's ({@link TableSourceEditor}):
 *
 * - **Byte-preserving.** It parses with ts-morph to find positions and writes
 *   by splicing printed text at them (`source-text.ts`), so comments, imports,
 *   functions, JSX and every key it was not asked to touch stay byte for byte.
 * - **Never executes the wire.** Every value is JSON, printed as a literal
 *   (`printSchemaValue`); every key is printed as an identifier only when it
 *   is one, quoted otherwise. Nothing a request carries is evaluated, imported
 *   or spliced as code.
 * - **Edited in code is left alone.** A value that is not plain data — a
 *   function, a component, a variable, a call — is never overwritten; an object
 *   that spreads another, or has a computed key, is never written into. The
 *   edit is refused with the reason, and {@link FrontendSourceEditor.describe}
 *   reports those places so the panel shows them read-only.
 * - **Preview, check, write, roll back.** An edit is applied to a copy of the
 *   text, the result parsed and read back (each value set must read back as
 *   exactly that value), and only then written — refused if the file changed
 *   on disk since the edit read it (the panel's `version`, or another save in
 *   between). The optional `check` runs over the written files (a project's
 *   own compile); when it fails, every file is restored as it was.
 *
 * @group Schema
 */
export class FrontendSourceEditor {
    private settled: Promise<unknown> = Promise.resolve();
    /** The directory searched for calls, absolute: the project's `frontend/src`. */
    readonly sourceDir: string;
    /** The directory paths are reported relative to: the project root. */
    readonly root: string;
    private readonly check?: FrontendSourceCheck;

    /**
     * @param sourceDir the directory searched for calls: the project's `frontend/src`
     * @param options.root what paths are reported relative to (default: two levels above `sourceDir`)
     * @param options.check a compile over the written files; problems roll the edit back
     */
    constructor(sourceDir: string, options: { root?: string; check?: FrontendSourceCheck } = {}) {
        this.sourceDir = path.resolve(sourceDir);
        this.root = path.resolve(options.root ?? path.dirname(path.dirname(this.sourceDir)));
        this.check = options.check;
    }

    /** Run `work` once every edit queued before it has finished. */
    run<T>(work: () => Promise<T>): Promise<T> {
        const result = this.settled.then(work);
        this.settled = result.then(() => undefined, () => undefined);
        return result;
    }

    /**
     * Every call to `callee` in the source directory, picked out by its `key`
     * member, as the editor reads it: its file, its `version`, and where it
     * is edited in code. `lists` names paths into the argument whose members
     * are each reported (`[["fields"]]`: each field, and whether it is an
     * object literal the editor can write).
     */
    describe(callee: string, key: string, lists: readonly (readonly string[])[] = []): FrontendCallSummary[] {
        assertIdentifier(callee, "callee");
        const out: FrontendCallSummary[] = [];
        for (const file of sourceFiles(this.sourceDir)) {
            const text = fs.readFileSync(file, "utf8");
            if (!text.includes(callee)) continue;
            const source = parse(file, text);
            for (const call of callsTo(source, callee)) {
                const located = locateArgument(call, key);
                if (!located) continue;
                const summary: FrontendCallSummary = {
                    value: located.value,
                    file: this.relative(file),
                    version: versionOf(text),
                    members: {}
                };
                if (located.editedInCode) summary.editedInCode = located.editedInCode;
                else if (located.object) {
                    for (const list of lists) {
                        const reached = reach(located.object, list);
                        if (reached.kind === "code") {
                            summary.members[list.join(".")] = reached.reason;
                            continue;
                        }
                        if (reached.kind !== "object") continue;
                        const opaque = opaqueMembers(reached.object, `\`${list.join(".")}\``);
                        for (const each of reached.object.getProperties()) {
                            const name = memberName(each);
                            if (name === undefined) continue;
                            const where = [...list, name].join(".");
                            if (opaque) {
                                summary.members[where] = opaque;
                                continue;
                            }
                            const value = Node.isPropertyAssignment(each) ? unwrapExpression(each.getInitializer()) : undefined;
                            if (!value) summary.members[where] = `\`${where}\` is ${Node.isShorthandPropertyAssignment(each) ? "a variable" : "a method"}.`;
                            else if (!Node.isObjectLiteralExpression(value)) summary.members[where] = `\`${where}\` is \`${clip(value.getText())}\`, not an object written in the call.`;
                            else {
                                const inner = opaqueMembers(value, `\`${where}\``);
                                if (inner) summary.members[where] = inner;
                            }
                        }
                    }
                }
                out.push(summary);
            }
        }
        return out;
    }

    /**
     * Apply `request` to a copy of its file and read the result back. Writes
     * nothing: the edit is refused (a {@link FrontendSourceEditError}) or
     * returned, with the file it changes.
     */
    async preview(request: FrontendSourceEditRequest): Promise<FrontendSourceEdit> {
        const { target } = request;
        const found = this.locate(target);
        if (request.version !== undefined && request.version !== versionOf(found.text)) {
            throw new FrontendSourceEditError("SCHEMA_EDIT_REFUSED",
                `${this.relative(found.file)} changed since the edit was prepared (it was saved by something else meanwhile). ` +
                "Nothing was written: reload, and make the edit again against the file as it is now.",
                [{ table: target.value, message: "The file changed on disk." }]);
        }
        let text = found.text;
        for (const [index, operation] of request.operations.entries()) {
            try {
                text = applyOperation(found.file, text, target, operation);
            } catch (error) {
                throw asRefusal(error, index, operation, target);
            }
        }
        if (text === found.text) {
            throw new FrontendSourceEditError("SCHEMA_EDIT_REFUSED", `The edit changes nothing in ${this.relative(found.file)}.`, []);
        }
        verify(found.file, text, target, request.operations);
        return { files: [{ path: found.file, contents: text, before: found.text }] };
    }

    /** {@link preview}, then write, check and — when the check fails — roll back. Queued behind every other edit. */
    apply(request: FrontendSourceEditRequest): Promise<FrontendSourceEdit> {
        return this.run(async () => {
            const edit = await this.preview(request);
            await this.write(edit);
            return edit;
        });
    }

    /**
     * Write a previewed edit, refusing when a file changed on disk since the
     * preview read it. A file that does not read back as written, a failure
     * on the way, or a `check` that reports problems restores every file as
     * it was before the write.
     */
    async write(edit: FrontendSourceEdit): Promise<void> {
        for (const file of edit.files) {
            const now = fs.existsSync(file.path) ? fs.readFileSync(file.path, "utf8") : undefined;
            if (now !== file.before) {
                throw new FrontendSourceEditError("SCHEMA_EDIT_REFUSED",
                    `${this.relative(file.path)} changed since the edit was prepared (it was saved by something else meanwhile). ` +
                    "Nothing was written: reload, and make the edit again against the file as it is now.", []);
            }
        }
        const written: FrontendSourceFile[] = [];
        try {
            for (const file of edit.files) {
                await writeWhole(file.path, file.contents);
                written.push(file);
                if (fs.readFileSync(file.path, "utf8") !== file.contents) throw new Error(`${file.path} does not read back as written.`);
            }
            const problems = this.check ? await this.check(edit.files) : [];
            if (problems.length > 0) {
                throw new FrontendSourceEditError("SCHEMA_EDIT_DOES_NOT_COMPILE",
                    `The edit was not kept: it does not compile. ${problems.map(problem => problem.message).join(" ")}`, problems);
            }
        } catch (error) {
            for (const file of written.reverse()) {
                if (file.before === undefined) await fsp.rm(file.path, { force: true });
                else await writeWhole(file.path, file.before);
            }
            throw error;
        }
    }

    /** A path as the panel reads it: relative to the project root, with forward slashes. */
    relative(file: string): string {
        return path.relative(this.root, file).split(path.sep).join("/");
    }

    /** The one call `target` names, or a refusal. */
    private locate(target: FrontendCallTarget): { file: string; text: string } {
        const found: { file: string; text: string }[] = [];
        for (const file of sourceFiles(this.sourceDir)) {
            const text = fs.readFileSync(file, "utf8");
            if (!text.includes(target.callee)) continue;
            const source = parse(file, text);
            for (const call of callsTo(source, target.callee)) {
                if (locateArgument(call, target.key)?.value === target.value) found.push({ file, text });
            }
        }
        if (found.length === 0) {
            throw refusal(
                `No \`${target.callee}({ ${target.key}: ${JSON.stringify(target.value)}, … })\` in ${this.relative(this.sourceDir) || "."}. ` +
                `If it is built by a helper or its \`${target.key}\` is not a string written in the call, it is edited in code.`,
                target.value
            );
        }
        if (found.length > 1) {
            throw refusal(
                `More than one \`${target.callee}\` call has \`${target.key}: ${JSON.stringify(target.value)}\` ` +
                `(${found.map(each => this.relative(each.file)).join(", ")}): edit it in code.`,
                target.value
            );
        }
        return found[0];
    }
}

/**
 * A check over the files an edit wrote, with the edit on disk: a project's
 * own compile. Problems roll the edit back.
 *
 * @group Schema
 */
export type FrontendSourceCheck = (files: readonly FrontendSourceFile[]) => Promise<FrontendSourceProblem[]>;

/**
 * JSON, the only thing a frontend source edit writes as a value.
 *
 * @group Schema
 */
export type FrontendSourceValue = null | boolean | number | string | FrontendSourceValue[] | { [key: string]: FrontendSourceValue };

/**
 * One operation on the object argument of a call, at a path of keys into it.
 *
 * - `set` — write `value` at `path`, replacing what is there (which must be
 *   plain data) or inserting it (before the member `before`, else last),
 *   creating the objects on the way that do not exist yet.
 * - `remove` — remove the key at `path`; nothing when it is absent. With
 *   `prune`, an object the removal leaves empty is removed too.
 * - `rename` — give the key at `path` the name `to`; its value is untouched.
 * - `move` — move the key at `path` before its sibling `before`, else last.
 *
 * @group Schema
 */
export type FrontendSourceOperation =
    | { op: "set"; path: string[]; value: FrontendSourceValue; before?: string }
    | { op: "remove"; path: string[]; prune?: boolean }
    | { op: "rename"; path: string[]; to: string }
    | { op: "move"; path: string[]; before?: string };

/**
 * Which call an edit is about: the call to `callee` whose object argument has
 * the member `key` written as the string `value`.
 *
 * @group Schema
 */
export interface FrontendCallTarget {
    callee: string;
    key: string;
    value: string;
}

/**
 * A frontend source edit, as `POST /api/admin/schema-editor/frontend/apply`
 * takes it.
 *
 * @group Schema
 */
export interface FrontendSourceEditRequest {
    target: FrontendCallTarget;
    /** The file's `version` as the panel read it; a different file is refused as stale. */
    version?: string;
    operations: FrontendSourceOperation[];
}

/**
 * One file an edit changes.
 *
 * @group Schema
 */
export interface FrontendSourceFile {
    /** Absolute path. */
    path: string;
    /** The new text. */
    contents: string;
    /** The text the edit was made against. */
    before?: string;
}

/**
 * An edit, applied to a copy and read back.
 *
 * @group Schema
 */
export interface FrontendSourceEdit {
    files: FrontendSourceFile[];
}

/**
 * How the editor reads one call.
 *
 * @group Schema
 */
export interface FrontendCallSummary {
    /** The value of the key it was picked out by (a collection's slug). */
    value: string;
    /** Its file, relative to the project root. */
    file: string;
    /** A hash of the file's text: sent back with an edit, a changed file is refused. */
    version: string;
    /** Why the whole call is read-only, when it is. */
    editedInCode?: string;
    /** Why a member of a listed path is read-only, by dotted path (`fields.customerId`). */
    members: Record<string, string>;
}

/**
 * What is wrong with an edit. `table` names the call by the value it was
 * picked out by — the shape the panel reads every schema-edit problem in.
 *
 * @group Schema
 */
export interface FrontendSourceProblem {
    table: string;
    /** The dotted path, when there is one. */
    key?: string;
    message: string;
}

/**
 * An edit the frontend source editor will not make. Nothing was written (or
 * what was written was restored).
 *
 * @group Schema
 */
export class FrontendSourceEditError extends Error {
    constructor(
        readonly code: "SCHEMA_EDIT_REFUSED" | "SCHEMA_EDIT_DOES_NOT_COMPILE" | "INVALID_INPUT",
        message: string,
        readonly problems: readonly FrontendSourceProblem[]
    ) {
        super(message);
        this.name = "FrontendSourceEditError";
    }
}

// ── The wire ────────────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

function isValue(value: unknown, depth = 0): value is FrontendSourceValue {
    if (depth > 32) return false;
    if (value === null || typeof value === "boolean" || typeof value === "string") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(item => isValue(item, depth + 1));
    if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.values(value).every(item => isValue(item, depth + 1));
    }
    return false;
}

const isKeyPath = (value: unknown): value is string[] =>
    Array.isArray(value) && value.length > 0 && value.every(segment => typeof segment === "string" && segment.length > 0);

function assertIdentifier(value: string, what: string): void {
    if (!IDENTIFIER.test(value)) throw new FrontendSourceEditError("INVALID_INPUT", `\`${what}\` must be an identifier, not ${JSON.stringify(value)}.`, []);
}

/**
 * The edit a request body describes, or an `INVALID_INPUT` refusal naming
 * every problem. Values must be JSON; the callee an identifier; paths
 * non-empty lists of keys.
 *
 * @group Schema
 */
export function parseFrontendSourceEdit(body: unknown): FrontendSourceEditRequest {
    const problems: string[] = [];
    if (!isRecord(body)) throw new FrontendSourceEditError("INVALID_INPUT", "Expected `{ target, operations }`.", []);
    const target = body.target;
    if (!isRecord(target) || typeof target.callee !== "string" || typeof target.key !== "string" || typeof target.value !== "string") {
        problems.push("`target` must be `{ callee, key, value }`, three strings.");
    } else if (!IDENTIFIER.test(target.callee)) {
        problems.push(`\`target.callee\` must be an identifier, not ${JSON.stringify(target.callee)}.`);
    }
    if (body.version !== undefined && typeof body.version !== "string") problems.push("`version` must be a string.");
    const operations: FrontendSourceOperation[] = [];
    if (!Array.isArray(body.operations) || body.operations.length === 0) {
        problems.push("`operations` must be a non-empty list.");
    } else {
        body.operations.forEach((operation: unknown, index) => {
            const where = `operations[${index}]`;
            if (!isRecord(operation) || !isKeyPath(operation.path)) {
                problems.push(`${where} needs a \`path\`: a non-empty list of keys.`);
                return;
            }
            const before = operation.before;
            if (before !== undefined && typeof before !== "string") {
                problems.push(`${where}.before must be a key.`);
                return;
            }
            switch (operation.op) {
                case "set":
                    if (!("value" in operation) || !isValue(operation.value)) {
                        problems.push(`${where}.value must be JSON: strings, finite numbers, booleans, null, arrays and plain objects.`);
                        return;
                    }
                    operations.push({ op: "set", path: operation.path, value: operation.value, ...(before !== undefined ? { before } : {}) });
                    return;
                case "remove":
                    operations.push({ op: "remove", path: operation.path, ...(operation.prune === true ? { prune: true } : {}) });
                    return;
                case "rename":
                    if (typeof operation.to !== "string" || operation.to.length === 0) {
                        problems.push(`${where}.to must be a key.`);
                        return;
                    }
                    operations.push({ op: "rename", path: operation.path, to: operation.to });
                    return;
                case "move":
                    operations.push({ op: "move", path: operation.path, ...(before !== undefined ? { before } : {}) });
                    return;
                default:
                    problems.push(`${where}.op must be one of set, remove, rename, move.`);
            }
        });
    }
    if (problems.length > 0 || !isRecord(target)) {
        throw new FrontendSourceEditError("INVALID_INPUT", `The frontend source edit is not well formed: ${problems.join(" ")}`,
            problems.map(message => ({ table: "", message })));
    }
    return {
        target: { callee: String(target.callee), key: String(target.key), value: String(target.value) },
        ...(typeof body.version === "string" ? { version: body.version } : {}),
        operations
    };
}

// ── Reading ─────────────────────────────────────────────────────────────────

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

/** The module files of the frontend source, in path order. */
function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) return out;
    const walk = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__tests__") continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && SOURCE_EXTENSIONS.some(ext => entry.name.endsWith(ext))
                && !/\.d\.[mc]?ts$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
                out.push(full);
            }
        }
    };
    walk(dir);
    return out.sort();
}

/** The text of a file parsed on its own, JSX by its extension. */
function parse(file: string, text: string): SourceFile {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, noLib: true, jsx: ts.JsxEmit.Preserve } });
    return project.createSourceFile(file, text, { overwrite: true });
}

/** The syntax errors of a text, as messages. */
function syntaxErrors(file: string, text: string): string[] {
    const result = ts.transpileModule(text, {
        fileName: file,
        reportDiagnostics: true,
        compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
    });
    return (result.diagnostics ?? []).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

/** Every call whose callee ends in `callee`: `defineX(…)`, `lib.defineX(…)`. */
function callsTo(source: SourceFile, callee: string): CallExpression[] {
    return source.getDescendants().filter((node): node is CallExpression => {
        if (!Node.isCallExpression(node)) return false;
        const expression = node.getExpression();
        if (Node.isIdentifier(expression)) return expression.getText() === callee;
        return Node.isPropertyAccessExpression(expression) && expression.getName() === callee;
    });
}

/** The call's object argument, picked out by its `key` member, and whether it can be written. */
function locateArgument(call: CallExpression, key: string): { value: string; object?: ObjectLiteralExpression; editedInCode?: string } | undefined {
    const argument = unwrapExpression(call.getArguments()[0]);
    if (!argument || !Node.isObjectLiteralExpression(argument)) return undefined;
    const found = member(argument, key, "the call's argument");
    if (found.kind !== "written") return undefined;
    const value = literalString(unwrapExpression(found.value));
    if (value === undefined) return undefined;
    const opaque = opaqueMembers(argument, "its argument");
    return opaque ? { value, editedInCode: opaque } : { value, object: argument };
}

type Reached =
    | { kind: "object"; object: ObjectLiteralExpression }
    | { kind: "absent"; object: ObjectLiteralExpression; depth: number }
    | { kind: "code"; reason: string };

/** Walk `keys` down from `root` through object literals written in place. */
function reach(root: ObjectLiteralExpression, keys: readonly string[]): Reached {
    let object = root;
    for (const [depth, key] of keys.entries()) {
        const where = keys.slice(0, depth + 1).join(".");
        const found = member(object, key, `\`${keys.slice(0, depth).join(".") || "the argument"}\``);
        if (found.kind === "absent") return { kind: "absent", object, depth };
        if (found.kind === "code") return { kind: "code", reason: found.reason };
        const value = unwrapExpression(found.value);
        if (!value || !Node.isObjectLiteralExpression(value)) {
            return { kind: "code", reason: `\`${where}\` is \`${clip(found.value.getText())}\`, not an object written in the call.` };
        }
        const opaque = opaqueMembers(value, `\`${where}\``);
        if (opaque) return { kind: "code", reason: opaque };
        object = value;
    }
    return { kind: "object", object };
}

const clip = (text: string): string => (text.length > 40 ? `${text.slice(0, 40)}…` : text);

/**
 * The version of a file's text the panel sends back with an edit: a short
 * hash, so a file changed since the panel read it is refused as stale.
 *
 * @group Schema
 */
export function versionOf(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** The JSON a plain-data literal denotes; `undefined` for anything else. */
function literalValue(node: Node | undefined): FrontendSourceValue | undefined {
    const value = unwrapExpression(node);
    if (!value) return undefined;
    if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) return value.getLiteralValue();
    if (Node.isNumericLiteral(value)) return value.getLiteralValue();
    if (Node.isTrueLiteral(value)) return true;
    if (Node.isFalseLiteral(value)) return false;
    if (Node.isNullLiteral(value)) return null;
    if (Node.isPrefixUnaryExpression(value) && value.getOperatorToken() === ts.SyntaxKind.MinusToken) {
        const operand = value.getOperand();
        return Node.isNumericLiteral(operand) ? -operand.getLiteralValue() : undefined;
    }
    if (Node.isArrayLiteralExpression(value)) {
        const items: FrontendSourceValue[] = [];
        for (const element of value.getElements()) {
            const item = literalValue(element);
            if (item === undefined) return undefined;
            items.push(item);
        }
        return items;
    }
    if (Node.isObjectLiteralExpression(value)) {
        const out: { [key: string]: FrontendSourceValue } = {};
        for (const each of value.getProperties()) {
            const name = memberName(each);
            if (name === undefined || !Node.isPropertyAssignment(each)) return undefined;
            const item = literalValue(each.getInitializer());
            if (item === undefined) return undefined;
            out[name] = item;
        }
        return out;
    }
    return undefined;
}

function sameJson(a: FrontendSourceValue | undefined, b: FrontendSourceValue | undefined): boolean {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
    }
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => key in b && sameJson(a[key], b[key]));
}

// ── Writing ─────────────────────────────────────────────────────────────────

function refusal(message: string, table: string, key?: string): FrontendSourceEditError {
    return new FrontendSourceEditError("SCHEMA_EDIT_REFUSED", message, [{ table, ...(key !== undefined ? { key } : {}), message }]);
}

function asRefusal(error: unknown, index: number, operation: FrontendSourceOperation, target: FrontendCallTarget): FrontendSourceEditError {
    if (error instanceof FrontendSourceEditError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return refusal(`Edit ${index} (${operation.op} \`${operation.path.join(".")}\` of "${target.value}"): ${message}`, target.value, operation.path.join("."));
}

/** The writable argument of the target call in `text`. */
function argumentIn(file: string, text: string, target: FrontendCallTarget): ObjectLiteralExpression {
    const source = parse(file, text);
    for (const call of callsTo(source, target.callee)) {
        const located = locateArgument(call, target.key);
        if (located?.value !== target.value) continue;
        if (!located.object) throw refusal(`"${target.value}" is edited in code: ${located.editedInCode}`, target.value);
        return located.object;
    }
    throw refusal(`The call for "${target.value}" is no longer in ${path.basename(file)}.`, target.value);
}

/** The object holding the last key of `keys`, which must exist and be writable. */
function parentOf(root: ObjectLiteralExpression, keys: readonly string[], target: FrontendCallTarget): ObjectLiteralExpression {
    const reached = reach(root, keys.slice(0, -1));
    const where = keys.join(".");
    if (reached.kind === "code") throw refusal(`\`${where}\` of "${target.value}" is edited in code: ${reached.reason}`, target.value, where);
    if (reached.kind === "absent") throw refusal(`"${target.value}" has no \`${keys.slice(0, reached.depth + 1).join(".")}\`.`, target.value, where);
    const opaque = opaqueMembers(reached.object, `\`${keys.slice(0, -1).join(".") || "the argument"}\``);
    if (opaque) throw refusal(`\`${where}\` of "${target.value}" is edited in code: ${opaque}`, target.value, where);
    return reached.object;
}

/** `value` nested under `keys`: `{ a: { b: value } }` for `["a", "b"]`. */
function nestedValue(keys: readonly string[], value: FrontendSourceValue): FrontendSourceValue {
    return keys.reduceRight<FrontendSourceValue>((inner, key) => ({ [key]: inner }), value);
}

function printed(value: FrontendSourceValue, where: string): string {
    return printSchemaValue(value, where);
}

function applyOperation(file: string, text: string, target: FrontendCallTarget, operation: FrontendSourceOperation): string {
    const root = argumentIn(file, text, target);
    const keys = operation.path;
    const where = keys.join(".");
    if (keys.length === 1 && keys[0] === target.key && operation.op !== "set") {
        throw refusal(`\`${target.key}\` is what the call is found by: it cannot be ${operation.op === "remove" ? "removed" : operation.op === "rename" ? "renamed" : "moved"}.`, target.value, where);
    }
    switch (operation.op) {
        case "set": {
            if (keys.length === 1 && keys[0] === target.key && operation.value !== target.value) {
                throw refusal(`\`${target.key}\` is what the call is found by, and other code refers to it: change it in code.`, target.value, where);
            }
            const reached = reach(root, keys.slice(0, -1));
            if (reached.kind === "code") throw refusal(`\`${where}\` of "${target.value}" is edited in code: ${reached.reason}`, target.value, where);
            if (reached.kind === "absent") {
                // Create the objects on the way: insert the first missing key with the rest nested in it.
                const missing = keys.slice(reached.depth);
                return insertMember(text, reached.object, missing[0], nestedValue(missing.slice(1), operation.value), `${target.value}.${where}`,
                    reached.depth === keys.length - 1 ? operation.before : undefined, target);
            }
            const object = reached.object;
            const last = keys[keys.length - 1];
            const found = member(object, last, `\`${keys.slice(0, -1).join(".") || "the argument"}\``);
            if (found.kind === "code") throw refusal(`\`${where}\` of "${target.value}" is edited in code: ${found.reason}`, target.value, where);
            if (found.kind === "absent") return insertMember(text, object, last, operation.value, `${target.value}.${where}`, operation.before, target);
            if (!isData(found.value)) {
                throw refusal(`\`${where}\` of "${target.value}" is edited in code: it is \`${clip(found.value.getText())}\`, not plain data.`, target.value, where);
            }
            return applyEdits(text, [replaceNode(text, found.value, printed(operation.value, `${target.value}.${where}`))]);
        }
        case "remove": {
            const reached = reach(root, keys.slice(0, -1));
            if (reached.kind === "absent") return text;
            if (reached.kind === "code") throw refusal(`\`${where}\` of "${target.value}" is edited in code: ${reached.reason}`, target.value, where);
            const object = reached.object;
            const found = member(object, keys[keys.length - 1], `\`${keys.slice(0, -1).join(".") || "the argument"}\``);
            if (found.kind === "absent") return text;
            if (found.kind === "code") throw refusal(`\`${where}\` of "${target.value}" is edited in code: ${found.reason}`, target.value, where);
            const value = unwrapExpression(found.value);
            if (!value || !(isData(value) || Node.isObjectLiteralExpression(value))) {
                throw refusal(`\`${where}\` of "${target.value}" is edited in code: it is \`${clip(found.value.getText())}\`.`, target.value, where);
            }
            const next = applyEdits(text, removeListItem(text, listShape(object, object.getProperties()), found.index));
            if (operation.prune && keys.length > 1 && object.getProperties().length === 1) {
                return applyOperation(file, next, target, { op: "remove", path: keys.slice(0, -1), prune: true });
            }
            return next;
        }
        case "rename": {
            const object = parentOf(root, keys, target);
            const last = keys[keys.length - 1];
            const found = member(object, last, `\`${keys.slice(0, -1).join(".") || "the argument"}\``);
            if (found.kind === "absent") throw refusal(`"${target.value}" has no \`${where}\`.`, target.value, where);
            if (found.kind === "code") throw refusal(`\`${where}\` of "${target.value}" is edited in code: ${found.reason}`, target.value, where);
            if (operation.to === last) return text;
            if (member(object, operation.to, "it").kind !== "absent") {
                throw refusal(`"${target.value}" already has \`${[...keys.slice(0, -1), operation.to].join(".")}\`.`, target.value, where);
            }
            const assignment = found.node;
            if (!Node.isPropertyAssignment(assignment)) throw refusal(`\`${where}\` is not written as \`key: value\`.`, target.value, where);
            const nameNode = assignment.getNameNode();
            return applyEdits(text, [{ start: nameNode.getStart(), end: nameNode.getEnd(), text: printKey(operation.to) }]);
        }
        case "move": {
            const object = parentOf(root, keys, target);
            const last = keys[keys.length - 1];
            const found = member(object, last, "it");
            if (found.kind !== "written") throw refusal(`"${target.value}" has no \`${where}\` written in the call.`, target.value, where);
            if (operation.before === last) return text;
            if (operation.before !== undefined && member(object, operation.before, "it").kind !== "written") {
                throw refusal(`"${target.value}" has no \`${[...keys.slice(0, -1), operation.before].join(".")}\` to move before.`, target.value, where);
            }
            const moved = itemText(text, listShape(object, object.getProperties()), found.index);
            const removed = applyEdits(text, removeListItem(text, listShape(object, object.getProperties()), found.index));
            const again = parentOf(argumentIn(file, removed, target), keys, target);
            const members = again.getProperties();
            const index = operation.before !== undefined ? members.findIndex(each => memberName(each) === operation.before) : members.length;
            return applyEdits(removed, insertListItem(removed, listShape(again, members), index, moved, "lines"));
        }
    }
}

function insertMember(
    text: string,
    object: ObjectLiteralExpression,
    key: string,
    value: FrontendSourceValue,
    where: string,
    before: string | undefined,
    target: FrontendCallTarget
): string {
    const members = object.getProperties();
    let index = members.length;
    if (before !== undefined) {
        index = members.findIndex(each => memberName(each) === before);
        if (index === -1) throw refusal(`There is no \`${before}\` to insert \`${key}\` before.`, target.value, where);
    }
    const edits: TextEdit[] = insertListItem(text, listShape(object, members), index, `${printKey(key)}: ${printed(value, where)}`, "lines");
    return applyEdits(text, edits);
}

/** The edited text parses, and every value set reads back as that value; every key removed is gone. */
function verify(file: string, text: string, target: FrontendCallTarget, operations: readonly FrontendSourceOperation[]): void {
    const errors = syntaxErrors(file, text);
    if (errors.length > 0) {
        throw new FrontendSourceEditError("SCHEMA_EDIT_DOES_NOT_COMPILE",
            `The edit was not written: ${path.basename(file)} would not parse: ${errors.join(" ")}`,
            errors.map(message => ({ table: target.value, message })));
    }
    const root = argumentIn(file, text, target);
    const expected = new Map<string, { path: string[]; value?: FrontendSourceValue }>();
    for (const operation of operations) {
        if (operation.op === "set") expected.set(operation.path.join("\u0000"), { path: operation.path, value: operation.value });
        else if (operation.op === "remove") expected.set(operation.path.join("\u0000"), { path: operation.path });
        else if (operation.op === "rename") {
            // What was set under the old key is now under the new one.
            const from = operation.path;
            const to = [...from.slice(0, -1), operation.to];
            for (const [id, entry] of [...expected]) {
                if (entry.path.length < from.length || !from.every((key, index) => entry.path[index] === key)) continue;
                expected.delete(id);
                const moved = [...to, ...entry.path.slice(from.length)];
                expected.set(moved.join("\u0000"), { ...entry, path: moved });
            }
        }
    }
    for (const { path: keys, value } of expected.values()) {
        const reached = reach(root, keys.slice(0, -1));
        const where = keys.join(".");
        const found = reached.kind === "object" ? member(reached.object, keys[keys.length - 1], "it") : undefined;
        if (value === undefined) {
            if (found?.kind === "written") throw refusal(`\`${where}\` is still there after the edit removed it.`, target.value, where);
            continue;
        }
        const read = found?.kind === "written" ? literalValue(found.value) : undefined;
        if (!sameJson(read, value)) throw refusal(`\`${where}\` does not read back as the value written.`, target.value, where);
    }
}

async function writeWhole(file: string, contents: string): Promise<void> {
    await fsp.writeFile(file, contents, "utf8");
}

/**
 * Where a project keeps its frontend source: `<project root>/frontend/src`.
 *
 * @group Schema
 */
export function frontendSourceDirOf(projectRoot: string): string {
    return path.join(projectRoot, "frontend", "src");
}
