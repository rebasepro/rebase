import {
    compareVersions,
    describeDriverSkew,
    schemaRecoveryGuidance
} from "../src/boot/version-skew";

/**
 * Telling "this driver never had the feature" apart from "this driver is old".
 *
 * The distinction is the whole point of the module. A managed deployment builds
 * its runtime from two independently versioned halves — the image supplies
 * `@rebasepro/server`, the bundle's own dependencies supply the driver — so a
 * platform-side fix can be fully shipped and still absent from every tenant. On
 * the day that happened, boot reported the driver "does not implement" the
 * capability, which reads as a permanent property of that driver rather than a
 * stale pin, and the investigation went after the runtime image instead.
 *
 * These tests pin the two behaviours that keep the diagnosis honest: canaries
 * must sort below the release they precede (fixes land there first, so getting
 * this backwards would report every canary as newer than the stable it leads
 * to), and anything unparseable must decline to judge rather than guess.
 */
describe("compareVersions", () => {
    it("orders by numeric precedence", () => {
        expect(compareVersions("0.11.0", "0.12.0")).toBe(-1);
        expect(compareVersions("0.12.0", "0.11.0")).toBe(1);
        expect(compareVersions("0.12.0", "0.12.0")).toBe(0);
        expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    });

    it("sorts a prerelease below the release it leads to", () => {
        // The real pairing from the incident: the fix existed only in canaries
        // built after 0.12.0 shipped, so a naive string compare — or treating a
        // prerelease as newer — would have called the stale pin current.
        expect(compareVersions("0.12.1-canary.g7f1150f", "0.12.1")).toBe(-1);
        expect(compareVersions("0.12.1", "0.12.1-canary.g7f1150f")).toBe(1);
        expect(compareVersions("0.12.0", "0.12.1-canary.g7f1150f")).toBe(-1);
    });

    it("orders two prereleases of the same version deterministically", () => {
        expect(compareVersions("0.12.1-canary.a", "0.12.1-canary.b")).toBe(-1);
        expect(compareVersions("0.12.1-canary.b", "0.12.1-canary.a")).toBe(1);
        expect(compareVersions("0.12.1-canary.a", "0.12.1-canary.a")).toBe(0);
    });

    it("declines to judge a version it cannot parse", () => {
        // A fork, a git specifier, a workspace link. Refusing beats inventing a
        // skew warning that sends someone chasing a version that is correct.
        expect(compareVersions("not-a-version", "0.12.0")).toBeUndefined();
        expect(compareVersions("0.12.0", "")).toBeUndefined();
        expect(compareVersions("0.12", "0.12.0")).toBeUndefined();
    });
});

describe("describeDriverSkew", () => {
    it("flags a driver older than the runtime and names both versions", () => {
        const skew = describeDriverSkew("0.12.0", "0.12.1-canary.g7f1150f");
        expect(skew.stale).toBe(true);
        expect(skew.detail).toContain("0.12.0");
        expect(skew.detail).toContain("0.12.1-canary.g7f1150f");
        expect(skew.detail).toContain("OLDER");
    });

    it("does not flag a current driver, but still reports both versions", () => {
        // The equal case still carries detail on purpose: "the driver is
        // current" is what redirects an investigation away from staleness.
        const skew = describeDriverSkew("0.12.0", "0.12.0");
        expect(skew.stale).toBe(false);
        expect(skew.detail).toContain("0.12.0");
    });

    it("never calls a newer driver stale", () => {
        // `stale` means "behind, so capabilities are missing". Ahead is a
        // different problem with the opposite remedy, reported separately.
        expect(describeDriverSkew("0.13.0", "0.12.0").stale).toBe(false);
    });

    it("flags a driver a minor or more ahead of the runtime", () => {
        // The image lagging the packages a bundle was built against. Half of a
        // cross-package feature runs, the other half is absent, nothing errors.
        expect(describeDriverSkew("0.15.0", "0.13.0").ahead).toBe(true);
        expect(describeDriverSkew("1.0.0", "0.15.0").ahead).toBe(true);
    });

    it("does not flag a driver merely a patch ahead", () => {
        // Taking a fix early is deliberate and supported. Warning here is what
        // would make the line noise, so the minor is the threshold.
        expect(describeDriverSkew("0.12.1", "0.12.0").ahead).toBe(false);
        expect(describeDriverSkew("0.12.0", "0.12.0").ahead).toBe(false);
    });

    it("stays silent when either version is unknown", () => {
        expect(describeDriverSkew(undefined, "0.12.0")).toEqual({ stale: false, ahead: false });
        expect(describeDriverSkew("0.12.0", undefined)).toEqual({ stale: false, ahead: false });
        expect(describeDriverSkew("weird", "0.12.0")).toEqual({ stale: false, ahead: false });
    });

    it("declines to judge an unparseable runtime rather than guessing a direction", () => {
        // A fork's custom version string must not produce a confident wrong
        // diagnosis in either direction.
        const skew = describeDriverSkew("0.15.0", "nightly");
        expect(skew.stale).toBe(false);
        expect(skew.ahead).toBe(false);
    });
});

describe("schemaRecoveryGuidance", () => {
    it("addresses managed and self-host separately", () => {
        const text = schemaRecoveryGuidance();
        expect(text).toContain("Managed cloud");
        expect(text).toContain("Self-host");
    });

    it("never tells a managed operator to run a command that cannot reach their database", () => {
        // The original guidance named only the pnpm scripts. Those target a
        // local DATABASE_URL and cannot touch a tenant's in-cluster Postgres,
        // so a managed reader was handed a dead end. `db push` may still appear
        // — under the self-host bullet — but the managed bullet must say the
        // opposite, and it must be the first thing that bullet says.
        const managedBullet = schemaRecoveryGuidance()
            .split("• ")
            .find(part => part.startsWith("Managed cloud"));
        expect(managedBullet).toBeDefined();
        expect(managedBullet).toContain("cannot reach");
        expect(managedBullet).toContain("redeploy");
    });

    it("says to bump the pinned driver only when the driver is the stale part", () => {
        // The pin is the actionable lever precisely when the driver is behind:
        // redeploying alone re-installs the same pinned version and changes
        // nothing, which is what made the first recovery attempt fail.
        expect(schemaRecoveryGuidance({ staleDriver: true })).toContain("package.json");
        expect(schemaRecoveryGuidance({ staleDriver: true })).toContain("@rebasepro/server-postgres");
        expect(schemaRecoveryGuidance({ staleDriver: false })).not.toContain("package.json");
    });
});
