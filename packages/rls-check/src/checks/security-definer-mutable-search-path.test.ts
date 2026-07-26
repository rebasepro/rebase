import { describe, expect, it } from "vitest";

import { routine, snapshot } from "../../test/fixtures/snapshot";
import { securityDefinerMutableSearchPath } from "./security-definer-mutable-search-path";

describe("security-definer-mutable-search-path", () => {
    it("flags a SECURITY DEFINER routine with no pinned search_path", () => {
        const findings = securityDefinerMutableSearchPath.run(
            snapshot({
                routines: [
                    routine("public", "promote_user", {
                        securityDefiner: true,
                        mutableSearchPath: true,
                        owner: "postgres"
                    })
                ]
            })
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].severity).toBe("medium");
        expect(findings[0].target).toMatchObject({ schema: "public", routine: "promote_user" });
        // The fix has to cover overloads, which a bare ALTER FUNCTION cannot.
        expect(findings[0].fix).toContain("'promote_user'");
        expect(findings[0].fix).toContain("ALTER ROUTINE");
    });

    it("is honest that exploitability depends on who holds CREATE", () => {
        const [f] = securityDefinerMutableSearchPath.run(
            snapshot({
                routines: [routine("public", "f", { securityDefiner: true, mutableSearchPath: true })]
            })
        );

        expect(f.impact).toContain("not directly exploitable");
    });

    it("does NOT flag a SECURITY DEFINER routine that pins search_path", () => {
        const findings = securityDefinerMutableSearchPath.run(
            snapshot({
                routines: [
                    routine("public", "promote_user", {
                        securityDefiner: true,
                        mutableSearchPath: false
                    })
                ]
            })
        );

        expect(findings).toEqual([]);
    });

    it("does NOT flag an INVOKER routine, whatever its search_path", () => {
        const findings = securityDefinerMutableSearchPath.run(
            snapshot({
                routines: [routine("public", "helper", { mutableSearchPath: true })]
            })
        );

        expect(findings).toEqual([]);
    });

    it("ignores routines outside the scanned schemas", () => {
        const findings = securityDefinerMutableSearchPath.run(
            snapshot({
                schemas: ["public"],
                routines: [
                    routine("auth", "internal", { securityDefiner: true, mutableSearchPath: true })
                ]
            })
        );

        expect(findings).toEqual([]);
    });
});
