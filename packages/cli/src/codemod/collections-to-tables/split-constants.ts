/**
 * Shared enum constants, split into values (the schema's) and labels (the
 * CMS's).
 *
 * A legacy project often keeps a closed set in one module of `config/` —
 * `export const LOCALE_ENUM: EnumValueConfig[] = [{ id: "en", label: "English" }, …]`
 * — and uses it in a collection, where the ids are the column's values and the
 * labels its presentation. After the split those belong to two sides that may
 * not import each other's code, so the module becomes two:
 *
 * - `backend/lib/<name>.ts`: `export const LOCALES = ["en", …] as const;` and
 *   `export type Locale = (typeof LOCALES)[number];`
 * - `frontend/src/cms/lib/<name>.ts`: `export const LOCALE_LABELS: Record<Locale, string> = {…}`,
 *   typed from the backend's values (a type import, which the frontend may
 *   make), so a value added without a label is a type error.
 *
 * The tables name `LOCALES` where they inlined the ids, and the customizations
 * name `LOCALE_LABELS` where they inlined the labels.
 *
 * Done only when it is mechanical: every export of the module is such a
 * constant, every entry is `{ id, label }` with nothing else (no colour, no
 * disabled flag). Otherwise the module stays a manual step that says why.
 */
import fs from "node:fs";
import path from "node:path";
import { plural } from "@rebasepro/utils";

import { toPosix } from "./ast";
import type { ModuleImporter } from "./load-legacy";
import type { CollectionEntry, PlanContext } from "./plan-context";
import { planFile, relativeToRoot } from "./plan-context";
import { printStringLiteral } from "./print-js";

/** One constant split in two. */
export interface SplitConstant {
    /** The legacy module, absolute. */
    module: string;
    /** The legacy export name (`LOCALE_ENUM`). */
    legacyName: string;
    /** The values, in order. */
    ids: (string | number)[];
    /** The label of each value. */
    labels: Record<string, string>;
    /** `LOCALES`, written in `backend/lib/<name>.ts`. */
    valuesName: string;
    /** `Locale`. */
    typeName: string;
    /** `LOCALE_LABELS`, written in `frontend/src/cms/lib/<name>.ts`. */
    labelsName: string;
    /** The backend module, absolute. */
    backendFile: string;
    /** The frontend module, absolute (absent for a project without a frontend). */
    frontendFile?: string;
    /** The collection files that import the legacy module. */
    importedBy: Set<string>;
}

/** A module of `config/` that could not be split, and why. */
export interface UnsplitModule {
    module: string;
    reason: string;
}

const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function resolveModule(fromFile: string, specifier: string): string | undefined {
    const base = path.resolve(path.dirname(fromFile), specifier).replace(/\.(m?js|jsx)$/, "");
    for (const extension of CODE_EXTENSIONS) if (fs.existsSync(base + extension)) return base + extension;
    for (const extension of CODE_EXTENSIONS) {
        const index = path.join(base, `index${extension}`);
        if (fs.existsSync(index)) return index;
    }
    return undefined;
}

function isEnumEntry(value: unknown): value is { id: string | number; label: string } {
    if (typeof value !== "object" || value === null) return false;
    const keys = Object.keys(value);
    return keys.length === 2 && "id" in value && "label" in value &&
        (typeof value.id === "string" || typeof value.id === "number") && typeof value.label === "string";
}

function names(legacyName: string): { valuesName: string; typeName: string; labelsName: string } {
    const base = legacyName.replace(/_(ENUM|VALUES|OPTIONS|LIST)$/, "") || legacyName;
    const lower = base.toLowerCase();
    const plural_ = plural(lower);
    const valuesName = plural_ !== lower ? plural_.toUpperCase() : `${base}_VALUES`;
    const typeName = lower.split("_").filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join("");
    return { valuesName, typeName, labelsName: `${base}_LABELS` };
}

/**
 * Find the `config/` modules the collections import that are enum constants
 * and nothing else.
 */
export async function findSplitConstants(
    plan: PlanContext,
    entries: readonly CollectionEntry[],
    importModule: ModuleImporter,
    cmsDir: string | undefined
): Promise<{ constants: SplitConstant[]; unsplit: UnsplitModule[] }> {
    const byModule = new Map<string, Set<string>>();
    for (const entry of entries) {
        for (const declaration of entry.sourceFile.getImportDeclarations()) {
            const specifier = declaration.getModuleSpecifierValue();
            if (!specifier.startsWith(".") || declaration.isTypeOnly()) continue;
            const target = resolveModule(entry.file, specifier);
            if (!target || !plan.relocator.isInConfig(target) || entries.some(other => other.file === target)) continue;
            const set = byModule.get(target) ?? new Set<string>();
            set.add(entry.file);
            byModule.set(target, set);
        }
    }
    const constants: SplitConstant[] = [];
    const unsplit: UnsplitModule[] = [];
    for (const [module, importedBy] of byModule) {
        let exports: Record<string, unknown>;
        try {
            exports = await importModule(module);
        } catch {
            continue;
        }
        const entriesOf = Object.entries(exports).filter(([name]) => name !== "default" && name !== "__esModule");
        const enumExports = entriesOf.filter(([, value]) => Array.isArray(value) && value.length > 0 && value.every(isEnumEntry));
        if (enumExports.length === 0) continue;
        if (enumExports.length !== entriesOf.length) {
            unsplit.push({ module, reason: `exports ${entriesOf.filter(entry => !enumExports.includes(entry)).map(([name]) => `\`${name}\``).join(", ")} besides its enum constants, so it cannot be split into values and labels mechanically` });
            continue;
        }
        const relative = path.relative(plan.relocator.configDirectory, module);
        for (const [legacyName, value] of enumExports) {
            const list = Array.isArray(value) ? value.filter(isEnumEntry) : [];
            const labels: Record<string, string> = {};
            for (const item of list) labels[String(item.id)] = item.label;
            constants.push({
                module,
                legacyName,
                ids: list.map(item => item.id),
                labels,
                ...names(legacyName),
                backendFile: path.join(plan.root, "backend", "lib", relative),
                ...(cmsDir ? { frontendFile: path.join(cmsDir, "lib", relative) } : {}),
                importedBy
            });
        }
    }
    return { constants, unsplit };
}

/** The printed form of a constant's ids, as the shared printer writes an array of literals. */
function printedIds(constant: SplitConstant): string {
    return `[${constant.ids.map(id => (typeof id === "string" ? printStringLiteral(id) : String(id))).join(", ")}]`;
}

function specifierFrom(fromFile: string, target: string): string {
    let relative = toPosix(path.relative(path.dirname(fromFile), target.replace(/\.(tsx?|mts)$/, "")));
    if (!relative.startsWith(".")) relative = `./${relative}`;
    return relative;
}

/** Insert an import line after a module's import block. */
function addImport(content: string, line: string): string {
    if (content.includes(line)) return content;
    const lines = content.split("\n");
    let last = -1;
    lines.forEach((text, index) => {
        if (/^import\s/.test(text)) last = index;
    });
    lines.splice(last + 1, 0, line);
    return lines.join("\n");
}

/** Write the split modules and point the planned tables at the values. */
export function planSplitConstants(plan: PlanContext, constants: readonly SplitConstant[], tableFiles: ReadonlyMap<string, string>): void {
    const byModule = new Map<string, SplitConstant[]>();
    for (const constant of constants) byModule.set(constant.module, [...(byModule.get(constant.module) ?? []), constant]);
    for (const [module, group] of byModule) {
        const legacy = relativeToRoot(plan, module);
        const backend = group.map(constant => [
            `/** The values of \`${constant.legacyName}\` (${legacy}). What the panel calls each one is the CMS's: ${constant.frontendFile ? relativeToRoot(plan, constant.frontendFile) : "no frontend"}. */`,
            `export const ${constant.valuesName} = ${printedIds(constant)} as const;`,
            "",
            `/** One of {@link ${constant.valuesName}}. */`,
            `export type ${constant.typeName} = (typeof ${constant.valuesName})[number];`
        ].join("\n"));
        planFile(plan, group[0].backendFile, `${backend.join("\n\n")}\n`, `values of ${legacy}`);
        const frontendFile = group[0].frontendFile;
        if (frontendFile) {
            const typeImport = `import type { ${group.map(constant => constant.typeName).join(", ")} } from ${JSON.stringify(specifierFrom(frontendFile, group[0].backendFile))};`;
            const frontend = group.map(constant => [
                `/** What the panel calls each value of \`${constant.legacyName}\` (${legacy}); the values are the backend's. */`,
                `export const ${constant.labelsName}: Record<${constant.typeName}, string> = {`,
                Object.entries(constant.labels).map(([id, label]) => `    ${/^[A-Za-z_$][\w$]*$/.test(id) ? id : JSON.stringify(id)}: ${printStringLiteral(label)}`).join(",\n"),
                "};"
            ].join("\n"));
            planFile(plan, frontendFile, `${typeImport}\n\n${frontend.join("\n\n")}\n`, `labels of ${legacy}`);
        }
        // The tables that inlined the values name the constant instead.
        for (const [collectionFile, tableFile] of tableFiles) {
            const planned = plan.files.get(tableFile);
            if (!planned) continue;
            let content = planned.content;
            for (const constant of group) {
                if (!constant.importedBy.has(collectionFile)) continue;
                const printed = printedIds(constant);
                if (!content.includes(printed)) continue;
                content = content.split(printed).join(constant.valuesName);
                content = addImport(content, `import { ${constant.valuesName} } from ${JSON.stringify(specifierFrom(tableFile, constant.backendFile))};`);
            }
            if (content !== planned.content) plan.files.set(tableFile, { ...planned, content });
        }
    }
}

/** The constant whose labels a field's legacy `enum` restates, when one does. */
export function constantForEnum(constants: readonly SplitConstant[], collectionFile: string, values: unknown): SplitConstant | undefined {
    if (!Array.isArray(values)) return undefined;
    return constants.find(constant => constant.importedBy.has(collectionFile) &&
        constant.ids.length === values.length &&
        values.every((value, index) => isEnumEntry(value) && value.id === constant.ids[index] && value.label === constant.labels[String(value.id)]));
}
