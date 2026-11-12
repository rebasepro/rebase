// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";
import type { AnyCollectionConfig } from "../../../legacy-model";
import diaryEntriesCollection from "./diary_entries";

// ⚠ Not reproduced exactly by `rebase db push` — read before pushing:
//   - "code" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "english_name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.
//   - "native_name" is a varchar with no length, declared as text: a push would plan converting it to text, which keeps every value.

const languagesCollection = defineCollection({
    name: "Languages",
    singularName: "Language",
    slug: "languages",
    table: "languages",
    properties: {
        code: {
            name: "Code",
            columnName: "code",
            type: "string",
            isId: "manual",
        },
        englishName: {
            name: "English Name",
            columnName: "english_name",
            type: "string",
            validation: {
                required: true
            },
        },
        nativeName: {
            name: "Native Name",
            columnName: "native_name",
            type: "string",
        },
    },
    relations: [
        {
            kind: "hasMany",
            relationName: "diary_entries",
            target: (): AnyCollectionConfig => diaryEntriesCollection,
            // the diary_entries.language_code FK points back here
            foreignKeyOnTarget: "language_code"
        },
    ],
    admin: {
        icon: "Database",
        display: { title: "englishName" },
        propertiesOrder: [
            "code",
            "englishName",
            "nativeName"
        ]
    }
});

export default languagesCollection;
