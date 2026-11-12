// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import languageCollection from "./language";
import inventoryCollection from "./inventory";
import actorCollection from "./actor";
import categoryCollection from "./category";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "rental_duration" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "length" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "rating" uses the enum type "mpaa_rating", and Rebase names a column's enum type <table>_<column>. Rename it before pushing: ALTER TYPE "mpaa_rating" RENAME TO "film_rating";

const filmCollection = defineCollection({
    name: "Film",
    singularName: "Film",
    slug: "film",
    table: "film",
    properties: {
        filmId: {
            name: "Film Id",
            columnName: "film_id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        title: {
            name: "Title",
            columnName: "title",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
        rating: {
            name: "Rating",
            columnName: "rating",
            type: "string",
            enum: [{ id: "G", label: "G" }, { id: "PG", label: "PG" }, { id: "PG-13", label: "PG-13" }, { id: "R", label: "R" }, { id: "NC-17", label: "NC-17" }],
            defaultValue: "G",
        },
        fulltext: {
            name: "Fulltext",
            columnName: "fulltext",
            type: "string",
            admin: {
                readOnly: true,
                hideFromCollection: true
            },
        },
        releaseYear: {
            name: "Release Year",
            columnName: "release_year",
            type: "number",
            columnType: "integer",
        },
        rentalDuration: {
            name: "Rental Duration",
            columnName: "rental_duration",
            type: "number",
            columnType: "integer",
            defaultValue: 3,
            validation: {
                required: true
            },
        },
        rentalRate: {
            name: "Rental Rate",
            columnName: "rental_rate",
            type: "number",
            precision: 4,
            scale: 2,
            defaultValue: 4.99,
            validation: {
                required: true
            },
        },
        length: {
            name: "Length",
            columnName: "length",
            type: "number",
            columnType: "integer",
        },
        replacementCost: {
            name: "Replacement Cost",
            columnName: "replacement_cost",
            type: "number",
            precision: 5,
            scale: 2,
            defaultValue: 19.99,
            validation: {
                required: true
            },
        },
        lengthHours: {
            name: "Length Hours",
            columnName: "length_hours",
            type: "number",
            admin: {
                readOnly: true
            },
        },
        lastUpdate: {
            name: "Last Update",
            columnName: "last_update",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
            validation: {
                required: true
            },
        },
        language: {
            name: "Language",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: language_id -> language(language_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => languageCollection,
                localKey: "language_id"
            }
        },
        originalLanguage: {
            name: "OriginalLanguage",
            type: "relation",
            // mapped from foreign key: original_language_id -> language(language_id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => languageCollection,
                localKey: "original_language_id",
                onDelete: "restrict"
            }
        },
        description: {
            name: "Description",
            columnName: "description",
            type: "string",
            admin: {
                multiline: true
            },
        },
        specialFeatures: {
            name: "Special Features",
            columnName: "special_features",
            type: "array",
            columnType: "text[]",
            of: { name: "Special Features Item", type: "string" },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "inventory",
            target: (): AnyCollectionConfig => inventoryCollection,
            // the inventory.film_id FK points back here
            foreignKeyOnTarget: "film_id"
        },
        {
            kind: "manyToMany",
            relationName: "actor",
            target: (): AnyCollectionConfig => actorCollection,
            through: {
                table: "film_actor",
                sourceColumn: "film_id",
                targetColumn: "actor_id"
            }
        },
        {
            kind: "manyToMany",
            relationName: "category",
            target: (): AnyCollectionConfig => categoryCollection,
            through: {
                table: "film_category",
                sourceColumn: "film_id",
                targetColumn: "category_id"
            }
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "title" },
        sort: ["lastUpdate", "desc"],
        listProperties: [
            "filmId",
            "title",
            "rating",
            "releaseYear",
            "rentalDuration",
            "rentalRate"
        ],
        propertiesOrder: [
            "filmId",
            "title",
            "rating",
            "fulltext",
            "releaseYear",
            "rentalDuration",
            "rentalRate",
            "length",
            "replacementCost",
            "lengthHours",
            "lastUpdate",
            "language",
            "originalLanguage",
            "description",
            "specialFeatures"
        ]
    }
});

export default filmCollection;
