/**
 * `backend/schema/<table>.ts` and `backend/schema/index.ts`.
 *
 * The data comes from the lift (`collectionsToTableDefs`), printed by the
 * shared printer (`printTableSource`), so a migrated table is written exactly
 * as introspection or the schema editor would write it. What a value cannot
 * give — the source of a hook or a transform, the imports and helpers that
 * source uses, the comments above a property — is read off the legacy file
 * and spliced in.
 */
import path from "node:path";
import type { Statement } from "ts-morph";
import {
    printImportLines,
    printIndexModule,
    printTableSource,
    tableIdentifier,
    type LiftResult,
    type PrintTarget,
    type TableSources
} from "@rebasepro/common";
import { isViewDef, type AnyTableDef, type AnyViewDef, type DefaultRls, type Property } from "@rebasepro/types";

import type { Member, PathSegment } from "./ast";
import { collectReferences, leadingComments, memberOf, nodeAtPath, nodeText, postDeclarationAssignments, resolveObject, toPosix } from "./ast";
import { carryHook, carryTransform, type CarriedFunction } from "./hooks";
import { importLines, RelocationError } from "./modules";
import type { CollectionEntry, PlanContext } from "./plan-context";
import { note, planFile, refuse, relativeToRoot } from "./plan-context";
import { dedent, reindent } from "./print-js";

/** How one table is named in the new layout. */
export interface TableName {
    slug: string;
    /** The exported identifier. */
    identifier: string;
    /** The module, absolute. */
    file: string;
    /** The SQL table name (the definition's name). */
    table: string;
    kind: "table" | "auth-table" | "view";
}

/** Placeholder tokens for code spliced into printed source. */
export class Splices {
    private readonly texts = new Map<string, string>();
    private counter = 0;

    /** A token standing for `text` in printed output. */
    token(text: string): string {
        const token = `__REBASE_MIGRATE_SPLICE_${this.counter++}__`;
        this.texts.set(token, text);
        return token;
    }

    /** Replace every token by its text, re-indented to the line it sits on. */
    apply(code: string): string {
        return code.split("\n").map(line => {
            let out = line;
            for (const [token, text] of this.texts) {
                if (!out.includes(token)) continue;
                const indent = /^[ \t]*/.exec(out)?.[0] ?? "";
                out = out.replace(token, () => reindent(text, indent));
            }
            return out;
        }).join("\n");
    }
}

/** The builders a printed table imports, which a carried binding must not shadow. */
const BUILDER_NAMES = new Set(["defineTable", "defineAuthTable", "defineView", "col", "rel", "json", "RelationTarget"]);

/** One function the table carries, where it was. */
interface CarriedSite {
    member: Member;
    carried: CarriedFunction;
    label: string;
}

/** A callback-bearing property, found by walking the evaluated properties. */
interface TransformSite {
    /** Path of the property in the literal: `["properties", "title"]`. */
    segments: PathSegment[];
    /** The printer's transform path: `title`, `tags[]`, `seo.title`, `content[].text`. */
    transformPath: string;
    /** The callback names that are functions. */
    names: string[];
}

function joinPath(parent: string, segment: string): string {
    if (parent === "") return segment;
    return segment === "[]" ? `${parent}[]` : `${parent}.${segment}`;
}

function functionNames(value: unknown): string[] {
    if (typeof value !== "object" || value === null) return [];
    return Object.entries(value).filter(([, entry]) => typeof entry === "function").map(([name]) => name);
}

function collectTransformSites(properties: Record<string, Property>, segments: PathSegment[], prefix: string, out: TransformSite[]): void {
    for (const [key, property] of Object.entries(properties)) {
        visitProperty(property, [...segments, key], joinPath(prefix, key), out);
    }
}

function visitProperty(property: Property, segments: PathSegment[], transformPath: string, out: TransformSite[]): void {
    const names = functionNames(property.callbacks);
    if (names.length > 0) out.push({ segments, transformPath, names });
    if (property.type === "array") {
        if (property.of !== undefined && !Array.isArray(property.of)) {
            visitProperty(property.of, [...segments, "of"], joinPath(transformPath, "[]"), out);
        }
        if (property.oneOf !== undefined) {
            for (const [variant, variantProperty] of Object.entries(property.oneOf.properties)) {
                visitProperty(variantProperty, [...segments, "oneOf", "properties", variant], joinPath(joinPath(transformPath, "[]"), variant), out);
            }
        }
    }
    if (property.type === "map" && property.properties !== undefined) {
        collectTransformSites(property.properties, [...segments, "properties"], transformPath, out);
    }
}

/**
 * The member at `segments` in the collection's literal, or in what a
 * top-level assignment after the declaration put there
 * (`ordersCollection.callbacks = {...}`).
 */
function locate(plan: PlanContext, entry: CollectionEntry, segments: PathSegment[]): { member?: Member; reason?: string } {
    const site = entry.site;
    if (!site) return { reason: entry.siteProblem ?? "the collection's literal was not found" };
    const direct = nodeAtPath(plan.ast, site.literal, segments);
    if (direct.node) return { member: direct.node };
    if (site.binding) {
        const assignments = postDeclarationAssignments(plan.ast, entry.sourceFile, site.binding);
        for (let length = segments.length; length > 0; length--) {
            const prefix = segments.slice(0, length);
            if (prefix.some(segment => typeof segment === "number")) continue;
            const assigned = assignments.get(prefix.join("."));
            if (!assigned) continue;
            const rest = segments.slice(length);
            if (rest.length === 0) return { member: { node: assigned.statement, value: assigned.value } };
            const object = resolveObject(plan.ast, assigned.value);
            if (!object.node) return { reason: `${prefix.join(".")} is assigned at line ${assigned.statement.getStartLineNumber()}, but ${object.reason}` };
            const nested = nodeAtPath(plan.ast, object.node, rest);
            if (nested.node) return { member: nested.node };
            return { reason: nested.reason };
        }
    }
    return { reason: direct.reason };
}

/** The functions of a callbacks object at `segments`, each carried. */
function carryCallbacks(
    plan: PlanContext,
    entry: CollectionEntry,
    segments: PathSegment[],
    names: readonly string[],
    label: string
): { members: { name: string; member: Member }[]; failed: boolean } {
    const located = locate(plan, entry, segments);
    if (!located.member) {
        refuse(plan, entry, `${label} holds functions, and their source could not be found: ${located.reason}. Write the callbacks inline in the collection literal (or as a \`const\` in the same file) and run the codemod again.`, { key: segments.join(".") });
        return { members: [], failed: true };
    }
    const object = resolveObject(plan.ast, located.member.value ?? located.member.node);
    if (!object.node) {
        refuse(plan, entry, `${label} is not an object literal the codemod can read (${object.reason}). Write it inline and run the codemod again.`, { key: segments.join("."), line: located.member.node.getStartLineNumber() });
        return { members: [], failed: true };
    }
    const members: { name: string; member: Member }[] = [];
    let failed = false;
    for (const name of names) {
        const member = memberOf(plan.ast, object.node, name);
        if (!member.node) {
            refuse(plan, entry, `${label}.${name} is a function whose source could not be found: ${member.reason}.`, { key: segments.join("."), line: object.node.getStartLineNumber() });
            failed = true;
            continue;
        }
        members.push({ name, member: member.node });
    }
    return { members, failed };
}

/** Insert comment lines above the entries of a top-level block (`columns`, `relations`) of printed source. */
function insertComments(code: string, block: string, comments: ReadonlyMap<string, string[]>, used: Set<string>): string {
    if (comments.size === 0) return code;
    const lines = code.split("\n");
    const open = lines.findIndex(line => line === `    ${block}: {`);
    if (open < 0) return code;
    const out = lines.slice(0, open + 1);
    let index = open + 1;
    for (; index < lines.length; index++) {
        const line = lines[index];
        if (/^ {4}\}/.test(line)) break;
        const match = /^ {8}("?)([^":\s]+)\1: /.exec(line);
        if (match && comments.has(match[2]) && !used.has(match[2])) {
            used.add(match[2]);
            for (const comment of comments.get(match[2]) ?? []) out.push(`        ${reindent(comment, "        ")}`);
        }
        out.push(line);
    }
    return [...out, ...lines.slice(index)].join("\n");
}

/** A comment's text with its original indentation removed from its later lines. */
function commentText(text: string, indent: string): string {
    return dedent(text, indent);
}

export interface BackendPlanInput {
    /** The Postgres collections, in the order they were lifted. */
    entries: CollectionEntry[];
    lift: LiftResult;
    /** `backend/schema`, absolute. */
    schemaDir: string;
    /** The order the index lists the tables in: the legacy index's `collections`, then the rest by file. */
    order: string[];
}

/** File names and identifiers for every table, unique. */
export function nameTables(entries: readonly CollectionEntry[], defs: readonly (AnyTableDef | AnyViewDef)[], schemaDir: string): Map<string, TableName> {
    const byName = new Map<string, number>();
    for (const def of defs) byName.set(def.name, (byName.get(def.name) ?? 0) + 1);
    const names = new Map<string, TableName>();
    defs.forEach((def, index) => {
        const entry = entries[index];
        const schema = isViewDef(def) ? def.config.schema : def.config.schema;
        const base = (byName.get(def.name) ?? 0) > 1 && schema ? `${schema}_${def.name}` : def.name;
        const kind = isViewDef(def) ? "view" : def.auth !== undefined ? "auth-table" : "table";
        names.set(entry.collection.slug, {
            slug: entry.collection.slug,
            identifier: tableIdentifier(base),
            file: path.join(schemaDir, `${base}.ts`),
            table: def.name,
            kind
        });
    });
    return names;
}

/** Plan the backend schema modules. */
export function planBackend(plan: PlanContext, input: BackendPlanInput, names: Map<string, TableName>): void {
    const { entries, lift, schemaDir } = input;
    lift.tables.forEach((def, index) => {
        const entry = entries[index];
        const name = names.get(entry.collection.slug);
        if (!name) return;
        planTableModule(plan, entry, def, name, names);
    });
    const ordered = [...input.order.map(slug => names.get(slug)).filter((value): value is TableName => value !== undefined)];
    for (const name of names.values()) if (!ordered.includes(name)) ordered.push(name);
    const index = printIndexModule(
        ordered.map(name => ({ identifier: name.identifier, importPath: `./${path.basename(name.file, ".ts")}` })),
        lift.defaultRls !== undefined ? { defaultRls: lift.defaultRls satisfies DefaultRls } : {}
    );
    planFile(plan, path.join(schemaDir, "index.ts"), index, "the schema index");
}

function planTableModule(plan: PlanContext, entry: CollectionEntry, def: AnyTableDef | AnyViewDef, name: TableName, names: Map<string, TableName>): void {
    const collection = entry.collection;
    const splices = new Splices();
    const sources: { hooks?: Record<string, string>; transforms?: Record<string, string>; auth?: { onCreateUser?: string; onResetPassword?: string } } = {};
    const carried: CarriedSite[] = [];
    let failed = false;

    // Table hooks.
    const hookNames = functionNames(collection.callbacks);
    if (hookNames.length > 0) {
        const { members, failed: hookFailure } = carryCallbacks(plan, entry, ["callbacks"], hookNames, "`callbacks`");
        failed ||= hookFailure;
        const hooks: Record<string, string> = {};
        for (const { name: hook, member } of members) {
            const result = carryHook(plan.ast, member, hook);
            hooks[hook] = splices.token(result.text);
            carried.push({ member, carried: result, label: `hooks.${hook}` });
        }
        sources.hooks = hooks;
    }

    // Column transforms.
    const transformSites: TransformSite[] = [];
    collectTransformSites(collection.properties ?? {}, ["properties"], "", transformSites);
    if (transformSites.length > 0) {
        const transforms: Record<string, string> = {};
        for (const site of transformSites) {
            const { members, failed: transformFailure } = carryCallbacks(plan, entry, [...site.segments, "callbacks"], site.names, `the \`callbacks\` of "${site.transformPath}"`);
            failed ||= transformFailure;
            if (members.length === 0) continue;
            const result = carryTransform(plan.ast, members);
            transforms[site.transformPath] = splices.token(result.text);
            for (const { member } of members) carried.push({ member, carried: { text: "", todos: [] }, label: `${site.transformPath}.transform` });
            if (result.todos.length > 0) carried.push({ member: members[0].member, carried: result, label: `${site.transformPath}.transform` });
        }
        sources.transforms = transforms;
    }

    // Auth lifecycle functions.
    const auth = typeof collection.auth === "object" && collection.auth !== null ? collection.auth : undefined;
    if (auth) {
        for (const key of ["onCreateUser", "onResetPassword"] as const) {
            if (typeof auth[key] !== "function") continue;
            const located = locate(plan, entry, ["auth", key]);
            if (!located.member) {
                refuse(plan, entry, `\`auth.${key}\` is a function whose source could not be found: ${located.reason}.`, { key: `auth.${key}` });
                failed = true;
                continue;
            }
            const text = located.member.method ? carryHook(plan.ast, located.member, key).text : nodeText(located.member.value ?? located.member.node);
            sources.auth = { ...sources.auth, [key]: splices.token(text) };
            carried.push({ member: located.member, carried: { text, todos: [] }, label: `auth.${key}` });
        }
    }
    if (failed) return;

    for (const site of carried) {
        for (const todo of site.carried.todos) {
            plan.manualSteps.push({
                title: `Check ${site.label} of ${name.table}`,
                detail: `${site.label} ${todo} The line is marked \`TODO(rebase-migrate)\`.`,
                file: relativeToRoot(plan, name.file)
            });
        }
    }

    // What the carried code references, and the other exports of the file.
    const site = entry.site;
    const exclude: Statement[] = site ? site.statements : [];
    const extraExports = site
        ? entry.sourceFile.getStatements().filter(statement => !exclude.includes(statement) && isExportedDeclaration(plan, statement))
        : [];
    const references = collectReferences(plan.ast, [...carried.map(entry_ => entry_.member.node), ...extraExports], exclude);
    for (const forbidden of references.forbidden) {
        refuse(plan, entry, `carried code references \`${forbidden.name}\`, the collection itself, which does not exist after the migration. Read what it needs from \`table\` (the hook's props) instead.`, { line: forbidden.line });
        failed = true;
    }
    if (failed) return;
    const statements = [...new Set([...references.statements, ...extraExports])].sort((a, b) => a.getStart() - b.getStart());
    for (const statement of extraExports) {
        const names_ = declaredNames(plan, statement);
        plan.manualSteps.push({
            title: `Update the importers of ${names_.join(", ")}`,
            detail: `${relativeToRoot(plan, entry.file)} exported ${names_.map(n => `\`${n}\``).join(", ")} beside the collection. ${names_.length > 1 ? "They are" : "It is"} exported from ${relativeToRoot(plan, name.file)} now; point every import of it there.`,
            file: relativeToRoot(plan, name.file)
        });
    }

    // Print the table.
    const resolveTarget = (target: { name?: string; slug: string }): PrintTarget => {
        const found = names.get(target.slug);
        if (!found) {
            throw new RelocationError(entry.file, `a relation points at "${target.slug}", which is not a collection file in ${relativeToRoot(plan, path.dirname(entry.file))}. Move that collection into the directory (or drop the relation) and run the codemod again.`);
        }
        return {
            identifier: found.identifier,
            importPath: `./${path.basename(found.file, ".ts")}`,
            table: found.table,
            kind: found.kind === "view" ? "view" : "table"
        };
    };
    let printed;
    try {
        printed = printTableSource(def, { identifier: name.identifier, resolveTarget, sources: sources satisfies TableSources });
    } catch (error) {
        refuse(plan, entry, error instanceof Error ? error.message : String(error));
        return;
    }

    // Imports: the builders and related tables, then what carried code uses.
    let carriedImports: string[];
    try {
        carriedImports = importLines(references.imports, use => plan.relocator.relocate(use.specifier, use.fromFile, name.file, "backend"));
    } catch (error) {
        refuse(plan, entry, error instanceof Error ? error.message : String(error));
        return;
    }
    const taken = new Set([...printed.imports.builders, ...printed.imports.tables.map(table => table.identifier), name.identifier, ...BUILDER_NAMES]);
    const clashes = [...references.imports.map(use => use.local), ...statements.flatMap(statement => declaredNames(plan, statement))]
        .filter(local => taken.has(local));
    if (clashes.length > 0) {
        refuse(plan, entry, `carried code binds ${[...new Set(clashes)].map(clash => `\`${clash}\``).join(", ")}, which the table module also binds (a builder, a related table, or the table itself). Rename it in the collection file and run the codemod again.`);
        return;
    }

    let statementTexts: string[];
    try {
        statementTexts = statements.map(statement => {
            const text = nodeText(statement);
            return text.includes("import(") ? plan.relocator.moveSpecifiersInText(text, entry.file, name.file, "backend") : text;
        });
    } catch (error) {
        refuse(plan, entry, error instanceof Error ? error.message : String(error));
        return;
    }

    // Comments: the file header, the collection's own, each property's.
    const header = fileHeader(plan, entry);
    const own = site ? site.statements.flatMap(statement => leadingComments(statement)).filter(comment => !header.includes(comment)) : [];
    let code = printed.code;
    const propertyComments = propertyCommentMap(plan, entry);
    const used = new Set<string>();
    code = insertComments(code, "columns", propertyComments, used);
    code = insertComments(code, "relations", propertyComments, used);
    code = splices.apply(code);
    if (code.includes("__REBASE_MIGRATE_SPLICE_")) {
        refuse(plan, entry, "a spliced source was not placed by the printer (internal): report this.");
        return;
    }
    if (carried.some(site_ => site_.carried.todos.length > 0)) {
        note(plan, entry, `${name.table}: carried code has TODO(rebase-migrate) lines to check.`);
    }

    const parts = [
        ...(header.length > 0 ? [header.join("\n")] : []),
        [...printImportLines(printed.imports), ...carriedImports].join("\n"),
        ...statementTexts,
        [...own, code].join("\n")
    ];
    planFile(plan, name.file, `${parts.join("\n\n")}\n`, `table ${name.table}`);
}

function isExportedDeclaration(plan: PlanContext, statement: Statement): boolean {
    const { Node: N } = plan.ast.tsm;
    if (N.isVariableStatement(statement) || N.isFunctionDeclaration(statement) || N.isClassDeclaration(statement) ||
        N.isInterfaceDeclaration(statement) || N.isTypeAliasDeclaration(statement) || N.isEnumDeclaration(statement)) {
        return statement.isExported() && !statement.isDefaultExport();
    }
    return false;
}

function declaredNames(plan: PlanContext, statement: Statement): string[] {
    const { Node: N } = plan.ast.tsm;
    if (N.isVariableStatement(statement)) return statement.getDeclarations().map(declaration => declaration.getName());
    if (N.isFunctionDeclaration(statement) || N.isClassDeclaration(statement)) {
        const declared = statement.getName();
        return declared ? [declared] : [];
    }
    if (N.isInterfaceDeclaration(statement) || N.isTypeAliasDeclaration(statement) || N.isEnumDeclaration(statement)) return [statement.getName()];
    return [];
}

/** The comments above the first statement of the file, when that statement is an import: the file's header. */
function fileHeader(plan: PlanContext, entry: CollectionEntry): string[] {
    const first = entry.sourceFile.getStatements()[0];
    if (!first || !plan.ast.tsm.Node.isImportDeclaration(first)) return [];
    return leadingComments(first);
}

/** The comments above each top-level property of the collection literal, by key. */
function propertyCommentMap(plan: PlanContext, entry: CollectionEntry): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const site = entry.site;
    if (!site) return out;
    const properties = memberOf(plan.ast, site.literal, "properties");
    if (!properties.node) return out;
    const object = resolveObject(plan.ast, properties.node.value);
    if (!object.node) return out;
    for (const member of object.node.getProperties()) {
        if (plan.ast.tsm.Node.isSpreadAssignment(member)) continue;
        const nameNode = "getNameNode" in member ? member.getNameNode() : undefined;
        if (!nameNode) continue;
        const key = nameNode.getText().replace(/^["']|["']$/g, "");
        const comments = leadingComments(member);
        if (comments.length === 0) continue;
        const indent = /^[ \t]*/.exec(member.getSourceFile().getFullText().slice(member.getSourceFile().getFullText().lastIndexOf("\n", member.getStart() - 1) + 1, member.getStart()))?.[0] ?? "";
        out.set(key, comments.map(comment => commentText(comment, indent)));
    }
    return out;
}

/** The relative module path of a table, from a file in another directory. */
export function tableImportPath(fromFile: string, table: TableName): string {
    let relative = toPosix(path.relative(path.dirname(fromFile), table.file.replace(/\.ts$/, "")));
    if (!relative.startsWith(".")) relative = `./${relative}`;
    return relative;
}
