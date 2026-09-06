/**
 * What `runAtlas` hands the Atlas binary.
 *
 * The flag that made this worth a test is `--exclude`. Atlas rejects an
 * unknown flag before doing any work, so a flag on the wrong subcommand is not
 * a degraded run — it is no run at all. Only `atlas schema apply` takes it;
 * `migrate diff` and `migrate apply` both answer `unknown flag: --exclude`.
 *
 * The guard that shipped was `args.includes("apply") || args.includes("diff")`,
 * which cannot tell `schema apply` from `migrate apply` — so both
 * `rebase db generate` and `rebase db migrate` exited 1 for every project
 * declaring a `search` block, from the day search shipped until it was
 * measured three weeks later. Nothing covered the argv, so nothing said so.
 *
 * Hence the matrix below is over (domain, subcommand) pairs, not subcommands.
 */
import { acceptsExcludeFlag, buildAtlasArgs } from "../src/schema/atlas-argv";

const URL = "postgres://u:p@localhost:5432/app";
const DEV_URL = "postgres://u:p@localhost:5432/app_dev_diff";
const EXCLUDES = ["public.talents.search_vector", "public.talents.talents_search_vector_gin"];

const build = (domain: string, args: string[], excludes: string[] = EXCLUDES) =>
    buildAtlasArgs({ domain, args, url: URL, devUrl: DEV_URL, excludes });

describe("--exclude goes only where Atlas accepts it", () => {
    it("`schema apply` takes it — that is the whole protection on the push path", () => {
        const argv = build("schema", ["apply", "--to", "file://drizzle/schema.sql"]);
        expect(argv).toContain("--exclude");
        expect(argv.filter((a) => a === "--exclude")).toHaveLength(EXCLUDES.length);
        for (const exclude of EXCLUDES) {
            expect(argv[argv.indexOf(exclude) - 1]).toBe("--exclude");
        }
    });

    it("`migrate diff` never does — Atlas answers `unknown flag: --exclude` and exits 1", () => {
        const argv = build("migrate", ["diff", "init", "--dir", "file://drizzle/migrations", "--to", "file://drizzle/schema.sql"]);
        expect(argv).not.toContain("--exclude");
        expect(argv.join(" ")).not.toContain("search_vector");
    });

    it("`migrate apply` never does either — it is not `schema apply`", () => {
        // The subcommand word is the same; the domain is what distinguishes
        // them, and a guard that reads only `args` took `rebase db migrate`
        // down alongside `db generate`.
        const argv = build("migrate", ["apply", "--dir", "file://drizzle/migrations"]);
        expect(argv).not.toContain("--exclude");
        expect(acceptsExcludeFlag("migrate", ["apply"])).toBe(false);
        expect(acceptsExcludeFlag("schema", ["apply"])).toBe(true);
    });

    it("nor does any other invocation", () => {
        const cases: [string, string[]][] = [
            ["migrate", ["apply", "--dir", "file://drizzle/migrations"]],
            ["migrate", ["status", "--dir", "file://drizzle/migrations"]],
            ["migrate", ["hash", "--dir", "file://drizzle/migrations"]],
            ["schema", ["inspect"]],
            ["schema", ["clean"]]
        ];
        for (const [domain, args] of cases) {
            expect(build(domain, args)).not.toContain("--exclude");
        }
    });

    it("the predicate and the builder agree, so neither can drift alone", () => {
        const cases: [string, string[]][] = [
            ["schema", ["apply"]],
            ["schema", ["inspect"]],
            ["migrate", ["diff", "name"]],
            ["migrate", ["apply"]],
            ["migrate", ["hash"]]
        ];
        for (const [domain, args] of cases) {
            expect(build(domain, args).includes("--exclude")).toBe(acceptsExcludeFlag(domain, args));
        }
    });

    it("`schema apply` with nothing to exclude passes no empty flag", () => {
        expect(build("schema", ["apply"], [])).not.toContain("--exclude");
    });
});

describe("the connection flags each subcommand needs", () => {
    it("`schema apply` gets both the target and the database Atlas plans in", () => {
        const argv = build("schema", ["apply", "--to", "file://drizzle/schema.sql"], []);
        expect(argv).toEqual(["schema", "apply", "--to", "file://drizzle/schema.sql", "--url", URL, "--dev-url", DEV_URL]);
    });

    it("`migrate diff` gets only the dev database — it never touches the real one", () => {
        const argv = build("migrate", ["diff", "init", "--dir", "file://drizzle/migrations"], []);
        expect(argv).toEqual(["migrate", "diff", "init", "--dir", "file://drizzle/migrations", "--dev-url", DEV_URL]);
        expect(argv).not.toContain("--url");
    });

    it("`migrate apply` gets the revisions schema and --allow-dirty", () => {
        const argv = build("migrate", ["apply", "--dir", "file://drizzle/migrations"], []);
        expect(argv).toEqual([
            "migrate", "apply", "--dir", "file://drizzle/migrations",
            "--url", URL, "--revisions-schema", "rebase", "--allow-dirty"
        ]);
    });

    it("`migrate apply --baseline` drops --allow-dirty, which Atlas refuses beside it", () => {
        // Measured against the pinned binary: `sql/migrate: baseline and
        // allow-dirty are mutually exclusive`, so sending both refuses the
        // command outright — the same shape as the `--exclude` failure this
        // whole module exists for.
        const argv = build("migrate", ["apply", "--dir", "file://drizzle/migrations", "--baseline", "20260101000000"], []);
        expect(argv).toEqual([
            "migrate", "apply", "--dir", "file://drizzle/migrations", "--baseline", "20260101000000",
            "--url", URL, "--revisions-schema", "rebase"
        ]);
        expect(argv).not.toContain("--allow-dirty");
    });

    it("`migrate status` gets the revisions schema but not --allow-dirty", () => {
        const argv = build("migrate", ["status"], []);
        expect(argv).toEqual(["migrate", "status", "--url", URL, "--revisions-schema", "rebase"]);
    });

    it("`migrate hash` needs no connection at all", () => {
        expect(build("migrate", ["hash", "--dir", "file://drizzle/migrations"], []))
            .toEqual(["migrate", "hash", "--dir", "file://drizzle/migrations"]);
    });

    it("`schema inspect` and `schema clean` read the target only", () => {
        expect(build("schema", ["inspect"], [])).toEqual(["schema", "inspect", "--url", URL]);
        expect(build("schema", ["clean"], [])).toEqual(["schema", "clean", "--url", URL]);
    });

    it("the caller's own args come first and are never reordered", () => {
        const argv = build("migrate", ["diff", "add_headline", "--dir", "file://d", "--to", "file://s.sql"], []);
        expect(argv.slice(0, 7)).toEqual(["migrate", "diff", "add_headline", "--dir", "file://d", "--to", "file://s.sql"]);
    });
});
