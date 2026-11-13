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
import fs from "node:fs";
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
import { importLines, resolveRelative } from "./modules";
import type { CollectionEntry, PlanContext } from "./plan-context";
import { note, planFile, refuse, relativeToRoot } from "./plan-context";
import { printValue, RawSource } from "./print-js";
import type { TableName } from "./backend";
import { tableImportPath } from "./backend";
import { own } from "./own";

/** The keys whose string value is a component path (the Vite plugin's `LAZY_COMPONENT_KEYS`). */
export const COMPONENT_KEYS = new Set(["Field", "Preview", "Builder", "Filter", "Component"]);

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
function importComponent(plan: PlanContext, builder: Builder, specifier: string, imported: string, writtenIn = builder.entry.file): RawSource {
    const moved = plan.relocator.relocate(specifier, writtenIn, builder.file, "frontend");
    for (const [local, existing] of builder.componentImports) {
        if (existing.specifier === moved && existing.imported === imported) return new RawSource(local);
    }
    const taken = new Set(builder.componentImports.keys());
    const local = componentName(imported === "default" ? moved : imported, taken);
    builder.componentImports.set(local, { specifier: moved, imported });
    return new RawSource(local);
}

/**
 * The module that wrote the component path `value`: the collection file when it
 * spells it, else the first module of the collection's relative imports (followed
 * a few levels: a shared helper's own imports) whose source holds it as a string
 * literal. A relative path is relative to the module that wrote it — a shared
 * module one directory away names the same component with another path.
 */
function componentWriter(entry: CollectionEntry, value: string): string {
    const spells = (text: string): boolean => text.includes(`"${value}"`) || text.includes(`'${value}'`) || text.includes(`\`${value}\``);
    if (spells(entry.sourceFile.getFullText())) return entry.file;
    const seen = new Set<string>([entry.file]);
    let frontier = [entry.file];
    for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
        const next: string[] = [];
        for (const file of frontier) {
            const text = file === entry.file ? entry.sourceFile.getFullText() : fs.readFileSync(file, "utf8");
            for (const match of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
                const target = resolveRelative(file, match[1]).target;
                if (seen.has(target) || !fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
                seen.add(target);
                if (spells(fs.readFileSync(target, "utf8"))) return target;
                next.push(target);
            }
        }
        frontier = next;
    }
    return entry.file;
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

/** Calls whose result differs from one load to the next: a value computed with one is not data. */
const LOAD_TIME_CALLS = /\bnew\s+Date\s*\(\s*\)|\bDate\.now\s*\(|\bMath\.random\s*\(|\bprocess\.env\b|\bimport\.meta\.env\b|\bcrypto\.randomUUID\s*\(|\bperformance\.now\s*\(/;

/** How close to the run a date must be to count as the run's clock (a preset of "today" lands within hours of it). */
const RUN_CLOCK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Whether an evaluated value holds a date read from the clock while the codemod loaded the config. */
function holdsRunClock(value: unknown, depth = 0): boolean {
    if (depth > 8) return false;
    const now = Date.now();
    const near = (time: number): boolean => Number.isFinite(time) && Math.abs(time - now) < RUN_CLOCK_WINDOW_MS;
    if (value instanceof Date) return near(value.getTime());
    if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && near(Date.parse(value));
    if (typeof value === "number") return value > 1e12 && near(value);
    if (Array.isArray(value)) return value.some(item => holdsRunClock(item, depth + 1));
    if (isPlainObject(value)) return Object.values(value).some(item => holdsRunClock(item, depth + 1));
    return false;
}

/** Whether an expression is written out as data (no call, no reference: what it evaluates to is what it says). */
function isLiteralExpression(plan: PlanContext, node: Node): boolean {
    const { Node: N, SyntaxKind } = plan.ast.tsm;
    const current = unwrap(plan.ast, node);
    if (N.isStringLiteral(current) || N.isNumericLiteral(current) || N.isNoSubstitutionTemplateLiteral(current) || N.isObjectLiteralExpression(current) || N.isArrayLiteralExpression(current)) return true;
    const kind = current.getKind();
    if (kind === SyntaxKind.TrueKeyword || kind === SyntaxKind.FalseKeyword || kind === SyntaxKind.NullKeyword) return true;
    if (N.isPrefixUnaryExpression(current)) return N.isNumericLiteral(current.getOperand());
    return N.isIdentifier(current) && current.getText() === "undefined";
}

/**
 * A data value the config COMPUTED when it was loaded — `new Date()`, `Date.now()`,
 * `Math.random()`, an environment read, or a helper that read the clock — is not
 * data: printed as evaluated it would be frozen to the codemod's run. Where the
 * expression that computed it is found in the collection's literal, it is carried
 * as that SOURCE (its imports with it); where it cannot be attributed, it is left
 * out and a step names it.
 *
 * @returns `handled` with what to print when this value is decided here;
 *   otherwise whether its source was attributed (no need to look again below it)
 */
function loadTimeValue(plan: PlanContext, builder: Builder, value: unknown, segments: PathSegment[], label: string): { handled: true; printed: unknown } | { handled: false; attributed: boolean } {
    if (segments.length === 0) return { handled: false, attributed: false };
    const located = locate(plan, builder.entry, segments);
    const member = located.member;
    if (member && !member.method) {
        const valueNode = member.value ?? member.node;
        if (isLiteralExpression(plan, valueNode)) return { handled: false, attributed: false };
        const source = nodeText(valueNode);
        if (!LOAD_TIME_CALLS.test(source) && !holdsRunClock(value)) return { handled: false, attributed: true };
        builder.codeNodes.push(member.node);
        note(plan, builder.entry, `${label} is computed when the config loads (\`${source.length > 80 ? `${source.slice(0, 77)}…` : source}\`): carried as that expression, not as the value it had during the migration. It now runs in the panel, when the customization module loads.`);
        return { handled: true, printed: new RawSource(source) };
    }
    if (!holdsRunClock(value) || Array.isArray(value) || isPlainObject(value)) return { handled: false, attributed: false };
    plan.manualSteps.push({
        title: `Write ${label} of ${builder.name.table} by hand`,
        detail: `${label} held ${JSON.stringify(value)} when the codemod loaded the config — a date read from the clock at load time, whose source cannot be attributed (${located.reason ?? "it was computed"}). It was left out rather than frozen to the run's time. Write the expression that computes it in ${relativeToRoot(plan, builder.file)} under the same key.`,
        file: relativeToRoot(plan, builder.file)
    });
    return { handled: true, printed: undefined };
}

/**
 * A value as something printable: data as itself, code from its source.
 *
 * @param segments where the value is in the legacy literal, for finding a function's source
 */
function printable(plan: PlanContext, builder: Builder, value: unknown, segments: PathSegment[], label: string, attributed = false): unknown {
    if (!isCode(value) && !attributed && value !== undefined) {
        const computed = loadTimeValue(plan, builder, value, segments, label);
        if (computed.handled) return computed.printed;
        attributed = computed.attributed;
    }
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
            return importComponent(plan, builder, value, "default", componentWriter(builder.entry, value));
        } catch (error) {
            refuse(plan, builder.entry, error instanceof Error ? error.message : String(error), { key: segments.join(".") });
            builder.failed = true;
            return undefined;
        }
    }
    if (Array.isArray(value)) return value.map((item, index) => printable(plan, builder, item, [...segments, index], `${label}[${index}]`, attributed));
    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined) continue;
            out[key] = printable(plan, builder, entry, [...segments, key], `${label}.${key}`, attributed);
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

/**
 * The relations the lift renamed in one collection, old key → new key: a
 * belongsTo that served its foreign key under its own key is `<key>Relation`
 * now, and the column keeps the key.
 */
function relationRenames(notes: readonly LiftNote[], slug: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const item of notes) {
        if (item.collection !== slug || item.kind !== "renamed" || item.key === undefined) continue;
        out.set(item.key, `${String(item.value)}Relation`);
    }
    return out;
}

/** The presentation options that name fields by key, as lists. */
const FIELD_LIST_OPTIONS = ["listFields", "previewFields", "fieldOrder"] as const;

/**
 * Point the presentation of a renamed relation at its new key.
 *
 * The panel draws the relation in the column's place (the projection replaces
 * a belongsTo's foreign-key column with the relation), so a customization that
 * still names the column's key labels, lists and titles a field the panel does
 * not have: every entry is skipped with a development warning. What the
 * legacy property said — its name, its column in the list, the title it gave
 * the record — is said of the relation.
 */
function renameRelationKeys(options: Record<string, unknown>, renames: ReadonlyMap<string, string>): void {
    if (renames.size === 0) return;
    const renameList = (value: unknown): unknown =>
        Array.isArray(value) ? value.map(entry => (typeof entry === "string" ? renames.get(entry) ?? entry : entry)) : value;
    const fields = options.fields;
    if (isPlainObject(fields)) {
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(fields)) {
            const renamed = renames.get(key);
            out[renamed !== undefined && !(renamed in fields) ? renamed : key] = value;
        }
        options.fields = out;
    }
    for (const key of FIELD_LIST_OPTIONS) if (options[key] !== undefined) options[key] = renameList(options[key]);
    const display = options.display;
    if (isPlainObject(display)) {
        for (const [slot, source] of Object.entries(display)) {
            if (typeof source === "string" && renames.has(source)) display[slot] = renames.get(source);
        }
    }
    const form = options.form;
    if (isPlainObject(form)) {
        if (form.sidebar !== undefined) form.sidebar = renameList(form.sidebar);
        if (Array.isArray(form.sections)) {
            for (const section of form.sections) if (isPlainObject(section) && section.fields !== undefined) section.fields = renameList(section.fields);
        }
    }
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
        renameRelationKeys(builder.options, relationRenames(notes, entry.collection.slug));
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
    // A column list naming an additional field: the key is branded, as the type asks
    // (`"score" as AdditionalFieldKey` — a bare string is not a column id).
    if (brandAdditionalFieldKeys(options)) imports.push(`import type { AdditionalFieldKey } from "@rebasepro/cms-types";`);
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

/**
 * Brand the entries of `fieldOrder` / `listFields` that name one of the
 * customization's `additionalFields`: `TableColumnId` accepts a field path, a
 * relation tab, or an `AdditionalFieldKey`, and the key's documented spelling is
 * `"key" as AdditionalFieldKey` (the brand is required, so a typo does not pass).
 *
 * @returns whether any entry was branded (the module then imports the type)
 */
export function brandAdditionalFieldKeys(options: Record<string, unknown>): boolean {
    const fields = options.additionalFields;
    const keys = new Set((Array.isArray(fields) ? fields : []).flatMap(field => (isPlainObject(field) && typeof field.key === "string" ? [field.key] : [])));
    if (keys.size === 0) return false;
    let branded = false;
    for (const list of ["fieldOrder", "listFields"]) {
        const value = options[list];
        if (!Array.isArray(value)) continue;
        options[list] = value.map(item => {
            if (typeof item !== "string" || !keys.has(item)) return item;
            branded = true;
            return new RawSource(`${JSON.stringify(item)} as AdditionalFieldKey`);
        });
    }
    return branded;
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
