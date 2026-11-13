/**
 * The project's own imports of what the migration removes from `config/`.
 *
 * 0.31 stops reading `config/collections`; the project's other modules of
 * `config/` stay where they are, so an import of one of those is left alone.
 * What changes is an import of something Rebase read:
 *
 * - a collection file, in backend code: repointed to the table module
 *   (`import posts from "…/config/collections/posts"` →
 *   `import { posts } from "…/backend/schema/posts"`); the uses that read the
 *   object are listed afterwards (see {@link tableUseSteps}), since a table
 *   definition is not a collection;
 * - a collection file, in frontend code: a type-only use becomes a type import
 *   of the table; a value use (reading `posts.properties.status.enum`) is a
 *   manual step naming the customization module;
 * - a helper beside the collections: copied out with the code that needs it
 *   (as the relocator does for carried code) and repointed;
 * - `config/resources.ts`, `config/storage.ts`, `config/generated/register.ts`:
 *   repointed to their new home in `backend/`;
 * - the collections index, or a config index that is removed: a manual step.
 */
import fs from "node:fs";
import path from "node:path";

import type { Node, SourceFile } from "ts-morph";

import { toPosix } from "./ast";
import { resolveRelative, writeSpecifier, type Side } from "./modules";
import type { PlanContext } from "./plan-context";
import { planFile, relativeToRoot } from "./plan-context";
import type { ConfigImporter } from "./project-files";

/** A table a collection file became. */
export interface TableHome {
    /** The exported identifier (`posts`). */
    identifier: string;
    /** The table module, absolute. */
    file: string;
    /** The customization module and its export, when one was written. */
    cms?: { identifier: string; file: string };
}

/** What {@link repointConfigImports} needs to know about the run. */
export interface RepointContext {
    configDir: string;
    collectionsDir: string;
    /** Collection files (absolute) → the table each became. */
    tables: ReadonlyMap<string, TableHome>;
    /** Rebase's own modules the run moved (absolute legacy path → new path). */
    movedWiring: ReadonlyMap<string, string>;
    /** Whether `config/index.ts` is removed (it re-exported nothing but what moved). */
    indexRemoved: boolean;
}

/** An import repointed to a table module, whose uses are checked once the run's rewrites are done. */
export interface TableBinding {
    /** The importing file, absolute. */
    file: string;
    /** The local name. */
    local: string;
    /** The table it now names. */
    table: TableHome;
}

function isUnder(dir: string, file: string): boolean {
    const relative = path.relative(dir, file);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isIndex(file: string, dir: string): boolean {
    return path.dirname(file) === dir && /^index\.(tsx?|mts|jsx?|mjs)$/.test(path.basename(file));
}

/** Whether every reference to `local` in the file (but its import) is in a type position. */
function usedAsTypeOnly(plan: PlanContext, sf: SourceFile, local: string): boolean {
    const { Node: N, SyntaxKind } = plan.ast.tsm;
    const uses = sf.getDescendantsOfKind(SyntaxKind.Identifier).filter(identifier =>
        identifier.getText() === local && !identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration));
    return uses.every(identifier => identifier.getAncestors().some((ancestor: Node) => N.isTypeNode(ancestor)));
}

/**
 * Rewrite the project's imports of what the migration removes from `config/`,
 * planning each rewritten file; what cannot be rewritten is a manual step per
 * file. Returns the bindings now naming a table, for {@link tableUseSteps}.
 */
export function repointConfigImports(plan: PlanContext, ctx: RepointContext, importers: readonly ConfigImporter[]): TableBinding[] {
    const { Node: N, SyntaxKind } = plan.ast.tsm;
    const bindings: TableBinding[] = [];
    const files = [...new Set(importers.map(importer => importer.file))].sort();
    for (const file of files) {
        const side: Side = plan.frontendDir && isUnder(plan.frontendDir, file) ? "frontend" : "backend";
        const text = plan.files.get(file)?.content ?? fs.readFileSync(file, "utf8");
        const sf = plan.ast.project.createSourceFile(`/__rebase_migrate__/repoint-${files.indexOf(file)}-${path.basename(file)}`, text, { overwrite: true });
        const edits: { start: number; end: number; text: string }[] = [];
        const left: string[] = [];
        try {
            const literals = [
                ...sf.getImportDeclarations().map(declaration => declaration.getModuleSpecifier()),
                ...sf.getExportDeclarations().map(declaration => declaration.getModuleSpecifier()).filter(literal => literal !== undefined),
                ...sf.getDescendantsOfKind(SyntaxKind.CallExpression)
                    .filter(call => call.getExpression().getKind() === SyntaxKind.ImportKeyword || call.getExpression().getText() === "require")
                    .map(call => call.getArguments()[0])
                    .filter(argument => argument !== undefined && N.isStringLiteral(argument))
            ];
            for (const literal of literals) {
                if (!N.isStringLiteral(literal)) continue;
                const specifier = literal.getLiteralValue();
                if (!specifier.startsWith(".")) continue;
                const { target, style } = resolveRelative(file, specifier);
                if (!isUnder(ctx.configDir, target) && target !== ctx.configDir) continue;
                const line = literal.getStartLineNumber();
                const replaceSpecifier = (next: string): void => {
                    edits.push({ start: literal.getStart() + 1, end: literal.getEnd() - 1, text: next });
                };
                const movedTo = ctx.movedWiring.get(target);
                if (movedTo) {
                    replaceSpecifier(writeSpecifier(file, movedTo, style));
                    continue;
                }
                if (isIndex(target, ctx.configDir) || target === ctx.configDir) {
                    if (ctx.indexRemoved) left.push(`line ${line}: "${specifier}" — config/index.ts re-exported only what Rebase read (\`collections\`, \`storageAuthorize\`) and is removed: import the table from backend/schema, storageAuthorize from backend/storage`);
                    continue;
                }
                if (!isUnder(ctx.collectionsDir, target)) continue; // the project's own module: it stays
                if (isIndex(target, ctx.collectionsDir)) {
                    left.push(side === "backend"
                        ? `line ${line}: "${specifier}" — the collections index: the backend boots from backend/schema (\`schemaDir\`, or \`tables\` from its index)`
                        : `line ${line}: "${specifier}" — the collections index: the panel projects the tables from the backend; customizations are in frontend/src/cms`);
                    continue;
                }
                const table = ctx.tables.get(target);
                if (!table) {
                    // A helper beside the collections: copied out, like carried code's.
                    try {
                        replaceSpecifier(plan.relocator.relocate(specifier, file, file, side));
                    } catch (error) {
                        left.push(`line ${line}: "${specifier}" — ${error instanceof Error ? error.message : String(error)}`);
                    }
                    continue;
                }
                const declaration = literal.getParent();
                const defaultImport = declaration && N.isImportDeclaration(declaration) ? declaration.getDefaultImport() : undefined;
                const onlyDefault = declaration && N.isImportDeclaration(declaration) && defaultImport && declaration.getNamedImports().length === 0 && !declaration.getNamespaceImport();
                if (!declaration || !N.isImportDeclaration(declaration) || !defaultImport || !onlyDefault) {
                    left.push(`line ${line}: "${specifier}" — the collection is the table \`${table.identifier}\` now: import it from ${relativeToRoot(plan, table.file)}${side === "frontend" ? " as a type (`import type`)" : ""}`);
                    continue;
                }
                const local = defaultImport.getText();
                const binding = table.identifier === local ? local : `${table.identifier} as ${local}`;
                const tableSpecifier = writeSpecifier(file, table.file, style);
                if (side === "frontend") {
                    if (declaration.isTypeOnly() || usedAsTypeOnly(plan, sf, local)) {
                        edits.push({ start: declaration.getStart(), end: declaration.getEnd(), text: `import type { ${binding} } from ${JSON.stringify(tableSpecifier)};` });
                    } else {
                        const cms = table.cms ? `the customization \`${table.cms.identifier}\` (${relativeToRoot(plan, table.cms.file)}) for what the panel shows, ` : "";
                        left.push(`line ${line}: "${specifier}" — \`${local}\` is read as a value in the frontend; a collection object is gone and the frontend may import backend/ as types only: use ${cms}or the table descriptor the server serves (\`GET /api/schema/tables\`) for its columns and enum values`);
                    }
                    continue;
                }
                edits.push({ start: declaration.getStart(), end: declaration.getEnd(), text: `import ${declaration.isTypeOnly() ? "type " : ""}{ ${binding} } from ${JSON.stringify(tableSpecifier)};` });
                bindings.push({ file, local, table });
            }
        } finally {
            plan.ast.project.removeSourceFile(sf);
        }
        if (edits.length > 0) {
            let next = text;
            for (const edit of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
            const planned = plan.files.get(file);
            planFile(plan, file, next, planned ? `${planned.role}, imports of config/` : `imports of config/ (${relativeToRoot(plan, file)})`);
        }
        if (left.length > 0) {
            plan.manualSteps.push({
                title: `Repoint the imports of ${relativeToRoot(plan, file)}`,
                detail: `What it imports from ${relativeToRoot(plan, ctx.collectionsDir)} is gone, and the codemod could not rewrite these: ${left.join("; ")}.`,
                file: relativeToRoot(plan, file)
            });
        }
    }
    return bindings;
}

/**
 * The uses of a binding repointed to a table that read it as an object, one
 * step per file, given the files as the run writes them (after the SDK
 * rewrite, which may have removed a use, as `auth.collection`). A table
 * definition is not a collection: `columns`, `hooks`, `rls` where a collection
 * had `properties`, `callbacks`, `securityRules`.
 *
 * @param read a file's content as the run writes it
 */
export function tableUseSteps(plan: PlanContext, bindings: readonly TableBinding[], read: (file: string) => string): void {
    const { SyntaxKind } = plan.ast.tsm;
    const byFile = new Map<string, TableBinding[]>();
    for (const binding of bindings) byFile.set(binding.file, [...(byFile.get(binding.file) ?? []), binding]);
    for (const [file, list] of byFile) {
        const text = read(file);
        const sf = plan.ast.project.createSourceFile(`/__rebase_migrate__/table-uses-${path.basename(file)}`, text, { overwrite: true });
        const lines: string[] = [];
        try {
            for (const binding of list) {
                const uses = sf.getDescendantsOfKind(SyntaxKind.Identifier)
                    .filter(identifier => identifier.getText() === binding.local && !identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration))
                    .map(identifier => identifier.getStartLineNumber());
                if (uses.length === 0) continue;
                lines.push(`\`${binding.local}\` (now the table \`${binding.table.identifier}\`) on line ${[...new Set(uses)].join(", ")}`);
            }
        } finally {
            plan.ast.project.removeSourceFile(sf);
        }
        if (lines.length === 0) continue;
        plan.manualSteps.push({
            title: `Check the uses of the tables ${relativeToRoot(plan, file)} imports`,
            detail: `Its imports of collection files now import the table definitions from backend/schema: ${lines.join("; ")}. A table definition is not a collection — \`columns\`, \`hooks\`, \`rls\` where a collection had \`properties\`, \`callbacks\`, \`securityRules\` — so check each use.`,
            file: toPosix(path.relative(plan.root, file))
        });
    }
}
