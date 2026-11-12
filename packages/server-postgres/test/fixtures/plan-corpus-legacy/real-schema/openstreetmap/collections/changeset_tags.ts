// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import changesetsCollection from "./changesets";

// Introspected as an owned-child: belongs to changesets (its only foreign key inside the primary key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "k" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "v" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const changesetTagsCollection = defineCollection({
    name: "Changeset Tags",
    singularName: "Changeset Tag",
    slug: "changeset_tags",
    table: "changeset_tags",
    properties: {
        changesetId: {
            name: "Changeset Id",
            columnName: "changeset_id",
            type: "number",
            // Part of composite primary key (changeset_id, k)
            isId: "manual",
            columnType: "bigint",
        },
        k: {
            name: "K",
            columnName: "k",
            type: "string",
            // Part of composite primary key (changeset_id, k)
            isId: "sql`''::character varying`",
        },
        v: {
            name: "V",
            columnName: "v",
            type: "string",
            defaultValue: "",
            validation: {
                required: true
            },
        },
        changeset: {
            name: "Changeset",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: changeset_id -> changesets(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => changesetsCollection,
                localKey: "changeset_id",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "Tag",
        hideFromNavigation: true,
        display: { title: "v" },
        propertiesOrder: [
            "changesetId",
            "k",
            "v",
            "changeset"
        ]
    }
});

export default changesetTagsCollection;
