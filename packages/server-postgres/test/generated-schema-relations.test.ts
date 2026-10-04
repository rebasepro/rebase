/**
 * The relations `schema.generated.ts` declares, evaluated by drizzle.
 *
 * `generated-schema-compiles.test.ts` proves the file type-checks, which is not
 * the same as drizzle accepting it. A `one()` drizzle cannot pair compiles
 * cleanly and throws the first time a relational query asks for it ("There are
 * multiple relations between…"), and a `one()` with a config but no `fields`
 * throws as soon as `drizzle({ schema })` evaluates the relations. So the
 * generated module is loaded here, every relation in it goes through drizzle's
 * own normalisation, and the `hasOne` links are compiled as `with` queries from
 * both ends.
 *
 * The module is written inside this package so `drizzle-orm` resolves the way
 * it does for a real project.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "@jest/globals";
import {
    createTableRelationsHelpers,
    extractTablesRelationalConfig,
    getTableName,
    is,
    normalizeRelation,
    type TableRelationalConfig,
    type TablesRelationalConfig
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { RelationalQueryBuilder } from "drizzle-orm/pg-core/query-builders/query";
import type { CollectionConfig } from "@rebasepro/types";

import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";

const PACKAGE_ROOT = path.resolve(__dirname, "..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

/** The generated module's `tables` and `relations`, merged the way a project passes them to drizzle. */
async function loadGeneratedSchema(collections: CollectionConfig[]): Promise<Record<string, unknown>> {
    const source = await generateSchema(collections);
    const dir = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".schema-relations-"));
    try {
        const file = path.join(dir, "schema.generated.ts");
        fs.writeFileSync(file, source);
        const module: unknown = await import(file);
        if (!isRecord(module) || !isRecord(module.tables) || !isRecord(module.relations)) {
            throw new Error("the generated module exports no tables or relations");
        }
        return { ...module.tables, ...module.relations };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * Every relation as the join drizzle resolves it to, keyed `<table>.<relation>`
 * and written `<target column> = <source column>`. Throws where drizzle would.
 */
function resolvedJoins(schema: Record<string, unknown>): Record<string, string> {
    const { tables, tableNamesMap } = extractTablesRelationalConfig<TablesRelationalConfig>(schema, createTableRelationsHelpers);
    const joins: Record<string, string> = {};
    for (const [tableKey, config] of Object.entries(tables)) {
        for (const [relationKey, relation] of Object.entries(config.relations)) {
            const { fields, references } = normalizeRelation(tables, tableNamesMap, relation);
            joins[`${tableKey}.${relationKey}`] = fields
                .map((field, i) => `${getTableName(references[i].table)}.${references[i].name} = ${getTableName(field.table)}.${field.name}`)
                .join(" AND ");
        }
    }
    return joins;
}

function withSql(schema: Record<string, unknown>, table: string, relation: string): string {
    const builder: unknown = Reflect.get(drizzle.mock({ schema }).query, table);
    if (!is(builder, RelationalQueryBuilder)) throw new Error(`drizzle built no relational query for "${table}"`);
    const query: RelationalQueryBuilder<TablesRelationalConfig, TableRelationalConfig> = builder;
    return query.findMany({ with: { [relation]: true } }).toSQL().sql;
}

describe("the generated relations, evaluated by drizzle", () => {
    it("resolves a hasOne whose target declares nothing back", async () => {
        const billing: CollectionConfig = {
            slug: "billing_configs",
            table: "billing_configs",
            name: "Billing configs",
            properties: { company_id: { type: "string" } }
        };
        const companies: CollectionConfig = {
            slug: "companies",
            table: "companies",
            name: "Companies",
            properties: {
                name: { type: "string" },
                billingConfig: { type: "relation", relation: { kind: "hasOne", target: () => billing, foreignKeyOnTarget: "company_id" } }
            }
        };
        const schema = await loadGeneratedSchema([companies, billing]);

        expect(resolvedJoins(schema)).toEqual({
            "companies.billingConfig": "billing_configs.company_id = companies.id",
            "billingConfigs._synth_companies_company_id": "companies.id = billing_configs.company_id"
        });
        expect(withSql(schema, "companies", "billingConfig"))
            .toContain("\"companies_billingConfig\".\"company_id\" = \"companies\".\"id\"");
    }, 60_000);

    it("resolves two hasOne relations to the same target, each on its own column", async () => {
        const billing: CollectionConfig = {
            slug: "billing_configs",
            table: "billing_configs",
            name: "Billing configs",
            properties: {
                company: { type: "relation", relation: { kind: "belongsTo", target: () => companies, localKey: "company_id" } },
                backupCompany: { type: "relation", relation: { kind: "belongsTo", target: () => companies, localKey: "backup_company_id" } }
            }
        };
        const companies: CollectionConfig = {
            slug: "companies",
            table: "companies",
            name: "Companies",
            properties: {
                billingConfig: { type: "relation", relation: { kind: "hasOne", target: () => billing, foreignKeyOnTarget: "company_id" } },
                backupBillingConfig: { type: "relation", relation: { kind: "hasOne", target: () => billing, foreignKeyOnTarget: "backup_company_id" } }
            }
        };
        const schema = await loadGeneratedSchema([companies, billing]);

        expect(resolvedJoins(schema)).toEqual({
            "companies.billingConfig": "billing_configs.company_id = companies.id",
            "companies.backupBillingConfig": "billing_configs.backup_company_id = companies.id",
            "billingConfigs.company": "companies.id = billing_configs.company_id",
            "billingConfigs.backupCompany": "companies.id = billing_configs.backup_company_id"
        });
        expect(withSql(schema, "companies", "backupBillingConfig"))
            .toContain("\"companies_backupBillingConfig\".\"backup_company_id\" = \"companies\".\"id\"");
        expect(withSql(schema, "billingConfigs", "backupCompany"))
            .toContain("\"billingConfigs_backupCompany\".\"id\" = \"billingConfigs\".\"backup_company_id\"");
    }, 60_000);

    it("resolves a self-referencing hasOne beside its belongsTo", async () => {
        const employees: CollectionConfig = {
            slug: "employees",
            table: "employees",
            name: "Employees",
            properties: {
                mentor: { type: "relation", relation: { kind: "belongsTo", target: () => employees, localKey: "mentor_id" } },
                mentee: { type: "relation", relation: { kind: "hasOne", target: () => employees, foreignKeyOnTarget: "mentor_id" } }
            }
        };
        const schema = await loadGeneratedSchema([employees]);

        expect(resolvedJoins(schema)).toEqual({
            "employees.mentor": "employees.id = employees.mentor_id",
            "employees.mentee": "employees.mentor_id = employees.id"
        });
        expect(withSql(schema, "employees", "mentee"))
            .toContain("\"employees_mentee\".\"mentor_id\" = \"employees\".\"id\"");
    }, 60_000);
});
