// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import artistCollection from "./artist";
import artistCreditCollection from "./artist_credit";

// Introspected as an owned-child: belongs to artist_credit (its only foreign key inside the primary key) and nothing else references it.

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const artistCreditNameCollection = defineCollection({
    name: "Artist Credit Name",
    singularName: "Artist Credit Name",
    slug: "artist_credit_name",
    table: "artist_credit_name",
    properties: {
        artistCredit: {
            name: "Artist Credit",
            columnName: "artist_credit",
            type: "number",
            // Part of composite primary key (artist_credit, position)
            isId: "manual",
            columnType: "integer",
        },
        position: {
            name: "Position",
            columnName: "position",
            type: "number",
            // Part of composite primary key (artist_credit, position)
            isId: "manual",
        },
        name: {
            name: "Name",
            columnName: "name",
            type: "string",
            validation: {
                required: true
            },
        },
        artist: {
            name: "Artist",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: artist -> artist(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => artistCollection,
                localKey: "artist",
                onDelete: "cascade"
            }
        },
        artistCreditRelation: {
            name: "ArtistCreditRelation",
            type: "relation",
            validation: { required: true },
            // mapped from foreign key: artist_credit -> artist_credit(id)
            relation: {
                kind: "belongsTo",
                target: (): AnyCollectionConfig => artistCreditCollection,
                localKey: "artist_credit",
                onDelete: "cascade"
            }
        },
        joinPhrase: {
            name: "Join Phrase",
            columnName: "join_phrase",
            type: "string",
            admin: {
                multiline: true
            },
            defaultValue: "",
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
            "artistCredit",
            "position",
            "name",
            "artist",
            "artistCreditRelation",
            "joinPhrase"
        ]
    }
});

export default artistCreditNameCollection;
