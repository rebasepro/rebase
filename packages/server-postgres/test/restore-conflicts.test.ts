/**
 * `db restore` into a database that already holds what the backup creates.
 *
 * Without `--clean`, pg_restore stops at the first object that exists. The
 * restore ended in pg_restore's own `schema "rebase" already exists` and
 * execa's `Command failed with exit code 1: /opt/homebrew/bin/pg_restore …`,
 * with no word about `--clean` or a new database, and only after the cluster
 * roles from the backup's sidecar had been applied. The conflict is read from
 * the dump's table of contents and the target's catalogue before anything runs.
 */
import { buildPgRestoreScriptArgs, buildPsqlScriptArgs, cleanRestorePrelude, parseDumpObjects } from "../src/backup/pg-tools";
import { describeCleanExtras, describeCleanRestoreFailure, describeRestoreConflict } from "../src/backup/backup-cli";

jest.mock("execa", () => ({ execa: jest.fn() }));

/** `pg_restore --list` of a Rebase database, pg_restore 18.6, captured verbatim. */
const LIST = `;
; Archive created at 2026-10-14 04:15:03 UTC
;     dbname: rebase
;     TOC Entries: 16
;     Format: CUSTOM
;
; Selected TOC Entries:
;
6; 2615 16425 SCHEMA - rebase rebase
223; 1259 16429 TABLE public Odd Name rebase
221; 1259 16408 TABLE public tags rebase
220; 1259 16407 SEQUENCE public tags_id_seq rebase
3492; 0 0 SEQUENCE OWNED BY public tags_id_seq rebase
222; 1259 16426 TABLE rebase users rebase
3332; 2604 16411 DEFAULT public tags id rebase
3485; 0 16429 TABLE DATA public Odd Name rebase
3483; 0 16408 TABLE DATA public tags rebase
3484; 0 16426 TABLE DATA rebase users rebase
3334; 2606 16416 CONSTRAINT public tags tags_pkey rebase
`;

describe("the objects a dump creates", () => {
    it("reads its schemas and tables, not their data or anything else", () => {
        expect(parseDumpObjects(LIST)).toEqual({
            schemas: ["rebase"],
            tables: [
                { schema: "public", table: "Odd Name" },
                { schema: "public", table: "tags" },
                { schema: "rebase", table: "users" }
            ],
            relations: [
                { schema: "public", name: "Odd Name" },
                { schema: "public", name: "tags" },
                { schema: "public", name: "tags_id_seq" },
                { schema: "rebase", name: "users" }
            ],
            routines: [],
            types: []
        });
    });

    it("reads its functions, procedures and aggregates by name, and its types and domains", () => {
        // pg_restore 18.4, captured verbatim, with the entries about them.
        const list = [
            "903; 1247 16406 DOMAIN rebase email rebase",
            "906; 1247 16409 TYPE rebase pair rebase",
            "900; 1247 16402 TYPE rebase role rebase",
            "227; 1255 16399 PROCEDURE rebase proc() rebase",
            "226; 1255 16398 FUNCTION rebase two(integer, text) rebase",
            "225; 1255 16397 FUNCTION rebase uid() rebase",
            "917; 1255 16400 AGGREGATE rebase agg(integer) rebase",
            "3550; 0 0 ACL rebase FUNCTION uid() rebase",
            "3551; 0 0 COMMENT rebase TYPE role rebase"
        ].join("\n");
        const objects = parseDumpObjects(list);
        expect(objects.routines).toEqual([
            { schema: "rebase", name: "proc" },
            { schema: "rebase", name: "two" },
            { schema: "rebase", name: "uid" },
            { schema: "rebase", name: "agg" }
        ]);
        expect(objects.types).toEqual([
            { schema: "rebase", name: "email" },
            { schema: "rebase", name: "pair" },
            { schema: "rebase", name: "role" }
        ]);
        expect(objects.relations).toEqual([]);
    });

    it("reads views, materialized views and foreign tables as relations, and no entry about one", () => {
        const list = [
            "230; 1259 16500 VIEW public recent rebase",
            "231; 1259 16501 MATERIALIZED VIEW public totals rebase",
            "232; 1259 16502 FOREIGN TABLE public remote rebase",
            "3500; 0 16501 MATERIALIZED VIEW DATA public totals rebase",
            "3501; 0 0 SEQUENCE SET public tags_id_seq rebase"
        ].join("\n");
        expect(parseDumpObjects(list).relations).toEqual([
            { schema: "public", name: "recent" },
            { schema: "public", name: "totals" },
            { schema: "public", name: "remote" }
        ]);
    });

    it("reads nothing from an empty table of contents", () => {
        expect(parseDumpObjects(";\n; Selected TOC Entries:\n;\n")).toEqual({ schemas: [], tables: [], relations: [], routines: [], types: [] });
    });
});

describe("the refusal", () => {
    it("names what is in the way and both ways round it", () => {
        const { message, hint } = describeRestoreConflict("shop", "./backups/x.dump",
            ["schema rebase", "table public.tags", "table rebase.users"]);
        expect(message).toBe(
            "\"shop\" already holds schema rebase, table public.tags, table rebase.users, which this backup creates. " +
            "Without --clean, pg_restore stops at the first of them. Nothing was restored or changed."
        );
        expect(hint).toContain("rebase db restore ./backups/x.dump --clean");
        expect(hint).toContain("rebase db restore ./backups/x.dump --create-db --target-db <new name>");
    });

    it("keeps the database the user named, and the --yes they typed, in both commands", () => {
        const { hint } = describeRestoreConflict("shop", "x.dump", ["schema rebase"], {
            targetDb: "shop",
            carried: ["--docker", "--yes"]
        });
        expect(hint).toContain("rebase db restore x.dump --target-db shop --clean --docker --yes");
        expect(hint).toContain("rebase db restore x.dump --create-db --target-db <new name> --docker --yes");
    });

    it("counts what it does not list", () => {
        const many = Array.from({ length: 8 }, (_, i) => `table public.t${i}`);
        expect(describeRestoreConflict("shop", "x.dump", many).message).toMatch(/table public\.t4, and 3 more, which/);
    });
});

describe("restore --clean", () => {
    const objects = parseDumpObjects(LIST);

    it("drops the backup's schemas whole, and its tables in schemas it does not create, with CASCADE", () => {
        expect(cleanRestorePrelude(objects)).toEqual([
            "SET client_min_messages = warning",
            "SET lock_timeout = '15s'",
            "DROP SCHEMA IF EXISTS \"rebase\" CASCADE",
            "DROP TABLE IF EXISTS \"public\".\"Odd Name\" CASCADE",
            "DROP TABLE IF EXISTS \"public\".\"tags\" CASCADE"
        ]);
    });

    it("never drops public itself", () => {
        const withPublic = { ...objects, schemas: ["public", ...objects.schemas] };
        expect(cleanRestorePrelude(withPublic).filter(statement => statement.includes("SCHEMA"))).toEqual([
            "DROP SCHEMA IF EXISTS \"rebase\" CASCADE"
        ]);
    });

    it("has pg_restore write the script and psql run it, stopping at the first error", () => {
        expect(buildPgRestoreScriptArgs({ inputFile: "/b/x.dump", noOwner: true }))
            .toEqual(["--format=custom", "--clean", "--if-exists", "--no-owner", "--file=-", "/b/x.dump"]);
        const psql = buildPsqlScriptArgs("postgres://u@h/shop");
        expect(psql).toEqual(expect.arrayContaining(["-X", "-v", "ON_ERROR_STOP=1", "--file=-", "--dbname=postgres://u@h/shop"]));
        // The transaction is the script's own, so it can end without a COMMIT.
        expect(psql).not.toContain("--single-transaction");
        expect(psql).not.toContain("-1");
    });

    it("names what it drops that the backup does not hold, and counts past ten", () => {
        expect(describeCleanExtras(["rebase"], ["table rebase.atlas_schema_revisions"])).toEqual([
            "--clean replaces schema rebase whole, so it also drops what this backup does not hold:",
            "  table rebase.atlas_schema_revisions"
        ]);
        expect(describeCleanExtras(["rebase"], [])).toEqual([]);
        const many = Array.from({ length: 12 }, (_, i) => `table rebase.t${i}`);
        expect(describeCleanExtras(["rebase", "audit"], many).at(-1)).toBe("  and 2 more");
        expect(describeCleanExtras(["rebase", "audit"], many)[0]).toMatch(/^--clean replaces schemas rebase, audit whole/);
    });

    it("says a restore that stopped changed nothing, and why", () => {
        const failed = describeCleanRestoreFailure("shop", { tool: "psql", lockTimeout: false }, 0);
        expect(failed.message).toBe(
            "Nothing was restored or changed: the restore ran as one transaction, and it was rolled back when a statement failed (above). " +
            "\"shop\" holds what it held before."
        );
        expect(failed.hint).toBeUndefined();

        const locked = describeCleanRestoreFailure("shop", { tool: "psql", lockTimeout: true }, 3);
        expect(locked.message).toMatch(/it waited too long for a lock on "shop"/);
        expect(locked.hint).toMatch(/usually a `rebase dev` serving from it/);
        expect(locked.hint).toMatch(/The 3 cluster role\(s\) recreated from the backup's sidecar before it stay\./);

        expect(describeCleanRestoreFailure("shop", { tool: "pg_restore", lockTimeout: false }, 0).message)
            .toMatch(/pg_restore could not read the whole backup/);
    });
});
