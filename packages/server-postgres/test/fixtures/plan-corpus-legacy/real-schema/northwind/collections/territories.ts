// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import regionCollection from "./region";
import employeesCollection from "./employees";

const territoriesCollection = defineCollection({
    name: "Territories",
    singularName: "Territory",
    slug: "territories",
    table: "territories",
    properties: {
        territoryId: {
            name: "Territory Id",
            columnName: "territory_id",
            type: "string",
            validation: {
                max: 20
            },
            isId: "manual",
            columnType: "varchar",
        },
        territoryDescription: {
            name: "Territory Description",
            columnName: "territory_description",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 60
            },
        },
        region: {
            name: "Region",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: region_id -> region(region_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => regionCollection,
                localKey: "region_id",
                onDelete: "no action"
            }
        },
    },
    relations: [
        {
            kind: "manyToMany",
            relationName: "employees",
            target: (): AnyCollectionConfig => employeesCollection,
            through: {
                table: "employee_territories",
                sourceColumn: "territory_id",
                targetColumn: "employee_id"
            }
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "territoryDescription" },
        propertiesOrder: [
            "territoryId",
            "territoryDescription",
            "region"
        ]
    }
});

export default territoriesCollection;
