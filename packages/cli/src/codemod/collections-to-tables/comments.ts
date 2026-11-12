/**
 * Carrying a collection file's comments to the files it became.
 *
 * The shared printer prints tables from values, so it has no comments to
 * print; this is the codemod's own pass over the printed text, run once every
 * file of a collection is planned. A comment moves with what it describes:
 *
 * - above a property (or inside its literal) → above its column, or its
 *   relation; above its field in the customization file when the property was
 *   presentation only (when both halves exist the schema file keeps it);
 * - above a `securityRules`, `indexes` or `relations` entry → above that rule,
 *   index or relation; above a `callbacks` member → above that hook;
 * - above any other carried key (`history`, `search`, …) → above that key;
 *   above a presentation key (`name`, `icon`, an `admin` option) → above it in
 *   the customization;
 * - comments inside carried functions are part of their text already.
 *
 * A comment that cannot be attached unambiguously is never dropped: it is
 * written at the top of the generated file, under `// From <original file>:`.
 */
import path from "node:path";
import type { Node, ObjectLiteralExpression, SourceFile } from "ts-morph";
import type { AnyTableDef, AnyViewDef } from "@rebasepro/types";

import type { AstContext } from "./ast";
import { memberOf, postDeclarationAssignments, resolveArray, resolveObject, toPosix } from "./ast";
import type { CollectionEntry } from "./plan-context";
import { dedent, reindent } from "./print-js";
import { COLLECTION_ADMIN_DESTINATIONS } from "./vocabulary";

/** Where a comment goes. */
export interface CommentTarget {
    side: "backend" | "cms";
    /** A top-level key of the definition / customization; absent for "unattached". */
    key?: string;
    /** An entry of that key's block: an object key, or an array index. */
    entry?: string | number;
}

/** One comment and where it goes. */
export interface PlacedComment {
    text: string;
    target: CommentTarget;
}

/** Legacy collection keys carried into the table under a key of their own. */
const CARRIED_KEYS: Readonly<Record<string, string>> = {
    slug: "slug",
    table: "table",
    schema: "schema",
    dataSource: "database",
    description: "description",
    tenant: "tenant",
    softDelete: "softDelete",
    history: "history",
    search: "search",
    strictWrites: "strictWrites",
    metadata: "metadata",
    disableDefaultPolicies: "defaultPolicies",
    auth: "auth",
    view: "query"
};

/** Presentation keys of a collection outside `admin`. */
const PRESENTATION_KEYS = new Set(["name", "singularName", "icon"]);

function isInsideFunction(ctx: AstContext, node: Node, boundary: Node): boolean {
    const { Node: N } = ctx.tsm;
    let current: Node | undefined = node;
    while (current && current !== boundary) {
        if (N.isArrowFunction(current) || N.isFunctionExpression(current) || N.isMethodDeclaration(current) || N.isFunctionDeclaration(current)) return true;
        current = current.getParent();
    }
    return false;
}

/**
 * The comment ranges of a node: before it, and on its line after it — after
 * the comma that ends a member too (`slug: …, // why`), which the parser
 * hands to the next member's leading trivia.
 */
function ownRanges(node: Node): { pos: number; text: string }[] {
    const out = [...node.getLeadingCommentRanges(), ...node.getTrailingCommentRanges()].map(range => ({ pos: range.getPos(), text: range.getText() }));
    const full = node.getSourceFile().getFullText();
    let end = node.getEnd();
    while (end < full.length && (full[end] === " " || full[end] === "\t")) end++;
    if (full[end] === ",") {
        const after = full.slice(end + 1);
        const match = /^[ \t]*(\/\/[^\n]*|\/\*[^\n]*?\*\/)/.exec(after);
        if (match) {
            const pos = end + 1 + after.indexOf(match[1]);
            if (!out.some(range => range.pos === pos)) out.push({ pos, text: match[1] });
        }
    }
    return out;
}

/** Every comment range anywhere inside a node (not counting the node's own leading ones). */
function innerRanges(node: Node): { pos: number; text: string; owner: Node }[] {
    const out: { pos: number; text: string; owner: Node }[] = [];
    for (const descendant of node.getDescendants()) {
        for (const range of [...descendant.getLeadingCommentRanges(), ...descendant.getTrailingCommentRanges()]) {
            if (range.getPos() >= node.getStart() && range.getEnd() <= node.getEnd()) out.push({ pos: range.getPos(), text: range.getText(), owner: descendant });
        }
    }
    return out;
}

/** A comment's text with the indentation of its line removed from its later lines. */
function commentText(sf: SourceFile, pos: number, text: string): string {
    const full = sf.getFullText();
    const lineStart = full.lastIndexOf("\n", pos - 1) + 1;
    const indent = /^[ \t]*/.exec(full.slice(lineStart, pos))?.[0] ?? "";
    return dedent(text, indent);
}

/** Directives a linter or compiler reads, which mean nothing in another file. */
function isDirective(text: string): boolean {
    return /^\/\/\s*(@ts-|eslint|prettier|#)/.test(text) || /^\/\*\s*(eslint|prettier|@ts-|global\b)/.test(text);
}

/**
 * Every comment of a collection file, and where it goes.
 *
 * @param def the definition the collection became (to know its columns and relations)
 * @param skip comments already written by the module printer (the file header, the collection's own doc)
 */
export function collectComments(ctx: AstContext, entry: CollectionEntry, def: AnyTableDef | AnyViewDef, skip: ReadonlySet<string>): PlacedComment[] {
    const site = entry.site;
    const sf = entry.sourceFile;
    if (!site) return [];
    const { Node: N } = ctx.tsm;
    const columns = new Set(Object.keys(def.config.columns));
    const relations = new Set(Object.keys(def.config.relations ?? {}));
    const placed = new Set<number>();
    const out: PlacedComment[] = [];
    const put = (pos: number, text: string, target: CommentTarget): void => {
        if (placed.has(pos)) return;
        placed.add(pos);
        if (isDirective(text) || skip.has(text)) return;
        out.push({ text: commentText(sf, pos, text), target });
    };
    const putAll = (node: Node, target: CommentTarget, boundary: Node): void => {
        for (const range of ownRanges(node)) put(range.pos, range.text, target);
        for (const range of innerRanges(node)) {
            if (isInsideFunction(ctx, range.owner, boundary)) {
                placed.add(range.pos);
                continue;
            }
            put(range.pos, range.text, target);
        }
    };

    const propertyTarget = (key: string): CommentTarget =>
        columns.has(key) ? { side: "backend", key: "columns", entry: key }
            : relations.has(key) ? { side: "backend", key: "relations", entry: key }
                : { side: "cms", key: "fields", entry: key };

    /** One collection-level member (`properties: {…}`) or the value assigned to it later. */
    const member = (key: string, holder: Node, value: Node | undefined): void => {
        const rangesOfHolder = ownRanges(holder);
        if (key === "properties") {
            for (const range of rangesOfHolder) put(range.pos, range.text, { side: "backend", key: "columns" });
            const object = value ? resolveObject(ctx, value).node : undefined;
            if (!object) return;
            for (const property of object.getProperties()) {
                if (N.isSpreadAssignment(property)) continue;
                const nameNode = "getNameNode" in property ? property.getNameNode() : undefined;
                const name = nameNode ? nameNode.getText().replace(/^["'`]|["'`]$/g, "") : undefined;
                if (name === undefined) continue;
                putAll(property, propertyTarget(name), property);
            }
            return;
        }
        const arrayKey = key === "securityRules" ? "rls" : key === "indexes" ? "indexes" : key === "relations" ? "relations" : undefined;
        if (arrayKey) {
            for (const range of rangesOfHolder) put(range.pos, range.text, { side: "backend", key: arrayKey });
            const array = value ? resolveArray(ctx, value).node : undefined;
            if (!array) return;
            const relationsList = "relations" in entry.collection && Array.isArray(entry.collection.relations) ? entry.collection.relations : [];
            array.getElements().forEach((element, index) => {
                if (arrayKey === "relations") {
                    const name = relationsList[index]?.relationName;
                    putAll(element, name !== undefined && relations.has(name) ? { side: "backend", key: "relations", entry: name } : { side: "backend", key: "relations" }, element);
                } else {
                    putAll(element, { side: "backend", key: arrayKey, entry: index }, element);
                }
            });
            return;
        }
        if (key === "callbacks") {
            for (const range of rangesOfHolder) put(range.pos, range.text, { side: "backend", key: "hooks" });
            const object = value ? resolveObject(ctx, value).node : undefined;
            if (!object) return;
            for (const hook of object.getProperties()) {
                const nameNode = "getNameNode" in hook ? hook.getNameNode() : undefined;
                if (!nameNode) continue;
                putAll(hook, { side: "backend", key: "hooks", entry: nameNode.getText() }, hook);
            }
            return;
        }
        if (key === "admin") {
            for (const range of rangesOfHolder) put(range.pos, range.text, { side: "cms" });
            const object = value ? resolveObject(ctx, value).node : undefined;
            if (!object) return;
            for (const option of object.getProperties()) {
                const nameNode = "getNameNode" in option ? option.getNameNode() : undefined;
                const destination = nameNode ? COLLECTION_ADMIN_DESTINATIONS[nameNode.getText()] : undefined;
                const top = typeof destination === "string" ? destination.split(".")[0] : undefined;
                putAll(option, top ? { side: "cms", key: top } : { side: "cms" }, option);
            }
            return;
        }
        const carried = CARRIED_KEYS[key];
        const target: CommentTarget = carried ? { side: "backend", key: carried }
            : PRESENTATION_KEYS.has(key) ? { side: "cms", key }
                : { side: "backend" };
        putAll(holder, target, holder);
    };

    const literal: ObjectLiteralExpression = site.literal;
    for (const property of literal.getProperties()) {
        if (N.isSpreadAssignment(property)) {
            putAll(property, { side: "backend" }, property);
            continue;
        }
        const nameNode = "getNameNode" in property ? property.getNameNode() : undefined;
        if (!nameNode) continue;
        const key = nameNode.getText().replace(/^["'`]|["'`]$/g, "");
        const value = memberOf(ctx, literal, key).node;
        member(key, property, value?.value ?? (value?.method ? value.method : undefined));
    }
    if (site.binding) {
        for (const [assigned, { value, statement }] of postDeclarationAssignments(ctx, sf, site.binding)) {
            if (!assigned.includes(".")) member(assigned, statement, value);
        }
    }
    // Every other comment of the file that nothing carried, at the top.
    for (const statement of sf.getStatements()) {
        if (ctx.tsm.Node.isImportDeclaration(statement)) {
            for (const range of ownRanges(statement)) put(range.pos, range.text, { side: "backend" });
            continue;
        }
        for (const range of ownRanges(statement)) put(range.pos, range.text, { side: "backend" });
        for (const range of innerRanges(statement)) {
            if (placed.has(range.pos)) continue;
            if (isInsideFunction(ctx, range.owner, statement)) {
                placed.add(range.pos);
                continue;
            }
            put(range.pos, range.text, { side: "backend" });
        }
    }
    return out;
}

/** The index of the line that opens the definition / customization call. */
function callLine(lines: readonly string[]): number {
    return lines.findIndex(line => /^export const \w+ = (define(Table|AuthTable|View)|customizeTable)\b/.test(line));
}

/** Where a target lands in printed text, as a line index, or -1. */
function targetLine(lines: readonly string[], target: CommentTarget): number {
    const start = callLine(lines);
    if (start < 0 || target.key === undefined) return -1;
    let keyLine = -1;
    for (let index = start + 1; index < lines.length; index++) {
        if (/^\}\)/.test(lines[index])) break;
        if (lines[index].startsWith(`    ${target.key}: `) || lines[index] === `    ${target.key}: {` || lines[index] === `    ${target.key}: [`) {
            keyLine = index;
            break;
        }
    }
    if (keyLine < 0 || target.entry === undefined) return keyLine;
    const opener = lines[keyLine];
    if (!opener.endsWith("{") && !opener.endsWith("[")) return keyLine;
    let element = 0;
    for (let index = keyLine + 1; index < lines.length; index++) {
        const line = lines[index];
        if (/^ {4}[\]}]/.test(line)) break;
        if (!/^ {8}\S/.test(line) || /^ {8}[}\]]/.test(line)) continue;
        if (typeof target.entry === "number") {
            if (element === target.entry) return index;
            element++;
        } else {
            const match = /^ {8}("?)([^":\s]+)\1: /.exec(line);
            if (match && match[2] === target.entry) return index;
        }
    }
    return -1;
}

/**
 * Insert comments into printed text, each above its target line, indented
 * like it. What has no target there is returned.
 */
export function placeComments(text: string, comments: readonly PlacedComment[]): { text: string; leftover: string[] } {
    const lines = text.split("\n");
    const inserts = new Map<number, string[]>();
    const leftover: string[] = [];
    for (const comment of comments) {
        const line = targetLine(lines, comment.target);
        if (line < 0) {
            leftover.push(comment.text);
            continue;
        }
        const indent = /^[ \t]*/.exec(lines[line])?.[0] ?? "";
        inserts.set(line, [...(inserts.get(line) ?? []), `${indent}${reindent(comment.text, indent)}`]);
    }
    const out: string[] = [];
    lines.forEach((line, index) => {
        out.push(...(inserts.get(index) ?? []), line);
    });
    return { text: out.join("\n"), leftover };
}

/** Comments nothing could be attached to, written after the module's imports under `// From <file>:`. */
export function addUnattached(text: string, comments: readonly string[], originalFile: string, root: string): string {
    if (comments.length === 0) return text;
    const lines = text.split("\n");
    let last = -1;
    lines.forEach((line, index) => {
        if (/^import\s/.test(line)) last = index;
    });
    const block = ["", `// From ${toPosix(path.relative(root, originalFile))}:`, ...comments];
    lines.splice(last + 1, 0, ...block);
    return lines.join("\n");
}

/**
 * The legacy collections index's comments: those about `defaultSecurityRules`
 * go above `defaultRls`, those about the `collections` array (the panel's
 * order) above `tableCustomizations`, the rest to the schema index's top.
 *
 * @returns the two index files' new text
 */
export function placeIndexComments(
    ctx: AstContext,
    legacyIndex: SourceFile,
    schemaIndex: string,
    cmsIndex: string | undefined,
    root: string
): { schemaIndex: string; cmsIndex?: string } {
    const rules: string[] = [];
    const order: string[] = [];
    const rest: string[] = [];
    for (const statement of legacyIndex.getStatements()) {
        const ranges = [...ownRanges(statement), ...innerRanges(statement).filter(range => !isInsideFunction(ctx, range.owner, statement))];
        const texts = ranges.filter(range => !isDirective(range.text)).map(range => commentText(legacyIndex, range.pos, range.text));
        if (texts.length === 0) continue;
        const declared = ctx.tsm.Node.isVariableStatement(statement) ? statement.getDeclarations().map(declaration => declaration.getName()) : [];
        if (declared.includes("defaultSecurityRules")) rules.push(...texts);
        else if (declared.includes("collections")) order.push(...texts);
        else rest.push(...texts);
    }
    const insertAbove = (text: string, marker: RegExp, comments: readonly string[]): { text: string; placed: boolean } => {
        if (comments.length === 0) return { text, placed: true };
        const lines = text.split("\n");
        let at = lines.findIndex(line => marker.test(line));
        if (at < 0) return { text, placed: false };
        while (at > 0 && /^(\/\*\*|\s*\*|\/\/)/.test(lines[at - 1])) at--;
        lines.splice(at, 0, ...comments);
        return { text: lines.join("\n"), placed: true };
    };
    const withRules = insertAbove(schemaIndex, /^export const defaultRls\b/, rules);
    let nextSchema = withRules.text;
    const unattached = [...rest, ...(withRules.placed ? [] : rules)];
    let nextCms = cmsIndex;
    if (cmsIndex !== undefined) {
        const withOrder = insertAbove(cmsIndex, /^export const tableCustomizations\b/, order);
        nextCms = withOrder.text;
        if (!withOrder.placed) unattached.push(...order);
    } else {
        unattached.push(...order);
    }
    if (unattached.length > 0) nextSchema = `// From ${toPosix(path.relative(root, legacyIndex.getFilePath()))}:\n${unattached.join("\n")}\n\n${nextSchema}`;
    return { schemaIndex: nextSchema, ...(nextCms !== undefined ? { cmsIndex: nextCms } : {}) };
}
