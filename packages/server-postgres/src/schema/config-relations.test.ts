/**
 * `buildDrizzleRelationsFromCollections`, judged by drizzle itself.
 *
 * The bootstrapper hands these relations to `drizzle({ schema })`, and drizzle
 * evaluates every `relations()` block right there, in
 * `extractTablesRelationalConfig`. A `one()` drizzle does not accept is not a
 * failed query later: it is a backend that does not start. So each case builds
 * the tables the way boot does (catalogue rows → `buildDrizzleTablesFromSchema`
 * keyed by `columnKeysFromCollections`), builds the relations, then runs
 * drizzle's own normalisation — `extractTablesRelationalConfig`, and
 * `normalizeRelation` for every relation, which is what the query builder calls
 * for each `with` — and compiles a relational query from each end.
 */
import { describe, expect, it } from "@jest/globals";
import {
    createTableRelationsHelpers,
    extractTablesRelationalConfig,
    getTableName,
    is,
    normalizeRelation,
    type Relations,
    type TableRelationalConfig,
    type TablesRelationalConfig
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgTable } from "drizzle-orm/pg-core";
import { RelationalQueryBuilder } from "drizzle-orm/pg-core/query-builders/query";
import type { CollectionConfig } from "@rebasepro/types";

import { columnKeysFromCollections } from "./catalogue-schema";
import { buildDrizzleRelationsFromCollections } from "./config-relations";
import { buildDrizzleTablesFromSchema } from "./dynamic-tables";
import { buildTablesMap, type TableColumn } from "./introspect-db-logic";

/** A table as `information_schema` reports it: an `id` key and nullable uuid columns. */
interface TableShape {
    name: string;
    columns: string[];
}

interface Built {
    tables: Record<string, PgTable>;
    relations: Record<string, Relations>;
    schema: Record<string, PgTable | Relations>;
}

function build(collections: CollectionConfig[], shapes: TableShape[]): Built {
    const columns: TableColumn[] = shapes.flatMap(shape => ["id", ...shape.columns].map(column_name => ({
        table_name: shape.name,
        column_name,
        data_type: "uuid",
        udt_name: "uuid",
        is_nullable: column_name === "id" ? "NO" : "YES",
        column_default: null,
        atttypmod: null
    })));
    const tablesMap = buildTablesMap(
        shapes.map(shape => ({ table_name: shape.name })),
        columns,
        shapes.map(shape => ({ table_name: shape.name, column_name: "id" })),
        []
    );
    const tables = buildDrizzleTablesFromSchema(tablesMap, "public", columnKeysFromCollections(collections));
    const relations = buildDrizzleRelationsFromCollections(collections, tables);
    return { tables, relations, schema: { ...tables, ...relations } };
}

/**
 * Every relation in the schema as the join drizzle resolves it to, keyed
 * `<table>.<relation>` and written `<target column> = <source column>`.
 *
 * Throws exactly where drizzle would: while evaluating the `relations()`
 * blocks (boot), or while pairing a relation with its counterpart (a query).
 */
function resolvedJoins(schema: Built["schema"]): Record<string, string> {
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

/** The `relationName` each relation carries, keyed `<table>.<relation>`. */
function relationNames(schema: Built["schema"]): Record<string, string | undefined> {
    const { tables } = extractTablesRelationalConfig<TablesRelationalConfig>(schema, createTableRelationsHelpers);
    const names: Record<string, string | undefined> = {};
    for (const [tableKey, config] of Object.entries(tables)) {
        for (const [relationKey, relation] of Object.entries(config.relations)) {
            names[`${tableKey}.${relationKey}`] = relation.relationName;
        }
    }
    return names;
}

/** `db.query[table]`. The tables are built at runtime, so their keys are not in the type. */
function relationalQuery(schema: Built["schema"], table: string): RelationalQueryBuilder<TablesRelationalConfig, TableRelationalConfig> {
    const builder: unknown = Reflect.get(drizzle.mock({ schema }).query, table);
    if (!is(builder, RelationalQueryBuilder)) throw new Error(`drizzle built no relational query for "${table}"`);
    return builder;
}

const withSql = (schema: Built["schema"], table: string, relation: string): string =>
    relationalQuery(schema, table).findMany({ with: { [relation]: true } }).toSQL().sql;

describe("buildDrizzleRelationsFromCollections — hasOne", () => {
    it("builds a hasOne whose target declares nothing back, and drizzle accepts it", () => {
        const billing: CollectionConfig = {
            slug: "company_billing_config",
            table: "company_billing_config",
            name: "Billing configs",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                company_id: { name: "Company", type: "string" }
            }
        };
        const company: CollectionConfig = {
            slug: "company",
            table: "company",
            name: "Companies",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                billingConfig: {
                    name: "Billing config",
                    type: "relation",
                    relation: { kind: "hasOne", target: () => billing, foreignKeyOnTarget: "company_id" }
                }
            }
        };
        const { schema, relations } = build([company, billing], [
            { name: "company", columns: [] },
            { name: "company_billing_config", columns: ["company_id"] }
        ]);

        expect(Object.keys(relations).sort()).toEqual(["companyRelations", "company_billing_configRelations"]);
        expect(resolvedJoins(schema)).toEqual({
            "company.billingConfig": "company_billing_config.company_id = company.id",
            // The owning side the target never declared, so the pair is complete
            // from either end.
            "company_billing_config._synth_company_billing_config_company_id": "company.id = company_billing_config.company_id"
        });
        expect(relationNames(schema)).toEqual({
            "company.billingConfig": "company_billing_config_company_id",
            "company_billing_config._synth_company_billing_config_company_id": "company_billing_config_company_id"
        });

        expect(withSql(schema, "company", "billingConfig"))
            .toContain("\"company_billingConfig\".\"company_id\" = \"company\".\"id\"");
        expect(withSql(schema, "company_billing_config", "_synth_company_billing_config_company_id"))
            .toContain("\"company_billing_config__synth_company_billing_config_company_id\".\"id\" = \"company_billing_config\".\"company_id\"");
    });

    it("pairs a hasOne with the belongsTo its target declares, under one relationName", () => {
        const billing: CollectionConfig = {
            slug: "company_billing_config",
            table: "company_billing_config",
            name: "Billing configs",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                company: {
                    name: "Company",
                    type: "relation",
                    relation: { kind: "belongsTo", target: () => company, localKey: "company_id" }
                }
            }
        };
        const company: CollectionConfig = {
            slug: "company",
            table: "company",
            name: "Companies",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                billingConfig: {
                    name: "Billing config",
                    type: "relation",
                    relation: { kind: "hasOne", target: () => billing, foreignKeyOnTarget: "company_id" }
                }
            }
        };
        const { schema } = build([company, billing], [
            { name: "company", columns: [] },
            { name: "company_billing_config", columns: ["company_id"] }
        ]);

        // No `_synth_` beside the declared belongsTo: one owning side, one name.
        expect(resolvedJoins(schema)).toEqual({
            "company.billingConfig": "company_billing_config.company_id = company.id",
            "company_billing_config.company": "company.id = company_billing_config.company_id"
        });
        expect(relationNames(schema)).toEqual({
            "company.billingConfig": "company_billing_config_companyId",
            "company_billing_config.company": "company_billing_config_companyId"
        });

        expect(withSql(schema, "company", "billingConfig"))
            .toContain("\"company_billingConfig\".\"company_id\" = \"company\".\"id\"");
        expect(withSql(schema, "company_billing_config", "company"))
            .toContain("\"company_billing_config_company\".\"id\" = \"company_billing_config\".\"company_id\"");
    });

    it("keeps two hasOne relations to the same target apart", () => {
        const billing: CollectionConfig = {
            slug: "company_billing_config",
            table: "company_billing_config",
            name: "Billing configs",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                company: {
                    name: "Company",
                    type: "relation",
                    relation: { kind: "belongsTo", target: () => company, localKey: "company_id" }
                },
                backupCompany: {
                    name: "Backup company",
                    type: "relation",
                    relation: { kind: "belongsTo", target: () => company, localKey: "backup_company_id" }
                }
            }
        };
        const company: CollectionConfig = {
            slug: "company",
            table: "company",
            name: "Companies",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                billingConfig: {
                    name: "Billing config",
                    type: "relation",
                    relation: { kind: "hasOne", target: () => billing, foreignKeyOnTarget: "company_id" }
                },
                backupBillingConfig: {
                    name: "Backup billing config",
                    type: "relation",
                    relation: { kind: "hasOne", target: () => billing, foreignKeyOnTarget: "backup_company_id" }
                }
            }
        };
        const { schema } = build([company, billing], [
            { name: "company", columns: [] },
            { name: "company_billing_config", columns: ["company_id", "backup_company_id"] }
        ]);

        // Pairing by table alone is ambiguous here — the target has two links
        // back — so each side has to name its own columns.
        expect(resolvedJoins(schema)).toEqual({
            "company.billingConfig": "company_billing_config.company_id = company.id",
            "company.backupBillingConfig": "company_billing_config.backup_company_id = company.id",
            "company_billing_config.company": "company.id = company_billing_config.company_id",
            "company_billing_config.backupCompany": "company.id = company_billing_config.backup_company_id"
        });
        const names = relationNames(schema);
        expect(names["company.billingConfig"]).toBe(names["company_billing_config.company"]);
        expect(names["company.backupBillingConfig"]).toBe(names["company_billing_config.backupCompany"]);
        expect(names["company.billingConfig"]).not.toBe(names["company.backupBillingConfig"]);

        expect(withSql(schema, "company", "backupBillingConfig"))
            .toContain("\"company_backupBillingConfig\".\"backup_company_id\" = \"company\".\"id\"");
    });

    it("builds a self-referencing hasOne, with and without the belongsTo beside it", () => {
        const withMentor: CollectionConfig = {
            slug: "employees",
            table: "employees",
            name: "Employees",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                mentor: {
                    name: "Mentor",
                    type: "relation",
                    relation: { kind: "belongsTo", target: () => withMentor, localKey: "mentor_id" }
                },
                mentee: {
                    name: "Mentee",
                    type: "relation",
                    relation: { kind: "hasOne", target: () => withMentor, foreignKeyOnTarget: "mentor_id" }
                }
            }
        };
        const paired = build([withMentor], [{ name: "employees", columns: ["mentor_id"] }]);

        expect(resolvedJoins(paired.schema)).toEqual({
            "employees.mentor": "employees.id = employees.mentor_id",
            "employees.mentee": "employees.mentor_id = employees.id"
        });
        expect(withSql(paired.schema, "employees", "mentee"))
            .toContain("\"employees_mentee\".\"mentor_id\" = \"employees\".\"id\"");
        expect(withSql(paired.schema, "employees", "mentor"))
            .toContain("\"employees_mentor\".\"id\" = \"employees\".\"mentor_id\"");

        const menteeOnly: CollectionConfig = {
            slug: "employees",
            table: "employees",
            name: "Employees",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                mentee: {
                    name: "Mentee",
                    type: "relation",
                    relation: { kind: "hasOne", target: () => menteeOnly, foreignKeyOnTarget: "mentor_id" }
                }
            }
        };
        const alone = build([menteeOnly], [{ name: "employees", columns: ["mentor_id"] }]);

        expect(resolvedJoins(alone.schema)).toEqual({
            "employees.mentee": "employees.mentor_id = employees.id",
            "employees._synth_employees_mentorId": "employees.id = employees.mentor_id"
        });
    });

    it("joins a hasOne on its sourceKey rather than the primary key", () => {
        const billing: CollectionConfig = {
            slug: "company_billing_config",
            table: "company_billing_config",
            name: "Billing configs",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                company_ref: { name: "Company ref", type: "string" }
            }
        };
        const company: CollectionConfig = {
            slug: "company",
            table: "company",
            name: "Companies",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                external_ref: { name: "External ref", type: "string" },
                billingConfig: {
                    name: "Billing config",
                    type: "relation",
                    relation: {
                        kind: "hasOne",
                        target: () => billing,
                        foreignKeyOnTarget: "company_ref",
                        sourceKey: "external_ref"
                    }
                }
            }
        };
        const { schema } = build([company, billing], [
            { name: "company", columns: ["external_ref"] },
            { name: "company_billing_config", columns: ["company_ref"] }
        ]);

        expect(resolvedJoins(schema)).toEqual({
            "company.billingConfig": "company_billing_config.company_ref = company.external_ref",
            "company_billing_config._synth_company_billing_config_company_ref": "company.external_ref = company_billing_config.company_ref"
        });
    });
});
