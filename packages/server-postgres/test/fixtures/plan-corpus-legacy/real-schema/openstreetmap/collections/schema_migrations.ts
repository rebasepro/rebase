// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "version" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const schemaMigrationsCollection = defineCollection({
    name: "Schema Migrations",
    singularName: "Schema Migration",
    slug: "schema_migrations",
    table: "schema_migrations",
    properties: {
        version: {
            name: "Version",
            columnName: "version",
            type: "string",
            isId: "manual",
        },
    },
    admin: {
        icon: "Database",
        propertiesOrder: [
            "version"
        ]
    }
});

export default schemaMigrationsCollection;
