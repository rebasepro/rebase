// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "member_type" uses the enum type "nwr_enum", which other columns share; Rebase gives each column its own type (<table>_<column>), so a push would plan "relation_members_member_type" and a conversion Postgres cannot cast.
//   - "member_role" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const relationMembersCollection = defineCollection({
    name: "Relation Members",
    singularName: "Relation Member",
    slug: "relation_members",
    table: "relation_members",
    properties: {
        relationId: {
            name: "Relation Id",
            columnName: "relation_id",
            type: "number",
            // Part of composite primary key (relation_id, version, sequence_id)
            isId: "manual",
            columnType: "bigint",
        },
        version: {
            name: "Version",
            columnName: "version",
            type: "number",
            // Part of composite primary key (relation_id, version, sequence_id)
            isId: "sql`0`",
            columnType: "bigint",
        },
        sequenceId: {
            name: "Sequence Id",
            columnName: "sequence_id",
            type: "number",
            // Part of composite primary key (relation_id, version, sequence_id)
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
    },
    admin: {
        icon: "Users",
        display: { title: "memberRole" },
        // A board over "memberType" fits this table, but a board needs a string column to keep each card's order in. Add one, then declare kanban: { columnProperty: "memberType" } and orderProperty: "<that property>".,
        propertiesOrder: [
            "relationId",
            "version",
            "sequenceId",
            "memberType",
            "memberRole",
            "memberId"
        ]
    }
});

export default relationMembersCollection;
