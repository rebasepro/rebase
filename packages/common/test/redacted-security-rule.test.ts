import { describe, expect, it } from "@jest/globals";
import { col, defineTable } from "@rebasepro/types";
import type { SecurityRule } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import {
    SchemaDefinitionError,
    compileTables
} from "../src";
import {
    compileRulePolicies
} from "./helpers/legacy-policies";

/**
 * The marker `GET /api/schema/tables` serves in place of a rule whose SQL it
 * withheld (`{ …targeting, redacted: true }`): the evaluator answers it
 * "unknown" exactly as it answers a raw rule, and nothing ever compiles a
 * policy from it.
 */

function table(securityRules: SecurityRule[]): LegacyCollectionConfig {
    return { name: "notes", slug: "notes", table: "notes", properties: { id: { name: "id", type: "string", isId: "uuid" } }, securityRules };
}

describe("the redacted marker is never a policy", () => {
    it("compileRulePolicies refuses it, naming the table", () => {
        expect(() => compileRulePolicies(table([]), { operation: "select", redacted: true }))
            .toThrow(/"notes".*redacted: true/s);
    });

    it("a table authoring one is refused when it is compiled", () => {
        const notes = defineTable("notes", {
            columns: { id: col.uuid().primaryKey().defaultRandom() },
            rls: [{ operation: "select", redacted: true }]
        });
        expect(() => compileTables([notes])).toThrow(SchemaDefinitionError);
        expect(() => compileTables([notes])).toThrow(/redacted/);
    });
});

