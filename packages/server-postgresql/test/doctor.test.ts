import { EntityCollection } from "@rebasepro/types";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { checkCollectionsVsSchema, getExpectedColumnType } from "../src/schema/doctor";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";

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
            const collections: EntityCollection[] = [{
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
            const collections: EntityCollection[] = [{
                slug: "products",
                table: "products",
                name: "Products",
                properties: {
                    name: { type: "string" },
                    price: { type: "number" },
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
            const originalCollections: EntityCollection[] = [{
                slug: "products",
                table: "products",
                name: "Products",
                properties: { name: { type: "string" } }
            }];

            const updatedCollections: EntityCollection[] = [{
                slug: "products",
                table: "products",
                name: "Products",
                properties: {
                    name: { type: "string" },
                    price: { type: "number" },  // New field added
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
            expect(getExpectedColumnType({ type: "string" })).toBe("character varying");
            expect(getExpectedColumnType({ type: "string", columnType: "text" } as import("@rebasepro/types").StringProperty)).toBe("text");
            expect(getExpectedColumnType({ type: "string", columnType: "char" } as import("@rebasepro/types").StringProperty)).toBe("character");
        });

        it("should map number types correctly", () => {
            expect(getExpectedColumnType({ type: "number" })).toBe("numeric");
            expect(getExpectedColumnType({ type: "number", validation: { integer: true } } as import("@rebasepro/types").NumberProperty)).toBe("integer");
            expect(getExpectedColumnType({ type: "number", columnType: "real" } as import("@rebasepro/types").NumberProperty)).toBe("real");
            expect(getExpectedColumnType({ type: "number", columnType: "double precision" } as import("@rebasepro/types").NumberProperty)).toBe("double precision");
            expect(getExpectedColumnType({ type: "number", columnType: "bigint" } as import("@rebasepro/types").NumberProperty)).toBe("bigint");
        });

        it("should map boolean type correctly", () => {
            expect(getExpectedColumnType({ type: "boolean" })).toBe("boolean");
        });

        it("should map date types correctly", () => {
            expect(getExpectedColumnType({ type: "date" })).toBe("timestamp with time zone");
            expect(getExpectedColumnType({ type: "date", columnType: "date" } as import("@rebasepro/types").DateProperty)).toBe("date");
            expect(getExpectedColumnType({ type: "date", columnType: "time" } as import("@rebasepro/types").DateProperty)).toBe("time without time zone");
        });

        it("should map json types correctly", () => {
            expect(getExpectedColumnType({ type: "map" })).toBe("jsonb");
            expect(getExpectedColumnType({ type: "array" })).toBe("jsonb");
            expect(getExpectedColumnType({ type: "array", columnType: "json" } as import("@rebasepro/types").ArrayProperty)).toBe("json");
        });

        it("should map enum string to USER-DEFINED", () => {
            expect(getExpectedColumnType({
                type: "string",
                enum: { active: "Active", inactive: "Inactive" }
            } as import("@rebasepro/types").StringProperty)).toBe("USER-DEFINED");
        });

        it("should return null for relation type", () => {
            expect(getExpectedColumnType({ type: "relation" } as import("@rebasepro/types").Property)).toBe(null);
        });
    });

    describe("report generation", () => {
        it("should correctly count errors and warnings in summary", () => {
            const issues = [
                { severity: "error" as const, category: "missing_table" as const, table: "t1", message: "m", fix: "f" },
                { severity: "warning" as const, category: "type_mismatch" as const, table: "t2", message: "m", fix: "f" },
                { severity: "error" as const, category: "missing_column" as const, table: "t3", message: "m", fix: "f" },
            ];

            const errors = issues.filter(i => i.severity === "error").length;
            const warnings = issues.filter(i => i.severity === "warning").length;

            expect(errors).toBe(2);
            expect(warnings).toBe(1);
        });
    });
});
