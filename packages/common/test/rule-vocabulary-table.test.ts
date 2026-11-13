/**
 * The rule vocabulary says `table`: `policy.existsIn({ table, where })` and
 * `tenant.from.membership.table`, where both used to say `collection`.
 *
 * Two promises ride on the rename. Policy names in deployed databases do not
 * move — an unnamed policy's name hashes the rule as written, and an
 * `existsIn` node sits inside its condition, so the hash reads the node in its
 * frozen old spelling. And a legacy collection that still says `collection`
 * is lifted to a table that says `table`.
 */
import { policy, type PolicyExpression, type SecurityRule, type TenantSource } from "@rebasepro/types";
import { type LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { getPolicyNameHash, getPolicyNamesForRule, newShapeHashInput } from "@rebasepro/utils";
import { collectionToTableDef, liftRuleSpelling, liftTenantSourceSpelling } from "../src/migrate";
import { policyToPostgres } from "../src/util/policy";

/** A value from outside the type system: a legacy config, a stored rule. */
const legacyRule = (json: string): SecurityRule => JSON.parse(json);
const legacySource = (json: string): TenantSource => JSON.parse(json);

const where = policy.compare(policy.field("user_id"), "eq", policy.authUid());

describe("existsIn names its table", () => {
    it("builds `{ kind, table, where }`", () => {
        expect(policy.existsIn({ table: "team_members", where })).toEqual({ kind: "existsIn", table: "team_members", where });
        expect(Object.keys(policy.existsIn({ table: "m", where }))).toEqual(["kind", "table", "where"]);
    });

    it("compiles the join table from `table`", () => {
        expect(policyToPostgres(policy.existsIn({ table: "team_members", where })))
            .toBe("EXISTS (SELECT 1 FROM \"public\".\"team_members\" \"_ex0\" WHERE (\"_ex0\".user_id)::text = (SELECT rebase.uid()))");
    });
});

describe("policy names do not move with the rename", () => {
    const written: SecurityRule = {
        operation: "select",
        condition: policy.or(policy.rolesOverlap(["admin"]), policy.existsIn({ table: "team_members", where }))
    };
    const asTheOldTypesWroteIt = legacyRule(JSON.stringify({
        operation: "select",
        condition: { kind: "or", operands: [{ kind: "rolesOverlap", roles: ["admin"] }, { kind: "existsIn", collection: "team_members", where }] }
    }));

    it("hashes `table` exactly as the old `collection` spelling hashed", () => {
        expect(getPolicyNameHash(written)).toBe(getPolicyNameHash(asTheOldTypesWroteIt));
        expect(getPolicyNamesForRule(written, "documents")).toEqual(getPolicyNamesForRule(asTheOldTypesWroteIt, "documents"));
    });

    it("does the same inside a new-shape rule", () => {
        const fresh: SecurityRule = { operation: "select", access: "authenticated", condition: policy.existsIn({ table: "m", where }) };
        const old = legacyRule(JSON.stringify({ operation: "select", access: "authenticated", condition: { kind: "existsIn", collection: "m", where } }));
        expect(newShapeHashInput(fresh)).toBe(newShapeHashInput(old));
    });

    it("leaves a column named `table` in a shorthand alone", () => {
        expect(getPolicyNameHash({ operation: "select", condition: { table: "a" } }))
            .not.toBe(getPolicyNameHash({ operation: "select", condition: { collection: "a" } }));
    });
});

describe("lifting a legacy collection respells its rules and tenancy", () => {
    it("respells `existsIn.collection` as `table`, nested, and keeps everything else as it was", () => {
        const old = legacyRule(JSON.stringify({
            name: "members_read",
            operation: "select",
            condition: { kind: "and", operands: [{ kind: "not", operand: { kind: "existsIn", collection: "bans", where } }, { kind: "existsIn", collection: "members", where }] }
        }));
        const lifted = liftRuleSpelling(old);
        const expected: PolicyExpression = policy.and(
            policy.not(policy.existsIn({ table: "bans", where })),
            policy.existsIn({ table: "members", where })
        );
        expect(lifted).toEqual({ name: "members_read", operation: "select", condition: expected });
        expect(getPolicyNamesForRule(lifted, "docs")).toEqual(getPolicyNamesForRule(old, "docs"));
    });

    it("returns a rule already in the new spelling, or with no existsIn, as the same object", () => {
        const fresh: SecurityRule = { operation: "select", condition: policy.existsIn({ table: "m", where }) };
        const owner: SecurityRule = { operation: "select", ownerField: "userId" };
        const shorthand: SecurityRule = { operation: "select", condition: { status: "published" } };
        for (const rule of [fresh, owner, shorthand]) expect(liftRuleSpelling(rule)).toBe(rule);
    });

    it("respells a membership tenant source", () => {
        expect(liftTenantSourceSpelling(legacySource("{\"membership\":{\"collection\":\"memberships\",\"userField\":\"userId\",\"tenantField\":\"orgId\"}}")))
            .toEqual({ membership: { table: "memberships", userField: "userId", tenantField: "orgId" } });
        const claim: TenantSource = { claim: "org_id" };
        expect(liftTenantSourceSpelling(claim)).toBe(claim);
    });

    it("lifts a whole legacy collection into a table that says `table`", () => {
        const collection: LegacyCollectionConfig = {
            name: "Docs", slug: "docs", table: "docs",
            properties: {
                id: { name: "ID", type: "string", isId: "uuid" },
                orgId: { name: "Org", type: "string", columnName: "org_id" }
            },
            securityRules: [legacyRule(JSON.stringify({ operation: "select", condition: { kind: "existsIn", collection: "memberships", where } }))],
            tenant: { field: "orgId", from: legacySource("{\"membership\":{\"collection\":\"memberships\",\"userField\":\"userId\",\"tenantField\":\"orgId\"}}") }
        };
        const { table } = collectionToTableDef(collection);
        expect(table.config).toMatchObject({
            rls: [{ operation: "select", condition: { kind: "existsIn", table: "memberships", where } }],
            tenant: { field: "orgId", from: { membership: { table: "memberships", userField: "userId", tenantField: "orgId" } } }
        });
        expect(JSON.stringify(table.config)).not.toContain("\"collection\"");
    });
});
