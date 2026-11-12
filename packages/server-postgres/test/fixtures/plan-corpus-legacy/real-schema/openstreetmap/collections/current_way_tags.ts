// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import currentWaysCollection from "./current_ways";

// Introspected as an owned-child: belongs to current_ways (its only foreign key inside the primary key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "k" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "v" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const currentWayTagsCollection = defineCollection({
    name: "Current Way Tags",
    singularName: "Current Way Tag",
    slug: "current_way_tags",
    table: "current_way_tags",
    properties: {
        wayId: {
            name: "Way Id",
            columnName: "way_id",
            type: "number",
            // Part of composite primary key (way_id, k)
            isId: "manual",
            columnType: "bigint",
        },
        k: {
            name: "K",
            columnName: "k",
            type: "string",
            // Part of composite primary key (way_id, k)
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
        way: {
            name: "Way",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: way_id -> current_ways(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => currentWaysCollection,
                localKey: "way_id",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "Tag",
        hideFromNavigation: true,
        display: { title: "v" },
        propertiesOrder: [
            "wayId",
            "k",
            "v",
            "way"
        ]
    }
});

export default currentWayTagsCollection;
