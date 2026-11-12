// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import usersCollection from "./users";
import issueCommentsCollection from "./issue_comments";
import reportsCollection from "./reports";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "reportable_type" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "status" uses the enum type "issue_status_enum", and Rebase names a column's enum type <table>_<column>. Rename it before pushing: ALTER TYPE "issue_status_enum" RENAME TO "issues_status";
//   - "assigned_role" uses the enum type "user_role_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "issues_assigned_role" and a conversion Postgres cannot cast.
//   - "resolved_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "updated_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const issuesCollection = defineCollection({
    name: "Issues",
    singularName: "Issue",
    slug: "issues",
    table: "issues",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "serial",
        },
        status: {
            name: "Status",
            columnName: "status",
            type: "string",
            enum: [{ id: "open", label: "Open" }, { id: "ignored", label: "Ignored" }, { id: "resolved", label: "Resolved" }],
            defaultValue: "open",
            validation: {
                required: true
            },
        },
        assignedRole: {
            name: "Assigned Role",
            columnName: "assigned_role",
            type: "string",
            enum: [{ id: "administrator", label: "Administrator" }, { id: "moderator", label: "Moderator" }, { id: "importer", label: "Importer" }],
            validation: {
                required: true
            },
        },
        reportableType: {
            name: "Reportable Type",
            columnName: "reportable_type",
            type: "string",
            validation: {
                required: true
            },
        },
        reportableId: {
            name: "Reportable Id",
            columnName: "reportable_id",
            type: "number",
            columnType: "integer",
            validation: {
                required: true
            },
        },
        reportsCount: {
            name: "Reports Count",
            columnName: "reports_count",
            type: "number",
            columnType: "integer",
            defaultValue: 0,
        },
        resolvedAt: {
            name: "Resolved At",
            columnName: "resolved_at",
            type: "date",
        },
        reportedUser: {
            name: "ReportedUser",
            type: "relation",
            // mapped from foreign key: reported_user_id -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "reported_user_id",
                onDelete: "no action"
            }
        },
        resolvedBy: {
            name: "ResolvedBy",
            type: "relation",
            // mapped from foreign key: resolved_by -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "resolved_by",
                onDelete: "no action"
            }
        },
        updatedBy: {
            name: "UpdatedBy",
            type: "relation",
            // mapped from foreign key: updated_by -> users(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => usersCollection,
                localKey: "updated_by",
                onDelete: "no action"
            }
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
        updatedAt: {
            name: "Updated At",
            columnName: "updated_at",
            type: "date",
            autoValue: "on_update",
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
            relationName: "issue_comments",
            target: (): AnyCollectionConfig => issueCommentsCollection,
            // the issue_comments.issue_id FK points back here
            foreignKeyOnTarget: "issue_id"
        },
        {
            kind: "hasMany",
            relationName: "reports",
            target: (): AnyCollectionConfig => reportsCollection,
            // the reports.issue_id FK points back here
            foreignKeyOnTarget: "issue_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "reportableType" },
        // A board over "status" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "status" } and orderProperty: "<that property>".,
        listProperties: [
            "id",
            "status",
            "assignedRole",
            "reportableType",
            "reportableId",
            "reportsCount"
        ],
        propertiesOrder: [
            "id",
            "status",
            "assignedRole",
            "reportableType",
            "reportableId",
            "reportsCount",
            "resolvedAt",
            "reportedUser",
            "resolvedBy",
            "updatedBy",
            "createdAt",
            "updatedAt"
        ]
    }
});

export default issuesCollection;
