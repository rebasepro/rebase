/**
 * The collections-to-tables codemod: one run, from a project on the
 * `config/collections` layout to `backend/schema` + `frontend/src/cms`.
 *
 * 1. Evaluate the legacy collections as the server's loader does.
 * 2. Lift them (`collectionsToTableDefs`) and print the tables with the shared
 *    printer, splicing in the source of hooks and transforms.
 * 3. Route everything that is presentation to `customizeTable` files, and
 *    Firestore collections to `defineFirestoreCollection`.
 * 4. Move the rest of `config/` and rewire the workspace.
 * 5. Refuse, never guess: any construct that cannot be carried exactly blocks
 *    the write, with the file, the line and what to change.
 * 6. Write under a journal, read the result back through the new pipeline
 *    and require byte-identical SQL; roll back on any difference.
 *
 * `config/` itself is never deleted: the run prints the `git rm -r` line.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { collectionsToTableDefs, isSchemaDefinitionError, type LiftResult } from "@rebasepro/common";
import { isPostgresCollectionConfig, type CollectionConfig } from "@rebasepro/types";

import { addSourceFile, createAstContext, findCollectionSite, postDeclarationAssignments, toPosix, type TsMorph } from "./ast";
import { nameTables, planBackend } from "./backend";
import { planCustomizations, printCmsIndex } from "./customization";
import { planFirestoreCollection } from "./firestore";
import { findSplitConstants, planSplitConstants } from "./split-constants";
import { Journal } from "./journal";
import { createSchemaModuleImporter } from "../../utils/import-schema-module";
import { LegacyLoadError, loadLegacyProject } from "./load-legacy";
import { Relocator } from "./modules";
import type { CollectionEntry, PlanContext } from "./plan-context";
import { note, planFile, relativeToRoot } from "./plan-context";
import {
    planBackendTsconfig,
    planFrontendWiring,
    planManifest,
    planMove,
    planWorkspace,
    findConfigImporters,
    findLegacyApiUses,
    readRawManifest,
    unmovedConfigFiles
} from "./project-files";
import type { CollectionOutcome, MigrateOptions, MigrationReport, PlannedFile } from "./types";
import { verifyMigration } from "./verify";

/** The directory every table module is written to. */
const SCHEMA_DIR = path.join("backend", "schema");

/** Output paths that must not already hold something else (a re-run must find exactly what it would write). */
function isOwnedOutput(plan: PlanContext, file: string, cmsDir: string | undefined): boolean {
    const relative = relativeToRoot(plan, file);
    return relative.startsWith("backend/schema/") || relative.startsWith("backend/lib/") ||
        relative === "backend/resources.ts" || relative === "backend/storage.ts" || relative.startsWith("backend/generated/") ||
        (cmsDir !== undefined && !path.relative(cmsDir, file).startsWith(".."));
}

/** Whether the project's git tree is clean, or why it is not usable as a safety net. */
function gitState(root: string): { clean: true } | { clean: false; reason: string } {
    const result = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=normal", "--", "."], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
        return { clean: false, reason: `${root} is not inside a git repository, so a run could not be undone with git. Commit the project first, or pass --force.` };
    }
    const dirty = result.stdout.split("\n").filter(line => line.trim().length > 0);
    if (dirty.length > 0) {
        return { clean: false, reason: `the git tree has ${dirty.length} uncommitted change(s) (${dirty.slice(0, 3).map(line => line.slice(3)).join(", ")}${dirty.length > 3 ? ", …" : ""}). Commit or stash them, so the migration is one reviewable diff — or pass --force.` };
    }
    return { clean: true };
}

function emptyReport(root: string): MigrationReport {
    return { projectRoot: root, status: "blocked", collections: [], files: [], refusals: [], notes: [], manualSteps: [] };
}

/** Run the codemod on one project. */
export async function migrateCollectionsToTables(options: MigrateOptions): Promise<MigrationReport> {
    const root = path.resolve(options.projectRoot);
    const report = emptyReport(root);
    const manifest = readRawManifest(root);
    const configDir = path.resolve(root, manifest.configDir);
    const writes = !options.dryRun && !options.check;

    if (writes && !options.force) {
        const state = gitState(root);
        if (!state.clean) {
            report.refusals.push({ file: ".", reason: state.reason });
            return report;
        }
    }

    const importModule = await createSchemaModuleImporter(root, options.moduleAliases);
    let legacy;
    try {
        legacy = await loadLegacyProject(configDir, importModule);
    } catch (error) {
        report.refusals.push({
            file: error instanceof LegacyLoadError && error.file ? toPosix(path.relative(root, error.file)) : toPosix(path.relative(root, configDir)),
            reason: error instanceof Error ? error.message : String(error)
        });
        return report;
    }

    const tsm: TsMorph = await import("ts-morph");
    const ast = createAstContext(tsm);
    const frontendDir = manifest.frontendRoot ? path.resolve(root, manifest.frontendRoot) : undefined;
    const cmsDir = frontendDir ? path.join(frontendDir, "src", "cms") : undefined;
    const relocator = new Relocator(ast, root, configDir, new Set(legacy.collections.map(entry => entry.file)), {
        backend: path.join(root, "backend", "lib"),
        frontend: cmsDir ? path.join(cmsDir, "lib") : path.join(root, "frontend", "src", "cms", "lib")
    });
    const plan: PlanContext = {
        root,
        ast,
        relocator,
        ...(frontendDir ? { frontendDir } : {}),
        files: new Map(),
        refusals: report.refusals,
        notes: report.notes,
        manualSteps: report.manualSteps
    };

    // The AST of every collection file.
    const entries: CollectionEntry[] = legacy.collections.map(({ collection, file }) => {
        const sourceFile = addSourceFile(ast, file, fs.readFileSync(file, "utf8"));
        const site = findCollectionSite(ast, sourceFile);
        return { collection, file, sourceFile, ...(site.node ? { site: site.node } : { siteProblem: site.reason }) };
    });
    for (const entry of entries) {
        if (!entry.site?.binding) continue;
        for (const [assigned, { statement }] of postDeclarationAssignments(ast, entry.sourceFile, entry.site.binding)) {
            note(plan, entry, `\`${entry.site.binding}.${assigned}\` is assigned after the declaration; the evaluated value is what was carried.`, statement.getStartLineNumber());
        }
    }

    const postgres = entries.filter(entry => isPostgresCollectionConfig(entry.collection));
    const firestore = entries.filter(entry => entry.collection.engine === "firestore");
    for (const entry of entries) {
        if (!postgres.includes(entry) && !firestore.includes(entry)) {
            plan.refusals.push({ file: relativeToRoot(plan, entry.file), collection: entry.collection.slug, reason: `is a ${String(entry.collection.engine)} collection. Only Postgres collections become tables and Firestore ones \`defineFirestoreCollection\`; this engine has no home in the new layout.` });
        }
    }
    if (cmsDir) for (const entry of firestore) relocator.moved.set(entry.file, path.join(cmsDir, path.basename(entry.file)));

    // Enum constants of config/ the collections use: values for the schema, labels for the CMS.
    const split = await findSplitConstants(plan, postgres, importModule, cmsDir);
    plan.splitConstants = split.constants;

    // The tables.
    let lift: LiftResult | undefined;
    try {
        lift = collectionsToTableDefs(postgres.map(entry => entry.collection), legacy.defaultSecurityRules ? { defaultSecurityRules: legacy.defaultSecurityRules } : {});
    } catch (error) {
        if (!isSchemaDefinitionError(error)) throw error;
        for (const problem of error.problems) {
            const entry = postgres.find(candidate => candidate.collection.slug === problem.table);
            plan.refusals.push({
                file: entry ? relativeToRoot(plan, entry.file) : relativeToRoot(plan, legacy.collectionsDir),
                collection: problem.table,
                ...(problem.key !== undefined ? { key: problem.key } : {}),
                reason: problem.message
            });
        }
    }

    const schemaDir = path.join(root, SCHEMA_DIR);
    const outcomes = new Map<string, CollectionOutcome>();
    for (const entry of entries) {
        outcomes.set(entry.collection.slug, { slug: entry.collection.slug, file: relativeToRoot(plan, entry.file), kind: "refused" });
    }
    let customizationModules: { identifier: string; file: string; slug: string }[] = [];
    if (lift) {
        const names = nameTables(postgres, lift.tables, schemaDir);
        const order = (legacy.navigationOrder ?? []).map(collection => collection.slug).filter(slug => names.has(slug));
        planBackend(plan, { entries: postgres, lift, schemaDir, order }, names);
        planSplitConstants(plan, split.constants, new Map(postgres.map(entry => [entry.file, names.get(entry.collection.slug)?.file ?? ""])));
        for (const [slug, name] of names) {
            const outcome = outcomes.get(slug);
            if (outcome) {
                outcome.kind = name.kind;
                outcome.backendFile = relativeToRoot(plan, name.file);
            }
        }
        if (cmsDir) {
            const navigation = legacy.navigationOrder ?? [];
            const ordered = [...postgres].sort((a, b) => rank(navigation, a.collection) - rank(navigation, b.collection));
            customizationModules = planCustomizations(plan, ordered, names, lift.notCarried, cmsDir).modules;
            for (const module of customizationModules) {
                const outcome = outcomes.get(module.slug);
                if (outcome) outcome.frontendFile = relativeToRoot(plan, module.file);
            }
        } else if (lift.notCarried.some(item => item.kind === "ui" || item.kind === "browser")) {
            plan.manualSteps.push({
                title: "Presentation not carried",
                detail: "The project has no frontend app (rebase.json declares no static app with `cms`, and there is no frontend/src), so the collections' admin presentation — labels, icons, `admin` blocks — had nowhere to go and was not written. Add a frontend and run the codemod again from the git history if you want it."
            });
        }
    }

    // Firestore collections.
    const external: { identifier: string; file: string }[] = [];
    for (const entry of firestore) {
        if (!cmsDir) {
            plan.refusals.push({ file: relativeToRoot(plan, entry.file), collection: entry.collection.slug, reason: "is a Firestore collection, which lives in the CMS (`defineFirestoreCollection` in frontend/src/cms), and the project has no frontend app." });
            continue;
        }
        const moved = planFirestoreCollection(plan, entry, cmsDir);
        if (!moved) continue;
        external.push(moved);
        const outcome = outcomes.get(entry.collection.slug);
        if (outcome) {
            outcome.kind = "firestore";
            outcome.frontendFile = relativeToRoot(plan, moved.file);
        }
    }
    if (firestore.length > 0) {
        note(plan, undefined, "Firestore collections are moved and rewritten in place; they have no SQL, so the SQL check does not cover them.");
    }

    // The CMS index and the frontend's wiring.
    if (cmsDir && frontendDir) {
        if (customizationModules.length > 0 || external.length > 0) {
            planFile(plan, path.join(cmsDir, "index.ts"), printCmsIndex(cmsDir, customizationModules, external), "the CMS index");
        }
        planFrontendWiring(plan, frontendDir, external.length > 0);
    }

    // The rest of config/.
    const handled = new Set<string>(legacy.collections.map(entry => entry.file));
    for (const name of ["index.ts", "index.js"]) handled.add(path.join(legacy.collectionsDir, name));
    handled.add(path.join(configDir, "index.ts"));
    const backendWanted = ["schema/**/*"];
    for (const [file, target] of [["resources.ts", "resources.ts"], ["storage.ts", "storage.ts"]] as const) {
        const from = path.join(configDir, file);
        try {
            if (planMove(plan, from, path.join(root, "backend", target), `backend/${target}`)) {
                handled.add(from);
                backendWanted.push(target);
            }
        } catch (error) {
            plan.refusals.push({ file: relativeToRoot(plan, from), reason: error instanceof Error ? error.message : String(error) });
        }
    }
    const register = path.join(configDir, "generated", "register.ts");
    try {
        if (planMove(plan, register, path.join(root, "backend", "generated", "register.ts"), "backend/generated/register.ts")) {
            handled.add(register);
            backendWanted.push("generated/**/*");
        }
    } catch (error) {
        plan.refusals.push({ file: relativeToRoot(plan, register), reason: error instanceof Error ? error.message : String(error) });
    }
    if (legacy.configIndexExports.includes("callbacks")) {
        plan.manualSteps.push({
            title: "Move the global collection callbacks",
            detail: "config/index.ts exports `callbacks`, which the runtime applied to every collection. Its home is `backend/hooks.ts`, exporting `hooks` (table hooks: `table` replaces `collection`, and `afterRead` / `beforeDelete` / `afterDelete` receive `values` instead of `row`). Move it by hand: the codemod does not rewrite a module it did not read as a collection.",
            file: relativeToRoot(plan, path.join(configDir, "index.ts"))
        });
    }

    for (const constant of split.constants) handled.add(constant.module);
    for (const { module, reason } of split.unsplit) {
        handled.add(module);
        plan.manualSteps.push({
            title: `Split ${relativeToRoot(plan, module)} by hand`,
            detail: `The collections use enum values from ${relativeToRoot(plan, module)}; the tables inline the values and the customizations the labels, and the module was not moved because it ${reason}. If it is still the one source of those values, split it: the values into backend/lib (\`export const X = [...] as const\`), the labels into frontend/src/cms/lib (\`Record<(typeof X)[number], string>\`, importing the values' type), and name them in the tables and customizations.`,
            file: relativeToRoot(plan, module)
        });
    }

    // Helper modules the moved code imports.
    for (const copy of relocator.helpers.values()) {
        handled.add(copy.from);
        planFile(plan, copy.to, relocator.helperContent(copy), `helper ${relativeToRoot(plan, copy.from)} (${copy.side})`);
        if (copy.side === "backend") backendWanted.push("lib/**/*");
        const content = relocator.helperContent(copy);
        if (copy.side === "backend" && /from\s+["'](react|@rebasepro\/(cms|cms-types|app|ui|studio))["']/.test(content)) {
            plan.manualSteps.push({
                title: `Split ${relativeToRoot(plan, copy.from)}`,
                detail: `The backend uses ${relativeToRoot(plan, copy.from)}, which imports an admin-panel package. It was copied to ${relativeToRoot(plan, copy.to)} as written; the backend may not import React or the CMS (\`pnpm check:headless\`): keep only what the backend uses there.`,
                file: relativeToRoot(plan, copy.to)
            });
        }
    }

    for (const { file, name } of relocator.legacyTypesLeft) {
        plan.manualSteps.push({
            title: `Replace the collection-model type ${name} in ${file}`,
            detail: `A helper copied to backend/lib uses \`${name}\` with type arguments; a table-model alias cannot stand for it. Use the table-model type from \`@rebasepro/server/schema\` (\`TableHooks\`, \`TableBeforeSaveProps\`, \`TableHookProps["context"]\`, …).`
        });
    }

    planManifest(plan, manifest);
    planWorkspace(plan, configDir, manifest.frontendRoot);
    planBackendTsconfig(plan, [...new Set(backendWanted)]);

    // Modules outside config/ that import from it: they point at nothing after the move.
    const newHomes = new Map<string, string>();
    for (const outcome of outcomes.values()) {
        const home = outcome.backendFile ?? outcome.frontendFile;
        if (home) newHomes.set(stripExtension(path.join(root, outcome.file)), home);
    }
    newHomes.set(stripExtension(path.join(legacy.collectionsDir, "index.ts")), toPosix(SCHEMA_DIR));
    newHomes.set(stripExtension(legacy.collectionsDir), toPosix(SCHEMA_DIR));
    newHomes.set(stripExtension(path.join(configDir, "resources.ts")), "backend/resources.ts");
    newHomes.set(stripExtension(path.join(configDir, "storage.ts")), "backend/storage.ts");
    for (const copy of relocator.helpers.values()) newHomes.set(stripExtension(copy.from), relativeToRoot(plan, copy.to));
    const importers = findConfigImporters(root, configDir, new Set(plan.files.keys()));
    const byFile = new Map<string, string[]>();
    for (const importer of importers) {
        const home = newHomes.get(stripExtension(importer.target));
        const lines = byFile.get(importer.file) ?? [];
        lines.push(`line ${importer.line}: "${importer.specifier}"${home ? ` → ${home}` : " → (not moved: see below)"}`);
        byFile.set(importer.file, lines);
    }
    for (const [file, lines] of byFile) {
        plan.manualSteps.push({
            title: `Repoint the imports of ${relativeToRoot(plan, file)}`,
            detail: `It imports from ${relativeToRoot(plan, configDir)}/, which the migration replaces: ${lines.join("; ")}. A collection is a table now (\`defineTable\` / \`defineAuthTable\`), and a backend entry passes \`tables\` / \`schemaDir\` instead of \`collections\` / \`collectionsDir\`.`,
            file: relativeToRoot(plan, file)
        });
    }

    // Server APIs of the collection model in the project's own code.
    const apiUses = new Map<string, { api: string; replacement: string; lines: number[] }>();
    for (const use of findLegacyApiUses(root, configDir, new Set(plan.files.keys()))) {
        const key = `${use.file}\0${use.api}`;
        const entry = apiUses.get(key) ?? { api: use.api, replacement: use.replacement, lines: [] };
        entry.lines.push(use.line);
        apiUses.set(key, entry);
    }
    for (const [key, { api, replacement, lines }] of apiUses) {
        const file = key.slice(0, key.indexOf("\0"));
        plan.manualSteps.push({
            title: `Replace ${api} in ${relativeToRoot(plan, file)}`,
            detail: `\`${api}\` (line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}) belongs to the collection model. Use ${replacement}.`,
            file: relativeToRoot(plan, file)
        });
    }

    const unmoved = unmovedConfigFiles(plan, configDir, handled);
    if (unmoved.length > 0) {
        plan.manualSteps.push({
            title: "Files of config/ nothing moved",
            detail: `Nothing the codemod carried imports these, so they were not moved: ${unmoved.join(", ")}. Move what is still used before deleting config/.`
        });
    }

    // What would be written.
    const files: PlannedFile[] = [];
    for (const [file, { content, role }] of [...plan.files].sort(([a], [b]) => a.localeCompare(b))) {
        const exists = fs.existsSync(file);
        const current = exists ? fs.readFileSync(file, "utf8") : undefined;
        const action: PlannedFile["action"] = !exists ? "create" : current === content ? "unchanged" : "update";
        if (action === "update" && isOwnedOutput(plan, file, cmsDir) && !options.force) {
            plan.refusals.push({ file: relativeToRoot(plan, file), reason: "already exists with other content. The codemod does not overwrite edits: move it aside (or pass --force) and run again." });
        }
        files.push({ path: relativeToRoot(plan, file), content, action, role });
    }
    report.files = files;
    // A collection any refusal names is refused, whatever was planned for it.
    for (const outcome of outcomes.values()) {
        if (report.refusals.some(refusal => refusal.collection === outcome.slug)) {
            outcome.kind = "refused";
            delete outcome.backendFile;
            delete outcome.frontendFile;
        }
    }
    report.collections = [...outcomes.values()];

    const legacyPostgres = postgres.map(entry => entry.collection);
    if (report.refusals.length > 0) {
        report.status = "blocked";
        return report;
    }

    if (options.check) {
        if (!fs.existsSync(schemaDir)) {
            report.refusals.push({ file: toPosix(SCHEMA_DIR), reason: "does not exist: there is no migrated schema to check. Run without --check to migrate." });
            report.status = "blocked";
            return report;
        }
        report.verification = await verifyMigration(legacyPostgres, schemaDir, importModule);
        report.status = report.verification.identical ? "checked" : "failed";
        if (report.verification.identical) report.removeCommand = removeCommand(plan, configDir);
        return report;
    }
    if (options.dryRun) {
        report.status = "planned";
        return report;
    }

    const pending = files.filter(file => file.action !== "unchanged");
    const journal = new Journal();
    for (const file of pending) journal.write(path.join(root, file.path), file.content);
    // A fresh importer: the one that read config/ cached modules by path.
    const verification = await verifyMigration(legacyPostgres, schemaDir, await createSchemaModuleImporter(root, options.moduleAliases));
    report.verification = verification;
    if (!verification.identical) {
        journal.rollback();
        report.status = "failed";
        return report;
    }
    report.status = pending.length === 0 ? "already-migrated" : "migrated";
    report.removeCommand = removeCommand(plan, configDir);
    return report;
}

function rank(order: readonly CollectionConfig[], collection: CollectionConfig): number {
    const index = order.findIndex(candidate => candidate.slug === collection.slug);
    return index < 0 ? order.length : index;
}

function stripExtension(file: string): string {
    return file.replace(/\.(tsx?|mts|jsx?|mjs)$/, "").replace(/[\\/]index$/, "");
}

function removeCommand(plan: PlanContext, configDir: string): string {
    return `git rm -r ${relativeToRoot(plan, configDir)}`;
}
