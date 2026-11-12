// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import currentRelationsCollection from "./current_relations";

// Introspected as an owned-child: belongs to current_relations (its only foreign key inside the primary key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "member_type" uses the enum type "nwr_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "current_relation_members_member_type" and a conversion Postgres cannot cast.
//   - "member_role" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const currentRelationMembersCollection = defineCollection({
    name: "Current Relation Members",
    singularName: "Current Relation Member",
    slug: "current_relation_members",
    table: "current_relation_members",
    properties: {
        relationId: {
            name: "Relation Id",
            columnName: "relation_id",
            type: "number",
            // Part of composite primary key (relation_id, sequence_id)
            isId: "manual",
            columnType: "bigint",
        },
        sequenceId: {
            name: "Sequence Id",
            columnName: "sequence_id",
            type: "number",
            // Part of composite primary key (relation_id, sequence_id)
            isId: "sql`0`",
            columnType: "integer",
        },
        memberType: {
            name: "Member Type",
            columnName: "member_type",
            type: "string",
            enum: [{ id: "Node", label: "Node" }, { id: "Way", label: "Way" }, { id: "Relation", label: "Relation" }],
            validation: {
                required: true
            },
        },
        memberRole: {
            name: "Member Role",
            columnName: "member_role",
            type: "string",
            validation: {
                required: true
            },
        },
        memberId: {
            name: "Member Id",
            columnName: "member_id",
            type: "number",
            columnType: "bigint",
            validation: {
                required: true
            },
        },
        relation: {
            name: "Relation",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: relation_id -> current_relations(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => currentRelationsCollection,
                localKey: "relation_id",
                onDelete: "no action"
            }
        },
    },
    admin: {
        icon: "Users",
        hideFromNavigation: true,
        display: { title: "memberRole" },
        // A board over "memberType" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "memberType" } and orderProperty: "<that property>".,
        propertiesOrder: [
            "relationId",
            "sequenceId",
            "memberType",
            "memberRole",
            "memberId",
            "relation"
        ]
    }
});

export default currentRelationMembersCollection;
