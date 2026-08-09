import { CollectionConfig, StringProperty, NumberProperty, DateProperty, ArrayProperty, Property } from "@rebasepro/types";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { checkCollectionsVsSchema, checkCollectionsVsSdk, getExpectedColumnType, renderReport, runDoctor } from "../src/schema/doctor";
import { generateTypedefs } from "@rebasepro/codegen";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";

// `runDoctor` loads collections off disk via the server package. Stubbing only
// that one export lets the summary be driven from in-memory collections while
// the phase checks, the counting and the renderer all stay real.
jest.mock("@rebasepro/server", () => {
    const actual = jest.requireActual("@rebasepro/server");
    return { ...actual,
        loadCollectionsFromDirectory: jest.fn() };
});

// Re-export for testing — we need to access the internal helper
// but since it's not exported, we test it indirectly via checkCollectionsVsSchema

describe("Rebase Schema Doctor", () => {

    describe("checkCollectionsVsSchema", () => {
        const createTempSchemaFile = async (content: string): Promise<string> => {
            const dir = fs.mkdtempSync(path.join(tmpdir(), "doctor-test-"));
            const filePath = path.join(dir, "schema.generated.ts");
            fs.writeFileSync(filePath, content, "utf-8");
            return filePath;
        };

        it("should detect missing schema file", async () => {
            const collections: CollectionConfig[] = [{
                slug: "products",
                table: "products",
                name: "Products",
                properties: { name: { type: "string" } }
            }];

            const result = await checkCollectionsVsSchema(collections, "/nonexistent/path/schema.generated.ts");
            expect(result.passed).toBe(false);
            expect(result.issues).toHaveLength(1);
            expect(result.issues[0].category).toBe("schema_stale");
            expect(result.issues[0].severity).toBe("error");
        });

        it("should pass when schema matches collections", async () => {
            const collections: CollectionConfig[] = [{
                slug: "products",
                table: "products",
                name: "Products",
                properties: {
                    name: { type: "string" },
                    price: { type: "number" }
                }
            }];

            // Generate the expected schema and write to temp file
            const expectedSchema = await generateSchema(collections);
            const schemaPath = await createTempSchemaFile(expectedSchema);

            try {
                const result = await checkCollectionsVsSchema(collections, schemaPath);
                expect(result.passed).toBe(true);
                expect(result.issues).toHaveLength(0);
            } finally {
                fs.rmSync(path.dirname(schemaPath), { recursive: true });
            }
        });

        it("should detect stale schema when collections have changed", async () => {
            const originalCollections: CollectionConfig[] = [{
                slug: "products",
                table: "products",
                name: "Products",
                properties: { name: { type: "string" } }
            }];

            const updatedCollections: CollectionConfig[] = [{
                slug: "products",
                table: "products",
                name: "Products",
                properties: {
                    name: { type: "string" },
                    price: { type: "number" } // New field added
                }
            }];

            // Write schema for original, check against updated
            const originalSchema = await generateSchema(originalCollections);
            const schemaPath = await createTempSchemaFile(originalSchema);

            try {
                const result = await checkCollectionsVsSchema(updatedCollections, schemaPath);
                expect(result.passed).toBe(false);
                expect(result.issues.some(i => i.category === "schema_stale")).toBe(true);
            } finally {
                fs.rmSync(path.dirname(schemaPath), { recursive: true });
            }
        });

        it("should return error for nonexistent schema file even with empty collections", async () => {
            const result = await checkCollectionsVsSchema([], "/nonexistent/path");
            // Schema file doesn't exist → error regardless of collection count
            expect(result.passed).toBe(false);
            expect(result.issues[0].category).toBe("schema_stale");
        });
    });

    describe("column type mapping", () => {
        // We test getExpectedColumnType indirectly through import
        // These are integration-style tests against the mapping logic

        it("should map string types correctly", () => {
            expect(getExpectedColumnType({ type: "string" })).toBe("text");
            expect(getExpectedColumnType({ type: "string",
columnType: "text" } as StringProperty)).toBe("text");
            expect(getExpectedColumnType({ type: "string",
columnType: "char" } as StringProperty)).toBe("character");
            expect(getExpectedColumnType({ type: "string",
columnType: "uuid" } as StringProperty)).toBe("uuid");
        });

        // The generator compiles markdown/multiline strings to `text`. When this
        // expectation said "text", every scaffolded project reported
        // phantom drift on its markdown columns the first time doctor ran.
        it("should expect text for markdown/multiline strings", () => {
            expect(getExpectedColumnType({ type: "string",
admin: { markdown: true } } as unknown as StringProperty)).toBe("text");
            expect(getExpectedColumnType({ type: "string",
admin: { multiline: true } } as unknown as StringProperty)).toBe("text");
            // A plain string with unrelated ui config stays varchar.
            expect(getExpectedColumnType({ type: "string",
admin: { hideFromCollection: true } } as unknown as StringProperty)).toBe("text");
        });

        it("should map number types correctly", () => {
            expect(getExpectedColumnType({ type: "number" })).toBe("numeric");
            expect(getExpectedColumnType({ type: "number",
validation: { integer: true } } as NumberProperty)).toBe("integer");
            expect(getExpectedColumnType({ type: "number",
columnType: "real" } as NumberProperty)).toBe("real");
            expect(getExpectedColumnType({ type: "number",
columnType: "double precision" } as NumberProperty)).toBe("double precision");
            expect(getExpectedColumnType({ type: "number",
columnType: "bigint" } as NumberProperty)).toBe("bigint");
            // Serial types are integers with a sequence default; the catalog
            // reports the underlying width.
            expect(getExpectedColumnType({ type: "number",
columnType: "serial" } as NumberProperty)).toBe("integer");
            expect(getExpectedColumnType({ type: "number",
columnType: "bigserial" } as NumberProperty)).toBe("bigint");
            expect(getExpectedColumnType({ type: "number",
columnType: "smallserial" } as NumberProperty)).toBe("smallint");
            // Any other columnType passes through, matching the generator, rather
            // than falling back to numeric and reporting drift.
            expect(getExpectedColumnType({ type: "number",
columnType: "smallint" } as unknown as NumberProperty)).toBe("smallint");
        });

        it("should map boolean type correctly", () => {
            expect(getExpectedColumnType({ type: "boolean" })).toBe("boolean");
        });

        it("should map date types correctly", () => {
            expect(getExpectedColumnType({ type: "date" })).toBe("timestamp with time zone");
            expect(getExpectedColumnType({ type: "date",
columnType: "date" } as DateProperty)).toBe("date");
            expect(getExpectedColumnType({ type: "date",
columnType: "time" } as DateProperty)).toBe("time without time zone");
        });

        it("should map json types correctly", () => {
            expect(getExpectedColumnType({ type: "map" })).toBe("jsonb");
            expect(getExpectedColumnType({ type: "array" })).toBe("jsonb");
            expect(getExpectedColumnType({ type: "array",
columnType: "json" } as ArrayProperty)).toBe("json");

            // Native array element type mappings
            expect(getExpectedColumnType({ type: "array",
of: { type: "string" } } as ArrayProperty)).toBe("ARRAY");
            expect(getExpectedColumnType({ type: "array",
of: { type: "number",
validation: { integer: true } } } as ArrayProperty)).toBe("ARRAY");
            expect(getExpectedColumnType({ type: "array",
of: { type: "boolean" } } as ArrayProperty)).toBe("ARRAY");
        });

        it("should map enum string to USER-DEFINED", () => {
            expect(getExpectedColumnType({
                type: "string",
                enum: { active: "Active",
inactive: "Inactive" }
            } as StringProperty)).toBe("USER-DEFINED");
        });

        it("should return null for relation type", () => {
            expect(getExpectedColumnType({ type: "relation" } as Property)).toBe(null);
        });
    });

    describe("report generation", () => {
        const collections: CollectionConfig[] = [{
            slug: "products",
            table: "products",
            name: "Products",
            properties: { name: { type: "string" } }
        }];

        let logSpy: jest.SpyInstance;
        let errSpy: jest.SpyInstance;
        /** Every line the report wrote, joined — the report is console output. */
        const printed = () => logSpy.mock.calls.map(c => String(c[0] ?? "")).join("\n");

        beforeEach(() => {
            (loadCollectionsFromDirectory as jest.Mock).mockResolvedValue(collections);
            // The renderer writes the whole drift report to stdout; the counts
            // and the verdict are what is under test, not the noise. It writes
            // through `console.log` rather than `logger.info` deliberately —
            // LOG_LEVEL=warn used to silence the entire report while doctor
            // still exited 1.
            logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
            errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        });

        afterEach(() => {
            logSpy.mockRestore();
            errSpy.mockRestore();
            jest.clearAllMocks();
        });

        it("counts errors, warnings and passing phases across every phase", async () => {
            const dir = fs.mkdtempSync(path.join(tmpdir(), "doctor-summary-"));
            // A stale (not missing) SDK file is the only way to get a *warning*
            // out of a phase — a missing one is deliberately reported as info.
            const sdkPath = path.join(dir, "rebase.d.ts");
            fs.writeFileSync(sdkPath, "// generated before the collections changed\n", "utf-8");

            try {
                const report = await runDoctor({
                    collectionsPath: dir,
                    // Missing schema file → one error from phase 1.
                    schemaPath: path.join(dir, "schema.generated.ts"),
                    sdkPath
                    // No databaseUrl → phase 2 never runs, and is counted as
                    // neither passing nor failing.
                });

                expect(report.collectionsToSchema.passed).toBe(false);
                expect(report.collectionsToSdk.passed).toBe(false);
                expect(report.schemaToDatabase.skipped).toBeTruthy();

                // Errors and warnings are summed across ALL phases, not per phase;
                // `passed` counts phases, not issues.
                expect(report.summary).toEqual({ passed: 0,
skipped: 1,
notApplicable: 0,
warnings: 1,
errors: 1 });
            } finally {
                fs.rmSync(dir, { recursive: true });
            }
        });

        // This test used to assert `{ passed: 3, warnings: 0, errors: 0 }` for a
        // run that never opened a connection, enshrining the bug as the clean
        // case: the database phase initialised to `{ passed: true, issues: [] }`,
        // rendered as "✅ Collections → Database: In sync" and closed with
        // "✓ All schemas are in sync!". A user whose .env spells the connection
        // string `POSTGRES_URL` got two green ticks against a database with no
        // tables in it.
        it("does not count a database phase that never ran as passing", async () => {
            const dir = fs.mkdtempSync(path.join(tmpdir(), "doctor-summary-clean-"));
            const schemaPath = path.join(dir, "schema.generated.ts");
            fs.writeFileSync(schemaPath, await generateSchema(collections), "utf-8");

            try {
                const report = await runDoctor({
                    collectionsPath: dir,
                    schemaPath,
                    // An absent SDK is informational, so it must not count as a
                    // warning or the phase would never come back clean.
                    sdkPath: path.join(dir, "rebase.d.ts")
                    // No databaseUrl.
                });

                expect(report.collectionsToSdk.issues.map(i => i.severity)).toEqual(["info"]);
                expect(report.schemaToDatabase.passed).toBe(false);
                expect(report.schemaToDatabase.skipped).toBe("DATABASE_URL not set");
                // The SDK phase had no artifact to compare against, so it is
                // neither passing nor skipped — see the test below.
                expect(report.summary).toEqual({ passed: 1,
skipped: 1,
notApplicable: 1,
warnings: 0,
errors: 0 });
            } finally {
                fs.rmSync(dir, { recursive: true });
            }
        });

        it("renders the skipped phase as skipped, and never claims everything is in sync", async () => {
            const dir = fs.mkdtempSync(path.join(tmpdir(), "doctor-render-skipped-"));
            const schemaPath = path.join(dir, "schema.generated.ts");
            fs.writeFileSync(schemaPath, await generateSchema(collections), "utf-8");

            try {
                await runDoctor({
                    collectionsPath: dir,
                    schemaPath,
                    sdkPath: path.join(dir, "rebase.d.ts")
                });

                const output = printed();
                expect(output).toContain("Collections → Database: skipped (DATABASE_URL not set)");
                expect(output).not.toContain("Collections → Database: In sync");
                expect(output).not.toContain("All schemas are in sync");
                expect(output).toContain("1 skipped");
            } finally {
                fs.rmSync(dir, { recursive: true });
            }
        });

        // The control for the test above: the clean verdict is still reachable
        // when all three phases actually ran.
        it("says everything is in sync when no phase was skipped", () => {
            const clean = { passed: true,
issues: [] };
            renderReport({
                collectionsToSchema: clean,
                collectionsToSdk: clean,
                schemaToDatabase: clean,
                summary: { passed: 3,
skipped: 0,
notApplicable: 0,
warnings: 0,
errors: 0 }
            });

            const output = printed();
            expect(output).toContain("Collections → Database: In sync");
            expect(output).toContain("All schemas are in sync!");
        });

        // Two adjacent lines used to say `✅ Collections → SDK Types: In sync`
        // and `ℹ Typed SDK not generated (optional).` — the report calling a
        // file synchronised in one breath and absent in the next. A phase with
        // nothing to compare against reports that, and nothing else.
        it("never calls a typed SDK that was never generated 'In sync'", async () => {
            const dir = fs.mkdtempSync(path.join(tmpdir(), "doctor-sdk-absent-"));
            const schemaPath = path.join(dir, "schema.generated.ts");
            fs.writeFileSync(schemaPath, await generateSchema(collections), "utf-8");

            try {
                const report = await runDoctor({
                    collectionsPath: dir,
                    schemaPath,
                    sdkPath: path.join(dir, "rebase.d.ts")
                });

                expect(report.collectionsToSdk.notApplicable).toBe("not generated (optional)");

                const output = printed();
                expect(output).toContain("Collections → SDK Types: not generated (optional)");
                expect(output).not.toContain("Collections → SDK Types: In sync");
                expect(output).toContain("1 not applicable");
                // An optional artifact nobody asked for is not a reason to
                // withhold a clean verdict from the checks that did run.
                expect(output).not.toContain("SDK Types: skipped");
            } finally {
                fs.rmSync(dir, { recursive: true });
            }
        });
    });

    // `rebase schema generate` and `rebase generate-sdk` write their files from
    // collections sorted by slug. The doctor regenerates in memory from whatever
    // order `readdirSync` returned, so on any project whose filename order
    // differs from its slug order both staleness checks fired on a file that was
    // freshly generated — and the fix they printed rewrote it in the order it
    // was already in. The generators sort themselves now.
    describe("staleness checks are independent of collection order", () => {
        const articles: CollectionConfig = {
            slug: "articles",
            table: "articles",
            name: "Articles",
            properties: { title: { type: "string" } }
        };
        const authors: CollectionConfig = {
            // `authors.ts` sorts before `blogPosts.ts` as a filename, while
            // `articles` sorts before `authors` as a slug.
            slug: "authors",
            table: "authors",
            name: "Authors",
            properties: { name: { type: "string" } }
        };

        it("does not report the generated schema as stale on a filename/slug inversion", async () => {
            const dir = fs.mkdtempSync(path.join(tmpdir(), "doctor-order-schema-"));
            const schemaPath = path.join(dir, "schema.generated.ts");
            // Written the way `rebase schema generate` writes it: sorted by slug.
            fs.writeFileSync(schemaPath, await generateSchema([articles, authors]), "utf-8");

            try {
                // Checked the way the loader hands them over: readdirSync order.
                const result = await checkCollectionsVsSchema([authors, articles], schemaPath);
                expect(result.issues).toHaveLength(0);
                expect(result.passed).toBe(true);
            } finally {
                fs.rmSync(dir, { recursive: true });
            }
        });

        it("does not report the SDK types as stale on a filename/slug inversion", async () => {
            const dir = fs.mkdtempSync(path.join(tmpdir(), "doctor-order-sdk-"));
            const sdkPath = path.join(dir, "database.types.ts");
            fs.writeFileSync(sdkPath, generateTypedefs([articles, authors]), "utf-8");

            try {
                const result = await checkCollectionsVsSdk([authors, articles], sdkPath);
                expect(result.issues).toHaveLength(0);
                expect(result.passed).toBe(true);
            } finally {
                fs.rmSync(dir, { recursive: true });
            }
        });
    });
});
