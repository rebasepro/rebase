/**
 * Moving code between files: rewriting a module specifier for its new home,
 * copying the helper modules carried code imports, and assembling a module's
 * import block.
 *
 * A relative import from `config/collections/orders.ts` keeps pointing at the
 * same file from `backend/schema/orders.ts` — unless that file lives in
 * `config/`, which is going away: such a helper is copied next to the code
 * that needs it (`backend/lib/…` for server code, `frontend/src/cms/lib/…` for
 * the panel's), its own imports moved the same way. A helper that imports a
 * collection file cannot move (the collection is a table now) and is refused.
 */
import fs from "node:fs";
import path from "node:path";

import type { AstContext, ImportUse } from "./ast";
import { toPosix } from "./ast";

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
type SpecifierStyle = "extensionless" | "directory" | { extension: string };

interface ResolvedSpecifier {
    target: string;
    style: SpecifierStyle;
}

function resolveRelative(fromFile: string, specifier: string): ResolvedSpecifier {
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

function writeSpecifier(fromFile: string, target: string, style: SpecifierStyle): string {
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
    /** Collection files that move rather than become tables (Firestore ones): legacy path → new path. */
    readonly moved = new Map<string, string>();

    constructor(
        private readonly ctx: AstContext,
        private readonly projectRoot: string,
        private readonly configDir: string,
        private readonly collectionFiles: ReadonlySet<string>,
        private readonly libDirs: Readonly<Record<Side, string>>
    ) {}

    /** Whether `file` is inside the config directory (and so goes away). */
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
        const text = fs.readFileSync(copy.from, "utf8");
        this.contents.set(key, text);
        const moved = this.moveSpecifiersInText(text, copy.from, copy.to, copy.side);
        this.contents.set(key, moved);
        return moved;
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
            let out = text;
            for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
            return out;
        } finally {
            this.ctx.project.removeSourceFile(sf);
        }
    }
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
