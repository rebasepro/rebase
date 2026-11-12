// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import artistCreditNameCollection from "./artist_credit_name";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "artist_count" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).

const artistCreditCollection = defineCollection({
    name: "Artist Credit",
    singularName: "Artist Credit",
    slug: "artist_credit",
    table: "artist_credit",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            validation: {
                required: true
            },
        },
        gid: {
            name: "Gid",
            columnName: "gid",
            type: "string",
            columnType: "uuid",
            validation: {
                required: true
            },
        },
        artistCount: {
            name: "Artist Count",
            columnName: "artist_count",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        refCount: {
            name: "Ref Count",
            columnName: "ref_count",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
        },
        editsPending: {
            name: "Edits Pending",
            columnName: "edits_pending",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
            validation: {
                required: true,
                min: 0
            },
        },
        created: {
            name: "Created",
            columnName: "created",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "artist_credit_name",
            target: (): AnyCollectionConfig => artistCreditNameCollection,
            // the artist_credit_name.artist_credit FK points back here
            foreignKeyOnTarget: "artist_credit"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "name" },
        sort: ["created", "desc"],
        listProperties: [
            "id",
            "name",
            "gid",
            "artistCount",
            "refCount",
            "editsPending"
        ],
        propertiesOrder: [
            "id",
            "name",
            "gid",
            "artistCount",
            "refCount",
            "editsPending",
            "created"
        ]
    }
});

export default artistCreditCollection;
