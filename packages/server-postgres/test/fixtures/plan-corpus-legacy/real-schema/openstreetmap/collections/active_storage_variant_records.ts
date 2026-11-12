// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import activeStorageBlobsCollection from "./active_storage_blobs";

// Introspected as an owned-child: belongs to active_storage_blobs (its only NOT NULL foreign key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "variation_digest" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const activeStorageVariantRecordsCollection = defineCollection({
    name: "Active Storage Variant Records",
    singularName: "Active Storage Variant Record",
    slug: "active_storage_variant_records",
    table: "active_storage_variant_records",
    properties: {
        id: {
            name: "Id",
            columnName: "id",
            type: "number",
            isId: "manual",
            columnType: "bigserial",
        },
        variationDigest: {
            name: "Variation Digest",
            columnName: "variation_digest",
            type: "string",
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
    },
    admin: {
        icon: "Database",
        hideFromNavigation: true,
        display: { title: "variationDigest" },
        propertiesOrder: [
            "id",
            "variationDigest",
            "blob"
        ]
    }
});

export default activeStorageVariantRecordsCollection;
