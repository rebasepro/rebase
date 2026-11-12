// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import activeStorageBlobsCollection from "./active_storage_blobs";

// Introspected as an owned-child: belongs to active_storage_blobs (its only NOT NULL foreign key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "record_type" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).

const activeStorageAttachmentsCollection = defineCollection({
    name: "Active Storage Attachments",
    singularName: "Active Storage Attachment",
    slug: "active_storage_attachments",
    table: "active_storage_attachments",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            validation: {
                required: true
            },
        },
        recordType: {
            name: "Record Type",
            columnName: "record_type",
            type: "string",
            validation: {
                required: true
            },
        },
        recordId: {
            name: "Record Id",
            columnName: "record_id",
            type: "number",
            columnType: "bigint",
            validation: {
                required: true
            },
        },
        blob: {
            name: "Blob",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: blob_id -> active_storage_blobs(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => activeStorageBlobsCollection,
                localKey: "blob_id",
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
    },
    admin: {
        icon: "Database",
        hideFromNavigation: true,
        display: { title: "name" },
        propertiesOrder: [
            "id",
            "name",
            "recordType",
            "recordId",
            "blob",
            "createdAt"
        ]
    }
});

export default activeStorageAttachmentsCollection;
