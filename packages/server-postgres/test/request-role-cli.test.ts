/**
 * The pure halves of `rebase db request-role migrate` and `rebase db provision
 * --print`: the lines they accept, which roles a migration moves between, and
 * what they print. The database halves are the security modules' own.
 */
import {
    asSqlScript,
    parseProvisionLine,
    parseRequestRoleLine,
    renderMigrationPlan,
    renderProvisionScript,
    renderRevokeOld,
    requestRoleReminder,
    resolveMigrationRoles
} from "../src/request-role-cli";
import { appRoleSetupInstructions } from "../src/security/rls-enforcement";

// eslint-disable-next-line no-control-regex
const plain = (lines: string[]): string => lines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");

describe("parseRequestRoleLine", () => {
    it("reads the action, the roles and the switches", () => {
        expect(parseRequestRoleLine(["db", "request-role", "migrate", "--to", "acme_prod_user"]))
            .toEqual({ action: "migrate", to: ["acme_prod_user"], dryRun: false, yes: false });
        expect(parseRequestRoleLine(["db", "request-role", "migrate", "--to=authenticated, anon,authenticated", "--dry-run", "-y"]))
            .toEqual({ action: "migrate", to: ["authenticated", "anon"], dryRun: true, yes: true });
    });

    it("accepts the flags the CLI relays", () => {
        expect(() => parseRequestRoleLine([
            "db", "request-role", "migrate", "--to", "x_user", "--database-url", "postgres://u:p@h/db", "--docker", "--debug"
        ])).not.toThrow();
    });

    it.each([
        [["db", "request-role"], /needs an action/],
        [["db", "request-role", "--to", "x"], /needs an action/],
        [["db", "request-role", "migrat", "--to", "x"], /no action "migrat" — did you mean migrate\?/],
        [["db", "request-role", "migrate"], /needs --to <role\[,role\]>/],
        [["db", "request-role", "migrate", "--too", "x"], /has no option --too — did you mean --to\?/],
        [["db", "request-role", "migrate", "--to", "x", "extra"], /takes no argument "extra"/],
        [["db", "request-role", "migrate", "--to", "Bad-Name"], /--to Bad-Name: "Bad-Name" is not a usable role name/],
        [["db", "request-role", "migrate", "--to", " , "], /needs at least one role name/]
    ])("refuses %j with nothing run", (line, message) => {
        expect(() => parseRequestRoleLine(line)).toThrow(message);
    });
});

describe("parseProvisionLine", () => {
    it("accepts --print", () => {
        expect(parseProvisionLine(["db", "provision", "--print"])).toEqual({ print: true });
    });

    it.each([
        [["db", "provision"], /pass --print/],
        [["db", "provision", "--prnt"], /has no option --prnt — did you mean --print\?/],
        [["db", "provision", "--print", "now"], /takes no argument "now"/]
    ])("refuses %j", (line, message) => {
        expect(() => parseProvisionLine(line)).toThrow(message);
    });
});

describe("resolveMigrationRoles", () => {
    it("moves from rebase_user when the database recorded nothing", () => {
        expect(resolveMigrationRoles(undefined, ["acme_prod_user"])).toEqual({ from: ["rebase_user"], to: ["acme_prod_user"] });
        expect(resolveMigrationRoles([], ["acme_prod_user"])).toEqual({ from: ["rebase_user"], to: ["acme_prod_user"] });
    });

    it("moves from the recorded roles", () => {
        expect(resolveMigrationRoles(["acme_prod_user"], ["authenticated", "anon"]))
            .toEqual({ from: ["acme_prod_user"], to: ["authenticated", "anon"] });
    });

    it("has nothing to do when the roles are already the target, in any order", () => {
        expect(resolveMigrationRoles(undefined, ["rebase_user"])).toBeNull();
        expect(resolveMigrationRoles(["anon", "authenticated"], ["authenticated", "anon"])).toBeNull();
    });
});

describe("renderMigrationPlan", () => {
    const plan = {
        statements: ["GRANT SELECT ON TABLE \"public\".\"posts\" TO \"acme_prod_user\""],
        revokeOld: ["REVOKE SELECT ON TABLE \"public\".\"posts\" FROM \"rebase_user\""]
    };
    const roles = { from: ["rebase_user"], to: ["acme_prod_user"] };

    it("prints the statements and, on a dry run, the revokes", () => {
        const text = plain(renderMigrationPlan(plan, roles, true));
        expect(text).toContain("Would run, in one transaction:");
        expect(text).toContain("GRANT SELECT ON TABLE \"public\".\"posts\" TO \"acme_prod_user\";");
        expect(text).toContain("Run these once you no longer need \"rebase_user\" in this database:");
        expect(text).toContain("REVOKE SELECT ON TABLE \"public\".\"posts\" FROM \"rebase_user\";");
    });

    it("leaves the revokes for after the run otherwise", () => {
        const text = plain(renderMigrationPlan(plan, roles, false));
        expect(text).toContain("Will run, in one transaction:");
        expect(text).not.toContain("REVOKE");
    });

    it("says when the old role holds nothing here", () => {
        const empty = { statements: [], revokeOld: [] };
        expect(plain(renderMigrationPlan(empty, roles, true))).toContain("holds no grants here: nothing to copy");
        expect(plain(renderRevokeOld(empty, roles.from))).toContain("nothing to take back");
    });
});

describe("requestRoleReminder", () => {
    it("names the environment variable for one role", () => {
        expect(requestRoleReminder(["acme_prod_user"])).toContain("REBASE_RLS_REQUEST_ROLE=acme_prod_user");
    });

    it("sends several roles to the setting in code, which is the only place they fit", () => {
        const text = requestRoleReminder(["authenticated", "anon"]);
        expect(text).not.toContain("REBASE_RLS_REQUEST_ROLE");
        expect(text).toContain("rls.requestRoles: [\"authenticated\", \"anon\"]");
    });
});

describe("renderProvisionScript", () => {
    it("prints a script psql can run whole: the prose as comments, the SQL as it is", () => {
        const script = renderProvisionScript(
            "app_owner",
            { roles: ["acme_prod_user"], grants: "schema", provisionRole: "never" },
            (role) => appRoleSetupInstructions("app_owner", ["public", "rebase"], role, "schema")
        );
        const lines = script.split("\n");
        expect(lines[0]).toMatch(/^-- /);
        expect(script).toContain("Request role(s): \"acme_prod_user\". grants: schema. provisionRole: never.");
        expect(script).toContain("CREATE ROLE acme_prod_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;");
        expect(script).toContain("GRANT USAGE ON SCHEMA \"public\" TO acme_prod_user;");
        // Every line is a comment, blank, or SQL from the instructions: none of the prose is left bare.
        expect(lines.filter((line) => line.startsWith("Rebase enforces"))).toEqual([]);
    });

    it("says why there are no schema-wide grants under grants: managed", () => {
        const script = renderProvisionScript(
            "app_owner",
            { roles: ["rebase_user"], grants: "managed", provisionRole: "auto" },
            (role) => appRoleSetupInstructions("app_owner", ["public"], role, "managed")
        );
        expect(script).toContain("-- grants: managed");
        expect(script).not.toContain("ON ALL TABLES IN SCHEMA");
    });

    it("prints one block per role", () => {
        const script = renderProvisionScript(
            "app_owner",
            { roles: ["authenticated", "anon"], grants: "schema", provisionRole: "auto" },
            (role) => `About ${role}.\n\nSELECT '${role}';`
        );
        expect(script).toContain("-- ── \"authenticated\" ──\n-- About authenticated.\nSELECT 'authenticated';");
        expect(script).toContain("-- ── \"anon\" ──\n-- About anon.\nSELECT 'anon';");
    });
});

describe("asSqlScript", () => {
    it("leaves text with no prose paragraph alone", () => {
        expect(asSqlScript("SELECT 1;")).toBe("SELECT 1;");
    });
});
