/**
 * Moving code between files: rewriting a module specifier for its new home,
 * copying the helper modules carried code imports, and assembling a module's
 * import block.
 *
 * A relative import from `config/collections/orders.ts` keeps pointing at the
 * same file from `backend/schema/orders.ts` — a module of `config/` included:
 * the project's own modules there stay, importable as before. Only a helper
 * inside `config/collections`, which the migration removes, is copied next to
 * the code that needs it (`backend/lib/…` for server code,
 * `frontend/src/cms/lib/…` for the panel's), its own imports moved the same
 * way. A helper that imports a collection file cannot move (the collection is a
 * table now) and is refused.
 */
import fs from "node:fs";
import path from "node:path";

import type { SourceFile } from "ts-morph";

import type { AstContext, ImportUse } from "./ast";
import { toPosix } from "./ast";
import { own } from "./own";

/** Which side of the split a file lives on. */
export type Side = "backend" | "frontend";

/** A module specifier that cannot be moved, and why. */
export class RelocationError extends Error {
    constructor(readonly file: string, message: string) {
        super(message);
    }
}

const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs"];

/** How a relative specifier was written, so the moved one is written the same way. */
export type SpecifierStyle = "extensionless" | "directory" | { extension: string };

export interface ResolvedSpecifier {
    target: string;
    style: SpecifierStyle;
}

/** The file a relative specifier written in `fromFile` names, and how it was written. */
export function resolveRelative(fromFile: string, specifier: string): ResolvedSpecifier {
    const base = path.resolve(path.dirname(fromFile), specifier);
    const extension = path.extname(specifier);
    if (extension === ".js" || extension === ".jsx" || extension === ".mjs") {
        const stem = base.slice(0, -extension.length);
        for (const candidate of [".ts", ".tsx", ".mts", extension]) {
            if (fs.existsSync(stem + candidate)) return { target: stem + candidate, style: { extension } };
        }
    }
    if (extension && fs.existsSync(base) && fs.statSync(base).isFile()) return { target: base, style: { extension } };
    for (const candidate of CODE_EXTENSIONS) {
        if (fs.existsSync(base + candidate)) return { target: base + candidate, style: "extensionless" };
    }
    for (const candidate of CODE_EXTENSIONS) {
        const index = path.join(base, `index${candidate}`);
        if (fs.existsSync(index)) return { target: index, style: "directory" };
    }
    return { target: base, style: extension ? { extension } : "extensionless" };
}

/** A relative specifier from `fromFile` to `target`, written in `style`. */
export function writeSpecifier(fromFile: string, target: string, style: SpecifierStyle): string {
    let destination = target;
    if (style === "directory") destination = path.dirname(target);
    else if (style === "extensionless") destination = target.replace(/\.(tsx?|mts|jsx?|mjs)$/, "");
    else if (/\.(tsx?|mts)$/.test(target) && /^\.(jsx?|mjs)$/.test(style.extension)) destination = target.replace(/\.(tsx?|mts)$/, style.extension);
    let relative = toPosix(path.relative(path.dirname(fromFile), destination));
    if (!relative.startsWith(".")) relative = `./${relative}`;
    return relative;
}

/** One helper module copied out of `config/`. */
export interface HelperCopy {
    /** Where it was, absolute. */
    from: string;
    /** Where it goes, absolute. */
    to: string;
    side: Side;
}

/**
 * Moves specifiers and collects the helper copies they need. One per run, so
 * a helper used by several files is copied once per side.
 */
export class Relocator {
    readonly helpers = new Map<string, HelperCopy>();
    /** Modules of the project's own in config/ that backend code the run writes imports in place. */
    readonly keptBackendModules = new Set<string>();
    /** Modules outside config/collections the run edits in place for the panel (a shared `dynamicProps` builder). */
    readonly keptFrontendModules = new Set<string>();
    /** Edits to a module's own text before it is copied or kept (a helper's callbacks as table hooks), by absolute path. */
    readonly sourceEdits = new Map<string, { start: number; end: number; text: string }[]>();

    /**
     * Queue edits to a module's own text (deduplicated by position), dropping
     * any copy of it already made so the next one carries them.
     */
    addSourceEdits(file: string, edits: readonly { start: number; end: number; text: string }[]): void {
        const queued = this.sourceEdits.get(file) ?? [];
        for (const edit of edits) if (!queued.some(other => other.start === edit.start && other.end === edit.end)) queued.push(edit);
        this.sourceEdits.set(file, queued);
        for (const side of ["backend", "frontend"]) this.contents.delete(`${side}:${file}`);
    }

    /** A module's text with its {@link sourceEdits} applied. */
    editedSource(file: string): string {
        let out = fs.readFileSync(file, "utf8");
        const edits = this.sourceEdits.get(file);
        if (edits) for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
        return out;
    }
    /** Collection files that move rather than become tables (Firestore ones): legacy path → new path. */
    readonly moved = new Map<string, string>();

    constructor(
        private readonly ctx: AstContext,
        private readonly projectRoot: string,
        private readonly configDir: string,
        private readonly collectionFiles: ReadonlySet<string>,
        private readonly libDirs: Readonly<Record<Side, string>>
    ) {}

    /** The config directory, absolute. */
    get configDirectory(): string {
        return this.configDir;
    }

    /** Whether `file` is inside `<config>/collections`, which the migration removes. */
    isInCollections(file: string): boolean {
        const relative = path.relative(path.join(this.configDir, "collections"), file);
        return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    }

    /** Whether `file` is inside the config directory. */
    isInConfig(file: string): boolean {
        const relative = path.relative(this.configDir, file);
        return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    }

    /** The specifier `specifier` (written in `fromFile`) becomes when written in `destFile`. */
    relocate(specifier: string, fromFile: string, destFile: string, side: Side): string {
        if (!specifier.startsWith(".")) return specifier;
        const { target, style } = resolveRelative(fromFile, specifier);
        const movedTo = this.moved.get(target);
        if (movedTo !== undefined && side === "frontend") return writeSpecifier(destFile, movedTo, style);
        if (this.collectionFiles.has(target)) {
            throw new RelocationError(fromFile,
                `${toPosix(path.relative(this.projectRoot, fromFile))} imports the collection file "${specifier}" into code the codemod moves. ` +
                "A collection is a table now: import the table from backend/schema (or move the shared value into a module of its own).");
        }
        if (!this.isInConfig(target)) return writeSpecifier(destFile, target, style);
        if (!fs.existsSync(target)) {
            throw new RelocationError(fromFile, `${toPosix(path.relative(this.projectRoot, fromFile))} imports "${specifier}", which does not exist.`);
        }
        // A module of the project's own in config/ stays where it is: 0.31
        // stops reading config/collections, not config/. Only a helper inside
        // config/collections — a directory that must go — is copied out.
        if (!this.isInCollections(target)) {
            if (side === "backend") this.keptBackendModules.add(target);
            return writeSpecifier(destFile, target, style);
        }
        const copy = this.copyHelper(target, side);
        return writeSpecifier(destFile, copy.to, style);
    }

    private copyHelper(file: string, side: Side): HelperCopy {
        const key = `${side}:${file}`;
        const existing = this.helpers.get(key);
        if (existing) return existing;
        const to = path.join(this.libDirs[side], path.relative(this.configDir, file));
        const copy: HelperCopy = { from: file, to, side };
        this.helpers.set(key, copy);
        // Its own imports move too (and may queue more copies).
        this.helperContent(copy);
        return copy;
    }

    private readonly contents = new Map<string, string>();

    /** A helper's content in its new home: its relative specifiers moved. */
    helperContent(copy: HelperCopy): string {
        const key = `${copy.side}:${copy.from}`;
        const cached = this.contents.get(key);
        if (cached !== undefined) return cached;
        const text = this.editedSource(copy.from);
        this.contents.set(key, text);
        const moved = this.moveSpecifiersInText(text, copy.from, copy.to, copy.side);
        this.contents.set(key, moved);
        return moved;
    }

    /**
     * A module of config/ that backend code imports in place, with the
     * collection-model types it imports replaced by table-model aliases (as a
     * copy to backend/lib gets them): the hooks it serves are table hooks now.
     */
    keptBackendContent(file: string): string {
        const text = this.editedSource(file);
        const sf = this.ctx.project.createSourceFile(`/__rebase_migrate__/kept-${path.basename(file)}`, text, { overwrite: true });
        try {
            const edits: { start: number; end: number; text: string }[] = [];
            this.legacyTypeEdits(sf, text, edits);
            let out = text;
            for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
            return out;
        } finally {
            this.ctx.project.removeSourceFile(sf);
        }
    }

    /** Collection-model types left in moved backend code (used with type arguments), for the report. */
    readonly legacyTypesLeft: { file: string; name: string }[] = [];

    /** Edits replacing the collection-model types a moved backend module imports (see {@link replaceLegacyTypes}). */
    private legacyTypeEdits(sf: SourceFile, text: string, edits: { start: number; end: number; text: string }[]): void {
        const aliases: string[] = [];
        const types = new Set<string>();
        for (const declaration of sf.getImportDeclarations()) {
            const specifier = declaration.getModuleSpecifierValue();
            if (!LEGACY_TYPE_PACKAGES.has(specifier)) continue;
            const named = declaration.getNamedImports();
            const replaced = named.filter(entry => {
                const replacement = own(LEGACY_TYPE_REPLACEMENTS, entry.getName());
                const local = entry.getAliasNode()?.getText() ?? entry.getName();
                if (!replacement) return false;
                if (new RegExp(`\\b${local}\\s*<`).test(text)) {
                    this.legacyTypesLeft.push({ file: sf.getBaseName(), name: local });
                    return false;
                }
                types.add(replacement.type);
                aliases.push(`type ${local} = ${replacement.expression};`);
                return true;
            });
            if (replaced.length === 0) continue;
            const remaining = named.filter(entry => !replaced.includes(entry));
            if (remaining.length === 0 && !declaration.getDefaultImport() && !declaration.getNamespaceImport()) {
                const end = text[declaration.getEnd()] === "\n" ? declaration.getEnd() + 1 : declaration.getEnd();
                edits.push({ start: declaration.getStart(), end, text: "" });
            } else {
                const bindings = remaining.map(entry => entry.getText()).join(", ");
                const typeOnly = declaration.isTypeOnly() ? "type " : "";
                const head = declaration.getDefaultImport() ? `${declaration.getDefaultImport()?.getText()}, ` : "";
                edits.push({ start: declaration.getStart(), end: declaration.getEnd(), text: `import ${typeOnly}${head}{ ${bindings} } from ${JSON.stringify(specifier)};` });
            }
        }
        if (aliases.length === 0) return;
        const imports = sf.getImportDeclarations();
        const at = imports.length > 0 ? imports[imports.length - 1].getEnd() : 0;
        edits.push({ start: at, end: at, text: `${imports.length > 0 ? "\n" : ""}import type { ${[...types].sort().join(", ")} } from "@rebasepro/server/schema";\n\n${aliases.join("\n")}${imports.length > 0 ? "" : "\n"}` });
    }

    /**
     * Every module specifier in `text` (static imports, re-exports, dynamic
     * `import()`), moved from `fromFile` to `destFile`.
     */
    moveSpecifiersInText(text: string, fromFile: string, destFile: string, side: Side): string {
        const { Node: N, SyntaxKind } = this.ctx.tsm;
        const sf = this.ctx.project.createSourceFile(`/__rebase_migrate__/move-${this.contents.size}-${path.basename(fromFile)}`, text, { overwrite: true });
        try {
            const edits: { start: number; end: number; text: string }[] = [];
            const literals = [
                ...sf.getImportDeclarations().map(declaration => declaration.getModuleSpecifier()),
                ...sf.getExportDeclarations().map(declaration => declaration.getModuleSpecifier()).filter(literal => literal !== undefined),
                ...sf.getDescendantsOfKind(SyntaxKind.CallExpression)
                    .filter(call => call.getExpression().getKind() === SyntaxKind.ImportKeyword)
                    .map(call => call.getArguments()[0])
                    .filter(argument => argument !== undefined && N.isStringLiteral(argument))
            ];
            for (const literal of literals) {
                if (!N.isStringLiteral(literal)) continue;
                const value = literal.getLiteralValue();
                const moved = this.relocate(value, fromFile, destFile, side);
                if (moved !== value) edits.push({ start: literal.getStart() + 1, end: literal.getEnd() - 1, text: moved });
            }
            if (side === "backend") this.legacyTypeEdits(sf, text, edits);
            let out = text;
            for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
            return out;
        } finally {
            this.ctx.project.removeSourceFile(sf);
        }
    }
}

/** Packages a backend helper imported collection-model types from. */
const LEGACY_TYPE_PACKAGES = new Set(["@rebasepro/common", "@rebasepro/types", "@rebasepro/server", "@rebasepro/cms-types"]);

/**
 * Collection-model types a backend helper used, and what each is in the table
 * model (from `@rebasepro/server/schema`, which a backend depends on). A
 * helper keeps its own name for the type — `type EntityCallbackContext =
 * TableHookProps["context"];` — so its body is untouched.
 */
export const LEGACY_TYPE_REPLACEMENTS: Readonly<Record<string, { type: string; expression: string }>> = {
    EntityCallbackContext: { type: "TableHookProps", expression: `TableHookProps["context"]` },
    RebaseCallContext: { type: "TableHookProps", expression: `TableHookProps["context"]` },
    CollectionCallbacks: { type: "TableHooks", expression: "TableHooks" },
    BeforeQueryProps: { type: "TableBeforeQueryProps", expression: "TableBeforeQueryProps" },
    AfterReadProps: { type: "TableAfterReadProps", expression: "TableAfterReadProps" },
    BeforeSaveProps: { type: "TableBeforeSaveProps", expression: "TableBeforeSaveProps" },
    AfterSaveProps: { type: "TableAfterSaveProps", expression: "TableAfterSaveProps" },
    AfterSaveErrorProps: { type: "TableAfterSaveErrorProps", expression: "TableAfterSaveErrorProps" },
    BeforeDeleteProps: { type: "TableDeleteProps", expression: "TableDeleteProps" },
    AfterDeleteProps: { type: "TableDeleteProps", expression: "TableDeleteProps" },
    PropertyCallbacks: { type: "ColumnTransform", expression: "ColumnTransform" }
};

/** What {@link replaceLegacyTypes} decided. */
export interface LegacyTypeReplacement {
    /** The uses still imported as they were. */
    kept: ImportUse[];
    /** `import type { … } from "@rebasepro/server/schema";`, when any type was replaced. */
    imports: string[];
    /** `type <local> = <replacement>;`, one per replaced binding. */
    aliases: string[];
    /** A binding used with type arguments, which an alias cannot stand for. */
    unreplaceable: string[];
}

/**
 * Replace collection-model types a backend module imports with their
 * table-model equivalents, as local aliases.
 *
 * @param text the code that uses them, to tell a generic use (`AfterSaveProps<M>`) apart
 */
export function replaceLegacyTypes(uses: readonly ImportUse[], text: string): LegacyTypeReplacement {
    const kept: ImportUse[] = [];
    const types = new Set<string>();
    const aliases: string[] = [];
    const unreplaceable: string[] = [];
    for (const use of uses) {
        const replacement = LEGACY_TYPE_PACKAGES.has(use.specifier) ? own(LEGACY_TYPE_REPLACEMENTS, use.imported) : undefined;
        if (!replacement) {
            kept.push(use);
            continue;
        }
        if (new RegExp(`\\b${use.local}\\s*<`).test(text)) {
            unreplaceable.push(use.local);
            kept.push(use);
            continue;
        }
        types.add(replacement.type);
        aliases.push(`type ${use.local} = ${replacement.expression};`);
    }
    const imports = types.size > 0 ? [`import type { ${[...types].sort().join(", ")} } from "@rebasepro/server/schema";`] : [];
    return { kept, imports, aliases, unreplaceable };
}

/** One import line's worth of bindings. */
interface ImportGroup {
    specifier: string;
    defaultLocal?: string;
    namespaceLocal?: string;
    named: { imported: string; local: string; typeOnly: boolean }[];
    defaultTypeOnly: boolean;
}

/**
 * The import block of a generated module: the uses, grouped by (moved)
 * specifier, in first-use order, each binding once.
 */
export function importLines(uses: readonly ImportUse[], relocate: (use: ImportUse) => string): string[] {
    const groups = new Map<string, ImportGroup>();
    const lines: string[] = [];
    for (const use of uses) {
        const specifier = relocate(use);
        if (use.imported === "*") {
            lines.push(`import ${use.typeOnly ? "type " : ""}* as ${use.local} from ${JSON.stringify(specifier)};`);
            continue;
        }
        let group = groups.get(specifier);
        if (!group) {
            group = { specifier, named: [], defaultTypeOnly: true };
            groups.set(specifier, group);
        }
        if (use.imported === "default") {
            group.defaultLocal = use.local;
            group.defaultTypeOnly = use.typeOnly;
        } else if (!group.named.some(entry => entry.local === use.local)) {
            group.named.push({ imported: use.imported, local: use.local, typeOnly: use.typeOnly });
        }
    }
    for (const group of groups.values()) {
        const allTypes = (group.defaultLocal === undefined || group.defaultTypeOnly) && group.named.every(entry => entry.typeOnly);
        const named = group.named.map(entry => {
            const binding = entry.imported === entry.local ? entry.local : `${entry.imported} as ${entry.local}`;
            return !allTypes && entry.typeOnly ? `type ${binding}` : binding;
        });
        const parts: string[] = [];
        if (group.defaultLocal !== undefined) parts.push(group.defaultLocal);
        if (named.length > 0) parts.push(`{ ${named.join(", ")} }`);
        if (parts.length === 0) continue;
        lines.push(`import ${allTypes ? "type " : ""}${parts.join(", ")} from ${JSON.stringify(group.specifier)};`);
    }
    return lines;
}
