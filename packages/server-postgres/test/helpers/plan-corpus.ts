/**
 * The plan-golden corpus: every collection set the schema pipeline is held to,
 * and one function that renders everything the pipeline emits for a set.
 *
 * `test/plan-golden.test.ts` compares {@link renderAllOutputs} of each
 * {@link PlanCorpusSet} byte for byte against the files under
 * `test/fixtures/plan-golden/<set id>/`. A later slice that replaces the
 * collection model feeding the planner feeds the very same sets through the
 * new model and asserts the same goldens — which is why the sets are data and
 * the renderer is exported rather than living inside the test.
 *
 * Nothing here re-implements a loader. Directories are read by
 * `loadCollectionsFromDirectory` (the one the CLI, the runtime and the doctor
 * share, which applies a directory's `defaultSecurityRules`), the generated
 * real-schema collections are written by `generateCollectionFile` and read back
 * by the same loader, and the docs sample is evaluated by the docs gate's own
 * evaluator in a child process.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resetDeclaredResources, type CollectionConfig } from "@rebasepro/types";
import { loadCollectionsFromDirectory } from "@rebasepro/server";

import { generateSchema } from "../../src/schema/generate-drizzle-schema-logic";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl,
    generatePostgresTriggersDdl,
    generatePostgresVectorDdl,
    generatePostgresViewsDdl,
    planCollectionPolicies,
    planJunctionTables,
    planRelationalColumns,
    searchExcludePatterns,
    triggerExcludePatterns,
    vectorExcludePatterns
} from "../../src/schema/generate-postgres-ddl-logic";
import { planCollectionSchemaEnsure, type ExistingSchema } from "../../src/schema/ensure-collection-tables";
import { planSchema } from "../../src/schema/plan/plan-schema";
import {
    buildEnumMap,
    compositeKeySkipReason,
    generateCollectionFile,
    generateIndexContent
} from "../../src/schema/introspect-db-logic";
import { isUsableFileName } from "../../src/schema/introspect-db-queries";
import { classifyTables } from "../../src/schema/introspect-db-structure";
import { parseCheckConstraints } from "../../src/schema/introspect-db-constraints";
import { everything, refused, companies, companyTranslations, linkIntoComposite } from "../fixtures/property-matrix-collections";
import { POLICY_SHAPE_COLLECTIONS } from "../fixtures/policy-shapes";
import { loadRealSchema, type RealSchemaName } from "./schema-metadata";
import { FIXTURE, FIXTURE_DATABASE_EXTENSIONS } from "../../../../tooling/scripts/derived-names-fixture";

/** The monorepo root. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** Where the goldens live: one directory per {@link PlanCorpusSet.id}. */
export const PLAN_GOLDEN_DIR = path.resolve(__dirname, "..", "fixtures", "plan-golden");

/**
 * The cloud control plane is a separate, private repository checked out at
 * `<repo>/saas`. Its goldens are kept there, beside its collections, so that
 * its schema is never written into this public repository.
 */
export const SAAS_ROOT = path.join(REPO_ROOT, "saas");
export const SAAS_PLAN_GOLDEN_DIR = path.join(SAAS_ROOT, "test", "plan-golden");

/** What a set is planned with — the inputs besides the collections. */
export interface PlanCorpusOptions {
    /**
     * `declaredDatabaseExtensions()` for the boot plan and `plan.json`.
     * `vector.sql` is rendered with and without the extension either way.
     */
    databaseExtensions?: readonly string[];
}

/** One collection set, and how it is planned. */
export interface PlanCorpusSet {
    /** Also the golden directory's name. */
    id: string;
    collections: CollectionConfig[];
    options: PlanCorpusOptions;
    /** The golden root this set is recorded under — {@link PLAN_GOLDEN_DIR} unless stated. */
    goldenRoot?: string;
}

/** A configuration the planner must refuse, and the message it must refuse it with. */
export interface PlanRefusal {
    id: string;
    collections: CollectionConfig[];
    messagePattern: RegExp;
}

/**
 * Fixture data typed loosely on purpose (it carries shapes the config types no
 * longer admit, because projects in the field still hold them), handed to the
 * planner as the collections it is.
 */
const asCollections = (data: unknown[]): CollectionConfig[] => data.map(entry => entry as CollectionConfig);

// ── The deterministic world ──────────────────────────────────────────────────

/**
 * Process state the planner reads besides its arguments.
 *
 * `declaredRlsPolicyShape` reads these three variables and the global database
 * registry, so the same collections plan differently on a host that exports
 * one. Every render runs with all three unset and the registry empty.
 */
export const PLANNER_ENV_VARIABLES = [
    "REBASE_RLS_POLICY_TARGET",
    "REBASE_RLS_ADMIN_POLICIES",
    "REBASE_RLS_DEFAULT_POLICIES"
] as const;

/** Run `render` with the planner's ambient inputs pinned, restoring the environment after. */
export function withPinnedPlannerWorld<T>(render: () => T): T {
    const saved = new Map<string, string | undefined>();
    for (const name of PLANNER_ENV_VARIABLES) {
        saved.set(name, process.env[name]);
        delete process.env[name];
    }
    resetDeclaredResources();
    try {
        return render();
    } finally {
        for (const [name, value] of saved) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}

// ── The goldens on disk ─────────────────────────────────────────────────────

/** Where the refusal corpus's messages are recorded. */
export const PLAN_REFUSALS_GOLDEN = path.join(PLAN_GOLDEN_DIR, "refusals.json");

/**
 * A rendered output's file name on disk: a `.ts` output is stored as `.ts.txt`,
 * so no linter, type checker or unused-file scan mistakes a golden for source.
 */
const goldenFileName = (output: string): string => (output.endsWith(".ts") ? `${output}.txt` : output);

/** The golden directory of one set. */
export const goldenDirOf = (set: PlanCorpusSet): string => path.join(set.goldenRoot ?? PLAN_GOLDEN_DIR, set.id);

/** One set's recorded outputs, keyed like {@link renderAllOutputs}. Empty when none are recorded. */
export function readGolden(set: PlanCorpusSet): Record<string, string> {
    const dir = goldenDirOf(set);
    if (!fs.existsSync(dir)) return {};
    const recorded: Record<string, string> = {};
    for (const file of fs.readdirSync(dir).sort()) {
        const output = file.endsWith(".ts.txt") ? file.slice(0, -".txt".length) : file;
        recorded[output] = fs.readFileSync(path.join(dir, file), "utf8");
    }
    return recorded;
}

/** Replace one set's recorded outputs. Only `UPDATE_PLAN_GOLDEN=1` may call this — see the test's header. */
export function writeGolden(set: PlanCorpusSet, outputs: Record<string, string>): void {
    const dir = goldenDirOf(set);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const [output, content] of Object.entries(outputs)) {
        fs.writeFileSync(path.join(dir, goldenFileName(output)), content);
    }
}

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * A plan or a planned object as stable JSON text.
 *
 * Functions are dropped (a relation's `target` thunk is not data), `Map`s become
 * entry arrays and `Set`s arrays, in insertion order — which is the planner's
 * own order, and is part of what is being frozen. A cycle is written as
 * `"[circular]"` rather than thrown on, so a back-reference shows up in the
 * golden instead of crashing the render.
 */
export function toGoldenJson(value: unknown, omitTopLevelKeys: readonly string[] = []): string {
    const ancestors: object[] = [];
    const normalize = (input: unknown, depth: number): unknown => {
        if (typeof input === "function" || typeof input === "symbol" || input === undefined) return undefined;
        if (typeof input === "bigint") return `${input}n`;
        if (input === null || typeof input !== "object") return input;
        if (input instanceof Date) return input.toISOString();
        if (input instanceof RegExp) return String(input);
        if (ancestors.includes(input)) return "[circular]";
        ancestors.push(input);
        try {
            if (input instanceof Map) {
                return [...input.entries()].map(([key, entry]) => [normalize(key, depth + 1), normalize(entry, depth + 1) ?? null]);
            }
            if (input instanceof Set) return [...input].map(entry => normalize(entry, depth + 1) ?? null);
            if (Array.isArray(input)) return input.map(entry => normalize(entry, depth + 1) ?? null);
            const out: Record<string, unknown> = {};
            for (const [key, entry] of Object.entries(input)) {
                if (depth === 0 && omitTopLevelKeys.includes(key)) continue;
                const normalized = normalize(entry, depth + 1);
                if (normalized !== undefined) out[key] = normalized;
            }
            return out;
        } finally {
            ancestors.pop();
        }
    };
    return `${JSON.stringify(normalize(value, 0), null, 2)}\n`;
}

/** Every `DdlRenderOptions` combination, named by what it includes. */
const DDL_COMBINATIONS = [false, true].flatMap(includePolicies =>
    [false, true].flatMap(includeSearch =>
        [false, true].map(includeVector => ({ includePolicies, includeSearch, includeVector }))
    )
);

const ddlFileName = (options: { includePolicies: boolean; includeSearch: boolean; includeVector: boolean }): string => {
    const parts = [
        ...(options.includePolicies ? ["policies"] : []),
        ...(options.includeSearch ? ["search"] : []),
        ...(options.includeVector ? ["vector"] : [])
    ];
    return `schema${parts.map(part => `+${part}`).join("")}.sql`;
};

/** A database with nothing in it: the managed first deploy, where boot emits its whole surface. */
const emptyDatabase = (): ExistingSchema => ({ tables: new Map(), enums: new Set(), constraints: new Set() });

/**
 * The collections in slug order — what `rebase db generate` plans
 * (`generate-files.ts` sorts the loaded collections exactly so).
 */
const inSlugOrder = (collections: readonly CollectionConfig[]): CollectionConfig[] =>
    [...collections].sort((a, b) => a.slug.localeCompare(b.slug));

/**
 * Everything the schema pipeline emits for one collection set, by file name.
 *
 * - `schema*.sql`: `generatePostgresDdl` under all eight `DdlRenderOptions`
 *   combinations (`schema.sql` is the one `db generate` writes: all three off).
 * - `policies.sql`, `search.sql`, `vector.sql`, `vector+extension.sql`,
 *   `triggers.sql`, `views.sql`: the files written beside it.
 * - `schema.generated.ts` / `schema.generated.no-policies.ts`: the Drizzle schema.
 * - `atlas-excludes.json`: the patterns that keep Atlas off the carved-out objects.
 * - `boot-ensure.json`: `planCollectionSchemaEnsure` against an empty database.
 * - `boot-policies.adminRole-*.adminRequestRole-*.json`: `planCollectionPolicies`
 *   for the four role-availability combinations.
 * - `relational-columns.json`, `junction-tables.json`: the legacy-column slices.
 * - `plan.json`: `planSchema` itself, functions stripped and the dead
 *   `collections` back-reference left out.
 *
 * Planned in slug order, with the planner's environment pinned. An output that
 * throws is recorded as `THROWS: <message>` in its own file, so a refusal is
 * frozen like any other output.
 */
export function renderAllOutputs(
    collections: readonly CollectionConfig[],
    options: PlanCorpusOptions = {}
): Record<string, string> {
    return withPinnedPlannerWorld(() => {
        const sorted = inSlugOrder(collections);
        const databaseExtensions = options.databaseExtensions ?? [];
        const files: Record<string, string> = {};
        const emit = (name: string, render: () => string): void => {
            try {
                files[name] = render();
            } catch (error) {
                files[name] = `THROWS: ${error instanceof Error ? error.message : String(error)}\n`;
            }
        };

        for (const combination of DDL_COMBINATIONS) {
            emit(ddlFileName(combination), () => generatePostgresDdl(sorted, combination));
        }
        emit("policies.sql", () => generatePostgresPoliciesDdl(sorted));
        emit("search.sql", () => generatePostgresSearchDdl(sorted));
        emit("vector.sql", () => generatePostgresVectorDdl(sorted));
        emit("vector+extension.sql", () => generatePostgresVectorDdl(sorted, { extensions: ["vector"] }));
        emit("triggers.sql", () => generatePostgresTriggersDdl(sorted));
        emit("views.sql", () => generatePostgresViewsDdl(sorted));
        emit("schema.generated.ts", () => generateSchema(sorted, { policies: true }));
        emit("schema.generated.no-policies.ts", () => generateSchema(sorted, { policies: false }));
        emit("atlas-excludes.json", () => toGoldenJson({
            search: searchExcludePatterns(sorted),
            vector: vectorExcludePatterns(sorted),
            triggers: triggerExcludePatterns(sorted)
        }));
        emit("boot-ensure.json", () => toGoldenJson(planCollectionSchemaEnsure(sorted, emptyDatabase(), { databaseExtensions })));
        for (const adminRoleAvailable of [false, true]) {
            for (const adminRequestRoleAvailable of [false, true]) {
                emit(
                    `boot-policies.adminRole-${adminRoleAvailable ? "on" : "off"}.adminRequestRole-${adminRequestRoleAvailable ? "on" : "off"}.json`,
                    () => toGoldenJson(planCollectionPolicies(sorted, { adminRoleAvailable, adminRequestRoleAvailable }))
                );
            }
        }
        emit("relational-columns.json", () => toGoldenJson(planRelationalColumns(sorted)));
        emit("junction-tables.json", () => toGoldenJson(planJunctionTables(sorted)));
        emit("plan.json", () => toGoldenJson(planSchema(sorted, { databaseExtensions }), ["collections"]));
        return files;
    });
}

// ── Sets that live in memory ─────────────────────────────────────────────────

/** The configurations every emitter refuses. */
export const PLAN_REFUSALS: PlanRefusal[] = [
    ...refused.map(({ collection, because }) => ({
        id: `property-matrix.${collection.slug}`,
        collections: [collection],
        messagePattern: because
    })),
    {
        // From `schema-refusals.test.ts`: the composite key itself is fine, the
        // single-column link into it is what has no column to point at.
        id: "property-matrix.link-into-composite-set",
        collections: [companies, companyTranslations, linkIntoComposite],
        messagePattern: /relation "link_into_composite\.translation" points at collection "company_translations", whose primary key spans 2 columns \("id", "locale"\)/
    }
];

// ── Sets read from disk ──────────────────────────────────────────────────────

/** A scratch directory, removed by {@link PlanCorpus.dispose}. */
const scratchDirectories: string[] = [];
const makeScratch = (label: string): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `plan-golden-${label}-`)));
    scratchDirectories.push(dir);
    return dir;
};

function copyDirectory(from: string, to: string): void {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) copyDirectory(source, target);
        else fs.copyFileSync(source, target);
    }
}

/** The presets `rebase init` offers (`TemplatePreset`). */
export const CLI_TEMPLATE_PRESETS = ["blog", "ecommerce", "blank"] as const;

/** Files the blog preset owns; other presets replace them. Mirrors `applyPreset`. */
const BLOG_PRESET_FILES = ["posts.ts", "authors.ts", "tags.ts", "index.ts"];

/**
 * The scaffold's `config/collections` for one preset, laid out the way
 * `applyPreset` leaves it (and `tooling/scripts/check-templates.mjs` checks it).
 */
async function loadCliTemplate(preset: (typeof CLI_TEMPLATE_PRESETS)[number]): Promise<CollectionConfig[]> {
    const templateConfig = path.join(REPO_ROOT, "packages", "cli", "templates", "template", "config");
    const config = path.join(makeScratch(`template-${preset}`), "config");
    copyDirectory(templateConfig, config);
    const collections = path.join(config, "collections");
    const presets = path.join(collections, "presets");
    if (preset !== "blog") {
        for (const file of BLOG_PRESET_FILES) fs.rmSync(path.join(collections, file), { force: true });
        const presetDir = path.join(presets, preset);
        for (const file of fs.readdirSync(presetDir).filter(name => name.endsWith(".ts"))) {
            fs.copyFileSync(path.join(presetDir, file), path.join(collections, file));
        }
    }
    fs.rmSync(presets, { recursive: true, force: true });
    return loadCollectionsFromDirectory(collections);
}

/** Every database captured under `test/fixtures/real-schemas`. */
export const REAL_SCHEMAS: RealSchemaName[] = ["chinook", "constraint-shapes", "musicbrainz", "northwind", "openstreetmap", "pagila"];

/**
 * What `rebase schema introspect` writes for a captured database, read back the
 * way every consumer reads a collections directory.
 *
 * The same steps as the command (`introspect-db.ts`): junction tables folded
 * into relations, composite-keyed tables that cannot round-trip skipped, names
 * unusable as file names skipped, one file per table and the `index.ts` — with
 * the `@rebasepro/cms-types` builder a scaffolded project resolves, and no data
 * inference (there is no database to sample).
 */
async function loadGeneratedRealSchema(name: RealSchemaName): Promise<CollectionConfig[]> {
    const { metadata, tables } = loadRealSchema(name);
    const enumMap = buildEnumMap(metadata.enumValues);
    const classifications = classifyTables(metadata, tables);
    const checkFacts = parseCheckConstraints(metadata.checks);
    const joinTables = new Set(
        Array.from(classifications.values()).filter(c => c.role === "junction").map(c => c.table)
    );
    const compositeKeyed = new Set(
        Array.from(tables.entries())
            .filter(([table, meta]) => !joinTables.has(table) && compositeKeySkipReason(meta, metadata.fks) !== undefined)
            .map(([table]) => table)
    );
    const outDir = path.join(makeScratch(`real-${name}`), "collections");
    fs.mkdirSync(outDir, { recursive: true });
    const generated: string[] = [];
    for (const [table, meta] of tables) {
        if (joinTables.has(table) || compositeKeyed.has(table) || !isUsableFileName(table)) continue;
        const source = generateCollectionFile(table, meta, metadata.fks, joinTables, tables, enumMap, undefined, {
            metadata,
            classifications,
            checkFacts,
            builder: "admin-types",
            notes: [],
            skippedTables: compositeKeyed
        });
        fs.writeFileSync(path.join(outDir, `${table}.ts`), source, "utf-8");
        generated.push(table);
    }
    fs.writeFileSync(path.join(outDir, "index.ts"), generateIndexContent(generated), "utf-8");
    return loadCollectionsFromDirectory(outDir);
}

/**
 * The collection the Schema-as-Code page generates its samples from, evaluated
 * by the docs gate's own evaluator (`docs-verify/collection-snippets.mjs`, as
 * `check-schema-sample.mjs` calls it).
 *
 * In a child process because the evaluator is an ES module jest cannot load.
 * The sample is plain data, and the child refuses to hand back anything JSON
 * would not carry faithfully — a function, a `Date`, `undefined` — so the
 * round trip cannot quietly change what is planned.
 */
function loadDocsSchemaSample(): CollectionConfig[] {
    const evaluator = path.join(REPO_ROOT, "tooling", "scripts", "docs-verify", "collection-snippets.mjs");
    const page = "website/src/content/docs/docs/architecture/schema-as-code.md";
    const script = `
        import fs from "node:fs";
        const { collectionSnippets } = await import(${JSON.stringify(`file://${evaluator}`)});
        const root = ${JSON.stringify(REPO_ROOT)};
        const page = ${JSON.stringify(page)};
        const text = fs.readFileSync(root + "/" + page, "utf8");
        const marker = /<!--\\s*schema-sample:\\s*collection\\s*-->\\s*\\n\`\`\`[a-zA-Z]*[^\\n]*\\n/.exec(text);
        if (!marker) throw new Error("no schema-sample: collection block in " + page);
        const start = marker.index + marker[0].length;
        const body = text.slice(start, text.indexOf("\\n\`\`\`", start - 1) + 1).trim();
        const { results } = await collectionSnippets(root, { globs: [page] });
        const sample = results.find(r => r.snippet.code.trim() === body);
        if (!sample || sample.error || sample.collections.length === 0) {
            throw new Error("the schema-sample collection did not evaluate: " + (sample?.error?.message ?? "no result"));
        }
        const faithful = function (key, value) {
            const raw = this[key];
            if (typeof raw === "function" || raw instanceof Date || raw === undefined && key !== "") {
                throw new Error("the docs sample carries a value JSON cannot hold, at " + JSON.stringify(key));
            }
            return value;
        };
        process.stdout.write(JSON.stringify(sample.collections, faithful));
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" }
    });
    if (result.status !== 0) {
        throw new Error(`Evaluating the docs schema sample failed:\n${result.stderr}`);
    }
    const parsed: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(parsed)) throw new Error("The docs schema sample evaluated to something other than a list.");
    return asCollections(parsed);
}

/** The loaded corpus, and the scratch directories its loaders wrote. */
export interface PlanCorpus {
    sets: PlanCorpusSet[];
    /** Sets that could not be loaded here, with why — reported, never silently dropped. */
    skipped: { id: string; reason: string }[];
    dispose(): void;
}

/**
 * Every corpus set. Loads from disk, so it is async; call once per suite.
 *
 * The in-memory sets come first, then the directories in a fixed order. The
 * control plane's set is included only where its private checkout exists.
 */
export async function loadPlanCorpus(): Promise<PlanCorpus> {
    const sets: PlanCorpusSet[] = [
        { id: "property-matrix", collections: everything, options: {} },
        {
            id: "derived-names",
            collections: asCollections(FIXTURE),
            options: { databaseExtensions: FIXTURE_DATABASE_EXTENSIONS }
        },
        { id: "policy-shapes", collections: POLICY_SHAPE_COLLECTIONS, options: {} },
        {
            id: "app",
            collections: await loadCollectionsFromDirectory(path.join(REPO_ROOT, "app", "config", "collections")),
            options: {}
        }
    ];
    for (const preset of CLI_TEMPLATE_PRESETS) {
        sets.push({ id: `cli-template.${preset}`, collections: await loadCliTemplate(preset), options: {} });
    }
    for (const name of REAL_SCHEMAS) {
        sets.push({ id: `real-schema.${name}`, collections: await loadGeneratedRealSchema(name), options: {} });
    }
    sets.push({ id: "docs.schema-as-code", collections: loadDocsSchemaSample(), options: {} });

    const skipped: { id: string; reason: string }[] = [];
    const saasCollections = path.join(SAAS_ROOT, "config", "collections");
    if (fs.existsSync(saasCollections)) {
        sets.push({
            id: "saas",
            collections: await loadCollectionsFromDirectory(saasCollections),
            options: {},
            goldenRoot: SAAS_PLAN_GOLDEN_DIR
        });
    } else {
        skipped.push({ id: "saas", reason: `no control-plane checkout at ${saasCollections}` });
    }

    return {
        sets,
        skipped,
        dispose: () => {
            for (const dir of scratchDirectories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}
