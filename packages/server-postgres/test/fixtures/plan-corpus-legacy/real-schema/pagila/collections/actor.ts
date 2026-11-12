// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import filmCollection from "./film";

const actorCollection = defineCollection({
    name: "Actor",
    singularName: "Actor",
    slug: "actor",
    table: "actor",
    properties: {
        actorId: {
            name: "Actor Id",
            columnName: "actor_id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        firstName: {
            name: "First Name",
            columnName: "first_name",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
        lastName: {
            name: "Last Name",
            columnName: "last_name",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                required: true
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
    },
    relations: [
        {
            kind: "manyToMany",
            relationName: "film",
            target: (): AnyCollectionConfig => filmCollection,
            through: {
                table: "film_actor",
                sourceColumn: "actor_id",
                targetColumn: "film_id"
            }
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "firstName" },
        sort: ["lastUpdate", "desc"],
        propertiesOrder: [
            "actorId",
            "firstName",
            "lastName",
            "lastUpdate"
        ]
    }
});

export default actorCollection;
