// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import constraintShapesChildCollection from "./constraint_shapes_child";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "rating" is smallint, which no `columnType` names; it is declared integer, so a push widens it (every value survives).
//   - "status" is text with CHECK (… IN …), declared here as an `enum`, which Rebase stores as the enum type "constraint_shapes_status". Convert the column before pushing: CREATE TYPE "constraint_shapes_status" AS ENUM ('draft', 'published', 'archived'); ALTER TABLE "constraint_shapes" DROP CONSTRAINT "constraint_shapes_status_check", ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "constraint_shapes_status" USING "status"::"constraint_shapes_status"; — or delete the `enum` to keep the column as it is.
//   - "tier" is text with CHECK (… IN …), declared here as an `enum`, which Rebase stores as the enum type "constraint_shapes_tier". Convert the column before pushing: CREATE TYPE "constraint_shapes_tier" AS ENUM ('free', 'pro', 'enterprise'); ALTER TABLE "constraint_shapes" DROP CONSTRAINT "constraint_shapes_tier_check", ALTER COLUMN "tier" DROP DEFAULT, ALTER COLUMN "tier" TYPE "constraint_shapes_tier" USING "tier"::"constraint_shapes_tier"; — or delete the `enum` to keep the column as it is.
//   - "visibility" is text with CHECK (… IN …), declared here as an `enum`, which Rebase stores as the enum type "constraint_shapes_visibility". Convert the column before pushing: CREATE TYPE "constraint_shapes_visibility" AS ENUM ('public', 'private'); ALTER TABLE "constraint_shapes" DROP CONSTRAINT "constraint_shapes_visibility_check", ALTER COLUMN "visibility" DROP DEFAULT, ALTER COLUMN "visibility" TYPE "constraint_shapes_visibility" USING "visibility"::"constraint_shapes_visibility"; — or delete the `enum` to keep the column as it is.
//   - "pinned_kind" is text with CHECK (… IN …), declared here as an `enum`, which Rebase stores as the enum type "constraint_shapes_pinned_kind". Convert the column before pushing: CREATE TYPE "constraint_shapes_pinned_kind" AS ENUM ('only-one'); ALTER TABLE "constraint_shapes" DROP CONSTRAINT "constraint_shapes_pinned_kind_check", ALTER COLUMN "pinned_kind" DROP DEFAULT, ALTER COLUMN "pinned_kind" TYPE "constraint_shapes_pinned_kind" USING "pinned_kind"::"constraint_shapes_pinned_kind"; — or delete the `enum` to keep the column as it is.
//   - "apostrophe_set" is text with CHECK (… IN …), declared here as an `enum`, which Rebase stores as the enum type "constraint_shapes_apostrophe_set". Convert the column before pushing: CREATE TYPE "constraint_shapes_apostrophe_set" AS ENUM ('it''s', 'won''t'); ALTER TABLE "constraint_shapes" DROP CONSTRAINT "constraint_shapes_apostrophe_set_check", ALTER COLUMN "apostrophe_set" DROP DEFAULT, ALTER COLUMN "apostrophe_set" TYPE "constraint_shapes_apostrophe_set" USING "apostrophe_set"::"constraint_shapes_apostrophe_set"; — or delete the `enum` to keep the column as it is.

const constraintShapesCollection = defineCollection({
    name: "Constraint Shapes",
    singularName: "Constraint Shape",
    slug: "constraint_shapes",
    table: "constraint_shapes",
    description: "Every CHECK shape the parser is expected to handle.",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "integer",
        },
        email: {
            name: "Email",
            columnName: "email",
            type: "string",
            admin: {
                multiline: true
            },
        },
        slug: {
            name: "Slug",
            columnName: "slug",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                min: 3,
                max: 64
            },
        },
        code: {
            name: "Code",
            columnName: "code",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                max: 10
            },
        },
        status: {
            name: "Status",
            columnName: "status",
            type: "string",
            description: "Publication state.",
            enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }, { id: "archived", label: "Archived" }],
            admin: {
                multiline: true
            },
            validation: {
                required: true
            },
        },
        tier: {
            name: "Tier",
            columnName: "tier",
            type: "string",
            enum: [{ id: "free", label: "Free" }, { id: "pro", label: "Pro" }, { id: "enterprise", label: "Enterprise" }],
            columnType: "varchar",
            validation: {
                max: 20
            },
        },
        search: {
            name: "Search",
            columnName: "search",
            type: "string",
            admin: {
                readOnly: true,
                hideFromCollection: true
            },
        },
        price: {
            name: "Price",
            columnName: "price",
            type: "number",
            description: "Unit price, before tax.",
            validation: {
                required: true,
                moreThan: 0
            },
        },
        discount: {
            name: "Discount",
            columnName: "discount",
            type: "number",
            columnType: "real",
            validation: {
                min: 0,
                max: 1
            },
        },
        quantity: {
            name: "Quantity",
            columnName: "quantity",
            type: "number",
            columnType: "integer",
            validation: {
                min: 1,
                max: 1000
            },
        },
        rating: {
            name: "Rating",
            columnName: "rating",
            type: "number",
            columnType: "integer",
            validation: {
                min: 1,
                max: 5
            },
        },
        temperature: {
            name: "Temperature",
            columnName: "temperature",
            type: "number",
            columnType: "integer",
            validation: {
                moreThan: -50,
                lessThan: 60
            },
        },
        exactCount: {
            name: "Exact Count",
            columnName: "exact_count",
            type: "number",
            columnType: "integer",
            validation: {
                min: 42,
                max: 42
            },
        },
        percent: {
            name: "Percent",
            columnName: "percent",
            type: "number",
            precision: 5,
            scale: 2,
            validation: {
                min: 0,
                max: 100
            },
        },
        startDay: {
            name: "Start Day",
            columnName: "start_day",
            type: "number",
            columnType: "integer",
        },
        endDay: {
            name: "End Day",
            columnName: "end_day",
            type: "number",
            columnType: "integer",
        },
        eitherWay: {
            name: "Either Way",
            columnName: "either_way",
            type: "number",
            columnType: "integer",
        },
        computedTotal: {
            name: "Computed Total",
            columnName: "computed_total",
            type: "number",
            admin: {
                readOnly: true
            },
        },
        visibility: {
            name: "Visibility",
            columnName: "visibility",
            type: "string",
            enum: [{ id: "public", label: "Public" }, { id: "private", label: "Private" }],
            admin: {
                multiline: true
            },
        },
        pinnedKind: {
            name: "Pinned Kind",
            columnName: "pinned_kind",
            type: "string",
            enum: [{ id: "only-one", label: "Only-One" }],
            admin: {
                multiline: true
            },
        },
        apostropheSet: {
            name: "Apostrophe Set",
            columnName: "apostrophe_set",
            type: "string",
            enum: [{ id: "it's", label: "It'S" }, { id: "won't", label: "Won'T" }],
            admin: {
                multiline: true
            },
        },
        fixedLen: {
            name: "Fixed Len",
            columnName: "fixed_len",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                min: 8,
                max: 8
            },
        },
        notReserved: {
            name: "Not Reserved",
            columnName: "not_reserved",
            type: "string",
            admin: {
                multiline: true
            },
        },
        emailUnique: {
            name: "Email Unique",
            columnName: "email_unique",
            type: "string",
            admin: {
                multiline: true
            },
            validation: {
                unique: true
            },
        },
        payload: {
            name: "Payload",
            columnName: "payload",
            type: "map",
            keyValue: true,
        },
        createdAt: {
            name: "Created At",
            columnName: "created_at",
            type: "date",
            autoValue: "on_create",
            admin: {
                readOnly: true,
                hideFromCollection: true
            },
            validation: {
                required: true
            },
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "constraint_shapes_child",
            target: (): AnyCollectionConfig => constraintShapesChildCollection,
            // the constraint_shapes_child.parent_id FK points back here
            foreignKeyOnTarget: "parent_id"
        },
    ],
    admin: {
        icon: "Database",
        // A board over "status" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "status" } and orderProperty: "<that property>".,
        sort: ["createdAt", "desc"],
        listProperties: [
            "id",
            "email",
            "slug",
            "code",
            "status",
            "tier"
        ],
        propertiesOrder: [
            "id",
            "email",
            "slug",
            "code",
            "status",
            "tier",
            "search",
            "price",
            "discount",
            "quantity",
            "rating",
            "temperature",
            "exactCount",
            "percent",
            "startDay",
            "endDay",
            "eitherWay",
            "computedTotal",
            "visibility",
            "pinnedKind",
            "apostropheSet",
            "fixedLen",
            "notReserved",
            "emailUnique",
            "payload",
            "createdAt"
        ]
    }
});

export default constraintShapesCollection;
