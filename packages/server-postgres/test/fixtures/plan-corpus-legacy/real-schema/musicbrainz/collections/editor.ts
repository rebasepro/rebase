// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import areaCollection from "./area";
import areaTagRawCollection from "./area_tag_raw";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "email" defaults to NULL::character varying, which no `defaultValue` can express; a push would plan dropping that default.
//   - "website" defaults to NULL::character varying, which no `defaultValue` can express; a push would plan dropping that default.

const editorCollection = defineCollection({
    name: "Editor",
    singularName: "Editor",
    slug: "editor",
    table: "editor",
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
            columnType: "varchar",
            validation: {
                required: true,
                max: 64
            },
        },
        email: {
            name: "Email",
            columnName: "email",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 64
            },
        },
        website: {
            name: "Website",
            columnName: "website",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 255
            },
        },
        password: {
            name: "Password",
            columnName: "password",
            type: "string",
            columnType: "varchar",
            validation: {
                required: true,
                max: 128
            },
        },
        ha1: {
            name: "Ha1",
            columnName: "ha1",
            type: "string",
            columnType: "char",
            validation: {
                required: true,
                max: 32
            },
        },
        deleted: {
            name: "Deleted",
            columnName: "deleted",
            type: "boolean",
            defaultValue: false,
            validation: {
                required: true
            },
        },
        privs: {
            name: "Privs",
            columnName: "privs",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
        },
        gender: {
            name: "Gender",
            columnName: "gender",
            type: "number",
            columnType: "integer",
        },
        memberSince: {
            name: "Member Since",
            columnName: "member_since",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
        },
        emailConfirmDate: {
            name: "Email Confirm Date",
            columnName: "email_confirm_date",
            type: "date",
        },
        lastLoginDate: {
            name: "Last Login Date",
            columnName: "last_login_date",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
        },
        lastUpdated: {
            name: "Last Updated",
            columnName: "last_updated",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true
            },
        },
        birthDate: {
            name: "Birth Date",
            columnName: "birth_date",
            type: "date",
            columnType: "date",
        },
        area: {
            name: "Area",
            type: "relation",
            // mapped from foreign key: area -> area(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => areaCollection,
                localKey: "area",
                onDelete: "no action"
            }
        },
        bio: {
            name: "Bio",
            columnName: "bio",
            type: "string",
            admin: {
                multiline: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "area_tag_raw",
            target: (): AnyCollectionConfig => areaTagRawCollection,
            // the area_tag_raw.editor FK points back here
            foreignKeyOnTarget: "editor"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "name" },
        listProperties: [
            "id",
            "name",
            "email",
            "website",
            "password",
            "ha1"
        ],
        propertiesOrder: [
            "id",
            "name",
            "email",
            "website",
            "password",
            "ha1",
            "deleted",
            "privs",
            "gender",
            "memberSince",
            "emailConfirmDate",
            "lastLoginDate",
            "lastUpdated",
            "birthDate",
            "area",
            "bio"
        ]
    }
});

export default editorCollection;
