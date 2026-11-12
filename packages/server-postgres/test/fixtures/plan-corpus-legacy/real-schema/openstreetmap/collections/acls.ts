// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "address" is inet, which no property type stores; it is read as text, and a push would plan converting the column to text.
//   - "k" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "v" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "domain" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "mx" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const aclsCollection = defineCollection({
    name: "Acls",
    singularName: "Acl",
    slug: "acls",
    table: "acls",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        address: {
            name: "Address",
            columnName: "address",
            type: "string",
        },
        k: {
            name: "K",
            columnName: "k",
            type: "string",
            validation: {
                required: true
            },
        },
        v: {
            name: "V",
            columnName: "v",
            type: "string",
        },
        domain: {
            name: "Domain",
            columnName: "domain",
            type: "string",
        },
        mx: {
            name: "Mx",
            columnName: "mx",
            type: "string",
        },
    },
    admin: {
        icon: "Database",
        display: { title: "k" },
        propertiesOrder: [
            "id",
            "address",
            "k",
            "v",
            "domain",
            "mx"
        ]
    }
});

export default aclsCollection;
