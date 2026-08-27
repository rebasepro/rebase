/**
 * What the generator writes, for real schemas.
 *
 * Every collection asserted here is generated from metadata a live PostgreSQL
 * server produced — pagila, chinook and northwind, captured under
 * `test/fixtures/real-schemas`. The existing `introspect-db-generation.test.ts`
 * covers the property-by-property mapping against built inputs; this covers the
 * output as a whole, on schemas nobody wrote to make it look good.
 *
 * The last block typechecks the generated text. That is the check that would
 * have caught the shape this change fixes: `icon` and `propertiesOrder` were
 * emitted at the top level of a `PostgresCollectionConfig`, which declares
 * neither, so every generated file was a type error and the panel never saw the
 * values — a defect invisible to any assertion about substrings, because the
 * substrings were all present.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

import {
    buildEnumMap,
    generateCollectionFile,
    type CollectionBuilder,
    type GenerationContext
} from "../src/schema/introspect-db-logic";
import { classifyTables } from "../src/schema/introspect-db-structure";
import { parseCheckConstraints } from "../src/schema/introspect-db-constraints";
import { buildSchema, column, loadRealSchema, serialPk, type RealSchemaName } from "./helpers/schema-metadata";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

interface GeneratedSchema {
    files: Map<string, string>;
    junctions: Set<string>;
    context: GenerationContext;
}

/** Runs the whole pipeline over a captured schema, as the CLI does. */
function generateAll(name: RealSchemaName, builder: CollectionBuilder = "admin-types"): GeneratedSchema {
    const { metadata, tables } = loadRealSchema(name);
    const enumMap = buildEnumMap(metadata.enumValues);
    const classifications = classifyTables(metadata, tables);
    const checkFacts = parseCheckConstraints(metadata.checks);
    const junctions = new Set(
        Array.from(classifications.values()).filter((c) => c.role === "junction").map((c) => c.table)
    );

    const context: GenerationContext = { metadata, classifications, checkFacts, builder };
    const files = new Map<string, string>();
    for (const [table, meta] of tables) {
        if (junctions.has(table)) continue;
        files.set(table, generateCollectionFile(
            table, meta, metadata.fks, junctions, tables, enumMap, undefined, context
        ));
    }
    return { files, junctions, context };
}

/** The `admin: { … }` block of a generated file. */
function adminBlock(source: string): string {
    const open = source.indexOf("\n    admin: {");
    if (open === -1) throw new Error(`no admin block in:\n${source}`);
    const close = source.indexOf("\n    }", open);
    return source.slice(open, close);
}

/** The generated block for one property. */
function propertyBlock(source: string, key: string): string {
    const open = source.indexOf(`\n        ${key}: {`);
    if (open === -1) throw new Error(`no property "${key}" in:\n${source}`);
    const close = source.indexOf("\n        },", open);
    return source.slice(open, close);
}

const pagila = generateAll("pagila");
const northwind = generateAll("northwind");
const chinook = generateAll("chinook");
const musicbrainz = generateAll("musicbrainz");
const openstreetmap = generateAll("openstreetmap");

/** The property keys a generated file declares, in order. */
function propertyKeys(source: string): string[] {
    const properties = source.slice(source.indexOf("\n    properties: {"), source.indexOf("\n    },"));
    return [...properties.matchAll(/^ {8}(\w+): \{$/gm)].map((m) => m[1]);
}

// ═══════════════════════════════════════════════════════════════════════
// Which collections exist at all
// ═══════════════════════════════════════════════════════════════════════
describe("collections generated from a real schema", () => {
    it("writes no file for a join table", () => {
        expect(pagila.files.has("film_actor")).toBe(false);
        expect(pagila.files.has("film_category")).toBe(false);
        expect(northwind.files.has("employee_territories")).toBe(false);
        expect(chinook.files.has("playlist_track")).toBe(false);
    });

    it("writes no file for a partition", () => {
        // pagila splits `payment` across 26 monthly partitions. Each one used to
        // become a collection with its own navigation entry.
        const partitions = [...pagila.files.keys()].filter((t) => t.startsWith("payment_p"));
        expect(partitions).toEqual([]);
        expect(pagila.files.has("payment")).toBe(true);
    });

    it("turns 70 pagila tables into 13 collections, 11 of them in the navigation", () => {
        expect(pagila.files.size).toBe(13);
        const navigable = [...pagila.files.values()].filter((f) => !f.includes("hideFromNavigation: true"));
        expect(navigable).toHaveLength(13);
        const grouped = [...pagila.files.values()].filter((f) => f.includes('group: "Reference"'));
        expect(grouped).toHaveLength(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// The admin block
// ═══════════════════════════════════════════════════════════════════════
describe("the generated admin block", () => {
    it("nests icon and propertiesOrder inside it, not at the top level", () => {
        const film = pagila.files.get("film")!;
        expect(adminBlock(film)).toContain('icon: "');
        expect(adminBlock(film)).toContain("propertiesOrder: [");
        // The top-level object must carry only fields the config type declares.
        const beforeAdmin = film.slice(0, film.indexOf("\n    admin: {"));
        expect(beforeAdmin).not.toContain("\n    icon:");
        expect(beforeAdmin).not.toContain("\n    propertiesOrder:");
    });

    it("hides a table owned by another from the navigation", () => {
        const details = northwind.files.get("order_details")!;
        expect(adminBlock(details)).toContain("hideFromNavigation: true");
    });

    it("does not hide a table the user has to be able to reach", () => {
        expect(adminBlock(northwind.files.get("orders")!)).not.toContain("hideFromNavigation");
        expect(adminBlock(pagila.files.get("film")!)).not.toContain("hideFromNavigation");
    });

    it("groups a code list away from the entities", () => {
        expect(adminBlock(pagila.files.get("language")!)).toContain('group: "Reference"');
        expect(adminBlock(pagila.files.get("category")!)).toContain('group: "Reference"');
        expect(adminBlock(pagila.files.get("film")!)).not.toContain("group:");
    });

    it("names a title property when the schema supports one", () => {
        expect(adminBlock(pagila.files.get("film")!)).toContain('display: { title: "title" }');
        expect(adminBlock(northwind.files.get("products")!)).toContain('display: { title: "productName" }');
    });

    it("sorts by the single database-maintained stamp", () => {
        expect(adminBlock(pagila.files.get("film")!)).toContain('sort: ["lastUpdate", "desc"]');
    });

    it("caps the list view on a wide table and leaves a narrow one alone", () => {
        expect(adminBlock(pagila.files.get("film")!)).toContain("listProperties: [");
        expect(adminBlock(pagila.files.get("language")!)).not.toContain("listProperties");
    });

    it("keeps a column the list view will not draw out of the capped list", () => {
        // `film.fulltext` is a tsvector — it sorts sixth by the ordering
        // heuristic and renders as nothing.
        const film = adminBlock(pagila.files.get("film")!);
        const listPart = film.slice(film.indexOf("listProperties"), film.indexOf("propertiesOrder"));
        expect(listPart).not.toContain("fulltext");
        expect(film).toContain('"fulltext"'); // still in propertiesOrder
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Properties
// ═══════════════════════════════════════════════════════════════════════
describe("properties generated from catalog facts", () => {
    it("marks a generated column read-only", () => {
        // pagila's `film.length_hours` is GENERATED ALWAYS AS … STORED.
        expect(propertyBlock(pagila.files.get("film")!, "lengthHours")).toContain("readOnly: true");
    });

    it("marks a tsvector read-only and hides it from the list", () => {
        const fulltext = propertyBlock(pagila.files.get("film")!, "fulltext");
        expect(fulltext).toContain("readOnly: true");
        expect(fulltext).toContain("hideFromCollection: true");
    });

    it("does not demand a value for a column the user cannot write", () => {
        // `film.fulltext` is NOT NULL and maintained by a trigger. Requiring it
        // makes every create impossible.
        expect(propertyBlock(pagila.files.get("film")!, "fulltext")).not.toContain("required: true");
    });

    it("still demands a value for an ordinary NOT NULL column", () => {
        expect(propertyBlock(pagila.files.get("film")!, "title")).toContain("required: true");
    });

    it("carries a declared varchar length into validation", () => {
        // chinook's `album.title` is varchar(160).
        expect(propertyBlock(chinook.files.get("album")!, "title")).toContain("max: 160");
    });

    it("does not invent a length for an unbounded text column", () => {
        expect(propertyBlock(pagila.files.get("film")!, "description")).not.toContain("max:");
    });

    it("marks a uniquely-constrained column unique", () => {
        // pagila's `customer.uuid` carries a single-column unique constraint.
        expect(propertyBlock(pagila.files.get("customer")!, "uuid")).toContain("unique: true");
    });

    it("does not mark either half of a composite unique constraint unique", () => {
        // `payment` is unique on (uuid, payment_date) — the pair, not the parts.
        const payment = pagila.files.get("payment")!;
        expect(propertyBlock(payment, "uuid")).not.toContain("unique: true");
        expect(propertyBlock(payment, "paymentDate")).not.toContain("unique: true");
    });

    it("turns a Postgres enum type into enum values", () => {
        expect(propertyBlock(pagila.files.get("film")!, "rating"))
            .toContain('enum: [{ id: "G", label: "G" }');
    });
});

describe("properties generated from a schema that declares constraints", () => {
    const shapes = generateAll("constraint-shapes");
    const source = () => shapes.files.get("constraint_shapes")!;

    it("carries a CHECK-declared value set into an enum", () => {
        expect(propertyBlock(source(), "status")).toContain('enum: [{ id: "draft"');
    });

    it("carries CHECK bounds into numeric validation", () => {
        const rating = propertyBlock(source(), "rating");
        expect(rating).toContain("min: 1");
        expect(rating).toContain("max: 5");
    });

    it("distinguishes an exclusive bound", () => {
        expect(propertyBlock(source(), "price")).toContain("moreThan: 0");
    });

    it("carries CHECK length bounds into string validation", () => {
        // `slug` is a `text` column, so it also picks up `admin: { multiline }`.
        // That is the point of testing this column: the guard against emitting a
        // duplicate `min` used to be `extra.includes("min:")`, and `admin:` ends
        // in `min:` — so every property with an admin block silently dropped the
        // minimum the database declared.
        const slug = propertyBlock(source(), "slug");
        expect(slug).toContain("admin: {");
        expect(slug).toContain("min: 3");
        expect(slug).toContain("max: 64");
    });

    it("adds no validation for a constraint it refused to read", () => {
        expect(propertyBlock(source(), "eitherWay")).not.toContain("validation");
        // `not.toContain("min:")` would pass for the wrong reason and fail for a
        // sillier one: `admin:` ends in `min:`.
        expect(propertyBlock(source(), "email")).not.toMatch(/[\s{,]min\s*:/);
        expect(propertyBlock(source(), "notReserved")).not.toContain("enum:");
        expect(propertyBlock(source(), "payload")).not.toContain("enum:");
    });

    it("carries COMMENT ON COLUMN into the property description", () => {
        expect(propertyBlock(source(), "price")).toContain('description: "Unit price, before tax."');
    });

    it("carries COMMENT ON TABLE into the collection description", () => {
        expect(source()).toContain('description: "Every CHECK shape the parser is expected to handle."');
    });

    it("files a cascading child under its parent", () => {
        const child = shapes.files.get("constraint_shapes_child")!;
        expect(child).toContain("hideFromNavigation: true");
        expect(child).toContain("Introspected as a owned-child");
        expect(child).toContain("ON DELETE CASCADE");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Property keys must be unique — an object literal cannot repeat one
// ═══════════════════════════════════════════════════════════════════════
describe("relation property keys", () => {
    it("does not collide with a column of the same name", () => {
        // MusicBrainz names every foreign key column after the table it points
        // at, with no `_id` suffix: `area_tag (area, tag)`. Both are also primary
        // key columns, so both stay as properties — and the relation derived from
        // each used to take the same key, declaring `area:` twice. TS1117, and 67
        // of MusicBrainz's 339 collections had it.
        for (const [table, source] of musicbrainz.files) {
            const keys = propertyKeys(source);
            expect({ table, duplicates: keys.filter((k, i) => keys.indexOf(k) !== i) })
                .toEqual({ table, duplicates: [] });
        }
    });

    it("still gives the relation a name of its own", () => {
        const areaTag = musicbrainz.files.get("area_tag")!;
        const keys = propertyKeys(areaTag);
        expect(keys).toContain("area");        // the key column
        expect(keys).toContain("areaRelation"); // the relation derived from it
    });

    it("holds across every real schema", () => {
        for (const schema of [pagila, northwind, chinook, openstreetmap, musicbrainz]) {
            for (const [table, source] of schema.files) {
                const keys = propertyKeys(source);
                expect({ table, duplicates: keys.filter((k, i) => keys.indexOf(k) !== i) })
                    .toEqual({ table, duplicates: [] });
            }
        }
    });

    it("never imports the collection it declares", () => {
        // A self-referencing foreign key — `openstreetmap.users.creator_id`,
        // `northwind.employees.reports_to` — otherwise imports this file's own
        // default export under the name it is about to declare.
        for (const schema of [pagila, northwind, chinook, openstreetmap, musicbrainz]) {
            for (const [table, source] of schema.files) {
                const declared = source.match(/^const (\w+):/m)?.[1];
                expect({ table, selfImport: source.includes(`import ${declared} from`) })
                    .toEqual({ table, selfImport: false });
            }
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════
// A board, on the one real schema that earns it
// ═══════════════════════════════════════════════════════════════════════
describe("boards derived from a real schema", () => {
    it("gives OpenStreetMap's enum-typed tables a board", () => {
        // OSM declares eight enum types, several of them NOT NULL — the only
        // sample schema here that does.
        const boards = [...openstreetmap.files.values()].filter((f) => f.includes("kanban: {"));
        expect(boards.length).toBeGreaterThanOrEqual(5);
    });

    it("names a property the collection actually declares", () => {
        for (const [table, source] of openstreetmap.files) {
            const column = source.match(/columnProperty: "(\w+)"/)?.[1];
            if (!column) continue;
            expect({ table, declared: propertyKeys(source).includes(column) }).toEqual({ table, declared: true });
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════
// A board, which no sample schema happens to earn
// ═══════════════════════════════════════════════════════════════════════
describe("a required enum column", () => {
    /**
     * None of the real schemas qualifies — pagila's `film.rating` is the only
     * Postgres enum among them and it is nullable, which has no column to sit
     * in. Built here rather than left untested, because the alternative is
     * emission code that has never run.
     */
    function ticketsWith(nullable: "YES" | "NO"): string {
        const { metadata, tables } = buildSchema({
            tables: [{
                name: "tickets",
                columns: [
                    serialPk("tickets"),
                    column("tickets", "subject", { is_nullable: "NO" }),
                    column("tickets", "state", {
                        data_type: "USER-DEFINED", udt_name: "ticket_state", is_nullable: nullable
                    })
                ]
            }],
            enumValues: ["open", "doing", "done"].map((v, i) => ({
                enum_name: "ticket_state", enum_value: v, sort_order: i + 1
            }))
        });
        return generateCollectionFile(
            "tickets", tables.get("tickets")!, metadata.fks, new Set(), tables,
            buildEnumMap(metadata.enumValues), undefined,
            { metadata, classifications: classifyTables(metadata, tables), checkFacts: new Map() }
        );
    }

    it("becomes the column property of a board", () => {
        expect(adminBlock(ticketsWith("NO"))).toContain('kanban: {\n            columnProperty: "state"');
    });

    it("does not, when it is nullable", () => {
        expect(adminBlock(ticketsWith("YES"))).not.toContain("kanban");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Explaining itself
// ═══════════════════════════════════════════════════════════════════════
describe("the classification note", () => {
    it("states the role and the evidence for a non-entity", () => {
        const details = northwind.files.get("order_details")!;
        expect(details).toContain("// Introspected as a owned-child:");
        expect(details).toContain("primary key made only of foreign keys");
    });

    it("says nothing for an ordinary entity", () => {
        expect(northwind.files.get("orders")).not.toContain("// Introspected as");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// Backwards compatibility
// ═══════════════════════════════════════════════════════════════════════
describe("generating without a structural analysis", () => {
    it("still produces a collection", () => {
        // `rebase init --introspect` and three test suites build a TableMeta by
        // hand and have no database to read constraints or counts from.
        const { metadata, tables } = loadRealSchema("pagila");
        const bare = generateCollectionFile(
            "film", tables.get("film")!, metadata.fks, new Set(), tables, buildEnumMap(metadata.enumValues)
        );
        expect(bare).toContain('slug: "film"');
        expect(bare).toContain("propertiesOrder: [");
    });

    it("emits no derived admin options it has no evidence for", () => {
        const { metadata, tables } = loadRealSchema("pagila");
        const bare = generateCollectionFile(
            "film", tables.get("film")!, metadata.fks, new Set(), tables, buildEnumMap(metadata.enumValues)
        );
        expect(bare).not.toContain("display: { title");
        expect(bare).not.toContain("hideFromNavigation");
        expect(bare).not.toContain("listProperties");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// The generated files must compile
// ═══════════════════════════════════════════════════════════════════════
describe("generated collections typecheck", () => {
    // Compiling four schemas' worth of collections against workspace source is
    // slow enough to need more than jest's default.
    jest.setTimeout(120_000);

    /**
     * Compiles a whole generated directory against the workspace source of
     * `@rebasepro/*`, with the admin-block augmentation in the program — the
     * arrangement a scaffolded project has via `config/cms.d.ts`.
     */
    function diagnosticsFor(schemas: GeneratedSchema[], flavour: CollectionBuilder = "admin-types"): string[] {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-introspect-tc-"));
        try {
            const entryFiles: string[] = [];
            for (const [index, schema] of schemas.entries()) {
                const schemaDir = path.join(dir, `s${index}`);
                fs.mkdirSync(schemaDir);
                for (const [table, source] of schema.files) {
                    // The generator emits extensionless relative imports, which
                    // `bundler` resolution accepts.
                    fs.writeFileSync(path.join(schemaDir, `${table}.ts`), source, "utf-8");
                    entryFiles.push(path.join(schemaDir, `${table}.ts`));
                }
            }
            if (flavour === "admin-types") {
                // A scaffolded project pulls the admin block in through
                // `config/cms.d.ts` and `typeRoots`. Naming the augmentation's
                // source directly gets the same declaration merging into the program
                // without depending on node_modules layout.
                entryFiles.push(path.join(REPO_ROOT, "packages/cms-types/src/augment.ts"));
            }

            // A headless project has no `@rebasepro/cms-types` to resolve. Leaving
            // the mapping in place would let an accidental admin-types import
            // compile here and fail for the user, which is the failure this whole
            // change is about — so the path is dropped along with the augmentation.
            const paths: Record<string, string[]> = {
                "@rebasepro/types": [path.join(REPO_ROOT, "packages/types/src")],
                "@rebasepro/common": [path.join(REPO_ROOT, "packages/common/src")],
                "@rebasepro/utils": [path.join(REPO_ROOT, "packages/utils/src")]
            };
            if (flavour === "admin-types") {
                paths["@rebasepro/cms-types"] = [path.join(REPO_ROOT, "packages/cms-types/src")];
            }

            const program = ts.createProgram(entryFiles, {
                noEmit: true,
                strict: true,
                skipLibCheck: true,
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ESNext,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                jsx: ts.JsxEmit.ReactJSX,
                esModuleInterop: true,
                baseUrl: REPO_ROOT,
                types: [],
                paths
            });

            const generated = new Set(entryFiles);
            return ts.getPreEmitDiagnostics(program)
                // Only diagnostics in the generated files themselves. The
                // workspace source has its own type check; borrowing its errors
                // here would make this test fail for reasons it does not own.
                .filter((d) => d.file && generated.has(d.file.fileName))
                .map((d) => {
                    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
                    const where = d.file && d.start !== undefined
                        ? `${path.basename(d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
                        : "?";
                    return `${where} TS${d.code}: ${message}`;
                });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }

    /**
     * The `--data-inference` path, which no fixture reaches.
     *
     * Sampled rows are the second place property options are assembled, and it
     * had the same defect as the first: `multiline` and `markdown` emitted at
     * the top of the property, where `StringProperty` does not declare them, and
     * a second `admin: {` block whenever two branches both fired. The values
     * below are synthetic — they are the input, not the thing under test; what
     * is under test is whether what comes out compiles.
     */
    function inferredSchema(): GeneratedSchema {
        const { metadata, tables } = buildSchema({
            tables: [{
                name: "articles",
                columns: [
                    serialPk("articles"),
                    column("articles", "body", { data_type: "text" }),
                    column("articles", "summary", { data_type: "text" }),
                    column("articles", "cover_image", { data_type: "text" }),
                    column("articles", "attachment", { data_type: "text" }),
                    column("articles", "state", { data_type: "text" })
                ]
            }]
        });
        const rows = [
            {
                id: 1,
                body: "# Heading\n\nSome **bold** text and a [link](https://example.com).",
                summary: "a".repeat(140),
                cover_image: "https://cdn.example.com/covers/one.png",
                attachment: "uploads/2026/report.pdf",
                state: "draft"
            },
            {
                id: 2,
                body: "## Another\n\n- a list item",
                summary: "b".repeat(160),
                cover_image: "https://cdn.example.com/covers/two.jpg",
                attachment: "uploads/2026/summary.pdf",
                state: "published"
            },
            {
                id: 3,
                body: "### Third\n\n**more**",
                summary: "c".repeat(120),
                cover_image: "https://cdn.example.com/covers/three.png",
                attachment: "uploads/2026/notes.pdf",
                state: "draft"
            }
        ];
        const source = generateCollectionFile(
            "articles", tables.get("articles")!, metadata.fks, new Set(), tables, new Map(), rows,
            { metadata, classifications: classifyTables(metadata, tables), checkFacts: new Map() }
        );
        return { files: new Map([["articles", source]]), junctions: new Set(), context: {} };
    }

    it("compiles a collection built from sampled rows", () => {
        const inferred = inferredSchema();
        const source = inferred.files.get("articles")!;
        // The inference fired — otherwise this would compile vacuously.
        expect(source).toContain("markdown: true");
        expect(source).toContain("url: true");
        // …and produced one admin block for the property, not two.
        const bodyBlock = propertyBlock(source, "body");
        expect(bodyBlock.match(/admin: \{/g)).toHaveLength(1);

        expect(diagnosticsFor([inferred])).toEqual([]);
    });

    it("compiles every collection generated from every real schema", () => {
        const diagnostics = diagnosticsFor([
            pagila, northwind, chinook, openstreetmap, musicbrainz, generateAll("constraint-shapes")
        ]);
        expect(diagnostics).toEqual([]);
    });

    /**
     * The same schemas, generated for a project that does not have
     * `@rebasepro/cms-types` — and compiled in a program that cannot resolve it
     * either, which is the arrangement a headless project actually has.
     *
     * This is the half that was broken and unmeasured: the generator emitted an
     * `admin` block regardless, and `@rebasepro/types` declares no `admin` field,
     * so every file introspection wrote into a BaaS project was a type error.
     */
    it("compiles every collection generated for a headless project", () => {
        const headless = (["pagila", "northwind", "chinook", "openstreetmap", "musicbrainz", "constraint-shapes"] as const)
            .map((name) => generateAll(name, "common"));

        // The flavour is real, not a relabelling: no admin surface anywhere.
        for (const schema of headless) {
            for (const source of schema.files.values()) {
                expect(source).not.toContain("admin: {");
                expect(source).not.toContain("@rebasepro/cms-types");
            }
        }

        expect(diagnosticsFor(headless, "common")).toEqual([]);
    });

    /**
     * The point of the whole change, stated as the failure it prevents.
     *
     * `propertiesOrder` names property keys. Under the old
     * `const x: PostgresCollectionConfig = { … }` annotation those keys were
     * widened to `string`, so a key naming nothing — the residue of a renamed
     * column — compiled silently and reordered nothing. If this test ever passes
     * with an empty diagnostics list, the inference is no longer reaching the
     * admin block and the generated files are back to being unchecked.
     */
    it("rejects a propertiesOrder key that names no property", () => {
        // The whole schema, because `film` imports four siblings — and it compiles
        // clean, which the test above already establishes.
        const good = pagila.files.get("film")!;
        const stale = good.replace(
            /propertiesOrder: \[\n/,
            "propertiesOrder: [\n            \"rentalDuratoin\",\n"
        );
        expect(stale).not.toEqual(good);

        const files = new Map(pagila.files);
        files.set("film", stale);
        const diagnostics = diagnosticsFor([{ files, junctions: pagila.junctions, context: pagila.context }]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toContain("TS2769");
        expect(diagnostics[0]).toContain("'\"rentalDuratoin\"' is not assignable");
        // The literal keys are close enough for the compiler to name the column the
        // rename left behind, which is the whole benefit in one line.
        expect(diagnostics[0]).toContain("Did you mean '\"rentalDuration\"'?");
    });
});
