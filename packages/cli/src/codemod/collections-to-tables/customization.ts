/**
 * `frontend/src/cms/<table>.tsx`: a collection's presentation as
 * `customizeTable(...)`, written only when the collection had any.
 *
 * Everything the lift did not put in the table (`notCarried`) is presentation,
 * and goes here under its new name: the `admin` block (its keys renamed where
 * `customizeTable` renamed them), labels that differ from what the
 * zero-config CMS derives, enum labels and colours, conditions, browser-only
 * storage functions, relation overrides. Data is printed from the evaluated
 * value; a function — an entity action, a display resolver, a component — is
 * printed from its source, its imports carried, a lazy `() => import("…")` or a
 * string path turned into a real import by value.
 *
 * A label equal to the derived one is dropped, so a migrated file states only
 * real deltas, and a collection whose presentation is entirely default gets no
 * file at all.
 */
import path from "node:path";
import type { Node, Statement } from "ts-morph";
import type { LegacyEnumValues, LiftNote } from "@rebasepro/common/migrate";
import { enumValueLabel, labelFromIdentifier, singularLabel } from "@rebasepro/utils";

import type { Member, PathSegment } from "./ast";
import { collectReferences, memberOf, nodeAtPath, nodeText, postDeclarationAssignments, resolveObject, spreadSource, toPosix, unwrap } from "./ast";
import { rewriteDynamicProps } from "./dynamic-props";
import { findLiteral } from "./helper-hooks";
import { memberFunctionText } from "./hooks";
import { constantForEnum } from "./split-constants";
import {
    COLLECTION_ADMIN_DESTINATIONS,
    KANBAN_DESTINATIONS,
    PROPERTY_ADMIN_DESTINATIONS,
    PROPERTY_FIELD_DESTINATIONS
} from "./vocabulary";
import { importLines } from "./modules";
import type { CollectionEntry, PlanContext } from "./plan-context";
import { note, planFile, refuse, relativeToRoot } from "./plan-context";
import { printValue, RawSource } from "./print-js";
import type { TableName } from "./backend";
import { tableImportPath } from "./backend";
import { own } from "./own";

/** The keys whose string value is a component path (the Vite plugin's `LAZY_COMPONENT_KEYS`). */
const COMPONENT_KEYS = new Set(["Field", "Preview", "Builder", "Filter", "Component"]);

/** A customization module being built. */
interface Builder {
    entry: CollectionEntry;
    name: TableName;
    /** The module, absolute. */
    file: string;
    options: Record<string, unknown>;
    /** AST nodes whose source is printed: their references are carried. */
    codeNodes: Node[];
    /** Component imports: local → `import X from "spec"` / `import { X } from "spec"`. */
    componentImports: Map<string, { specifier: string; imported: string }>;
    /** Named imports of split constants' label modules: specifier → names. */
    libImports: Map<string, Set<string>>;
    failed: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** A value that is a React component or other code: a function, or an exotic component object. */
function isCode(value: unknown): boolean {
    return typeof value === "function" || (typeof value === "object" && value !== null && "$$typeof" in value);
}

/** Parse a lift note's key (`content[text].images[]`) into legacy literal segments. */
export function noteKeySegments(key: string): { literal: PathSegment[]; field: string[] } {
    const literal: PathSegment[] = ["properties"];
    const field: string[] = [];
    const pattern = /([^.[\]]+)|\[\]|\[([^\]]+)\]|\./g;
    let first = true;
    for (const match of key.matchAll(pattern)) {
        const [token, name, variant] = match;
        if (token === ".") continue;
        if (name !== undefined) {
            if (!first) {
                literal.push("properties");
                field.push("fields");
            }
            literal.push(name);
            field.push(name);
        } else if (token === "[]") {
            literal.push("of");
            field.push("of");
        } else if (variant !== undefined) {
            literal.push("oneOf", "properties", variant);
            field.push("oneOf", variant);
        }
        first = false;
    }
    return { literal, field };
}

/** The last identifier of a note key: what the default label is derived from. */
function lastKey(key: string): string {
    const names = [...key.matchAll(/([^.[\]]+)/g)].map(match => match[1]);
    return names[names.length - 1] ?? key;
}

/** Read or create the nested object at `segments` under `root`. */
function at(root: Record<string, unknown>, segments: readonly string[]): Record<string, unknown> {
    let current = root;
    for (const segment of segments) {
        const next = current[segment];
        if (isPlainObject(next)) {
            current = next;
        } else {
            const created: Record<string, unknown> = {};
            current[segment] = created;
            current = created;
        }
    }
    return current;
}

/** Find the member at `segments` of the collection literal (or what an assignment after it put there). */
function locate(plan: PlanContext, entry: CollectionEntry, segments: readonly PathSegment[]): { member?: Member; reason?: string } {
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
            if (!object.node) return { reason: object.reason };
            const nested = nodeAtPath(plan.ast, object.node, rest);
            return nested.node ? { member: nested.node } : { reason: nested.reason };
        }
    }
    return { reason: direct.reason };
}

/** A component's import name, from its module path: `../BodyPartsField` → `BodyPartsField`. */
function componentName(specifier: string, taken: ReadonlySet<string>): string {
    const base = path.basename(specifier).replace(/\.(tsx?|jsx?|mjs)$/, "");
    const stem = base === "index" ? path.basename(path.dirname(specifier)) : base;
    const pascal = stem.split(/[^A-Za-z0-9]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join("") || "Component";
    const safe = /^[0-9]/.test(pascal) ? `C${pascal}` : pascal;
    let candidate = safe;
    let counter = 2;
    while (taken.has(candidate)) candidate = `${safe}${counter++}`;
    return candidate;
}

/** Turn a component path written in the collection file into an import in the customization module. */
function importComponent(plan: PlanContext, builder: Builder, specifier: string, imported: string): RawSource {
    const moved = plan.relocator.relocate(specifier, builder.entry.file, builder.file, "frontend");
    for (const [local, existing] of builder.componentImports) {
        if (existing.specifier === moved && existing.imported === imported) return new RawSource(local);
    }
    const taken = new Set(builder.componentImports.keys());
    const local = componentName(imported === "default" ? moved : imported, taken);
    builder.componentImports.set(local, { specifier: moved, imported });
    return new RawSource(local);
}

/** A lazy component thunk — `() => import("…")`, optionally `.then(m => m.X)` — as the import it stands for. */
function lazyImport(plan: PlanContext, node: Node): { specifier: string; imported: string } | undefined {
    const { Node: N, SyntaxKind } = plan.ast.tsm;
    const fn = unwrap(plan.ast, node);
    if (!N.isArrowFunction(fn) || fn.getParameters().length > 0) return undefined;
    let body: Node = unwrap(plan.ast, fn.getBody());
    let imported = "default";
    if (N.isCallExpression(body) && N.isPropertyAccessExpression(body.getExpression()) && body.getExpression().getText().endsWith(".then")) {
        const then = body.getArguments()[0];
        if (!then || !N.isArrowFunction(then)) return undefined;
        const parameter = then.getParameters()[0]?.getName();
        const result = unwrap(plan.ast, then.getBody());
        if (N.isPropertyAccessExpression(result) && result.getExpression().getText() === parameter) {
            imported = result.getName();
        } else if (N.isObjectLiteralExpression(result)) {
            const property = result.getProperty("default");
            const initializer = property && N.isPropertyAssignment(property) ? unwrap(plan.ast, property.getInitializerOrThrow()) : undefined;
            if (!initializer || !N.isPropertyAccessExpression(initializer) || initializer.getExpression().getText() !== parameter) return undefined;
            imported = initializer.getName();
        } else {
            return undefined;
        }
        const target: Node = body.getExpression();
        if (!N.isPropertyAccessExpression(target)) return undefined;
        body = unwrap(plan.ast, target.getExpression());
    }
    if (!N.isCallExpression(body) || body.getExpression().getKind() !== SyntaxKind.ImportKeyword) return undefined;
    const argument = body.getArguments()[0];
    if (!argument || !N.isStringLiteral(argument)) return undefined;
    return { specifier: argument.getLiteralValue(), imported };
}

/**
 * A value as something printable: data as itself, code from its source.
 *
 * @param segments where the value is in the legacy literal, for finding a function's source
 */
function printable(plan: PlanContext, builder: Builder, value: unknown, segments: PathSegment[], label: string): unknown {
    if (isCode(value)) {
        const located = locate(plan, builder.entry, segments);
        if (!located.member) {
            // Spread in from one shared object (`...fixedOnceCreated`): carried as that object's member, its import with it.
            const spread = builder.entry.site ? spreadSource(plan.ast, builder.entry.site.literal, segments) : undefined;
            if (spread) {
                builder.codeNodes.push(spread.spread);
                return new RawSource(spread.text);
            }
            // Presentation code whose source cannot be attributed (a wrapper's output,
            // a member before a spread): the evaluated data around it is printed, the
            // function is left out, and a step says where it was — a form rule, not a
            // reason to block the migration.
            plan.manualSteps.push({
                title: `Add ${label} of ${builder.name.table} by hand`,
                detail: `${label} is a function the collection computed (${located.reason}), so its source cannot be carried; the rest of the customization is printed from the evaluated collection. Write it in the table's customization (${relativeToRoot(plan, builder.file)} — \`customizeTable\`, created by hand if the run wrote none) under the same key, from the code that produced it.`,
                file: relativeToRoot(plan, builder.file)
            });
            return undefined;
        }
        const member = located.member;
        const valueNode = member.value ?? member.node;
        const lazy = member.method ? undefined : lazyImport(plan, valueNode);
        if (lazy) {
            try {
                return importComponent(plan, builder, lazy.specifier, lazy.imported);
            } catch (error) {
                refuse(plan, builder.entry, error instanceof Error ? error.message : String(error), { key: segments.join(".") });
                builder.failed = true;
                return undefined;
            }
        }
        builder.codeNodes.push(member.node);
        return new RawSource(memberFunctionText(plan.ast, member));
    }
    if (typeof value === "string" && COMPONENT_KEYS.has(String(segments[segments.length - 1])) && (value.startsWith("./") || value.startsWith("../"))) {
        try {
            return importComponent(plan, builder, value, "default");
        } catch (error) {
            refuse(plan, builder.entry, error instanceof Error ? error.message : String(error), { key: segments.join(".") });
            builder.failed = true;
            return undefined;
        }
    }
    if (Array.isArray(value)) return value.map((item, index) => printable(plan, builder, item, [...segments, index], `${label}[${index}]`));
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined) continue;
            out[key] = printable(plan, builder, entry, [...segments, key], `${label}.${key}`);
        }
        return out;
    }
    return value;
}

/** The enum labels a field needs: only values whose label or colour is not the derived one. */
export function enumLabelsOf(values: LegacyEnumValues): Record<string, unknown> | undefined {
    const entries: { id: string | number; label?: string; color?: unknown; disabled?: boolean }[] = Array.isArray(values)
        ? values.map(value => ({ ...value }))
        : Object.entries(values).map(([id, value]) => (typeof value === "string" ? { id, label: value } : { ...value, id }));
    const out: Record<string, unknown> = {};
    for (const entry of entries) {
        const label = entry.label ?? String(entry.id);
        const derived = enumValueLabel(entry.id);
        const extra: Record<string, unknown> = {};
        if (entry.color !== undefined) extra.color = entry.color;
        if (entry.disabled !== undefined) extra.disabled = entry.disabled;
        if (Object.keys(extra).length > 0) out[String(entry.id)] = { label, ...extra };
        else if (label !== derived) out[String(entry.id)] = label;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** A property's `admin` block as field-customization keys. */
function fieldAdmin(plan: PlanContext, builder: Builder, admin: Record<string, unknown>, segments: PathSegment[], target: Record<string, unknown>, label: string): void {
    for (const [key, value] of Object.entries(admin)) {
        if (value === undefined) continue;
        const destination = own(PROPERTY_ADMIN_DESTINATIONS, key);
        if (destination === undefined) {
            note(plan, builder.entry, `${label}.admin.${key} is not an admin option (nothing read it); not carried.`);
            continue;
        }
        if (typeof destination !== "string") {
            note(plan, builder.entry, `${label}.admin.${key} is not carried: ${destination.dropped}`);
            continue;
        }
        const printed = printable(plan, builder, value, [...segments, "admin", key], `${label}.admin.${key}`);
        if (key === "disabled" && isPlainObject(value) && value.hidden === true) {
            target.hiddenInForm = true;
            const { hidden: _hidden, ...rest } = isPlainObject(printed) ? printed : {};
            void _hidden;
            if (Object.keys(rest).length > 0) target.disabled = rest;
            continue;
        }
        target[destination] = printed;
    }
}

/** The collection `admin` block as `customizeTable` keys. */
function collectionAdmin(plan: PlanContext, builder: Builder, admin: Record<string, unknown>): void {
    const options = builder.options;
    for (const [key, value] of Object.entries(admin)) {
        if (value === undefined) continue;
        const destination = own(COLLECTION_ADMIN_DESTINATIONS, key);
        if (destination === undefined) {
            note(plan, builder.entry, `admin.${key} is not an admin option (nothing read it); not carried.`);
            continue;
        }
        if (typeof destination !== "string") {
            note(plan, builder.entry, `admin.${key} is not carried: ${destination.dropped}`);
            continue;
        }
        const printed = printable(plan, builder, value, ["admin", key], `admin.${key}`);
        if (destination.includes(".")) {
            const path_ = destination.split(".");
            at(options, path_.slice(0, -1))[path_[path_.length - 1]] = printed;
            continue;
        }
        if (key === "kanban" && isPlainObject(printed)) {
            const kanban = at(options, ["kanban"]);
            for (const [kanbanKey, kanbanValue] of Object.entries(printed)) {
                kanban[own(KANBAN_DESTINATIONS, kanbanKey) ?? kanbanKey] = kanbanValue;
            }
            continue;
        }
        if (key === "form" && isPlainObject(printed) && Array.isArray(printed.sections)) {
            options.form = {
                ...printed,
                sections: printed.sections.map(section => {
                    if (!isPlainObject(section) || !("properties" in section)) return section;
                    const { properties, ...rest } = section;
                    const ordered: Record<string, unknown> = {};
                    for (const [sectionKey, sectionValue] of Object.entries({ ...rest, fields: properties })) {
                        ordered[sectionKey] = sectionValue;
                    }
                    return ordered;
                })
            };
            continue;
        }
        options[destination] = printed;
    }
    const kanban = options.kanban;
    if (isPlainObject(kanban) && kanban.columnField === undefined) {
        delete options.kanban;
        note(plan, builder.entry, "admin.orderProperty has no kanban board to order (no `kanban.columnProperty`); `customizeTable` keeps the order field on the board, so it is not carried.");
    }
}

/** The relation-tab overrides of a relation, flattened as `customizeTable` options. */
function relationOverrides(plan: PlanContext, builder: Builder, value: unknown, segments: PathSegment[], label: string): Record<string, unknown> | undefined {
    if (!isPlainObject(value)) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue;
        if (key === "admin" && isPlainObject(entry)) {
            for (const [adminKey, adminValue] of Object.entries(entry)) {
                const destination = own(COLLECTION_ADMIN_DESTINATIONS, adminKey);
                if (typeof destination !== "string" || destination.includes(".")) {
                    note(plan, builder.entry, `${label}.admin.${adminKey} has no relation-tab option in \`customizeTable\`; not carried.`);
                    continue;
                }
                out[destination] = printable(plan, builder, adminValue, [...segments, "admin", adminKey], `${label}.admin.${adminKey}`);
            }
            continue;
        }
        if (key === "name" || key === "singularName" || key === "description" || key === "metadata" || key === "icon") {
            out[key] = printable(plan, builder, entry, [...segments, key], `${label}.${key}`);
            continue;
        }
        note(plan, builder.entry, `${label}.${key} has no relation-tab option in \`customizeTable\`; not carried.`);
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** Where a relation's `overrides` are in the legacy literal. */
function relationSegments(entry: CollectionEntry, key: string): PathSegment[] {
    const relations = "relations" in entry.collection && Array.isArray(entry.collection.relations) ? entry.collection.relations : [];
    const index = relations.findIndex(relation => (relation.relationName ?? "") === key);
    if (index >= 0) return ["relations", index, "overrides"];
    const stripped = key.endsWith("Relation") ? key.slice(0, -"Relation".length) : key;
    return ["properties", stripped, "relation", "overrides"];
}

/** Apply one property-level note to the field it is about. */
function applyFieldNote(plan: PlanContext, builder: Builder, item: LiftNote, fields: Record<string, unknown>): void {
    const key = item.key ?? "";
    const { literal, field } = noteKeySegments(key);
    const label = `properties.${key}`;
    if (item.kind === "inert" || item.kind === "redundant" || item.kind === "derived" || item.kind === "meaning") return;
    if (item.kind === "unknown") {
        note(plan, builder.entry, `${label}.${item.field} is not a field of the property model (nothing read it); not carried.`);
        return;
    }
    if (item.kind === "renamed") {
        plan.manualSteps.push({
            title: `Relation renamed in ${builder.name.table}`,
            detail: item.reason,
            file: relativeToRoot(plan, builder.name.file)
        });
        return;
    }
    if (item.field === "overrides") {
        const overrides = relationOverrides(plan, builder, item.value, relationSegments(builder.entry, key), `relations.${key}.overrides`);
        if (overrides) at(fields, [key]).overrides = overrides;
        return;
    }
    const target = at(fields, field);
    switch (item.field) {
        case "name":
            if (typeof item.value === "string" && item.value !== labelFromIdentifier(lastKey(key))) target.name = item.value;
            return;
        case "admin":
            if (isPlainObject(item.value)) fieldAdmin(plan, builder, item.value, literal, target, label);
            return;
        case "enum": {
            const constant = constantForEnum(plan.splitConstants ?? [], builder.entry.file, item.value);
            if (constant?.frontendFile) {
                let specifier = toPosix(path.relative(path.dirname(builder.file), constant.frontendFile.replace(/\.tsx?$/, "")));
                if (!specifier.startsWith(".")) specifier = `./${specifier}`;
                builder.libImports.set(specifier, new Set([...(builder.libImports.get(specifier) ?? []), constant.labelsName]));
                target.enumLabels = new RawSource(constant.labelsName);
                return;
            }
            const labels = enumLabelsOf(item.value as LegacyEnumValues);
            if (labels) target.enumLabels = labels;
            return;
        }
        case "propertiesOrder":
            target[String(PROPERTY_FIELD_DESTINATIONS.propertiesOrder)] = item.value;
            return;
        case "defaultValue": {
            // A relation's pre-fill: `new EntityRelation(…)` objects, which are
            // printed from their source (a class instance has no literal), its
            // imports carried.
            const located = locate(plan, builder.entry, [...literal, "defaultValue"]);
            if (!located.member) {
                note(plan, builder.entry, `${label}.defaultValue is not carried: its source could not be found (${located.reason ?? "unknown"}). Write it as \`fields.${key}.defaultValue\` in the customization.`);
                return;
            }
            builder.codeNodes.push(located.member.node);
            target.defaultValue = new RawSource(memberFunctionText(plan.ast, located.member));
            return;
        }
        case "storage.storagePath":
            at(target, ["storage"]).path = printable(plan, builder, item.value, [...literal, "storage", "storagePath"], `${label}.storage.storagePath`);
            return;
        case "storage.processFile":
        case "storage.postProcess":
        case "storage.previewUrl":
        case "storage.fileName": {
            const name = item.field.slice("storage.".length);
            at(target, ["storage"])[name] = printable(plan, builder, item.value, [...literal, "storage", name], `${label}.storage.${name}`);
            return;
        }
        default:
            break;
    }
    const destination = own(PROPERTY_FIELD_DESTINATIONS, item.field);
    if (destination !== undefined && typeof destination !== "string") {
        note(plan, builder.entry, `${label}.${item.field} is not carried: ${destination.dropped}`);
        return;
    }
    if (destination !== undefined) {
        target[destination] = printable(plan, builder, item.value, [...literal, item.field], `${label}.${item.field}`);
        if (item.field === "dynamicProps" && target[destination] !== undefined && flattenDynamicProps(plan, builder, target, destination, [...literal, item.field])) return;
        if (item.field === "dynamicProps" && target[destination] !== undefined) {
            plan.manualSteps.push({
                title: `Check fields.${key}.dynamicProps of ${builder.name.table}`,
                detail: "`dynamicProps` returns a field customization now (flat keys: `hidden`, `fieldOrder`, …), not a partial property with an `admin` block. Check what it returns.",
                file: relativeToRoot(plan, builder.file)
            });
        }
        return;
    }
    note(plan, builder.entry, `${label}.${item.field}: ${item.reason} \`customizeTable\` has no option for it; not carried.`);
}

/**
 * A `dynamicProps` builder carried into a customization, its returns rewritten
 * to 0.31's flat shape (see `dynamic-props.ts`): in the printed function when
 * it was written inline, in the defining module (its copy, or in place) when
 * it came from a spread of a shared object. True when nothing is left to
 * check by hand.
 */
function flattenDynamicProps(plan: PlanContext, builder: Builder, target: Record<string, unknown>, destination: string, segments: PathSegment[]): boolean {
    const { Node: N } = plan.ast.tsm;
    const printed = target[destination];
    if (!(printed instanceof RawSource)) return false;
    const located = locate(plan, builder.entry, segments);
    if (located.member) {
        // Written inline: rewrite the printed text (a scratch file of it, so a `const` it reads is not in scope and refuses).
        const scratch = plan.ast.project.createSourceFile(`/__rebase_migrate__/dynamic-props-${builder.name.identifier}.ts`, `const __builder = ${printed.text};`, { overwrite: true });
        try {
            const fn = unwrap(plan.ast, scratch.getVariableDeclarationOrThrow("__builder").getInitializerOrThrow());
            const rewrite = rewriteDynamicProps(plan.ast, fn, scratch, [fn]);
            if (!rewrite.edits) return false;
            const offset = "const __builder = ".length;
            let text = printed.text;
            for (const edit of [...rewrite.edits].sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start - offset) + edit.text + text.slice(edit.end - offset);
            target[destination] = new RawSource(text);
            return true;
        } finally {
            plan.ast.project.removeSourceFile(scratch);
        }
    }
    const spread = builder.entry.site ? spreadSource(plan.ast, builder.entry.site.literal, segments) : undefined;
    if (!spread) return false;
    const owner = findLiteral(plan, spread.spread);
    if (!owner.literal) return false;
    const member = memberOf(plan.ast, owner.literal, "dynamicProps");
    const fn = member.node ? (member.node.method ?? (member.node.value ? unwrap(plan.ast, member.node.value) : undefined)) : undefined;
    if (!fn || !(N.isArrowFunction(fn) || N.isFunctionExpression(fn) || N.isMethodDeclaration(fn))) return false;
    const sf = fn.getSourceFile();
    const rewrite = rewriteDynamicProps(plan.ast, fn, sf);
    if (!rewrite.edits) return false;
    if (rewrite.edits.length > 0) {
        plan.relocator.addSourceEdits(sf.getFilePath(), rewrite.edits);
        if (!plan.relocator.isInCollections(sf.getFilePath())) plan.relocator.keptFrontendModules.add(sf.getFilePath());
    }
    return true;
}

/**
 * `auth.actions` of an auth collection: `resetPassword: false` takes the
 * panel's reset-password action away, an action replaces it — both
 * `customizeTable`'s `resetPasswordAction` now. `true` is the default.
 */
function authActions(plan: PlanContext, builder: Builder, value: unknown): void {
    if (!isPlainObject(value)) {
        note(plan, builder.entry, "auth.actions is not an object of actions; not carried.");
        return;
    }
    for (const [key, entry] of Object.entries(value)) {
        if (key !== "resetPassword") {
            note(plan, builder.entry, `auth.actions.${key} is not an auth action (nothing read it); not carried.`);
            continue;
        }
        if (entry === undefined || entry === true) continue;
        builder.options.resetPasswordAction = entry === false
            ? false
            : printable(plan, builder, entry, ["auth", "actions", "resetPassword"], "auth.actions.resetPassword");
    }
}

/** Apply one collection-level note. */
function applyCollectionNote(plan: PlanContext, builder: Builder, item: LiftNote): void {
    const options = builder.options;
    const derivedName = labelFromIdentifier(builder.name.table);
    switch (item.field) {
        case "name":
            if (typeof item.value === "string" && item.value !== derivedName) options.name = item.value;
            return;
        case "singularName":
            if (typeof item.value === "string" && item.value !== singularLabel(derivedName)) options.singularName = item.value;
            return;
        case "icon":
            options.icon = printable(plan, builder, item.value, ["icon"], "icon");
            return;
        case "admin":
            if (isPlainObject(item.value)) collectionAdmin(plan, builder, item.value);
            return;
        case "ownerId":
            return;
        case "auth.actions":
            authActions(plan, builder, item.value);
            return;
        case "childCollections":
            plan.manualSteps.push({
                title: `Child collections of ${builder.name.table}`,
                detail: "`childCollections` has no `customizeTable` equivalent. A table's `rel.hasMany` / `rel.manyToMany` relations are shown as tabs on its records: declare the relation on the table instead.",
                file: relativeToRoot(plan, builder.entry.file)
            });
            return;
        default:
            break;
    }
    if (item.kind === "inert" || item.kind === "redundant" || item.kind === "derived" || item.kind === "meaning") return;
    if (item.kind === "unknown") {
        note(plan, builder.entry, `${item.field} is not a field of the collection model (nothing read it); not carried.`);
        return;
    }
    note(plan, builder.entry, `${item.field}: ${item.reason} \`customizeTable\` has no option for it; not carried.`);
}

/** The order the customization's top-level keys are written in. */
const OPTION_ORDER = ["name", "singularName", "description", "icon", "group"];

function orderedOptions(options: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of OPTION_ORDER) if (options[key] !== undefined) out[key] = options[key];
    for (const [key, value] of Object.entries(options)) if (key !== "fields" && out[key] === undefined && value !== undefined) out[key] = value;
    if (isPlainObject(options.fields) && Object.keys(options.fields).length > 0) out.fields = options.fields;
    return out;
}

/** Remove empty objects a note path created without filling. */
function prune(value: unknown): unknown {
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        const pruned = prune(entry);
        if (pruned === undefined || (isPlainObject(pruned) && Object.keys(pruned).length === 0)) continue;
        out[key] = pruned;
    }
    return out;
}

/** What {@link planCustomizations} wrote, for the index and `App.tsx`. */
export interface CustomizationOutput {
    /** The exported identifier and module of each customization, in the order given. */
    modules: { identifier: string; file: string; slug: string }[];
}

/**
 * Plan one `customizeTable` module per collection with non-default
 * presentation.
 *
 * @param notes the lift's `notCarried`
 * @param cmsDir `frontend/src/cms`, absolute
 */
export function planCustomizations(
    plan: PlanContext,
    entries: readonly CollectionEntry[],
    names: ReadonlyMap<string, TableName>,
    notes: readonly LiftNote[],
    cmsDir: string
): CustomizationOutput {
    const modules: CustomizationOutput["modules"] = [];
    for (const entry of entries) {
        const name = names.get(entry.collection.slug);
        if (!name) continue;
        const file = path.join(cmsDir, `${path.basename(name.file, ".ts")}.tsx`);
        const builder: Builder = { entry, name, file, options: {}, codeNodes: [], componentImports: new Map(), libImports: new Map(), failed: false };
        const fields: Record<string, unknown> = {};
        for (const item of notes) {
            if (item.collection !== entry.collection.slug) continue;
            if (item.key === undefined) applyCollectionNote(plan, builder, item);
            else applyFieldNote(plan, builder, item, fields);
        }
        builder.options.fields = prune(fields);
        const options = orderedOptions(prune(builder.options) as Record<string, unknown>);
        if (builder.failed || Object.keys(options).length === 0) continue;
        const content = printModule(plan, builder, options);
        if (content === undefined) continue;
        planFile(plan, file, content, `customization ${name.table}`);
        modules.push({ identifier: `${name.identifier}Cms`, file, slug: entry.collection.slug });
    }
    return { modules };
}

function printModule(plan: PlanContext, builder: Builder, options: Record<string, unknown>): string | undefined {
    const { entry, name, file } = builder;
    const exclude: Statement[] = entry.site ? entry.site.statements : [];
    const references = collectReferences(plan.ast, builder.codeNodes, exclude);
    if (references.forbidden.length > 0) {
        for (const forbidden of references.forbidden) {
            refuse(plan, entry, `presentation code references \`${forbidden.name}\`, the collection itself, which does not exist after the migration.`, { line: forbidden.line });
        }
        return undefined;
    }
    const identifier = `${name.identifier}Cms`;
    const taken = new Set(["customizeTable", name.identifier, identifier, ...builder.componentImports.keys()]);
    const clashes = references.imports.map(use => use.local).filter(local => taken.has(local));
    if (clashes.length > 0) {
        refuse(plan, entry, `presentation code binds ${clashes.map(clash => `\`${clash}\``).join(", ")}, which the customization module also binds. Rename it and run the codemod again.`);
        return undefined;
    }
    let carriedImports: string[];
    let statements: string[];
    try {
        carriedImports = importLines(references.imports, use => plan.relocator.relocate(use.specifier, use.fromFile, file, "frontend"));
        statements = references.statements.map(statement => {
            const text = nodeText(statement);
            return text.includes("import(") ? plan.relocator.moveSpecifiersInText(text, entry.file, file, "frontend") : text;
        });
    } catch (error) {
        refuse(plan, entry, error instanceof Error ? error.message : String(error));
        return undefined;
    }
    const componentLines = [...builder.componentImports].map(([local, { specifier, imported }]) =>
        imported === "default" ? `import ${local} from ${JSON.stringify(specifier)};` : `import { ${imported === local ? local : `${imported} as ${local}`} } from ${JSON.stringify(specifier)};`);
    const imports = [
        `import { customizeTable } from "@rebasepro/cms";`,
        `import type { ${name.identifier} } from ${JSON.stringify(tableImportPath(file, name))};`,
        ...componentLines,
        ...[...builder.libImports].map(([specifier, imported]) => `import { ${[...imported].join(", ")} } from ${JSON.stringify(specifier)};`),
        ...carriedImports
    ];
    let body: string;
    try {
        body = printValue(options, "", "options");
    } catch (error) {
        refuse(plan, entry, error instanceof Error ? error.message : String(error));
        return undefined;
    }
    const call = `export const ${identifier} = customizeTable<typeof ${name.identifier}>(${JSON.stringify(entry.collection.slug)}, ${body});`;
    return `${[imports.join("\n"), ...statements, call].join("\n\n")}\n`;
}

/** `frontend/src/cms/index.ts`: the customizations in navigation order, and the external collections. */
export function printCmsIndex(
    cmsDir: string,
    customizations: readonly { identifier: string; file: string }[],
    external: readonly { identifier: string; file: string }[]
): string {
    const lines: string[] = [];
    const specifier = (file: string): string => {
        const relative = toPosix(path.relative(cmsDir, file.replace(/\.tsx?$/, "")));
        return JSON.stringify(relative.startsWith(".") ? relative : `./${relative}`);
    };
    for (const module of customizations) lines.push(`import { ${module.identifier} } from ${specifier(module.file)};`);
    // A Firestore collection file keeps its default export, as it was written.
    for (const module of external) lines.push(`import ${module.identifier} from ${specifier(module.file)};`);
    if (lines.length > 0) lines.push("");
    lines.push("/** The table customizations, in the order the panel lists them. */");
    lines.push(`export const tableCustomizations = [${customizations.map(module => module.identifier).join(", ")}];`);
    if (external.length > 0) {
        lines.push("");
        lines.push("/** Collections whose rows live outside the Postgres backend. */");
        lines.push(`export const externalCollections = [${external.map(module => module.identifier).join(", ")}];`);
    }
    return `${lines.join("\n")}\n`;
}
