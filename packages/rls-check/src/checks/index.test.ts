import { describe, expect, it } from "vitest";

import { SEVERITIES, type Check } from "../types";
import { grant, policy, snapshot, table } from "../../test/fixtures/snapshot";
import { CHECKS, runChecks } from "./index";

/** Ids are a public API — they end up in `--skip` lists and CI baselines. */
const EXPECTED_IDS = [
    "rls-disabled",
    "policy-always-true",
    "policy-anonymous-tautology",
    "policy-authenticated-tautology",
    "view-bypasses-rls",
    "matview-bypasses-rls",
    "anonymous-write-allowed",
    "unqualified-column-in-subquery",
    "junction-table-unprotected",
    "rls-enabled-not-forced",
    "rls-enabled-no-policies",
    "policy-role-unreachable",
    "grant-to-public",
    "security-definer-mutable-search-path",
    "current-setting-throws"
];

const messy = () =>
    snapshot({
        relations: [
            table("public", "orders", { estimatedRows: 5 }),
            table("public", "events", { estimatedRows: 900000 }),
            table("public", "settings", { rlsEnabled: true })
        ],
        grants: [
            grant("public", "orders", "anon", ["SELECT"]),
            grant("public", "events", "anon", ["SELECT"]),
            grant("public", "settings", "PUBLIC", ["SELECT"])
        ],
        policies: [policy("public", "settings", "open", { using: "true", roles: ["anon"] })]
    });

describe("CHECKS", () => {
    it("registers exactly the documented ids, once each", () => {
        expect(CHECKS.map((c) => c.id)).toEqual(EXPECTED_IDS);
    });

    it("gives every check a title and a description for --list-checks", () => {
        for (const check of CHECKS) {
            expect(check.title.length).toBeGreaterThan(0);
            expect(check.description.length).toBeGreaterThan(0);
        }
    });
});

describe("runChecks", () => {
    it("stamps every finding with its docs anchor", () => {
        for (const f of runChecks(messy())) {
            expect(f.docs).toBe(`https://rebase.pro/docs/rls-check#${f.id}`);
        }
    });

    it("returns findings worst first, biggest blast radius first within a severity", () => {
        const findings = runChecks(messy());
        const ranks = findings.map((f) => SEVERITIES.indexOf(f.severity));

        expect(findings[0].severity).toBe("critical");
        expect(ranks).toEqual([...ranks].sort((a, b) => b - a));

        const criticalTables = findings
            .filter((f) => f.severity === "critical" && f.id === "rls-disabled")
            .map((f) => f.target.table);
        expect(criticalTables).toEqual(["events", "orders"]);
    });

    it("honours `only`", () => {
        const findings = runChecks(messy(), { only: ["grant-to-public"] });

        expect(findings.length).toBeGreaterThan(0);
        expect(new Set(findings.map((f) => f.id))).toEqual(new Set(["grant-to-public"]));
    });

    it("honours `skip`", () => {
        const findings = runChecks(messy(), { skip: ["rls-disabled"] });

        expect(findings.some((f) => f.id === "rls-disabled")).toBe(false);
        expect(findings.length).toBeGreaterThan(0);
    });

    it("treats an empty `only` as no filter at all", () => {
        expect(runChecks(messy(), { only: [] }).length).toBe(runChecks(messy()).length);
    });

    it("degrades an exploding check to a skipped one rather than failing the scan", () => {
        const exploding: Check = {
            id: "boom",
            title: "boom",
            description: "boom",
            run() {
                throw new Error("catalog shape nobody anticipated");
            }
        };
        CHECKS.push(exploding);

        try {
            const findings = runChecks(messy());
            expect(findings.length).toBeGreaterThan(0);
            expect(findings.some((f) => f.id === "boom")).toBe(false);
        } finally {
            CHECKS.pop();
        }
    });

    it("returns nothing at all for an empty database", () => {
        expect(runChecks(snapshot())).toEqual([]);
    });
});
