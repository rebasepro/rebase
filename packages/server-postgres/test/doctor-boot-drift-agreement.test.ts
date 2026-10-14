/**
 * `rebase doctor` and the boot warning answer the same drift question.
 *
 * Boot compares `schema.generated.ts` against the catalogue and warns once per
 * difference; the warning box sends the reader to `rebase doctor` for "the full
 * report". The doctor compared the collections against the database on its own
 * terms, which never looked at nullability or at columns no collection
 * declares. So after renaming `authors.email` to a required `contactEmail`,
 * boot warned about two differences — `contact_email` NOT NULL against a
 * nullable column, and the `email` column left behind — while the doctor said
 * "Collections → Database: In sync".
 *
 * The doctor now asks boot's question through boot's own code
 * (`readCatalogueSchema`, then `diffGeneratedSchemaAgainstCatalogue`), so the
 * two cannot disagree. This test runs both against one database.
 *
 * The database is PGlite, provisioned by the boot ensure itself, behind the
 * `pg.Pool` the doctor opens.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { loadCollectionsFromDirectory } from "@rebasepro/server";
import { ensureCollectionTables } from "../src/schema/ensure-collection-tables";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { describeSchemaDifference, diffGeneratedSchemaAgainstCatalogue } from "../src/schema/generated-schema-diff";
import { checkCollectionsVsDatabase, generatedSchemaDriftIssues, runDoctor, type DoctorIssue } from "../src/schema/doctor";

let mockDb: PGlite | undefined;
jest.mock("pg", () => {
    class Pool {
        async query(text: string, values?: unknown[]) {
            if (!mockDb) throw new Error("no database");
            const result = await mockDb.query(text, values);
            return { rows: result.rows };
        }
        async end() { /* the test owns the database */ }
    }
    return { Pool };
});

// `runDoctor` loads collections off disk through the server package.
jest.mock("@rebasepro/server", () => {
    const actual = jest.requireActual("@rebasepro/server");
    return { ...actual, loadCollectionsFromDirectory: jest.fn() };
});

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const URL = "postgres://doctor.test/db";

const authorsBefore = {
    slug: "authors",
    table: "authors",
    name: "Authors",
    properties: {
        id: { type: "string", isId: "uuid" },
        name: { type: "string" },
        email: { type: "string" }
    }
} as unknown as CollectionConfig;

/** `email` renamed to `contactEmail`, and made required. */
const authorsAfter = {
    slug: "authors",
    table: "authors",
    name: "Authors",
    properties: {
        id: { type: "string", isId: "uuid" },
        name: { type: "string" },
        contactEmail: { type: "string", validation: { required: true } }
    }
} as unknown as CollectionConfig;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

/**
 * `schema.generated.ts` for these collections, written inside this package so
 * `drizzle-orm` resolves the way it does in a project.
 */
function writeGeneratedSchema(source: string): { dir: string; file: string } {
    const dir = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".doctor-boot-drift-"));
    const file = path.join(dir, "schema.generated.ts");
    fs.writeFileSync(file, source);
    return { dir, file };
}

async function generatedTables(collections: CollectionConfig[]): Promise<Record<string, unknown>> {
    const { dir, file } = writeGeneratedSchema(await generateSchema(collections));
    try {
        const module: unknown = await import(file);
        if (!isRecord(module) || !isRecord(module.tables)) throw new Error("the generated module exports no tables");
        return module.tables;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** What boot computes before it warns: its own two calls, with its own arguments. */
async function bootDifferences(collections: CollectionConfig[], generated: Record<string, unknown>) {
    const catalogue = await readCatalogueSchema({ client: mockDb!, collections, defaultSchema: "public" });
    return diffGeneratedSchemaAgainstCatalogue({ generated, catalogue: catalogue.meta, collections });
}

describe("doctor and boot agree about schema drift", () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(async () => {
        // The ensure says it withheld the NOT NULL; that warning is boot's, and
        // not what this asserts on.
        warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        mockDb = new PGlite();
        await mockDb.waitReady;
        await mockDb.exec('CREATE SCHEMA IF NOT EXISTS "rebase";');
        // The table as it was, with a row in it, then boot's additive ensure
        // for the renamed property — which adds `contact_email` and leaves
        // `email` alone, as the boot of `rebase dev` does.
        expect((await ensureCollectionTables(mockDb, [authorsBefore])).failures).toEqual([]);
        await mockDb.exec(`INSERT INTO "public"."authors" (id, name, email) VALUES (gen_random_uuid(), 'Ada', 'ada@example.com')`);
        expect((await ensureCollectionTables(mockDb, [authorsAfter])).failures).toEqual([]);
    });

    afterEach(async () => {
        await mockDb?.close();
        mockDb = undefined;
        warnSpy.mockRestore();
    });

    it("reports the NOT NULL mismatch and the extra column boot warns about", async () => {
        const generated = await generatedTables([authorsAfter]);

        const boot = await bootDifferences([authorsAfter], generated);
        expect(boot.map(d => `${d.kind} ${d.column}`).sort()).toEqual(["extra-column email", "nullability contact_email"]);

        const phase = await checkCollectionsVsDatabase([authorsAfter], URL, { generated });
        expect(phase.passed).toBe(false);
        const nullability = phase.issues.find(i => i.category === "nullability_mismatch");
        const extra = phase.issues.find(i => i.category === "extra_column");
        expect(nullability).toMatchObject({ severity: "warning", table: "authors", column: "contact_email" });
        expect(extra).toMatchObject({ severity: "warning", table: "authors", column: "email" });

        // In boot's own words, one issue per difference boot warns about.
        for (const difference of boot) {
            expect(phase.issues.map(i => i.message)).toContain(describeSchemaDifference(difference));
        }
        expect(nullability?.fix).toMatch(/rebase db push/);
        expect(nullability?.fix).toMatch(/every row/);
        expect(extra?.fix).toMatch(/never drops a column/);
    });

    it("says nothing boot would not: a database that matches the file is in sync", async () => {
        // Push's half of the change, by hand: the old column gone, every row
        // filled, the NOT NULL applied.
        await mockDb!.exec(`
            UPDATE "public"."authors" SET contact_email = email;
            ALTER TABLE "public"."authors" DROP COLUMN email;
            ALTER TABLE "public"."authors" ALTER COLUMN contact_email SET NOT NULL;
        `);
        const generated = await generatedTables([authorsAfter]);
        expect(await bootDifferences([authorsAfter], generated)).toEqual([]);
        const phase = await checkCollectionsVsDatabase([authorsAfter], URL, { generated });
        expect(phase.issues.filter(i => i.severity !== "info")).toEqual([]);
        expect(phase.passed).toBe(true);
    });

    it("names a difference once: what the collections-side checks said is not repeated, and nothing else is dropped", () => {
        const already: DoctorIssue[] = [{
            severity: "warning",
            category: "type_mismatch",
            table: "authors",
            column: "name",
            message: "the doctor's own",
            fix: "…"
        }];
        const issues = generatedSchemaDriftIssues([
            { kind: "type", table: "authors", collection: "authors", column: "name", property: "name", generated: "text", live: "integer" },
            { kind: "nullability", table: "authors", collection: "authors", column: "name", property: "name", generated: "NOT NULL", live: "nullable" },
            { kind: "type", table: "authors", collection: "authors", column: "bio", property: "bio", generated: "text", live: "integer" }
        ], already, [authorsAfter]);
        expect(issues.map(i => `${i.category} ${i.column}`)).toEqual(["nullability_mismatch name", "type_mismatch bio"]);
    });

    it("runDoctor reads schema.generated.ts from --schema and reports the same drift", async () => {
        jest.mocked(loadCollectionsFromDirectory).mockResolvedValue([authorsAfter]);
        const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
        const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
        const { dir, file } = writeGeneratedSchema(await generateSchema([authorsAfter]));
        try {
            const report = await runDoctor({
                collectionsPath: dir,
                schemaPath: file,
                sdkPath: path.join(dir, "database.types.ts"),
                databaseUrl: URL
            });
            expect(report.collectionsToSchema.passed).toBe(true);
            expect(report.schemaToDatabase.issues.map(i => i.category).sort())
                .toEqual(["extra_column", "nullability_mismatch"]);
            const printed = logSpy.mock.calls.map(c => String(c[0] ?? "")).join("\n");
            expect(printed).not.toContain("Collections → Database: In sync");
            expect(printed).toContain("Nullability Mismatch");
            expect(printed).toContain("Extra Column");
        } finally {
            logSpy.mockRestore();
            errSpy.mockRestore();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
