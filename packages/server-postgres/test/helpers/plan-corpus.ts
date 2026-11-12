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
 * The corpus is legacy collection sets on purpose: the goldens were recorded
 * from them on `main`, and the table path is proven against the same goldens
 * by lifting each set (`plan-equivalence.test.ts`). Every set read from disk
 * is a FROZEN copy under `test/fixtures/plan-corpus-legacy/` (the control
 * plane's under `saas/test/plan-corpus-legacy/`) — never the live project,
 * which moves to the table model under the goldens' feet. See
 * `plan-corpus-legacy/legacy-model.ts` for what was copied from where. A
 * collection directory is read by {@link readCollectionDirectory} — the
 * deleted runtime loader's semantics, kept for these frozen inputs only: every
 * non-index module in directory order, its default export, and the index's
 * `defaultSecurityRules` applied to each collection with no rules of its own.
 */
import fs from "node:fs";
import path from "node:path";

import { pathToFileURL } from "node:url";

import {
    isPostgresCollectionConfig,
    resolveResourceRefs,
    type CollectionConfig,
    type SecurityRule
} from "@rebasepro/types";

import {
    PLANNER_ENV_VARIABLES,
    renderSchemaOutputs,
    toStableJson,
    withPinnedPlannerWorld
} from "../../src/schema/render-outputs";
import { everything, refused, companies, companyTranslations, linkIntoComposite } from "../fixtures/property-matrix-collections";
import { POLICY_SHAPE_COLLECTIONS } from "../fixtures/policy-shapes";
import type { RealSchemaName } from "./schema-metadata";
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

/** The frozen legacy inputs of every set read from disk. */
export const PLAN_CORPUS_LEGACY_DIR = path.resolve(__dirname, "..", "fixtures", "plan-corpus-legacy");
/** The control plane's frozen input, in its own repository. */
export const SAAS_PLAN_CORPUS_LEGACY_DIR = path.join(SAAS_ROOT, "test", "plan-corpus-legacy");

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

/** The planner's ambient inputs, pinned for every render: see `src/schema/render-outputs.ts`. */
export { PLANNER_ENV_VARIABLES, withPinnedPlannerWorld };

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

/** A plan as stable JSON text, as the goldens record it (`toStableJson` in `src/schema/render-outputs.ts`). */
export const toGoldenJson = toStableJson;

/**
 * Everything the schema pipeline emits for one collection set, by file name —
 * `renderSchemaOutputs` (`src/schema/render-outputs.ts`), which the
 * collections-to-tables codemod also proves a migration with. Planned in slug
 * order, with the planner's environment pinned; an output that throws is
 * recorded as `THROWS: <message>`.
 */
export function renderAllOutputs(
    collections: readonly CollectionConfig[],
    options: PlanCorpusOptions = {}
): Record<string, string> {
    return renderSchemaOutputs(collections, options);
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

/** The presets `rebase init` offered (`TemplatePreset`), each frozen laid out the way `applyPreset` left it. */
export const CLI_TEMPLATE_PRESETS = ["blog", "ecommerce", "blank"] as const;

/** A module of a collection directory: not the index, a test, a declaration file or a dotfile. */
const isCollectionModule = (file: string): boolean =>
    (file.endsWith(".ts") || file.endsWith(".js")) && !file.startsWith(".") && !file.includes(".test.") &&
    !file.endsWith(".d.ts") && file !== "index.ts" && file !== "index.js";

const isSecurityRuleList = (value: unknown): value is SecurityRule[] => Array.isArray(value);

/**
 * A legacy `config/collections` directory, read the way the runtime read one
 * when these goldens were recorded: each module's default export in directory
 * order, references resolved, and the index's `defaultSecurityRules` applied
 * to every collection that declares no rules. Throws on a module that does not
 * import or exports no collection — a set silently missing a collection would
 * record a golden for a different schema.
 */
async function readCollectionDirectory(dir: string): Promise<CollectionConfig[]> {
    const collections: CollectionConfig[] = [];
    for (const file of fs.readdirSync(dir).filter(isCollectionModule)) {
        const mod: Record<string, unknown> = await import(pathToFileURL(path.join(dir, file)).href);
        const collection: unknown = mod.default;
        if (typeof collection !== "object" || collection === null || !("properties" in collection)) {
            throw new Error(`${path.join(dir, file)} default-exports no collection`);
        }
        // A plain object authored as a collection: what the runtime loader accepted.
        collections.push(resolveResourceRefs(collection as CollectionConfig));
    }
    const index = ["index.ts", "index.js"].map(name => path.join(dir, name)).find(candidate => fs.existsSync(candidate));
    if (index) {
        const mod: Record<string, unknown> = await import(pathToFileURL(index).href);
        const defaults = mod.defaultSecurityRules;
        if (isSecurityRuleList(defaults) && defaults.length > 0) {
            for (const collection of collections) {
                if (isPostgresCollectionConfig(collection) && !collection.securityRules?.length) {
                    collection.securityRules = defaults;
                }
            }
        }
    }
    return collections;
}

/**
 * Every database captured under `test/fixtures/real-schemas`. Each set is the
 * collections `rebase schema introspect` generated from the capture (junctions
 * folded, unround-trippable composite keys and unusable file names skipped,
 * the `@rebasepro/cms-types` builder, no data inference), frozen.
 */
export const REAL_SCHEMAS: RealSchemaName[] = ["chinook", "constraint-shapes", "musicbrainz", "northwind", "openstreetmap", "pagila"];

/** A frozen set's collections directory. */
const legacyCollections = (...segments: string[]): string => path.join(PLAN_CORPUS_LEGACY_DIR, ...segments, "collections");

/** The loaded corpus. */
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
            collections: await readCollectionDirectory(legacyCollections("app")),
            options: {}
        }
    ];
    for (const preset of CLI_TEMPLATE_PRESETS) {
        sets.push({ id: `cli-template.${preset}`, collections: await readCollectionDirectory(legacyCollections("cli-template", preset)), options: {} });
    }
    for (const name of REAL_SCHEMAS) {
        sets.push({ id: `real-schema.${name}`, collections: await readCollectionDirectory(legacyCollections("real-schema", name)), options: {} });
    }
    sets.push({ id: "docs.schema-as-code", collections: await readCollectionDirectory(legacyCollections("docs", "schema-as-code")), options: {} });

    const skipped: { id: string; reason: string }[] = [];
    const saasCollections = path.join(SAAS_PLAN_CORPUS_LEGACY_DIR, "saas", "collections");
    if (fs.existsSync(saasCollections)) {
        sets.push({
            id: "saas",
            collections: await readCollectionDirectory(saasCollections),
            options: {},
            goldenRoot: SAAS_PLAN_GOLDEN_DIR
        });
    } else {
        skipped.push({ id: "saas", reason: `no control-plane checkout at ${saasCollections}` });
    }

    return {
        sets,
        skipped,
        // Nothing to clean up any more: every set is read in place. Kept so the
        // suites' `afterAll(() => corpus.dispose())` stays valid.
        dispose: () => undefined
    };
}
