// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import activeStorageAttachmentsCollection from "./active_storage_attachments";
import activeStorageVariantRecordsCollection from "./active_storage_variant_records";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "key" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "filename" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "content_type" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "checksum" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "created_at" is timestamp without time zone; a date property stores timestamptz, date or time, so a push would plan converting it to timestamptz (and ask before applying it).
//   - "service_name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const activeStorageBlobsCollection = defineCollection({
    name: "Active Storage Blobs",
    singularName: "Active Storage Blob",
    slug: "active_storage_blobs",
    table: "active_storage_blobs",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        filename: {
            name: "Filename",
            columnName: "filename",
            type: "string",
            validation: {
                required: true
            },
        },
        serviceName: {
            name: "Service Name",
            columnName: "service_name",
            type: "string",
            validation: {
                required: true
            },
        },
        key: {
            name: "Key",
            columnName: "key",
            type: "string",
            validation: {
                required: true,
                unique: true
            },
        },
        contentType: {
            name: "Content Type",
            columnName: "content_type",
            type: "string",
        },
        checksum: {
            name: "Checksum",
            columnName: "checksum",
            type: "string",
        },
        byteSize: {
            name: "Byte Size",
            columnName: "byte_size",
            type: "number",
            columnType: "bigint",
            validation: {
                required: true
            },
        },
        metadata: {
            name: "Metadata",
            columnName: "metadata",
            type: "string",
            admin: {
                multiline: true
            },
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
            relationName: "active_storage_attachments",
            target: (): AnyCollectionConfig => activeStorageAttachmentsCollection,
            // the active_storage_attachments.blob_id FK points back here
            foreignKeyOnTarget: "blob_id"
        },
        {
            kind: "hasMany",
            relationName: "active_storage_variant_records",
            target: (): AnyCollectionConfig => activeStorageVariantRecordsCollection,
            // the active_storage_variant_records.blob_id FK points back here
            foreignKeyOnTarget: "blob_id"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "key" },
        listProperties: [
            "id",
            "filename",
            "serviceName",
            "key",
            "contentType",
            "checksum"
        ],
        propertiesOrder: [
            "id",
            "filename",
            "serviceName",
            "key",
            "contentType",
            "checksum",
            "byteSize",
            "metadata",
            "createdAt"
        ]
    }
});

export default activeStorageBlobsCollection;
