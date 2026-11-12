// @ts-nocheck — a frozen legacy input of the plan-golden corpus: see plan-corpus-legacy/legacy-model.ts.
import { defineCollection } from "../../../legacy-model";

const usStatesCollection = defineCollection({
    name: "Us States",
    singularName: "Us State",
    slug: "us_states",
    table: "us_states",
    properties: {
        stateId: {
            name: "State Id",
            columnName: "state_id",
            type: "number",
            isId: "manual",
        },
        stateName: {
            name: "State Name",
            columnName: "state_name",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 100
            },
        },
        stateAbbr: {
            name: "State Abbr",
            columnName: "state_abbr",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 2
            },
        },
        stateRegion: {
            name: "State Region",
            columnName: "state_region",
            type: "string",
            columnType: "varchar",
            validation: {
                max: 50
            },
        },
    },
    admin: {
        icon: "Database",
        propertiesOrder: [
            "stateId",
            "stateName",
            "stateAbbr",
            "stateRegion"
        ]
    }
});

export default usStatesCollection;
